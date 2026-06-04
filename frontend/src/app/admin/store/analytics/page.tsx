'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  BarChart3, TrendingUp, ShoppingCart, Receipt, RotateCcw,
  Package, Boxes, AlertTriangle, IndianRupee, Trophy, RefreshCw, Radio,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { api } from '@/lib/api';
import { errMsg } from '@/lib/storeHelpers';
import { formatPaise } from '@/components/store/Money';
import { useAdminStockSocket, useAdminOrdersSocket } from '@/lib/storeSockets';

/**
 * Admin store analytics dashboard — read-only KPIs from /admin/store/analytics/*.
 *
 * Every money field from the backend is INTEGER PAISE; format with formatPaise.
 * Charts are pure divs/SVG (no chart lib) per the design constraints.
 *
 * Endpoints (see store-analytics.controller.ts):
 *  - summary       → { range, orders, revenuePaise, aovPaise, units, refundsPaise, returns }
 *  - revenue       → { range, data: [{ date, orders, revenuePaise, refundsPaise, netRevenuePaise, units }] }
 *  - top-products  → { range, limit, data: [{ productId, productName, productSlug, units, revenuePaise, orders }] }
 *  - low-stock     → { data: [...], meta }
 *  - returns-rate  → { range, orders, returns, ratePercent, refundValuePaise }
 *  - inventory-value → { totalValuePaise, totalOnHand, skuCount, stockLevelCount }
 */

type Range = 'today' | '7d' | '30d';

interface Summary {
  range: Range;
  orders: number;
  revenuePaise: number;
  aovPaise: number;
  units: number;
  refundsPaise: number;
  returns: number;
}
interface RevenuePoint {
  date: string;
  orders: number;
  revenuePaise: number;
  refundsPaise: number;
  netRevenuePaise: number;
  units: number;
}
interface TopProduct {
  productId: string | null;
  productName: string;
  productSlug: string | null;
  units: number;
  revenuePaise: number;
  orders: number;
}
interface LowStockRow {
  stockLevelId: string;
  skuCode: string;
  skuName: string | null;
  warehouseCode: string;
  warehouseName: string;
  available: number;
  reorderPoint: number;
  shortfall: number;
}
interface ReturnsRate {
  range: Range;
  orders: number;
  returns: number;
  ratePercent: number;
  refundValuePaise: number;
}
interface InventoryValue {
  totalValuePaise: number;
  totalOnHand: number;
  skuCount: number;
  stockLevelCount: number;
}

const RANGES: { key: Range; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: '7d', label: '7 Days' },
  { key: '30d', label: '30 Days' },
];

function StatCard({
  icon: Icon, label, value, sub, accent,
}: { icon: LucideIcon; label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="border border-hairline bg-white p-6">
      <div className="flex items-center gap-3 mb-3">
        <Icon className={`w-5 h-5 ${accent || 'text-forest/60'}`} />
        <span className="text-[10px] uppercase tracking-widest text-ink/40 font-bold">{label}</span>
      </div>
      <div className="font-serif text-3xl font-bold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-ink/40 mt-1">{sub}</div>}
    </div>
  );
}

