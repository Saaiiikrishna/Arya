'use client';

/**
 * Admin Store — Inventory.
 *
 * Three-panel strict-DESIGN.md surface (0px radius, no shadows, parchment/forest
 * hairlines, matte buttons). Tabs:
 *   • Stock Matrix  — live SKU × warehouse on-hand/reserved/available grid that
 *                     patches itself in real time via useAdminStockSocket
 *                     ('stock.updated'), plus Adjust + Transfer modals.
 *   • Warehouses    — list / create / deactivate (soft-delete; FKs are RESTRICT).
 *   • Movements     — paginated append-only StockMovement ledger.
 *   • Reorder       — at/under-reorder-point report.
 *
 * Request bodies are built to the EXACT backend DTO field names (StockAdjustDto /
 * StockTransferDto / CreateWarehouseDto) so the global ValidationPipe
 * (whitelist + forbidNonWhitelisted) does not 400 — the api.ts method TS shapes
 * carry legacy field names (`delta`, `qty`) so each mutating call is passed the
 * correct DTO object cast through `any`. Identity/actor is server-pinned from the
 * JWT — never sent in the body.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Warehouse, Plus, X, RefreshCw, ArrowRightLeft, SlidersHorizontal,
  PackageSearch, ScrollText, AlertTriangle, Power, Search, Building2, Radio, Loader2,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAdminStockSocket, StockUpdatedPayload } from '@/lib/storeSockets';
import Pagination from '@/components/store/Pagination';
import StockBadge from '@/components/store/StockBadge';
import SkuPicker from '@/components/store/SkuPicker';

// ─── Types (loose — backend returns decorated rows) ──────────────────────────

interface WarehouseRow {
  id: string;
  code: string;
  name: string;
  city?: string | null;
  stateCode?: string | null;
  gstin?: string | null;
  priority: number;
  isDefault: boolean;
  isActive: boolean;
}

interface StockRow {
  id: string;
  skuId: string;
  warehouseId: string;
  onHand: number;
  reserved: number;
  available: number;
  reorderPoint?: number;
  reorderQty?: number;
  version?: number;
  sku?: { id: string; skuCode: string; name: string; isActive?: boolean };
  warehouse?: { id: string; code: string; name: string; isActive?: boolean };
}

interface MovementRow {
  id: string;
  type: string;
  reason: string;
  quantity: number;
  reservedDelta: number;
  balanceAfter: number | null;
  referenceType: string | null;
  referenceId: string | null;
  triggeredBy: string | null;
  actorRole: string | null;
  note: string | null;
  createdAt: string;
  sku?: { id: string; skuCode: string; name: string };
  warehouse?: { id: string; code: string; name: string };
}

interface ReorderRow extends StockRow {
  shortfall: number;
  suggestedOrderQty: number;
}

type Tab = 'matrix' | 'warehouses' | 'movements' | 'reorder';

const ADJUST_REASONS = ['MANUAL_ADJUST', 'DAMAGE', 'CYCLE_COUNT', 'PURCHASE', 'RETURN'];
const STATE_CODE_HINT = '2-digit GST state code (e.g. 27 for Maharashtra)';

// Mirrors CreateWarehouseDto's INDIAN_STATE_CODES allowlist (01–37, 97, 99) so an
// invalid-but-2-digit code (e.g. 00, 38, 50) is rejected client-side rather than
// surfacing as a generic backend 400 after a round-trip.
const INDIAN_STATE_CODES: ReadonlySet<string> = new Set([
  ...Array.from({ length: 37 }, (_, i) => String(i + 1).padStart(2, '0')),
  '97',
  '99',
]);

// Canonical 15-char Indian GSTIN — same regex CreateWarehouseDto enforces, so a
// malformed value is caught at entry instead of after a 400 round-trip.
const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Strict matte input class shared across forms.
const INPUT =
  'w-full border border-hairline bg-white px-4 py-3 text-sm text-ink outline-none focus:border-forest';
const LABEL = 'block text-[10px] uppercase tracking-widest text-ink/60 mb-2 font-bold';

export default function AdminInventoryPage() {
  const [tab, setTab] = useState<Tab>('matrix');

  // ── Warehouses (shared across tabs for filters + transfer targets) ──────────
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [warehousesLoading, setWarehousesLoading] = useState(true);
  const [warehousesError, setWarehousesError] = useState<string | null>(null);
  const [includeInactiveWh, setIncludeInactiveWh] = useState(false);

  // ── Stock matrix ────────────────────────────────────────────────────────────
  const [rows, setRows] = useState<StockRow[]>([]);
  const [matrixMeta, setMatrixMeta] = useState({ total: 0, page: 1, totalPages: 1, limit: 50 });
  const [matrixLoading, setMatrixLoading] = useState(true);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  const [matrixPage, setMatrixPage] = useState(1);
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [filterWarehouse, setFilterWarehouse] = useState('');
  const [belowReorder, setBelowReorder] = useState(false);
  const [liveBeacon, setLiveBeacon] = useState(false);

  // ── Movements ────────────────────────────────────────────────────────────────
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [movementsMeta, setMovementsMeta] = useState({ total: 0, page: 1, totalPages: 1, limit: 50 });
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementsPage, setMovementsPage] = useState(1);
  const [movementsLoaded, setMovementsLoaded] = useState(false);
  const [movementsError, setMovementsError] = useState<string | null>(null);

  // ── Reorder report ────────────────────────────────────────────────────────────
  const [reorder, setReorder] = useState<ReorderRow[]>([]);
  const [reorderLoading, setReorderLoading] = useState(false);
  const [reorderLoaded, setReorderLoaded] = useState(false);
  const [reorderError, setReorderError] = useState<string | null>(null);

  // ── Modals ────────────────────────────────────────────────────────────────────
  const [showWarehouseForm, setShowWarehouseForm] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [showTransfer, setShowTransfer] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [whForm, setWhForm] = useState({
    code: '', name: '', city: '', stateCode: '', gstin: '', postalCode: '',
    priority: '', isDefault: false,
  });

  const [adjustForm, setAdjustForm] = useState({
    skuId: '', skuLabel: '', warehouseId: '', quantityDelta: '', reason: 'MANUAL_ADJUST', note: '',
  });

  const [transferForm, setTransferForm] = useState({
    skuId: '', skuLabel: '', fromWarehouseId: '', toWarehouseId: '', quantity: '', note: '',
  });

  // SKU selection in the adjust/transfer modals is now served by the SkuPicker
  // typeahead (GET /admin/store/skus) — no longer a directory derived from the
  // loaded matrix/reorder rows, so any SKU is selectable, not just visible ones.

  // ─── Data loaders ──────────────────────────────────────────────────────────

  const loadWarehouses = useCallback(async () => {
    setWarehousesLoading(true);
    setWarehousesError(null);
    try {
      const data = await api.adminListWarehouses(includeInactiveWh);
      setWarehouses(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setWarehousesError(e?.message || 'Failed to load warehouses');
      setWarehouses([]);
    } finally {
      setWarehousesLoading(false);
    }
  }, [includeInactiveWh]);

  const loadMatrix = useCallback(async () => {
    setMatrixLoading(true);
    setMatrixError(null);
    try {
      const params: Record<string, string | number> = { page: matrixPage, limit: 50 };
      if (search.trim()) params.search = search.trim();
      if (filterWarehouse) params.warehouseId = filterWarehouse;
      if (belowReorder) params.belowReorder = 'true';
      const res = await api.adminGetStockMatrix(params);
      setRows(res?.data ?? []);
      setMatrixMeta(res?.meta ?? { total: 0, page: 1, totalPages: 1, limit: 50 });
    } catch (e: any) {
      setMatrixError(e?.message || 'Failed to load stock matrix');
      setRows([]);
    } finally {
      setMatrixLoading(false);
    }
  }, [matrixPage, search, filterWarehouse, belowReorder]);

  const loadMovements = useCallback(async () => {
    setMovementsLoading(true);
    setMovementsError(null);
    try {
      const res = await api.adminListStockMovements({ page: movementsPage, limit: 50 });
      setMovements(res?.data ?? []);
      setMovementsMeta(res?.meta ?? { total: 0, page: 1, totalPages: 1, limit: 50 });
      setMovementsLoaded(true);
    } catch (e: any) {
      setMovementsError(e?.message || 'Failed to load stock movements');
      setMovements([]);
    } finally {
      setMovementsLoading(false);
    }
  }, [movementsPage]);

  const loadReorder = useCallback(async () => {
    setReorderLoading(true);
    setReorderError(null);
    try {
      const res = await api.adminGetReorderReport(filterWarehouse || undefined);
      setReorder(res?.data ?? []);
      setReorderLoaded(true);
    } catch (e: any) {
      setReorderError(e?.message || 'Failed to load reorder report');
      setReorder([]);
    } finally {
      setReorderLoading(false);
    }
  }, [filterWarehouse]);

  // Initial: warehouses + first matrix page.
  useEffect(() => { loadWarehouses(); }, [loadWarehouses]);
  useEffect(() => { loadMatrix(); }, [loadMatrix]);

  // Lazy-load movements / reorder when their tab is first opened or page changes.
  useEffect(() => {
    if (tab === 'movements') loadMovements();
  }, [tab, loadMovements]);
  useEffect(() => {
    if (tab === 'reorder') loadReorder();
  }, [tab, loadReorder]);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => {
      setMatrixPage(1);
      setSearch(searchInput);
    }, 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ─── Realtime: patch matrix rows in place on stock.updated ─────────────────
  const beaconTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onStockUpdate = useCallback((p: StockUpdatedPayload) => {
    setRows((prev) => {
      let touched = false;
      const next = prev.map((r) => {
        if (r.skuId === p.skuId && r.warehouseId === p.warehouseId) {
          // Drop stale, out-of-order frames using the optimistic-lock version.
          if (r.version !== undefined && p.version <= r.version) return r;
          touched = true;
          return {
            ...r,
            onHand: p.onHand,
            reserved: p.reserved,
            available: p.available,
            version: p.version,
          };
        }
        return r;
      });
      return touched ? next : prev;
    });
    // Flash the live beacon so the operator sees the feed is hot.
    setLiveBeacon(true);
    if (beaconTimer.current) clearTimeout(beaconTimer.current);
    beaconTimer.current = setTimeout(() => setLiveBeacon(false), 1200);
  }, []);
  useAdminStockSocket(onStockUpdate);
  useEffect(() => () => { if (beaconTimer.current) clearTimeout(beaconTimer.current); }, []);

  // ─── Mutations ─────────────────────────────────────────────────────────────

  const activeWarehouses = useMemo(() => warehouses.filter((w) => w.isActive), [warehouses]);

  const submitWarehouse = async () => {
    if (!whForm.code.trim() || !whForm.name.trim()) {
      alert('Warehouse code and name are required');
      return;
    }
    if (whForm.stateCode.trim() && !INDIAN_STATE_CODES.has(whForm.stateCode.trim())) {
      alert('State code must be a valid Indian GST state code (01–37, 97, or 99 — e.g. 27 for Maharashtra)');
      return;
    }
    if (whForm.gstin.trim() && !GSTIN_REGEX.test(whForm.gstin.trim())) {
      alert('GSTIN format is invalid (expected 15 characters, e.g. 27AAACU1234A1Z5)');
      return;
    }
    setActionLoading(true);
    try {
      const body: Record<string, any> = {
        code: whForm.code.trim(),
        name: whForm.name.trim(),
        isDefault: whForm.isDefault,
      };
      if (whForm.city.trim()) body.city = whForm.city.trim();
      if (whForm.stateCode.trim()) body.stateCode = whForm.stateCode.trim();
      if (whForm.gstin.trim()) body.gstin = whForm.gstin.trim();
      if (whForm.postalCode.trim()) body.postalCode = whForm.postalCode.trim();
      if (whForm.priority.trim() !== '') {
        const p = Number(whForm.priority);
        if (Number.isNaN(p) || p < 0) { alert('Priority must be a non-negative number'); setActionLoading(false); return; }
        body.priority = p;
      }
      await api.adminCreateWarehouse(body as { code: string; name: string });
      setShowWarehouseForm(false);
      setWhForm({ code: '', name: '', city: '', stateCode: '', gstin: '', postalCode: '', priority: '', isDefault: false });
      await loadWarehouses();
    } catch (e: any) {
      alert(e?.message || 'Failed to create warehouse');
    } finally {
      setActionLoading(false);
    }
  };

  const deactivateWarehouse = async (w: WarehouseRow) => {
    if (!confirm(`Deactivate warehouse "${w.name}" (${w.code})? It will no longer be allocatable. Stock history is preserved.`)) return;
    setActionLoading(true);
    try {
      await api.adminDeactivateWarehouse(w.id);
      await loadWarehouses();
    } catch (e: any) {
      alert(e?.message || 'Failed to deactivate warehouse');
    } finally {
      setActionLoading(false);
    }
  };

  const submitAdjust = async () => {
    if (!adjustForm.skuId || !adjustForm.warehouseId) {
      alert('Select both a SKU and a warehouse');
      return;
    }
    const delta = Number(adjustForm.quantityDelta);
    if (adjustForm.quantityDelta.trim() === '' || !Number.isInteger(delta) || delta === 0) {
      alert('Enter a non-zero whole-number quantity delta (use a negative value to remove stock)');
      return;
    }
    setActionLoading(true);
    try {
      // EXACT StockAdjustDto field names — api.ts shape uses `delta`, so cast.
      const body: any = {
        skuId: adjustForm.skuId,
        warehouseId: adjustForm.warehouseId,
        quantityDelta: delta,
        reason: adjustForm.reason,
      };
      if (adjustForm.note.trim()) body.note = adjustForm.note.trim();
      await api.adminAdjustStock(body);
      setShowAdjust(false);
      setAdjustForm({ skuId: '', skuLabel: '', warehouseId: '', quantityDelta: '', reason: 'MANUAL_ADJUST', note: '' });
      await loadMatrix();
    } catch (e: any) {
      alert(e?.message || 'Failed to adjust stock');
    } finally {
      setActionLoading(false);
    }
  };

  const submitTransfer = async () => {
    if (!transferForm.skuId || !transferForm.fromWarehouseId || !transferForm.toWarehouseId) {
      alert('Select a SKU and both source and destination warehouses');
      return;
    }
    if (transferForm.fromWarehouseId === transferForm.toWarehouseId) {
      alert('Source and destination warehouses must differ');
      return;
    }
    const qty = Number(transferForm.quantity);
    if (transferForm.quantity.trim() === '' || !Number.isInteger(qty) || qty <= 0) {
      alert('Enter a positive whole-number quantity to transfer');
      return;
    }
    setActionLoading(true);
    try {
      // EXACT StockTransferDto field names — api.ts shape uses `qty`, so cast.
      const body: any = {
        skuId: transferForm.skuId,
        fromWarehouseId: transferForm.fromWarehouseId,
        toWarehouseId: transferForm.toWarehouseId,
        quantity: qty,
      };
      if (transferForm.note.trim()) body.note = transferForm.note.trim();
      await api.adminTransferStock(body);
      setShowTransfer(false);
      setTransferForm({ skuId: '', skuLabel: '', fromWarehouseId: '', toWarehouseId: '', quantity: '', note: '' });
      await loadMatrix();
    } catch (e: any) {
      alert(e?.message || 'Failed to transfer stock');
    } finally {
      setActionLoading(false);
    }
  };

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const warehouseName = (id: string) => {
    const w = warehouses.find((x) => x.id === id);
    return w ? `${w.code} · ${w.name}` : id.slice(0, 8);
  };

  const movementTypeBadge = (type: string) => {
    const map: Record<string, string> = {
      IN: 'bg-success/10 text-success border-success/25',
      OUT: 'bg-terracotta/10 text-terracotta border-terracotta/20',
      ADJUST: 'bg-marigold/15 text-warning border-marigold/40',
      TRANSFER: 'bg-forest/10 text-forest border-forest/20',
      RETURN: 'bg-info/10 text-info border-info/25',
      RESERVE: 'bg-ink/5 text-ink/50 border-ink/15',
      RELEASE: 'bg-ink/5 text-ink/50 border-ink/15',
    };
    return map[type] || 'bg-ink/5 text-ink/50 border-ink/15';
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  const TABS: { key: Tab; label: string; icon: any }[] = [
    { key: 'matrix', label: 'Stock Matrix', icon: PackageSearch },
    { key: 'warehouses', label: 'Warehouses', icon: Warehouse },
    { key: 'movements', label: 'Movements', icon: ScrollText },
    { key: 'reorder', label: 'Reorder Report', icon: AlertTriangle },
  ];

  return (
    <div className="text-ink animate-fade-in px-4 sm:px-6 lg:px-8 py-8 sm:py-12 max-w-[1280px] 3xl:max-w-[1600px] mx-auto min-h-screen">
      {/* Header */}
      <header className="border-b border-hairline pb-8 mb-10 flex flex-wrap justify-between items-end gap-6">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-3xl sm:text-4xl lg:text-5xl font-bold leading-none">Inventory</h1>
          <p className="text-ink/50 mt-2 font-serif italic">Warehouses, live stock, movements &amp; reorder control</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setShowAdjust(true)}
            className="px-5 py-3 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment transition-colors flex items-center gap-2"
          >
            <SlidersHorizontal className="w-4 h-4" /> Adjust Stock
          </button>
          <button
            onClick={() => setShowTransfer(true)}
            className="px-5 py-3 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment transition-colors flex items-center gap-2"
          >
            <ArrowRightLeft className="w-4 h-4" /> Transfer
          </button>
        </div>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-hairline mb-8 overflow-x-auto">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-6 py-3 text-[11px] uppercase tracking-widest font-bold transition-colors border-b-2 -mb-px flex items-center gap-2 shrink-0 whitespace-nowrap ${
              tab === key ? 'border-forest text-forest' : 'border-transparent text-ink/40 hover:text-ink'
            }`}
          >
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </div>

      {/* ── STOCK MATRIX ── */}
      {tab === 'matrix' && (
        <section className="animate-fade-in">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="w-4 h-4 text-ink/30 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search SKU code or name…"
                className="w-full border border-hairline bg-white pl-9 pr-4 py-2.5 text-sm text-ink outline-none focus:border-forest"
              />
            </div>
            <select
              value={filterWarehouse}
              onChange={(e) => { setMatrixPage(1); setFilterWarehouse(e.target.value); }}
              className="border border-hairline bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-forest"
            >
              <option value="">All warehouses</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.code} · {w.name}{!w.isActive ? ' (inactive)' : ''}</option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-ink/60 cursor-pointer select-none border border-hairline px-3 py-2.5">
              <input
                type="checkbox"
                checked={belowReorder}
                onChange={(e) => { setMatrixPage(1); setBelowReorder(e.target.checked); }}
                className="accent-forest"
              />
              Below reorder only
            </label>
            <button
              onClick={loadMatrix}
              className="px-3 py-2.5 border border-hairline text-ink/60 hover:border-forest hover:text-forest transition-colors flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold"
            >
              <RefreshCw className={`w-4 h-4 ${matrixLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
            <span className={`flex items-center gap-1.5 text-[10px] uppercase tracking-widest font-bold transition-colors ${liveBeacon ? 'text-success' : 'text-ink/30'}`}>
              <Radio className={`w-3.5 h-3.5 ${liveBeacon ? 'animate-pulse' : ''}`} /> Live
            </span>
          </div>

          {matrixError ? (
            <div className="border border-terracotta/30 bg-terracotta/5 p-6 text-terracotta text-sm flex items-center justify-between">
              <span>{matrixError}</span>
              <button onClick={loadMatrix} className="underline text-[10px] uppercase tracking-widest font-bold">Retry</button>
            </div>
          ) : (
            <div className="border border-hairline bg-white overflow-x-auto">
              <div className="min-w-[760px]">
              <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
                <div className="col-span-4">SKU</div>
                <div className="col-span-3">Warehouse</div>
                <div className="col-span-1 text-right">On Hand</div>
                <div className="col-span-1 text-right">Reserved</div>
                <div className="col-span-1 text-right">Available</div>
                <div className="col-span-2 text-right">Status</div>
              </div>

              {matrixLoading ? (
                <div className="p-12 text-center">
                  <Loader2 className="w-6 h-6 text-forest animate-spin mx-auto" />
                </div>
              ) : rows.length === 0 ? (
                <div className="p-12 text-center text-ink/40">
                  <PackageSearch className="w-8 h-8 mx-auto mb-3 opacity-40" />
                  <p className="font-serif italic">No stock records match these filters.</p>
                </div>
              ) : (
                rows.map((r) => (
                  <div key={r.id} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm">
                    <div className="col-span-4">
                      <div className="font-bold">{r.sku?.skuCode ?? r.skuId.slice(0, 8)}</div>
                      <div className="text-[11px] text-ink/40 line-clamp-1">{r.sku?.name}</div>
                    </div>
                    <div className="col-span-3">
                      <div className="text-xs font-semibold">{r.warehouse?.code ?? warehouseName(r.warehouseId)}</div>
                      <div className="text-[10px] text-ink/40 line-clamp-1">{r.warehouse?.name}</div>
                    </div>
                    <div className="col-span-1 text-right tabular-nums font-semibold">{r.onHand}</div>
                    <div className="col-span-1 text-right tabular-nums text-ink/50">{r.reserved}</div>
                    <div className="col-span-1 text-right tabular-nums font-bold text-forest">{r.available}</div>
                    <div className="col-span-2 flex justify-end">
                      <StockBadge qty={r.available} showCount={false} />
                    </div>
                  </div>
                ))
              )}
              </div>
            </div>
          )}

          {matrixMeta.totalPages > 1 && (
            <div className="mt-6">
              <Pagination page={matrixMeta.page} totalPages={matrixMeta.totalPages} onPageChange={setMatrixPage} />
            </div>
          )}
          {!matrixLoading && rows.length > 0 && (
            <p className="text-[10px] uppercase tracking-widest text-ink/30 mt-4 text-center">
              {matrixMeta.total} stock record{matrixMeta.total !== 1 ? 's' : ''}
            </p>
          )}
        </section>
      )}

      {/* ── WAREHOUSES ── */}
      {tab === 'warehouses' && (
        <section className="animate-fade-in">
          <div className="flex items-center justify-between mb-6">
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-ink/60 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeInactiveWh}
                onChange={(e) => setIncludeInactiveWh(e.target.checked)}
                className="accent-forest"
              />
              Show inactive
            </label>
            <button
              onClick={() => setShowWarehouseForm(true)}
              className="px-6 py-3 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 transition-colors flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> New Warehouse
            </button>
          </div>

          {warehousesError ? (
            <div className="border border-terracotta/30 bg-terracotta/5 p-6 text-terracotta text-sm flex items-center justify-between">
              <span>{warehousesError}</span>
              <button onClick={loadWarehouses} className="underline text-[10px] uppercase tracking-widest font-bold">Retry</button>
            </div>
          ) : warehousesLoading ? (
            <div className="p-12 text-center">
              <Loader2 className="w-6 h-6 text-forest animate-spin mx-auto" />
            </div>
          ) : warehouses.length === 0 ? (
            <div className="border border-hairline bg-white p-12 text-center text-ink/40">
              <Warehouse className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="font-serif italic mb-4">No warehouses configured yet.</p>
              <button onClick={() => setShowWarehouseForm(true)} className="px-5 py-2.5 border border-forest text-forest text-[10px] uppercase tracking-widest font-bold hover:bg-forest hover:text-parchment transition-colors">
                Add First Warehouse
              </button>
            </div>
          ) : (
            <div className="border border-hairline bg-white overflow-x-auto">
              <div className="min-w-[760px]">
              <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
                <div className="col-span-3">Code / Name</div>
                <div className="col-span-3">Location</div>
                <div className="col-span-2">GSTIN</div>
                <div className="col-span-1 text-right">Priority</div>
                <div className="col-span-1">Status</div>
                <div className="col-span-2 text-right">Actions</div>
              </div>
              {warehouses.map((w) => (
                <div key={w.id} className={`grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm ${!w.isActive ? 'opacity-50' : ''}`}>
                  <div className="col-span-3">
                    <div className="font-bold flex items-center gap-2">
                      {w.code}
                      {w.isDefault && <span className="px-1.5 py-0.5 text-[8px] uppercase tracking-widest font-bold border bg-forest/10 text-forest border-forest/20">Default</span>}
                    </div>
                    <div className="text-[11px] text-ink/40">{w.name}</div>
                  </div>
                  <div className="col-span-3 text-xs text-ink/60">
                    {[w.city, w.stateCode].filter(Boolean).join(' · ') || <span className="text-ink/30">—</span>}
                  </div>
                  <div className="col-span-2 text-[11px] text-ink/50 font-mono">{w.gstin || '—'}</div>
                  <div className="col-span-1 text-right tabular-nums">{w.priority}</div>
                  <div className="col-span-1">
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-[9px] uppercase tracking-widest font-bold border ${w.isActive ? 'bg-success/10 text-success border-success/25' : 'bg-ink/5 text-ink/40 border-ink/15'}`}>
                      {w.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <div className="col-span-2 flex justify-end">
                    {w.isActive ? (
                      <button
                        onClick={() => deactivateWarehouse(w)}
                        disabled={actionLoading}
                        className="px-3 py-1.5 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-terracotta hover:text-terracotta transition-colors disabled:opacity-50 flex items-center gap-1.5"
                      >
                        <Power className="w-3 h-3" /> Deactivate
                      </button>
                    ) : (
                      <span className="text-[10px] uppercase tracking-widest text-ink/30">—</span>
                    )}
                  </div>
                </div>
              ))}
              </div>
            </div>
          )}
        </section>
      )}

      {/* ── MOVEMENTS ── */}
      {tab === 'movements' && (
        <section className="animate-fade-in">
          <div className="flex items-center justify-between mb-6">
            <h2 className="font-serif text-xl font-bold">Stock Movement Ledger</h2>
            <button
              onClick={loadMovements}
              className="px-3 py-2.5 border border-hairline text-ink/60 hover:border-forest hover:text-forest transition-colors flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold"
            >
              <RefreshCw className={`w-4 h-4 ${movementsLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>

          {movementsError ? (
            <div className="border border-terracotta/30 bg-terracotta/5 p-6 text-terracotta text-sm flex items-center justify-between">
              <span>{movementsError}</span>
              <button onClick={loadMovements} className="underline text-[10px] uppercase tracking-widest font-bold">Retry</button>
            </div>
          ) : movementsLoading && !movementsLoaded ? (
            <div className="p-12 text-center">
              <Loader2 className="w-6 h-6 text-forest animate-spin mx-auto" />
            </div>
          ) : movements.length === 0 ? (
            <div className="border border-hairline bg-white p-12 text-center text-ink/40">
              <ScrollText className="w-8 h-8 mx-auto mb-3 opacity-40" />
              <p className="font-serif italic">No stock movements recorded yet.</p>
            </div>
          ) : (
            <div className="border border-hairline bg-white overflow-x-auto">
              <div className="min-w-[820px]">
              <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
                <div className="col-span-2">When</div>
                <div className="col-span-3">SKU</div>
                <div className="col-span-2">Warehouse</div>
                <div className="col-span-1">Type</div>
                <div className="col-span-1 text-right">Qty Δ</div>
                <div className="col-span-1 text-right">Balance</div>
                <div className="col-span-2">Reference</div>
              </div>
              {movements.map((m) => (
                <div key={m.id} className="grid grid-cols-12 gap-4 px-6 py-3.5 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm">
                  <div className="col-span-2 text-[11px] text-ink/50">
                    {new Date(m.createdAt).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </div>
                  <div className="col-span-3">
                    <div className="font-semibold text-xs">{m.sku?.skuCode ?? '—'}</div>
                    <div className="text-[10px] text-ink/40 line-clamp-1">{m.sku?.name}</div>
                  </div>
                  <div className="col-span-2 text-[11px] text-ink/60">{m.warehouse?.code ?? '—'}</div>
                  <div className="col-span-1">
                    <span className={`inline-block px-1.5 py-0.5 text-[8px] uppercase tracking-widest font-bold border ${movementTypeBadge(m.type)}`}>{m.type}</span>
                  </div>
                  <div className={`col-span-1 text-right tabular-nums font-bold ${m.quantity > 0 ? 'text-success' : m.quantity < 0 ? 'text-terracotta' : 'text-ink/40'}`}>
                    {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                  </div>
                  <div className="col-span-1 text-right tabular-nums text-ink/60">{m.balanceAfter ?? '—'}</div>
                  <div className="col-span-2 text-[10px] text-ink/50">
                    {m.referenceType ? <span className="uppercase tracking-widest">{m.referenceType}</span> : <span className="text-ink/30">{m.reason}</span>}
                    {m.note && <div className="text-ink/40 line-clamp-1 normal-case tracking-normal">{m.note}</div>}
                  </div>
                </div>
              ))}
              </div>
            </div>
          )}

          {movementsMeta.totalPages > 1 && (
            <div className="mt-6">
              <Pagination page={movementsMeta.page} totalPages={movementsMeta.totalPages} onPageChange={setMovementsPage} />
            </div>
          )}
        </section>
      )}

      {/* ── REORDER REPORT ── */}
      {tab === 'reorder' && (
        <section className="animate-fade-in">
          <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
            <h2 className="font-serif text-xl font-bold">Reorder Report</h2>
            <div className="flex items-center gap-3">
              <select
                value={filterWarehouse}
                onChange={(e) => setFilterWarehouse(e.target.value)}
                className="border border-hairline bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-forest"
              >
                <option value="">All warehouses</option>
                {activeWarehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                ))}
              </select>
              <button
                onClick={loadReorder}
                className="px-3 py-2.5 border border-hairline text-ink/60 hover:border-forest hover:text-forest transition-colors flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold"
              >
                <RefreshCw className={`w-4 h-4 ${reorderLoading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
          </div>

          {reorderError ? (
            <div className="border border-terracotta/30 bg-terracotta/5 p-6 text-terracotta text-sm flex items-center justify-between">
              <span>{reorderError}</span>
              <button onClick={loadReorder} className="underline text-[10px] uppercase tracking-widest font-bold">Retry</button>
            </div>
          ) : reorderLoading && !reorderLoaded ? (
            <div className="p-12 text-center">
              <Loader2 className="w-6 h-6 text-forest animate-spin mx-auto" />
            </div>
          ) : reorder.length === 0 ? (
            <div className="border border-success/25 bg-success/5 p-12 text-center text-success">
              <PackageSearch className="w-8 h-8 mx-auto mb-3 opacity-60" />
              <p className="font-serif italic">All stock is above reorder thresholds. Nothing to reorder.</p>
            </div>
          ) : (
            <div className="border border-hairline bg-white overflow-x-auto">
              <div className="min-w-[760px]">
              <div className="grid grid-cols-12 gap-4 px-6 py-3 bg-alabaster border-b border-hairline text-[9px] uppercase tracking-widest text-ink/40 font-bold">
                <div className="col-span-4">SKU</div>
                <div className="col-span-2">Warehouse</div>
                <div className="col-span-1 text-right">Available</div>
                <div className="col-span-1 text-right">Reorder Pt</div>
                <div className="col-span-2 text-right">Shortfall</div>
                <div className="col-span-2 text-right">Suggested Qty</div>
              </div>
              {reorder.map((r) => (
                <div key={r.id} className="grid grid-cols-12 gap-4 px-6 py-4 border-b border-hairline/50 hover:bg-alabaster/50 transition-colors items-center text-sm">
                  <div className="col-span-4">
                    <div className="font-bold">{r.sku?.skuCode ?? r.skuId.slice(0, 8)}</div>
                    <div className="text-[11px] text-ink/40 line-clamp-1">{r.sku?.name}</div>
                  </div>
                  <div className="col-span-2 text-xs text-ink/60">{r.warehouse?.code ?? warehouseName(r.warehouseId)}</div>
                  <div className="col-span-1 text-right tabular-nums font-bold text-terracotta">{r.available}</div>
                  <div className="col-span-1 text-right tabular-nums text-ink/50">{r.reorderPoint ?? 0}</div>
                  <div className="col-span-2 text-right tabular-nums font-semibold text-warning">{r.shortfall}</div>
                  <div className="col-span-2 text-right tabular-nums font-bold text-forest">{r.suggestedOrderQty}</div>
                </div>
              ))}
              </div>
            </div>
          )}
          {reorder.length > 0 && (
            <p className="text-[10px] text-ink/40 mt-4 text-center">
              Raise purchase orders for these SKUs from the <Link href="/admin/store/purchasing" className="text-forest font-bold uppercase tracking-widest hover:underline">Purchasing</Link> page.
            </p>
          )}
        </section>
      )}

      {/* ═══ MODAL: New Warehouse ═══ */}
      {showWarehouseForm && (
        <div className="fixed inset-0 bg-ink/50 backdrop-blur-[20px] flex items-center justify-center z-50 p-4">
          <div className="bg-alabaster border border-hairline w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-hairline px-8 py-5">
              <h2 className="font-serif text-2xl font-bold flex items-center gap-2"><Building2 className="w-5 h-5 text-forest/60" /> New Warehouse</h2>
              <button onClick={() => setShowWarehouseForm(false)} className="text-ink/40 hover:text-ink transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-8 space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>Code *</label>
                  <input value={whForm.code} onChange={(e) => setWhForm({ ...whForm, code: e.target.value })} placeholder="WH-MUM" className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>Name *</label>
                  <input value={whForm.name} onChange={(e) => setWhForm({ ...whForm, name: e.target.value })} placeholder="Mumbai Hub" className={INPUT} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>City</label>
                  <input value={whForm.city} onChange={(e) => setWhForm({ ...whForm, city: e.target.value })} className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>State Code</label>
                  <input value={whForm.stateCode} onChange={(e) => setWhForm({ ...whForm, stateCode: e.target.value })} placeholder="27" maxLength={2} className={INPUT} />
                  <p className="text-[9px] text-ink/35 mt-1">{STATE_CODE_HINT} — required for the warehouse to be allocatable.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>GSTIN</label>
                  <input value={whForm.gstin} onChange={(e) => setWhForm({ ...whForm, gstin: e.target.value })} placeholder="27AAACU1234A1Z5" className={INPUT} />
                </div>
                <div>
                  <label className={LABEL}>Postal Code</label>
                  <input value={whForm.postalCode} onChange={(e) => setWhForm({ ...whForm, postalCode: e.target.value })} className={INPUT} />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-end">
                <div>
                  <label className={LABEL}>Priority</label>
                  <input type="number" min={0} value={whForm.priority} onChange={(e) => setWhForm({ ...whForm, priority: e.target.value })} placeholder="0" className={INPUT} />
                </div>
                <label className="flex items-center gap-2 text-[10px] uppercase tracking-widest font-bold text-ink/60 cursor-pointer select-none pb-3">
                  <input type="checkbox" checked={whForm.isDefault} onChange={(e) => setWhForm({ ...whForm, isDefault: e.target.checked })} className="accent-forest" />
                  Set as default warehouse
                </label>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-hairline px-8 py-5">
              <button onClick={() => setShowWarehouseForm(false)} className="px-6 py-3 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-ink/40 transition-colors">Cancel</button>
              <button onClick={submitWarehouse} disabled={actionLoading} className="px-8 py-3 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors">
                {actionLoading ? 'Creating…' : 'Create Warehouse'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL: Adjust Stock ═══ */}
      {showAdjust && (
        <div className="fixed inset-0 bg-ink/50 backdrop-blur-[20px] flex items-center justify-center z-50 p-4">
          <div className="bg-alabaster border border-hairline w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-hairline px-8 py-5">
              <h2 className="font-serif text-2xl font-bold flex items-center gap-2"><SlidersHorizontal className="w-5 h-5 text-forest/60" /> Adjust Stock</h2>
              <button onClick={() => setShowAdjust(false)} className="text-ink/40 hover:text-ink transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-8 space-y-5">
              <div>
                <label className={LABEL}>SKU *</label>
                <SkuPicker
                  value={adjustForm.skuId}
                  selectedLabel={adjustForm.skuLabel}
                  onSelect={(s) => setAdjustForm({ ...adjustForm, skuId: s.id, skuLabel: `${s.skuCode}${s.name ? ` — ${s.name}` : ''}` })}
                  onClear={() => setAdjustForm({ ...adjustForm, skuId: '', skuLabel: '' })}
                />
                <p className="text-[9px] text-ink/35 mt-1">Search any SKU by code, name or product — not just those on the loaded matrix page.</p>
              </div>
              <div>
                <label className={LABEL}>Warehouse *</label>
                <select value={adjustForm.warehouseId} onChange={(e) => setAdjustForm({ ...adjustForm, warehouseId: e.target.value })} className={INPUT}>
                  <option value="">Select a warehouse…</option>
                  {activeWarehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>Quantity Δ *</label>
                  <input type="number" step={1} value={adjustForm.quantityDelta} onChange={(e) => setAdjustForm({ ...adjustForm, quantityDelta: e.target.value })} placeholder="+10 or -3" className={INPUT} />
                  <p className="text-[9px] text-ink/35 mt-1">Signed whole units. Negative removes stock.</p>
                </div>
                <div>
                  <label className={LABEL}>Reason</label>
                  <select value={adjustForm.reason} onChange={(e) => setAdjustForm({ ...adjustForm, reason: e.target.value })} className={INPUT}>
                    {ADJUST_REASONS.map((r) => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={LABEL}>Note</label>
                <textarea rows={2} value={adjustForm.note} onChange={(e) => setAdjustForm({ ...adjustForm, note: e.target.value })} placeholder="Audit context for this adjustment…" className={`${INPUT} resize-none`} />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-hairline px-8 py-5">
              <button onClick={() => setShowAdjust(false)} className="px-6 py-3 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-ink/40 transition-colors">Cancel</button>
              <button onClick={submitAdjust} disabled={actionLoading} className="px-8 py-3 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors">
                {actionLoading ? 'Applying…' : 'Apply Adjustment'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL: Transfer Stock ═══ */}
      {showTransfer && (
        <div className="fixed inset-0 bg-ink/50 backdrop-blur-[20px] flex items-center justify-center z-50 p-4">
          <div className="bg-alabaster border border-hairline w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-hairline px-8 py-5">
              <h2 className="font-serif text-2xl font-bold flex items-center gap-2"><ArrowRightLeft className="w-5 h-5 text-forest/60" /> Transfer Stock</h2>
              <button onClick={() => setShowTransfer(false)} className="text-ink/40 hover:text-ink transition-colors"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-8 space-y-5">
              <div>
                <label className={LABEL}>SKU *</label>
                <SkuPicker
                  value={transferForm.skuId}
                  selectedLabel={transferForm.skuLabel}
                  onSelect={(s) => setTransferForm({ ...transferForm, skuId: s.id, skuLabel: `${s.skuCode}${s.name ? ` — ${s.name}` : ''}` })}
                  onClear={() => setTransferForm({ ...transferForm, skuId: '', skuLabel: '' })}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={LABEL}>From Warehouse *</label>
                  <select value={transferForm.fromWarehouseId} onChange={(e) => setTransferForm({ ...transferForm, fromWarehouseId: e.target.value })} className={INPUT}>
                    <option value="">Source…</option>
                    {activeWarehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LABEL}>To Warehouse *</label>
                  <select value={transferForm.toWarehouseId} onChange={(e) => setTransferForm({ ...transferForm, toWarehouseId: e.target.value })} className={INPUT}>
                    <option value="">Destination…</option>
                    {activeWarehouses.filter((w) => w.id !== transferForm.fromWarehouseId).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={LABEL}>Quantity *</label>
                <input type="number" min={1} step={1} value={transferForm.quantity} onChange={(e) => setTransferForm({ ...transferForm, quantity: e.target.value })} placeholder="e.g., 25" className={INPUT} />
                <p className="text-[9px] text-ink/35 mt-1">Whole units to move. Cannot exceed available at the source.</p>
              </div>
              <div>
                <label className={LABEL}>Note</label>
                <textarea rows={2} value={transferForm.note} onChange={(e) => setTransferForm({ ...transferForm, note: e.target.value })} className={`${INPUT} resize-none`} />
              </div>
            </div>
            <div className="flex items-center justify-end gap-3 border-t border-hairline px-8 py-5">
              <button onClick={() => setShowTransfer(false)} className="px-6 py-3 border border-hairline text-ink/60 text-[10px] uppercase tracking-widest font-bold hover:border-ink/40 transition-colors">Cancel</button>
              <button onClick={submitTransfer} disabled={actionLoading} className="px-8 py-3 bg-forest text-parchment text-[10px] uppercase tracking-widest font-bold hover:bg-forest/90 disabled:opacity-50 transition-colors">
                {actionLoading ? 'Transferring…' : 'Transfer Stock'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
