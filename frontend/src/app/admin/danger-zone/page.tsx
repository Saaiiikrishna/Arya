'use client';

import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api';
import Link from 'next/link';

export default function DangerZonePage() {
  const [tables, setTables] = useState<{table_name: string; row_count: number}[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmText, setConfirmText] = useState('');
  const [working, setWorking] = useState(false);
  const [expandedTable, setExpandedTable] = useState<string | null>(null);
  const [tableData, setTableData] = useState<any>(null);
  const [loadingData, setLoadingData] = useState(false);

  const loadTables = () => {
    setLoading(true);
    api.getDangerZoneTables().then(setTables).catch(() => {}).finally(() => setLoading(false));
  };
  
  const loadExpandedTableData = async (tableName: string) => {
    setLoadingData(true);
    setExpandedTable(tableName);
    try {
      const data = await api.getDangerZoneTableData(tableName);
      setTableData(data);
    } catch (e) {
      console.error(e);
      setTableData(null);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    loadTables();
  }, []);

  const handleTruncate = async (tableName: string) => {
    if (!window.confirm(`Are you absolutely sure you want to TRUNCATE the ${tableName} table?`)) return;
    setWorking(true);
    try {
      await api.truncateTable(tableName);
      window.alert(`Successfully truncated ${tableName}`);
      loadTables();
    } catch (e: any) {
      window.alert(`Failed: ${e.message}`);
    } finally {
      setWorking(false);
    }
  };

  const handleWipeAll = async () => {
    if (confirmText !== 'CONFIRM') {
      window.alert('You must type CONFIRM exactly to proceed.');
      return;
    }
    if (!window.confirm('FINAL WARNING: This will delete almost all data in the database. Proceed?')) return;
    setWorking(true);
    try {
      await api.truncateAllTables();
      window.alert('Target tables wiped successfully.');
      loadTables();
      setConfirmText('');
    } catch (e: any) {
      window.alert(`Failed: ${e.message}`);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="text-ink animate-fade-in px-8 py-12 max-w-[1200px] mx-auto min-h-screen relative">
      <header className="border-b border-hairline pb-8 mb-12 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div>
          <Link href="/admin/dashboard" className="text-sm uppercase tracking-widest text-forest font-medium mb-3 inline-block">
            ← Command Center
          </Link>
          <h1 className="font-serif text-5xl font-bold leading-none text-terracotta">Danger Zone</h1>
          <p className="text-xs uppercase tracking-widest text-ink/60 font-semibold text-terracotta/80 mt-2">Strictly Restricted - Destructive database operations</p>
        </div>
        <div className="text-left md:text-right">
          <button 
            onClick={() => {
              loadTables();
              if (expandedTable) loadExpandedTableData(expandedTable);
            }} 
            disabled={loading || loadingData || working}
            className="border border-terracotta/50 text-terracotta hover:bg-terracotta hover:text-white px-8 py-4 text-xs uppercase tracking-widest font-bold transition-all disabled:opacity-50 flex items-center justify-center md:inline-flex gap-2 bg-white"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={loading || loadingData ? 'animate-spin' : ''}><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path><polyline points="21 3 21 8 16 8"></polyline></svg>
            Refresh Database State
          </button>
        </div>
      </header>

      <div className="bg-alabaster border border-terracotta/20 overflow-x-auto mb-16 shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-terracotta/20 text-left bg-terracotta/5">
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-terracotta font-bold">SQL Relational Table</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-terracotta font-bold">Live Tuple Count</th>
              <th className="px-6 py-4 text-[10px] uppercase tracking-widest text-terracotta font-bold text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={3} className="px-6 py-8 text-center text-ink/40 text-xs">Loading database schema...</td></tr>
            ) : tables.map((t) => (
              <React.Fragment key={t.table_name}>
                <tr className={`border-b border-terracotta/10 last:border-0 transition-colors relative group ${
                  expandedTable === t.table_name ? 'bg-terracotta/5' : ''
                } ${
                  t.row_count > 0 ? 'bg-terracotta/[0.03] hover:bg-terracotta/[0.08]' : 'hover:bg-terracotta/5'
                }`}>
                  <td className="px-6 py-4 font-mono font-bold text-ink/80 text-xs relative flex items-center h-full">
                    {t.row_count > 0 && <div className="absolute left-0 top-0 bottom-0 w-1 bg-terracotta shadow-[0_0_12px_rgba(200,80,60,0.6)] animate-pulse"></div>}
                    {t.table_name}
                  </td>
                  <td className="px-6 py-4 text-xs font-mono relative">
                    {t.row_count > 0 ? <span className="text-terracotta font-bold">{t.row_count.toLocaleString()} rows</span> : <span>{t.row_count.toLocaleString()} rows</span>}
                  </td>
                  <td className="px-6 py-4 text-right flex justify-end gap-3">
                    <button 
                      onClick={() => expandedTable === t.table_name ? setExpandedTable(null) : loadExpandedTableData(t.table_name)}
                      disabled={working}
                      className="border border-ink/30 text-ink px-4 py-2 text-[10px] uppercase tracking-widest font-bold hover:bg-ink hover:text-white transition-colors disabled:opacity-50"
                    >
                      {expandedTable === t.table_name ? 'Close Viewer' : 'View Data'}
                    </button>
                    <button 
                      onClick={() => handleTruncate(t.table_name)}
                      disabled={working}
                      className="border border-terracotta text-terracotta px-4 py-2 text-[10px] uppercase tracking-widest font-bold hover:bg-terracotta hover:text-white transition-colors disabled:opacity-50"
                    >
                      Purge Table
                    </button>
                  </td>
                </tr>
                {expandedTable === t.table_name && (
                  <tr>
                    <td colSpan={3} className="p-0 border-b border-terracotta/20">
                      <div className="bg-white p-6 border-x-4 border-l-terracotta border-r-transparent overflow-x-auto shadow-inner">
                        {loadingData ? (
                          <div className="text-center text-xs text-ink/50 py-8 animate-pulse">Fetching dataset...</div>
                        ) : tableData && tableData.columns ? (
                          <div className="max-w-[80vw] md:max-w-full">
                            <table className="w-full text-[10px] text-left border border-hairline whitespace-nowrap">
                              <thead className="bg-alabaster border-b border-hairline">
                                <tr>
                                  {tableData.columns.map((col: any) => (
                                    <th key={col.column_name} className="px-3 py-2 font-mono font-bold text-ink group relative">
                                      <div className="flex items-center justify-between gap-4">
                                        <span>{col.column_name}</span>
                                        <button 
                                          onClick={async () => {
                                            if(!window.confirm(`Clear all data in column "${col.column_name}"? This action sets the entire column to NULL across all rows.`)) return;
                                            try {
                                              await api.clearDangerZoneColumn(t.table_name, col.column_name);
                                              window.alert('Column data cleared');
                                              loadExpandedTableData(t.table_name);
                                              loadTables();
                                            } catch(e: any) {
                                              window.alert(`Error: ${e.message}`);
                                            }
                                          }}
                                          className="text-terracotta hover:text-white hover:bg-terracotta p-1 border border-transparent hover:border-terracotta transition-colors opacity-0 group-hover:opacity-100"
                                          title="Clear Column Data"
                                        >✕</button>
                                      </div>
                                    </th>
                                  ))}
                                  <th className="px-3 py-2 bg-terracotta/5 font-mono text-terracotta text-right">Row Action</th>
                                </tr>
                              </thead>
                              <tbody>
                                {tableData.rows?.map((row: any, i: number) => (
                                  <tr key={i} className="border-b border-hairline last:border-0 hover:bg-parchment/30">
                                    {tableData.columns.map((col: any) => (
                                      <td key={col.column_name} className="px-3 py-2 font-mono text-ink/80 max-w-[200px] truncate" title={String(row[col.column_name] ?? 'NULL')}>
                                        {row[col.column_name] === null ? (
                                          <span className="text-ink/30 italic">NULL</span>
                                        ) : typeof row[col.column_name] === 'object' ? (
                                          JSON.stringify(row[col.column_name])
                                        ) : String(row[col.column_name])}
                                      </td>
                                    ))}
                                    <td className="px-3 py-2 text-right bg-terracotta/5">
                                      <button 
                                        onClick={async () => {
                                          if (!tableData.pkColumn) {
                                            window.alert('Cannot delete: No primary key detected for this table.');
                                            return;
                                          }
                                          const rowId = row[tableData.pkColumn];
                                          if(!window.confirm(`Delete row where ${tableData.pkColumn} = ${rowId}?`)) return;
                                          try {
                                            await api.deleteDangerZoneRow(t.table_name, tableData.pkColumn, String(rowId));
                                            loadExpandedTableData(t.table_name);
                                            loadTables();
                                          } catch(e: any) {
                                            window.alert(`Error: ${e.message}`);
                                          }
                                        }}
                                        className="text-terracotta hover:bg-terracotta hover:text-white border border-terracotta px-2 py-1 text-[9px] uppercase tracking-wider font-bold transition-colors"
                                      >
                                        Delete
                                      </button>
                                    </td>
                                  </tr>
                                ))}
                                {(!tableData.rows || tableData.rows.length === 0) && (
                                  <tr><td colSpan={tableData.columns.length + 1} className="px-3 py-6 text-center text-ink/40">Table is empty.</td></tr>
                                )}
                              </tbody>
                            </table>
                            {tableData.rows?.length === 50 && (
                              <div className="text-right text-[10px] text-ink/50 mt-2 font-mono italic">Showing top 50 rows only</div>
                            )}
                          </div>
                        ) : (
                          <div className="text-center text-xs text-terracotta py-8">Failed to fetch table data.</div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {!loading && tables.length === 0 && (
              <tr><td colSpan={3} className="px-6 py-8 text-center text-ink/40 text-xs">No user tables detected.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="border-t border-terracotta/20 pt-16">
        <div className="bg-terracotta/5 border border-terracotta p-8 flex flex-col md:flex-row gap-8 items-center justify-between">
          <div className="max-w-xl">
            <h3 className="font-serif text-3xl font-bold text-terracotta mb-4">Global Data Purge</h3>
            <p className="text-sm text-ink/70 leading-relaxed font-sans">
              Selecting this action will immediately truncate all unprotected tables across the entire PostgreSQL database. All applicant data, system settings, batches, teams, matches, operations and visitor analytics will be irreversibly destroyed. Administrator profiles are exempt.
            </p>
          </div>
          <div className="flex flex-col items-center gap-4 flex-shrink-0 w-full md:w-auto mt-4 md:mt-0">
            <input 
              type="text" 
              placeholder="Type CONFIRM to unlock"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              className="px-6 py-4 bg-white border border-terracotta/50 focus:outline-none focus:border-terracotta w-full text-center tracking-widest text-sm font-mono text-terracotta placeholder-terracotta/40 font-bold"
            />
            <button 
              onClick={handleWipeAll}
              disabled={working || confirmText !== 'CONFIRM'}
              className="w-full bg-terracotta text-white px-8 py-5 text-sm uppercase tracking-[0.2em] font-bold hover:bg-ink transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {working ? 'Processing...' : 'Delete All Data'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