export default function AdminStoreAnalyticsPage() {
  const [range, setRange] = useState<Range>('7d');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [revenue, setRevenue] = useState<RevenuePoint[]>([]);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [lowStock, setLowStock] = useState<LowStockRow[]>([]);
  const [lowStockTotal, setLowStockTotal] = useState(0);
  const [returnsRate, setReturnsRate] = useState<ReturnsRate | null>(null);
  const [inventoryValue, setInventoryValue] = useState<InventoryValue | null>(null);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    setError(null);
    try {
      const [s, r, tp, ls, rr, iv] = await Promise.all([
        api.adminStoreAnalyticsSummary(range),
        api.adminStoreAnalyticsRevenue(range),
        api.adminStoreTopProducts({ range, limit: 8 }),
        api.adminStoreLowStock({ limit: 8 }),
        api.adminStoreReturnsRate(range),
        api.adminStoreInventoryValue(),
      ]);
      setSummary(s);
      setRevenue(r?.data ?? []);
      setTopProducts(tp?.data ?? []);
      setLowStock(ls?.data ?? []);
      setLowStockTotal(ls?.meta?.total ?? 0);
      setReturnsRate(rr);
      setInventoryValue(iv);
    } catch (e: unknown) {
      setError(errMsg(e, 'Failed to load analytics'));
    } finally {
      // Only clear the state we set at the top of this call: a refresh must not
      // flip `loading` to false out from under an in-flight initial load.
      if (isRefresh) setRefreshing(false);
      else setLoading(false);
    }
  }, [range]);

  useEffect(() => { load(); }, [load]);

  // ── Realtime: live order + stock feeds drive a background refresh ──────────
  // The KPI summary tracks paid orders; the low-stock / inventory tiles track
  // stock. Rather than mutate individual numbers from each frame (the analytics
  // aggregates are server-computed over a range), a live frame schedules a
  // debounced silent re-fetch so the dashboard stays current without a manual
  // Refresh click. Debounced so a burst of frames coalesces into one reload.
  const [liveFlash, setLiveFlash] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const liveFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRef = useRef(load);
  useEffect(() => { loadRef.current = load; }, [load]);

  const scheduleLiveRefresh = useCallback(() => {
    // Flash a "Live" pulse immediately so the admin sees activity.
    setLiveFlash(true);
    if (liveFlashTimer.current) clearTimeout(liveFlashTimer.current);
    liveFlashTimer.current = setTimeout(() => setLiveFlash(false), 1200);
    // Coalesce bursts into a single silent refresh ~2s after the last frame.
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => { loadRef.current(true); }, 2000);
  }, []);

  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    if (liveFlashTimer.current) clearTimeout(liveFlashTimer.current);
  }, []);

  useAdminOrdersSocket(scheduleLiveRefresh);
  useAdminStockSocket(scheduleLiveRefresh);

  // Max revenue for the bar-chart scale (avoid divide-by-zero with a 1 floor).
  const maxRevenue = Math.max(1, ...revenue.map((p) => p.revenuePaise));
  const maxUnits = Math.max(1, ...topProducts.map((p) => p.units));

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-forest border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="uppercase tracking-widest text-xs font-semibold text-ink/60">Loading Store Analytics</p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-ink animate-fade-in px-4 sm:px-6 lg:px-8 py-8 sm:py-12 max-w-[1200px] 3xl:max-w-[1600px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-10 flex justify-between items-end flex-wrap gap-4">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold leading-none flex items-center gap-3">
            <BarChart3 className="w-7 h-7 sm:w-9 sm:h-9 text-forest/70" /> Store Analytics
          </h1>
          <p className="text-ink/50 mt-2 font-serif italic">Revenue, orders, inventory &amp; returns at a glance</p>
        </div>
        <div className="flex items-center flex-wrap gap-3">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-2 border text-[10px] uppercase tracking-widest font-bold transition-colors ${
              liveFlash ? 'border-forest bg-forest/10 text-forest' : 'border-hairline text-ink/40'
            }`}
            title="Updates automatically from live order and stock events"
          >
            <Radio className={`w-3.5 h-3.5 ${liveFlash ? 'animate-pulse' : ''}`} /> Live
          </span>
          <div className="flex gap-1 border border-hairline bg-white p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-4 py-2 text-[10px] uppercase tracking-widest font-bold transition-colors ${
                  range === r.key ? 'bg-forest text-parchment' : 'text-ink/60 hover:text-forest'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => load(true)}
            disabled={refreshing}
            className="px-4 py-2.5 border border-hairline text-[10px] uppercase tracking-widest font-bold hover:border-forest hover:text-forest transition-colors flex items-center gap-2 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
          </button>
        </div>
      </header>

      {error && (
        <div className="border border-terracotta/20 bg-terracotta/5 p-6 mb-8 text-center">
          <p className="text-terracotta font-semibold mb-3">{error}</p>
          <button onClick={() => load()} className="px-5 py-2 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment transition-colors">
            Retry
          </button>
        </div>
      )}

      {/* KPI cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard icon={IndianRupee} label="Revenue" value={formatPaise(summary?.revenuePaise ?? 0, { showDecimals: false })} sub={`${summary?.units ?? 0} units sold`} accent="text-forest" />
        <StatCard icon={ShoppingCart} label="Orders" value={String(summary?.orders ?? 0)} sub="paid orders" />
        <StatCard icon={Receipt} label="Avg Order Value" value={formatPaise(summary?.aovPaise ?? 0, { showDecimals: false })} accent="text-forest/60" />
        <StatCard icon={RotateCcw} label="Refunds" value={formatPaise(summary?.refundsPaise ?? 0, { showDecimals: false })} sub={`${summary?.returns ?? 0} returns`} accent="text-terracotta" />
      </section>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12">
        <StatCard
          icon={RotateCcw}
          label="Returns Rate"
          value={`${returnsRate?.ratePercent ?? 0}%`}
          sub={`${returnsRate?.returns ?? 0} of ${returnsRate?.orders ?? 0} orders`}
          accent="text-terracotta"
        />
        <StatCard
          icon={Boxes}
          label="Inventory Value"
          value={formatPaise(inventoryValue?.totalValuePaise ?? 0, { showDecimals: false })}
          sub={`${inventoryValue?.totalOnHand ?? 0} units on hand`}
        />
        <StatCard
          icon={Package}
          label="Active SKUs"
          value={String(inventoryValue?.skuCount ?? 0)}
          sub={`${inventoryValue?.stockLevelCount ?? 0} stock records`}
        />
        <StatCard
          icon={AlertTriangle}
          label="Low Stock"
          value={String(lowStockTotal)}
          sub="SKUs at/under reorder point"
          accent={lowStockTotal > 0 ? 'text-terracotta' : 'text-forest/60'}
        />
      </section>

      {/* Revenue time-series bar chart */}
      <section className="border border-hairline bg-white p-6 mb-12">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-xl font-bold flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-forest/60" /> Revenue Trend
          </h2>
          <div className="flex items-center gap-4 text-[10px] uppercase tracking-widest text-ink/40 font-bold">
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-forest inline-block" /> Revenue</span>
            <span className="flex items-center gap-1.5"><span className="w-3 h-3 bg-terracotta/60 inline-block" /> Refunds</span>
          </div>
        </div>
        {revenue.length === 0 ? (
          <p className="text-ink/40 text-sm font-serif italic py-8 text-center">No revenue data for this range.</p>
        ) : (
          <div className="flex items-end gap-2 h-56 border-b border-hairline pb-px">
            {revenue.map((p) => {
              const revH = (p.revenuePaise / maxRevenue) * 100;
              const refH = (p.refundsPaise / maxRevenue) * 100;
              return (
                <div key={p.date} className="flex-1 flex flex-col items-center justify-end gap-1 group relative h-full">
                  <div className="w-full flex flex-col items-center justify-end h-full">
                    {/* Tooltip */}
                    <div className="absolute -top-2 left-1/2 -translate-x-1/2 -translate-y-full bg-ink text-parchment text-[10px] px-2 py-1 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10">
                      <div className="font-bold">{formatPaise(p.revenuePaise, { showDecimals: false })}</div>
                      <div className="text-parchment/60">{p.orders} orders · {p.units} units</div>
                    </div>
                    {refH > 0 && (
                      <div className="w-full bg-terracotta/50" style={{ height: `${Math.max(refH, 1)}%` }} />
                    )}
                    <div className="w-full bg-forest transition-colors group-hover:bg-forest/80" style={{ height: `${Math.max(revH, p.revenuePaise > 0 ? 2 : 0)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {revenue.length > 0 && (
          <div className="flex gap-2 mt-2">
            {revenue.map((p) => (
              <div key={p.date} className="flex-1 text-center text-[9px] text-ink/40 tabular-nums">
                {new Date(`${p.date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top products */}
        <section className="border border-hairline bg-white p-6">
          <h2 className="font-serif text-xl font-bold flex items-center gap-2 mb-6">
            <Trophy className="w-5 h-5 text-forest/60" /> Top Products
          </h2>
          {topProducts.length === 0 ? (
            <p className="text-ink/40 text-sm font-serif italic py-8 text-center">No sales in this range.</p>
          ) : (
            <div className="space-y-4">
              {topProducts.map((p, i) => (
                <div key={p.productId ?? `${p.productName}-${i}`}>
                  <div className="flex items-center justify-between mb-1.5 text-sm">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-[10px] font-bold text-ink/30 w-5 shrink-0">#{i + 1}</span>
                      <span className="font-semibold truncate">{p.productName}</span>
                    </span>
                    <span className="text-[11px] text-ink/50 shrink-0 ml-3 tabular-nums">
                      {p.units} units · {formatPaise(p.revenuePaise, { showDecimals: false })}
                    </span>
                  </div>
                  <div className="h-2 bg-parchment ml-7">
                    <div className="h-full bg-forest/70 transition-all" style={{ width: `${(p.units / maxUnits) * 100}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Low stock */}
        <section className="border border-hairline bg-white p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-serif text-xl font-bold flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-terracotta/70" /> Low Stock
            </h2>
            {lowStockTotal > 0 && (
              <span className="text-[10px] uppercase tracking-widest font-bold text-terracotta">{lowStockTotal} flagged</span>
            )}
          </div>
          {lowStock.length === 0 ? (
            <div className="py-8 text-center">
              <Package className="w-8 h-8 mx-auto mb-3 text-forest/30" />
              <p className="text-ink/40 text-sm font-serif italic">All SKUs above reorder point.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {lowStock.map((r) => (
                <div key={r.stockLevelId} className="flex items-center justify-between border border-hairline/60 p-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-semibold flex items-center gap-2">
                      <code className="text-[11px] bg-alabaster px-1.5 py-0.5">{r.skuCode}</code>
                      {r.skuName && <span className="truncate text-ink/70">{r.skuName}</span>}
                    </div>
                    <div className="text-[10px] text-ink/40 mt-0.5">{r.warehouseName} ({r.warehouseCode})</div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <div className="font-bold tabular-nums text-terracotta">{r.available}</div>
                    <div className="text-[9px] uppercase tracking-widest text-ink/40">of {r.reorderPoint} pt</div>
                  </div>
                </div>
              ))}
              {lowStockTotal > lowStock.length && (
                <p className="text-[11px] text-ink/40 text-center pt-2">+ {lowStockTotal - lowStock.length} more low-stock SKUs</p>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
