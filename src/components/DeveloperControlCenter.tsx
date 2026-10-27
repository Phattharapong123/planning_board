import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  RefreshCw, Download, Search, Database, Activity, Edit3, X, Save,
  ChevronDown, ChevronRight,
  TrendingUp, ArrowUpDown, Code2, Cpu, BarChart3, CalendarDays,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ProductionOrder, Machine } from '../types';

// ── Types ────────────────────────────────────────────────────────────────────

interface HistoryRow {
  id: string; order_id: string | null; order_ref: string; unc_codes: string | null;
  event_type: string; field_name: string | null; old_value: string | null;
  new_value: string | null; changed_by: string | null; created_at: string;
}

interface DeleteLogEntry {
  id: string;
  table_name: string;
  record_id: string;
  order_id: string | null;
  deleted_by: string;
  deleted_at: string;
  snapshot: Record<string, unknown> | null;
  unc_code: string | null;
  due_date: string | null;
  qty: string | null;
}

interface OrderWithStats extends ProductionOrder {
  edit_count: number;
  last_edit_at: string | null;
  last_edit_by: string | null;
  last_edit_field: string | null;
  last_edit_old: string | null;
  last_edit_new: string | null;
  is_deleted: boolean;
  deleted_by: string | null;
  deleted_at: string | null;
}

const TABLES: { name: string; label: string }[] = [
  { name: 'production_orders', label: 'Production Orders' },
  { name: 'plan_history', label: 'Plan History' },
  { name: 'app_users', label: 'App Users' },
  { name: 'machines', label: 'Machines' },
  { name: 'notifications', label: 'Notifications' },
  { name: 'delete_log', label: 'Delete Log' },
  { name: 'unc_parts', label: 'UNC Parts' },
  { name: 'master_plans', label: 'Master Plans' },
  { name: 'master_plan_daily', label: 'Master Plan Daily' },
  { name: 'master_plan_parameters', label: 'Master Plan Parameters' },
  { name: 'forecast_versions', label: 'Forecast Versions' },
  { name: 'holidays', label: 'Holidays' },
];

const EDITABLE_TABLES = ['production_orders', 'app_users', 'machines', 'unc_parts', 'holidays', 'notifications'];

const TABLE_COLUMNS: Record<string, string[]> = {
  production_orders: ['order_id','unc_code_1','qty_1','unc_code_2','qty_2','unc_code_3','qty_3','unc_code_4','qty_4','size_ton','leadtime','leadtime_hours','due_date','plan_issue_date','remark','plan_type','urgent','is_planned','is_finished','is_updated','is_printed','created_by','machine_id','scheduled_date','x_offset','created_at','is_deleted','deleted_by','deleted_at'],
  plan_history: ['id','order_id','order_ref','unc_codes','event_type','field_name','old_value','new_value','changed_by','created_at'],
  app_users: ['id','username','role','display_name','section_access','created_at'],
  machines: ['mc_no','machine_type','size_ton','display_order','created_at'],
  notifications: ['id','for_username','order_ref','order_id','message','edited_by','is_read','created_at'],
  delete_log: ['id','table_name','record_id','order_id','deleted_by','deleted_at','snapshot','unc_code','due_date','qty'],
  unc_parts: ['id','unc_code','unc_code_2','unc_code_3','unc_code_4','part_name','planner','customer','size_ton','cycle_time','plan_cavity','plan_type','status','created_at','updated_at'],
  master_plans: ['id','unc_code','unc_code_2','unc_code_3','unc_code_4','part_name','planner','customer','size_ton','cycle_time','plan_cavity','plan_type','status','created_at','updated_at'],
  master_plan_daily: ['id','master_plan_id','date','forecast','stock','plan','actual','order_qty'],
  master_plan_parameters: ['id','master_plan_id','parameter_name','parameter_value','display_order','created_at'],
  forecast_versions: ['id','version_number','updated_by','updated_at','row_count'],
  holidays: ['id','date','name','created_by','created_at'],
};

const NUMERIC_COLS = new Set(['qty_1','qty_2','qty_3','qty_4','size_ton','leadtime','leadtime_hours','x_offset','version_number','row_count','display_order','plan_cavity','cycle_time','forecast','stock','plan','actual','order_qty','parameter_value']);
const BOOLEAN_COLS = new Set(['urgent','is_planned','is_finished','is_updated','is_printed','is_read','is_deleted']);
const DATE_COLS = new Set(['due_date','scheduled_date','date']);

type UserCardCounts = { user: string; total: number; plan: number; unplan: number; urgent: number; pressP: number };
type UncProduction = { code: string; qty: number; cards: number };
type MachineDay = { date: string; label: string; count: number; isToday: boolean };

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDateTime(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getFullYear()).slice(2)} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}
function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toISOString().slice(0,10);
}
function getQty(o: ProductionOrder) { return (o.qty_1??0)+(o.qty_2??0)+(o.qty_3??0)+(o.qty_4??0); }
function uncDisplay(o: ProductionOrder) {
  const codes = [o.unc_code_1, o.unc_code_2, o.unc_code_3, o.unc_code_4].filter(Boolean);
  return codes.join(' / ') || '—';
}

function statusRowStyle(o: OrderWithStats): { borderLeft: string; bg: string; text: string } {
  if (o.is_deleted) return { borderLeft: '#6B7280', bg: 'rgba(107,114,128,0.06)', text: '#4b5563' };
  if (o.is_finished) return { borderLeft: '#9ca3af', bg: 'rgba(156,163,175,0.04)', text: '#6b7280' };
  if (o.is_planned) return { borderLeft: '#22C55E', bg: 'rgba(34,197,94,0.04)', text: '#16a34a' };
  if (o.urgent) return { borderLeft: '#EF4444', bg: 'rgba(239,68,68,0.04)', text: '#dc2626' };
  return { borderLeft: '#F59E0B', bg: 'rgba(245,158,11,0.03)', text: '#d97706' };
}

function tableRowStyle(r: Record<string, unknown>): { borderLeft: string; bg: string; text: string } {
  const isDeleted = r.is_deleted === true || r.is_deleted === 'true';
  const isFinished = r.is_finished === true || r.is_finished === 'true';
  const isPlanned = r.is_planned === true || r.is_planned === 'true';
  const urgent = r.urgent === true || r.urgent === 'true';
  if (isDeleted) return { borderLeft: '#6B7280', bg: 'rgba(107,114,128,0.06)', text: '#4b5563' };
  if (isFinished) return { borderLeft: '#9ca3af', bg: 'rgba(156,163,175,0.04)', text: '#6b7280' };
  if (isPlanned) return { borderLeft: '#22C55E', bg: 'rgba(34,197,94,0.04)', text: '#16a34a' };
  if (urgent) return { borderLeft: '#EF4444', bg: 'rgba(239,68,68,0.04)', text: '#dc2626' };
  return { borderLeft: '#F59E0B', bg: 'rgba(245,158,11,0.03)', text: '#d97706' };
}

function downloadCSV(filename: string, rows: Record<string, unknown>[], columns: string[]) {
  const header = columns.join(',');
  const body = rows.map(r =>
    columns.map(c => {
      const v = r[c];
      if (v == null) return '';
      const s = String(v).replace(/"/g, '""');
      return /[",\n]/.test(s) ? `"${s}"` : s;
    }).join(',')
  ).join('\n');
  const blob = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Activity Log Row ──────────────────────────────────────────────────────────

function ActivityLogRow({ o, onEdit }: { o: OrderWithStats; onEdit: (o: OrderWithStats) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [edits, setEdits] = useState<HistoryRow[]>([]);
  const [loadingEdits, setLoadingEdits] = useState(false);

  async function loadEdits() {
    if (expanded && edits.length > 0) return;
    setLoadingEdits(true);
    const { data } = await supabase
      .from('plan_history')
      .select('*')
      .eq('order_id', o.id)
      .order('created_at', { ascending: false });
    const historyRows = (data as HistoryRow[]) || [];
    if (o.is_deleted && o.deleted_at) {
      historyRows.unshift({
        id: 'delete-' + o.id,
        order_id: o.id,
        order_ref: o.order_id,
        unc_codes: null,
        event_type: 'deleted',
        field_name: null,
        old_value: null,
        new_value: null,
        changed_by: o.deleted_by,
        created_at: o.deleted_at,
      });
    }
    setEdits(historyRows);
    setLoadingEdits(false);
  }

  function toggle() {
    if (!expanded) loadEdits();
    setExpanded(v => !v);
  }

  const rowStyle = statusRowStyle(o);
  const statusBadge = () => {
    if (o.is_finished) return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">Finished</span>;
    if (o.is_planned) return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">Planned</span>;
    if (o.urgent) return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400">Urgent</span>;
    return <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">Unplanned</span>;
  };

  return (
    <>
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-50 dark:border-blue-900/20 hover:bg-orange-50/30 dark:hover:bg-blue-900/20 transition-colors text-[10px]" style={{ borderLeft: `3px solid ${rowStyle.borderLeft}`, background: rowStyle.bg }}>
        <button onClick={toggle} className="p-0.5 text-gray-400 hover:text-[#F36B21] flex-shrink-0">
          {expanded ? <ChevronDown size={11}/> : <ChevronRight size={11}/>}
        </button>
        <span className="w-20 font-mono font-bold truncate flex-shrink-0" style={{ color: rowStyle.text }} title={o.order_id}>{o.order_id}</span>
        <span className="w-28 truncate flex-shrink-0" style={{ color: rowStyle.text }} title={uncDisplay(o)}>{uncDisplay(o)}</span>
        <span className="w-12 text-right font-semibold flex-shrink-0" style={{ color: rowStyle.text }}>{getQty(o).toLocaleString()}</span>
        <span className="w-20 flex-shrink-0" style={{ color: rowStyle.text }}>{fmtDate(o.due_date)}</span>
        <span className="w-12 flex-shrink-0" style={{ color: rowStyle.text }}>{o.size_ton ? `${o.size_ton}T` : '—'}</span>
        <span className="w-32 truncate flex-shrink-0" style={{ color: rowStyle.text }} title={o.remark ?? ''}>{o.remark ?? '—'}</span>
        <span className="w-12 flex-shrink-0">{o.urgent ? <span className="text-red-500 font-bold text-[9px]">Yes</span> : <span className="text-gray-400 text-[9px]">No</span>}</span>
        <span className="w-16 truncate flex-shrink-0" style={{ color: rowStyle.text }}>{o.created_by ?? '—'}</span>
        <span className="w-20 flex-shrink-0" style={{ color: rowStyle.text }}>{fmtDateTime(o.created_at)}</span>
        <span className="w-20 flex-shrink-0" style={{ color: rowStyle.text }}>{o.is_planned ? fmtDateTime(o.scheduled_date) : '—'}</span>
        <span className="w-10 text-center font-bold flex-shrink-0" style={{ color: o.edit_count > 0 ? rowStyle.text : '#9ca3af' }}>{o.edit_count}</span>
        <span className="w-24 truncate flex-shrink-0" style={{ color: rowStyle.text }} title={o.last_edit_field ?? ''}>{o.last_edit_field ?? '—'}</span>
        <span className="w-20 truncate flex-shrink-0" style={{ color: rowStyle.text }} title={o.last_edit_old ?? ''}>{o.last_edit_old ?? '—'}</span>
        <span className="w-20 truncate flex-shrink-0" style={{ color: rowStyle.text }} title={o.last_edit_new ?? ''}>{o.last_edit_new ?? '—'}</span>
        <span className="w-20 flex-shrink-0" style={{ color: rowStyle.text }}>{fmtDateTime(o.last_edit_at)}</span>
        <span className="w-16 truncate flex-shrink-0" style={{ color: rowStyle.text }}>{o.last_edit_by ?? '—'}</span>
        <span className="w-16 flex-shrink-0">
          {o.is_deleted ? (
            <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400">Deleted</span>
          ) : statusBadge()}
        </span>
        {!o.is_deleted && (
          <button onClick={() => onEdit(o)} className="p-1 rounded-md text-gray-400 hover:text-[#F36B21] hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all flex-shrink-0">
            <Edit3 size={10}/>
          </button>
        )}
      </div>
      {expanded && (
        <div className="bg-gray-50 dark:bg-[#0A1628] border-b border-gray-100 dark:border-blue-900/20 px-2 py-2 ml-7">
          {loadingEdits ? (
            <div className="text-[10px] text-gray-400 text-center py-2">Loading edit history...</div>
          ) : edits.length === 0 ? (
            <div className="text-[10px] text-gray-400 text-center py-2">No edit history</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] border-collapse">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-blue-900/30 text-gray-400">
                    <th className="text-left py-1 pr-3 font-semibold">Event</th>
                    <th className="text-left py-1 pr-3 font-semibold">Field</th>
                    <th className="text-left py-1 pr-3 font-semibold">Old Value</th>
                    <th className="text-left py-1 pr-3 font-semibold">New Value</th>
                    <th className="text-left py-1 pr-3 font-semibold">By</th>
                    <th className="text-left py-1 font-semibold">When</th>
                  </tr>
                </thead>
                <tbody>
                  {edits.map(e => (
                    <tr key={e.id} className="border-b border-gray-100 dark:border-blue-900/10">
                      <td className="py-1 pr-3"><span className={`px-1.5 py-0.5 rounded-full text-[8px] font-bold ${e.event_type === 'deleted' ? 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400' : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'}`}>{e.event_type}</span></td>
                      <td className="py-1 pr-3 font-semibold text-gray-600 dark:text-gray-300">{e.field_name ?? '—'}</td>
                      <td className="py-1 pr-3 text-gray-400 truncate max-w-[120px]">{e.old_value ?? '—'}</td>
                      <td className="py-1 pr-3 text-gray-600 dark:text-gray-300 truncate max-w-[120px]">{e.new_value ?? '—'}</td>
                      <td className="py-1 pr-3 text-gray-500 dark:text-gray-400">{e.changed_by ?? '—'}</td>
                      <td className="py-1 text-gray-400">{fmtDateTime(e.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

function EditModal({
  table, row, columns, onClose, onSaved,
}: {
  table: string;
  row: Record<string, unknown>;
  columns: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const v: Record<string, string> = {};
    for (const c of columns) v[c] = row[c] != null ? String(row[c]) : '';
    return v;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  function handleSave() {
    setSaving(true);
    setError(null);
    (async () => {
      const updates: Record<string, unknown> = {};
      for (const c of columns) {
        if (c === 'id' || c === 'created_at') continue;
        const raw = values[c];
        if (raw === '' || raw == null) {
          updates[c] = null;
        } else if (NUMERIC_COLS.has(c)) {
          updates[c] = Number(raw);
        } else if (BOOLEAN_COLS.has(c)) {
          updates[c] = raw === 'true' || raw === '1';
        } else {
          updates[c] = raw;
        }
      }
      const { error: err } = await supabase.from(table).update(updates).eq('id', row.id);
      setSaving(false);
      if (err) { setError(err.message); return; }
      setOk(true);
      setTimeout(() => { onSaved(); onClose(); }, 800);
    })();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[85vh] bg-white dark:bg-[#0C1830] rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        <div className="bg-gray-900 dark:bg-[#0A1628] px-5 py-3 flex items-center justify-between flex-shrink-0 border-b border-blue-900/50">
          <div className="flex items-center gap-2">
            <Edit3 size={14} className="text-[#F36B21]"/>
            <span className="text-white font-bold text-sm">Edit: {table}</span>
            <span className="text-gray-400 text-xs font-mono">{String(row.id ?? '').slice(0,8)}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-all">
            <X size={16}/>
          </button>
        </div>
        <div className="overflow-y-auto p-5 flex-1">
          {ok && <div className="bg-green-50 border border-green-300 rounded-xl px-3 py-2 text-green-700 text-sm font-semibold mb-3">Saved!</div>}
          {error && <div className="bg-red-50 border border-red-300 rounded-xl px-3 py-2 text-red-600 text-sm mb-3">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            {columns.map(c => {
              const isId = c === 'id' || c === 'created_at';
              const val = values[c] ?? '';
              return (
                <div key={c} className={isId ? 'col-span-2' : ''}>
                  <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{c}</label>
                  {isId ? (
                    <input type="text" value={val} disabled
                      className="w-full px-3 py-2 border border-gray-200 dark:border-blue-900/50 rounded-lg text-xs text-gray-400 bg-gray-50 dark:bg-[#0A1628] font-mono"/>
                  ) : BOOLEAN_COLS.has(c) ? (
                    <select value={val} onChange={e => setValues(v => ({ ...v, [c]: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-blue-900/50 rounded-lg text-sm bg-white dark:bg-[#0A1628] text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#F36B21]">
                      <option value="false">false</option>
                      <option value="true">true</option>
                    </select>
                  ) : (
                    <input
                      type={NUMERIC_COLS.has(c) ? 'number' : DATE_COLS.has(c) ? 'date' : 'text'}
                      value={val}
                      onChange={e => setValues(v => ({ ...v, [c]: e.target.value }))}
                      className="w-full px-3 py-2 border border-gray-200 dark:border-blue-900/50 rounded-lg text-sm bg-white dark:bg-[#0A1628] text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#F36B21]"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 dark:border-blue-900/50 flex items-center justify-end gap-2 flex-shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-blue-900/30 rounded-xl transition-all">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 bg-[#F36B21] hover:bg-[#D4591A] text-white text-sm font-bold rounded-xl transition-all shadow-md active:scale-95 disabled:opacity-60">
            <Save size={14}/>{saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Table Browser ─────────────────────────────────────────────────────────────

function TableBrowser() {
  const [selectedTable, setSelectedTable] = useState('production_orders');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [editRow, setEditRow] = useState<Record<string, unknown> | null>(null);
  const [limit, setLimit] = useState(100);

  const columns = TABLE_COLUMNS[selectedTable] || [];
  const canEdit = EDITABLE_TABLES.includes(selectedTable);

  const fetchData = useCallback(async () => {
    setLoading(true);
    let query = supabase.from(selectedTable).select('*');
    if (sortCol) query = query.order(sortCol, { ascending: sortAsc });
    else query = query.order('created_at', { ascending: false, nullsFirst: false });
    if (limit > 0) query = query.limit(limit);
    const { data, error } = await query;

    if (error) {
      setRows([]);
      console.error('TableBrowser fetch error:', error.message);
      setLoading(false);
      return;
    }

    let result: Record<string, unknown>[] = (data || []);

    if (selectedTable === 'production_orders') {
      const { data: dData } = await supabase
        .from('delete_log')
        .select('*')
        .eq('table_name', 'production_orders')
        .order('deleted_at', { ascending: false })
        .limit(limit > 0 ? limit : 3000);

      const existingIds = new Set((data || []).map((r: Record<string, unknown>) => r.id));
      const deletedRows: Record<string, unknown>[] = ((dData || []) as DeleteLogEntry[])
        .filter(d => !existingIds.has(d.record_id))
        .map(d => {
          const s = (d.snapshot || {}) as Record<string, unknown>;
          return {
            id: d.record_id,
            order_id: d.order_id ?? s.order_id ?? d.record_id.slice(0, 8),
            unc_code_1: s.unc_code_1 ?? null,
            qty_1: s.qty_1 ?? null,
            unc_code_2: s.unc_code_2 ?? null,
            qty_2: s.qty_2 ?? null,
            unc_code_3: s.unc_code_3 ?? null,
            qty_3: s.qty_3 ?? null,
            unc_code_4: s.unc_code_4 ?? null,
            qty_4: s.qty_4 ?? null,
            size_ton: s.size_ton ?? null,
            leadtime: s.leadtime ?? null,
            leadtime_hours: s.leadtime_hours ?? null,
            due_date: d.due_date ?? s.due_date ?? null,
            remark: s.remark ?? null,
            plan_type: s.plan_type ?? 'White',
            urgent: s.urgent ?? false,
            is_planned: s.is_planned ?? false,
            is_finished: s.is_finished ?? false,
            is_updated: false,
            is_printed: s.is_printed ?? false,
            created_by: d.deleted_by,
            machine_id: s.machine_id ?? null,
            scheduled_date: s.scheduled_date ?? null,
            x_offset: s.x_offset ?? null,
            created_at: d.deleted_at,
            is_deleted: true,
            deleted_by: d.deleted_by,
            deleted_at: d.deleted_at,
          };
        });
      result = [...(data || []), ...deletedRows];
    }

    setRows(result);
    setLoading(false);
  }, [selectedTable, sortCol, sortAsc, limit]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    if (!search) return rows;
    const s = search.toLowerCase();
    return rows.filter(r =>
      columns.some(c => String(r[c] ?? '').toLowerCase().includes(s))
    );
  }, [rows, search, columns]);

  function handleSort(col: string) {
    if (sortCol === col) setSortAsc(v => !v);
    else { setSortCol(col); setSortAsc(true); }
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Table selector + search + download */}
      <div className="flex items-center gap-2 mb-2 flex-shrink-0">
        <div className="relative">
          <select
            value={selectedTable}
            onChange={e => { setSelectedTable(e.target.value); setSortCol(null); setSearch(''); }}
            className="appearance-none pl-3 pr-8 py-1.5 border border-gray-200 dark:border-blue-900/50 rounded-lg text-xs font-bold bg-white dark:bg-[#0C1830] text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#F36B21]"
          >
            {TABLES.map(t => <option key={t.name} value={t.name}>{t.label}</option>)}
          </select>
          <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full pl-7 pr-3 py-1.5 border border-gray-200 dark:border-blue-900/50 rounded-lg text-xs bg-white dark:bg-[#0C1830] text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#F36B21]"
          />
        </div>
        <select value={limit} onChange={e => setLimit(Number(e.target.value))}
          className="px-2 py-1.5 border border-gray-200 dark:border-blue-900/50 rounded-lg text-xs bg-white dark:bg-[#0C1830] text-gray-600 dark:text-gray-300">
          <option value={50}>50</option>
          <option value={100}>100</option>
          <option value={500}>500</option>
          <option value={1000}>1000</option>
          <option value={0}>All</option>
        </select>
        <button onClick={() => downloadCSV(selectedTable + '_' + new Date().toISOString().slice(0,10) + '.csv', filtered, columns)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F36B21] hover:bg-[#D4591A] text-white text-xs font-bold rounded-lg transition-all active:scale-95 shadow-sm">
          <Download size={12}/> CSV
        </button>
        <button onClick={fetchData} className="p-1.5 rounded-lg text-gray-400 hover:text-[#F36B21] hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all">
          <RefreshCw size={13}/>
        </button>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-gray-200 dark:border-blue-900/40 bg-white dark:bg-[#0C1830]">
        {loading ? (
          <div className="flex items-center justify-center h-full">
            <div className="w-5 h-5 border-2 border-[#F36B21] border-t-transparent rounded-full animate-spin"/>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-xs text-gray-400">No data</div>
        ) : (
          <table className="w-full text-[10px] border-collapse">
            <thead className="sticky top-0 bg-gray-50 dark:bg-[#0A1628] z-10">
              <tr className="border-b border-gray-200 dark:border-blue-900/40">
                {canEdit && <th className="w-8 px-1 py-1.5"></th>}
                {columns.map(c => (
                  <th key={c} onClick={() => handleSort(c)}
                    className="px-2 py-1.5 text-left font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider cursor-pointer hover:text-[#F36B21] whitespace-nowrap select-none">
                    <span className="flex items-center gap-0.5">
                      {c}
                      {sortCol === c && <ArrowUpDown size={8} className="text-[#F36B21]"/>}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const rowStyle = selectedTable === 'production_orders' ? tableRowStyle(r) : null;
                return (
                <tr key={String(r.id ?? i)} className="border-b border-gray-50 dark:border-blue-900/20 hover:bg-orange-50/20 dark:hover:bg-blue-900/20" style={rowStyle ? { borderLeft: `3px solid ${rowStyle.borderLeft}`, background: rowStyle.bg } : undefined}>
                  {canEdit && (
                    <td className="px-1 py-1">
                      <button onClick={() => setEditRow(r)} className="p-1 rounded-md text-gray-400 hover:text-[#F36B21] hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all">
                        <Edit3 size={9}/>
                      </button>
                    </td>
                  )}
                  {columns.map(c => {
                    const v = r[c];
                    const isBool = BOOLEAN_COLS.has(c);
                    const textColor = rowStyle ? rowStyle.text : undefined;
                    return (
                      <td key={c} className="px-2 py-1 whitespace-nowrap max-w-[160px] truncate" style={textColor ? { color: textColor } : undefined} title={String(v ?? '')}>
                        {v == null ? <span className="text-gray-300 dark:text-gray-600">—</span> :
                         isBool ? <span className={v ? 'text-green-600 font-bold' : 'text-gray-400'}>{String(v)}</span> :
                         String(v)}
                      </td>
                    );
                  })}
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="text-[10px] text-gray-400 mt-1 flex-shrink-0">
        {filtered.length} rows {search && `(filtered from ${rows.length})`} · {columns.length} columns
      </div>

      {editRow && (
        <EditModal
          table={selectedTable}
          row={editRow}
          columns={columns}
          onClose={() => setEditRow(null)}
          onSaved={fetchData}
        />
      )}
    </div>
  );
}

function classifyCard(o: ProductionOrder): 'plan' | 'unplan' | 'urgent' | 'pressP' {
  const remark = o.remark?.toLowerCase() || '';
  if (/press\\s*p|press-p|pressp/.test(remark)) return 'pressP';
  if (o.urgent) return 'urgent';
  return o.is_planned ? 'plan' : 'unplan';
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface UsageMetric {
  label: string;
  value: string;
  limit: string;
  color: string;
  available: boolean;
}

interface UsageResponse {
  metrics: UsageMetric[];
  billingPeriod: { start: string | null; end: string | null };
  fetchedAt: string;
  error: string | null;
}

const MANUAL_USAGE: UsageResponse = {
  metrics: [
    { label: 'Deployment Storage', value: '441.27 MB', limit: '10 GB', color: '#F36B21', available: true },
    { label: 'Edge Requests', value: '1.7K', limit: '1M', color: '#3B82F6', available: true },
    { label: 'Fast Data Transfer', value: '8.25 MB', limit: '100 GB', color: '#F59E0B', available: true },
    { label: 'Edge Request CPU Duration', value: '0s', limit: '1h', color: '#22C55E', available: true },
    { label: 'Functions Storage', value: '9.53 KB', limit: '10 GB', color: '#8B5CF6', available: true },
    { label: 'Fast Origin Transfer', value: '0', limit: '10 GB', color: '#06B6D4', available: true },
    { label: 'Private Data Transfer', value: '0 B', limit: '—', color: '#94A3B8', available: true },
    { label: 'PrivateLink Data Transfer', value: '0 B', limit: '—', color: '#94A3B8', available: true },
    { label: 'Microfrontends Routing', value: '0', limit: '50K', color: '#64748B', available: true },
    { label: 'ISR Reads', value: '0', limit: '1M', color: '#64748B', available: true },
  ],
  billingPeriod: { start: null, end: null },
  fetchedAt: new Date().toISOString(),
  error: null,
};

function UsagePanel() {
  const [data, setData] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchUsage = useCallback(() => {
    setLoading(true);
    setError(null);
    setData(MANUAL_USAGE);
    setLastUpdated(new Date());
    setLoading(false);
  }, []);

  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  const metrics = data?.metrics ?? [];
  const periodLabel = 'Last 30 days';

  return (
    <div className="rounded-xl border border-gray-200 dark:border-blue-900/50 bg-white dark:bg-[#0C1830] overflow-hidden h-full flex flex-col">
      <div className="px-3 py-2.5 border-b border-gray-100 dark:border-blue-900/40 flex items-center justify-between">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-bold text-gray-800 dark:text-white truncate">Vercel Usage</span>
          <span className="text-[9px] text-gray-400 truncate hidden sm:inline">{periodLabel}</span>
        </div>
        <button
          onClick={fetchUsage}
          disabled={loading}
          className="p-1 rounded-md text-gray-400 hover:text-[#F36B21] hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all flex-shrink-0 disabled:opacity-40"
          title="Refresh usage data"
        >
          <RefreshCw size={11} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {loading && metrics.length === 0 ? (
        <div className="flex-1 flex items-center justify-center py-8">
          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            <RefreshCw size={12} className="animate-spin" />
            <span>Loading usage data...</span>
          </div>
        </div>
      ) : error && metrics.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-6 px-3 gap-2">
          <span className="text-[10px] text-red-500 text-center font-medium">{error}</span>
          <button onClick={fetchUsage} className="text-[10px] text-[#F36B21] hover:underline font-semibold">Try again</button>
        </div>
      ) : (
        <>
          <div className="p-1.5 flex-1 overflow-y-auto">
            {metrics.map(metric => (
              <div key={metric.label} className="flex items-center gap-1.5 px-2 py-1.5 odd:bg-gray-50 dark:odd:bg-[#0A1628] rounded-md">
                <span className="w-3 h-3 rounded-full border-2 flex-shrink-0" style={{ borderColor: metric.color, opacity: metric.available ? 1 : 0.3 }}/>
                <span className="text-[10px] text-gray-700 dark:text-gray-300 truncate flex-1">{metric.label}</span>
                <span className="text-[10px] font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">
                  {metric.value}
                  {metric.available && <span className="text-gray-400 font-normal"> / {metric.limit}</span>}
                </span>
              </div>
            ))}
          </div>
          {lastUpdated && (
            <div className="px-3 py-1.5 border-t border-gray-100 dark:border-blue-900/40 flex items-center justify-between text-[9px] text-gray-400">
              <span>Updated {fmtDateTime(lastUpdated.toISOString())}</span>
              {error && <span className="text-amber-500 truncate ml-1" title={error}>partial</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MachineStatusChart({ days, machineTotal }: { days: MachineDay[]; machineTotal: number }) {
  const dayWidth = 52;
  const left = 34;
  const right = 10;
  const top = 16;
  const bottom = 34;
  const height = 200;
  const chartHeight = height - top - bottom;
  const width = left + right + days.length * dayWidth;
  const maxCount = Math.max(...days.map(d => d.count), 0);
  const max = Math.max(machineTotal, 1);
  const points = days.map((day, index) => {
    const x = left + index * dayWidth + dayWidth / 2;
    const y = top + chartHeight - (day.count / max) * chartHeight;
    return `${x},${y}`;
  }).join(' ');

  return (
    <div className="rounded-xl border border-gray-200 dark:border-blue-900/50 bg-white dark:bg-[#0C1830] p-3 h-full flex flex-col">
      <div className="flex items-start justify-between mb-1">
        <div>
          <div className="flex items-center gap-1.5"><Cpu size={14} className="text-[#F36B21]"/><span className="text-xs font-bold text-gray-800 dark:text-white">Machine Status</span></div>
          <div className="text-[10px] text-gray-400 mt-0.5">Machines with production · {machineTotal} total · peak {maxCount}</div>
        </div>
        <div className="flex items-center gap-1 text-[9px] text-gray-400"><CalendarDays size={11}/> 3 days back · today · 7 days ahead</div>
      </div>
      <div className="flex items-center gap-3 mb-1 text-[9px] text-gray-500 dark:text-gray-400"><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#F36B21]"/> working</span><span>Today: <strong className="text-gray-800 dark:text-white">{days.find(day => day.isToday)?.count ?? 0}</strong> / {machineTotal}</span></div>
      <div className="overflow-x-auto flex-1 min-h-0">
        <svg viewBox={`0 0 ${width} ${height}`} className="h-[190px]" style={{ minWidth: width }} role="img" aria-label="Machine status 3 days back and 7 days ahead">
          {[0, 0.5, 1].map(ratio => {
            const y = top + chartHeight * ratio;
            const value = Math.round(max * (1 - ratio));
            return <g key={ratio}><line x1={left} x2={width - right} y1={y} y2={y} stroke="currentColor" className="text-gray-100 dark:text-blue-900/40" strokeWidth="1"/><text x={left - 5} y={y + 3} textAnchor="end" className="fill-gray-400" fontSize="9">{value}</text></g>;
          })}
          <polyline points={points} fill="none" stroke="#F36B21" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
          {days.map((day, index) => {
            const x = left + index * dayWidth + dayWidth / 2;
            const y = top + chartHeight - (day.count / max) * chartHeight;
            return <g key={day.date}><line x1={x} x2={x} y1={top} y2={top + chartHeight} stroke={day.isToday ? '#F36B21' : 'transparent'} strokeDasharray="3 3" opacity="0.45"/><circle cx={x} cy={y} r={day.isToday ? 5 : 3.5} fill={day.isToday ? '#F36B21' : '#fff'} stroke="#F36B21" strokeWidth="2"/><text x={x} y={height - 17} textAnchor="middle" className={day.isToday ? 'fill-[#F36B21] font-bold' : 'fill-gray-400'} fontSize="8">{day.label}</text><text x={x} y={y - 9} textAnchor="middle" className="fill-gray-600 dark:fill-gray-300" fontSize="8">{day.count}</text></g>;
          })}
        </svg>
      </div>
    </div>
  );
}

function UserCardsChart({ users }: { users: UserCardCounts[] }) {
  const visibleUsers = users.slice(0, 8);
  const max = Math.max(...visibleUsers.map(u => u.total), 1);
  const width = 300;
  const height = 210;
  const top = 14;
  const bottom = 38;
  const left = 6;
  const right = 6;
  const chartHeight = height - top - bottom;
  const barCount = visibleUsers.length;
  const barAreaWidth = width - left - right;
  const slot = barAreaWidth / Math.max(barCount, 1);
  const barWidth = Math.min(22, slot * 0.65);
  const colors = { plan: '#22C55E', unplan: '#F59E0B', urgent: '#EF4444', pressP: '#3B82F6' };
  const labelMap: Record<string, string> = { plan: 'Plan', unplan: 'Unplan', urgent: 'Urgent', pressP: 'Press P' };

  return (
    <div className="rounded-xl border border-gray-200 dark:border-blue-900/50 bg-white dark:bg-[#0C1830] p-3 h-full flex flex-col">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <div className="flex items-center gap-1.5"><BarChart3 size={14} className="text-[#F36B21]"/><span className="text-xs font-bold text-gray-800 dark:text-white">Plans by User</span></div>
          <div className="text-[10px] text-gray-400 mt-0.5">Active cards by one user</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-gray-500 dark:text-gray-400 mb-1">
        {(['plan','unplan','urgent','pressP'] as const).map(key => (
          <span key={key} className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ backgroundColor: colors[key] }}/>{labelMap[key]}</span>
        ))}
      </div>
      {visibleUsers.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-xs text-gray-400">No user data</div>
      ) : (
        <svg viewBox={`0 0 ${width} ${height}`} className="w-full flex-1" role="img" aria-label="Plans by user">
          {[0, 0.5, 1].map(ratio => {
            const y = top + chartHeight * ratio;
            const val = Math.round(max * (1 - ratio));
            return <g key={ratio}><line x1={left} x2={width - right} y1={y} y2={y} stroke="currentColor" className="text-gray-100 dark:text-blue-900/40" strokeWidth="1"/>{ratio < 1 && <text x={left + 1} y={y - 2} className="fill-gray-300 dark:fill-gray-600" fontSize="7">{val}</text>}</g>;
          })}
          {visibleUsers.map((user, i) => {
            const x = left + i * slot + (slot - barWidth) / 2;
            let y = top + chartHeight;
            const segments = (['plan','unplan','urgent','pressP'] as const).map(key => {
              const segHeight = user[key] / max * chartHeight;
              y -= segHeight;
              return { key, segHeight, y: y };
            });
            const topY = top + chartHeight - user.total / max * chartHeight;
            const label = user.user.length > 7 ? user.user.slice(0, 6) + '..' : user.user;
            return (
              <g key={user.user}>
                {segments.map(s => s.segHeight > 0 && <rect key={s.key} x={x} y={s.y} width={barWidth} height={s.segHeight} fill={colors[s.key]} rx={1}/>)}
                <text x={x + barWidth / 2} y={topY - 3} textAnchor="middle" className="fill-gray-600 dark:fill-gray-300" fontSize="8" fontWeight="700">{user.total}</text>
                <text x={x + barWidth / 2} y={height - 20} textAnchor="middle" className="fill-gray-400" fontSize="7">{label}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}

function TopUncChart({ items }: { items: UncProduction[] }) {
  const max = Math.max(...items.map(item => item.qty), 1);
  return <div className="rounded-xl border border-gray-200 dark:border-blue-900/50 bg-white dark:bg-[#0C1830] p-3 h-full"><div className="flex items-center gap-1.5 mb-1"><TrendingUp size={14} className="text-[#F36B21]"/><span className="text-xs font-bold text-gray-800 dark:text-white">Top UNC Codes</span></div><div className="text-[10px] text-gray-400 mb-3">Most produced in the last 30 days</div>{items.length === 0 ? <div className="h-32 flex items-center justify-center text-xs text-gray-400">No production data</div> : <div className="space-y-2">{items.map((item, index) => <div key={item.code}><div className="flex items-center justify-between mb-1"><span className="text-[10px] font-semibold text-gray-700 dark:text-gray-300 truncate pr-2"><span className="text-gray-400 mr-1">{index + 1}</span>{item.code}</span><span className="text-[10px] font-bold text-gray-600 dark:text-gray-300">{item.qty.toLocaleString()}</span></div><div className="h-2 bg-gray-100 dark:bg-blue-900/30 rounded-full overflow-hidden"><div className="h-full bg-[#F36B21] rounded-full" style={{ width: String(item.qty / max * 100) + '%' }}/></div></div>)}</div>}</div>;
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function DeveloperControlCenter() {
  const [tab, setTab] = useState<'activity' | 'tables'>('activity');
  const [orders, setOrders] = useState<OrderWithStats[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'planned' | 'unplanned' | 'urgent' | 'finished' | 'deleted'>('all');
  const [userFilter, setUserFilter] = useState<string>('all');
  const [editOrder, setEditOrder] = useState<OrderWithStats | null>(null);
  const [updatedAt, setUpdatedAt] = useState(new Date());

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data: oData }, { data: hData }, { data: mData }, { data: dData }] = await Promise.all([
      supabase.from('production_orders').select('*').order('created_at', { ascending: false }).limit(3000),
      supabase.from('plan_history').select('*').order('created_at', { ascending: false }).limit(5000),
      supabase.from('machines').select('*').order('display_order', { ascending: true }),
      supabase.from('delete_log').select('*').order('deleted_at', { ascending: false }).limit(3000),
    ]);

    if (mData) setMachines(mData as Machine[]);
    if (!oData) { setLoading(false); return; }

    const editsByOrder = new Map<string, HistoryRow[]>();
    for (const h of (hData || []) as HistoryRow[]) {
      if (!h.order_id) continue;
      const arr = editsByOrder.get(h.order_id) || [];
      arr.push(h);
      editsByOrder.set(h.order_id, arr);
    }

    const enriched: OrderWithStats[] = (oData as ProductionOrder[]).map(o => {
      const edits = editsByOrder.get(o.id) || [];
      const updateEdits = edits.filter(e => e.event_type === 'updated');
      const lastEdit = updateEdits[0] || null;
      return {
        ...o,
        edit_count: updateEdits.length,
        last_edit_at: lastEdit?.created_at ?? null,
        last_edit_by: lastEdit?.changed_by ?? null,
        last_edit_field: lastEdit?.field_name ?? null,
        last_edit_old: lastEdit?.old_value ?? null,
        last_edit_new: lastEdit?.new_value ?? null,
        is_deleted: false,
        deleted_by: null,
        deleted_at: null,
      };
    });

    const deletedOrders: OrderWithStats[] = ((dData || []) as DeleteLogEntry[])
      .filter(d => d.table_name === 'production_orders')
      .map(d => {
        const s = (d.snapshot || {}) as Record<string, unknown>;
        return {
          id: d.record_id,
          order_id: d.order_id ?? (s.order_id as string) ?? d.record_id.slice(0, 8),
          unc_code_1: (s.unc_code_1 as string) ?? null,
          qty_1: (s.qty_1 as number) ?? null,
          unc_code_2: (s.unc_code_2 as string) ?? null,
          qty_2: (s.qty_2 as number) ?? null,
          unc_code_3: (s.unc_code_3 as string) ?? null,
          qty_3: (s.qty_3 as number) ?? null,
          unc_code_4: (s.unc_code_4 as string) ?? null,
          qty_4: (s.qty_4 as number) ?? null,
          size_ton: (s.size_ton as number) ?? null,
          leadtime: (s.leadtime as number) ?? null,
          leadtime_hours: (s.leadtime_hours as number) ?? null,
          due_date: d.due_date ?? (s.due_date as string) ?? null,
          remark: (s.remark as string) ?? null,
          plan_type: ((s.plan_type as string) ?? 'White') as ProductionOrder['plan_type'],
          urgent: (s.urgent as boolean) ?? false,
          is_planned: (s.is_planned as boolean) ?? false,
          is_finished: (s.is_finished as boolean) ?? false,
          finished_at: null,
          is_updated: false,
          is_printed: (s.is_printed as boolean) ?? false,
          created_by: d.deleted_by,
          machine_id: (s.machine_id as string) ?? null,
          scheduled_date: (s.scheduled_date as string) ?? null,
          plan_issue_date: (s.plan_issue_date as string) ?? null,
          x_offset: (s.x_offset as number) ?? null,
          prev_machine_id: null,
          prev_slot_index: null,
          created_at: d.deleted_at,
          edit_count: 1,
          last_edit_at: d.deleted_at,
          last_edit_by: d.deleted_by,
          last_edit_field: 'deleted',
          last_edit_old: null,
          last_edit_new: null,
          is_deleted: true,
          deleted_by: d.deleted_by,
          deleted_at: d.deleted_at,
        };
      });

    const existingIds = new Set(enriched.map(o => o.id));
    const merged = [...enriched, ...deletedOrders.filter(d => !existingIds.has(d.id))];
    merged.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));

    setOrders(merged);
    setLoading(false);
    setUpdatedAt(new Date());
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const overview = useMemo(() => {
    const now = new Date();
    const machineDays: MachineDay[] = Array.from({ length: 11 }, (_, index) => {
      const date = new Date(now);
      date.setHours(0, 0, 0, 0);
      date.setDate(now.getDate() - 3 + index);
      const key = localDateKey(date);
      const dayMs = date.getTime();
      const activeMachineIds = new Set<string>();
      for (const order of orders) {
        if (!order.machine_id) continue;
        const startDate = order.scheduled_date ? new Date(order.scheduled_date + 'T00:00:00') : null;
        if (!startDate) continue;
        const startMs = startDate.getTime();
        const totalHours = (order.leadtime ?? 0) * 24 + (order.leadtime_hours ?? 0);
        const endMs = startMs + totalHours * 3600000;
        const dayEndMs = dayMs + 86400000;
        if (dayMs >= startMs && dayMs < endMs) {
          activeMachineIds.add(order.machine_id as string);
        } else if (dayMs < startMs && dayEndMs > startMs && startMs < endMs) {
          activeMachineIds.add(order.machine_id as string);
        }
      }
      return { date: key, label: `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`, count: activeMachineIds.size, isToday: index === 3 };
    });

    const userMap = new Map<string, UserCardCounts>();
    for (const order of orders) {
      if (order.is_finished) continue;
      const user = order.created_by || 'Unknown';
      const current = userMap.get(user) || { user, total: 0, plan: 0, unplan: 0, urgent: 0, pressP: 0 };
      current.total += 1;
      current[classifyCard(order)] += 1;
      userMap.set(user, current);
    }

    const uncMap = new Map<string, UncProduction>();
    const recentCutoff = new Date(now);
    recentCutoff.setDate(now.getDate() - 30);
    for (const order of orders) {
      if (new Date(order.created_at) < recentCutoff) continue;
      const pairs: Array<[string | null, number | null]> = [[order.unc_code_1, order.qty_1], [order.unc_code_2, order.qty_2], [order.unc_code_3, order.qty_3], [order.unc_code_4, order.qty_4]];
      for (const [code, qty] of pairs) {
        if (!code) continue;
        const current = uncMap.get(code) || { code, qty: 0, cards: 0 };
        current.qty += qty || 0;
        current.cards += 1;
        uncMap.set(code, current);
      }
    }

    return {
      machineDays,
      userCards: Array.from(userMap.values()).sort((a, b) => b.total - a.total),
      topUnc: Array.from(uncMap.values()).sort((a, b) => b.qty - a.qty).slice(0, 8),
      uncCount: new Set(orders.flatMap(order => [order.unc_code_1, order.unc_code_2, order.unc_code_3, order.unc_code_4].filter(Boolean))).size,
    };
  }, [orders]);

  const userOptions = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) { if (o.created_by) set.add(o.created_by); }
    return Array.from(set).sort();
  }, [orders]);

  const filtered = useMemo(() => {
    let r = orders;
    if (statusFilter !== 'all') {
      r = r.filter(o => {
        switch (statusFilter) {
          case 'planned': return !o.is_deleted && o.is_planned && !o.is_finished;
          case 'unplanned': return !o.is_deleted && !o.is_planned && !o.is_finished;
          case 'urgent': return !o.is_deleted && o.urgent;
          case 'finished': return !o.is_deleted && o.is_finished;
          case 'deleted': return o.is_deleted;
        }
      });
    }
    if (userFilter !== 'all') {
      r = r.filter(o => (o.created_by || 'Unknown') === userFilter);
    }
    if (search) {
      const s = search.toLowerCase();
      r = r.filter(o =>
        o.order_id.toLowerCase().includes(s) ||
        [o.unc_code_1, o.unc_code_2, o.unc_code_3, o.unc_code_4].some(c => c?.toLowerCase().includes(s)) ||
        o.remark?.toLowerCase().includes(s) ||
        o.created_by?.toLowerCase().includes(s)
      );
    }
    return r;
  }, [orders, search, statusFilter, userFilter]);

  const fmtU = `${String(updatedAt.getHours()).padStart(2,'0')}:${String(updatedAt.getMinutes()).padStart(2,'0')}`;

  return (
    <div className="flex flex-col h-full overflow-hidden gap-2">
      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-[#F36B21]/10 dark:bg-[#F36B21]/20 flex items-center justify-center">
            <Code2 size={16} className="text-[#F36B21]"/>
          </div>
          <span className="text-sm font-bold text-gray-800 dark:text-white">Control Center</span>
          <span className="text-[10px] text-gray-400">Updated {fmtU}</span>
          <span className="flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"/>
            Live
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => setTab('activity')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${tab === 'activity' ? 'bg-[#F36B21] text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-blue-900/30'}`}>
            <Activity size={12}/> Activity Log
          </button>
          <button onClick={() => setTab('tables')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${tab === 'tables' ? 'bg-[#F36B21] text-white shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-blue-900/30'}`}>
            <Database size={12}/> Table Browser
          </button>
          <button onClick={fetchData} className="p-1.5 rounded-lg text-gray-400 hover:text-[#F36B21] hover:bg-orange-50 dark:hover:bg-orange-900/20 transition-all">
            <RefreshCw size={13}/>
          </button>
        </div>
      </div>

      {/* ── Overview Row: Usage + Machine Status + Cards by User + Top UNC ── */}
      <div className="grid grid-cols-12 gap-2 flex-shrink-0">
        <div className="col-span-3 min-h-0"><UsagePanel /></div>
        <div className="col-span-3 min-h-0"><MachineStatusChart days={overview.machineDays} machineTotal={machines.length} /></div>
        <div className="col-span-3 min-h-0"><UserCardsChart users={overview.userCards} /></div>
        <div className="col-span-3 min-h-0"><TopUncChart items={overview.topUnc} /></div>
      </div>

      {/* ── Content ── */}
      {tab === 'activity' ? (
        <div className="flex-1 min-h-0 flex flex-col gap-2">
          {/* Filters */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <div className="relative flex-1 max-w-sm">
              <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by order ID, UNC code, remark, user..."
                className="w-full pl-7 pr-3 py-1.5 border border-gray-200 dark:border-blue-900/50 rounded-lg text-xs bg-white dark:bg-[#0C1830] text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#F36B21]"
              />
            </div>
            <div className="flex items-center gap-0.5 bg-gray-100 dark:bg-[#0A1628] rounded-lg p-0.5">
              {(['all','planned','unplanned','urgent','finished','deleted'] as const).map(s => (
                <button key={s} onClick={() => setStatusFilter(s)}
                  className={statusFilter === s ? 'px-2.5 py-1 rounded-md text-[10px] font-bold transition-all capitalize bg-[#F36B21] text-white shadow-sm' : 'px-2.5 py-1 rounded-md text-[10px] font-bold transition-all capitalize text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}>
                  {s}
                </button>
              ))}
            </div>
            <div className="relative">
              <select
                value={userFilter}
                onChange={e => setUserFilter(e.target.value)}
                className="appearance-none pl-3 pr-8 py-1.5 border border-gray-200 dark:border-blue-900/50 rounded-lg text-xs font-bold bg-white dark:bg-[#0C1830] text-gray-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-[#F36B21] capitalize"
              >
                <option value="all">All Users</option>
                {userOptions.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
            </div>
            <button onClick={() => downloadCSV('activity_log_' + new Date().toISOString().slice(0,10) + '.csv', filtered as unknown as Record<string, unknown>[], ['order_id','unc_code_1','qty_1','unc_code_2','qty_2','unc_code_3','qty_3','unc_code_4','qty_4','size_ton','due_date','plan_issue_date','remark','urgent','created_by','created_at','scheduled_date','edit_count','last_edit_field','last_edit_at','last_edit_by','is_planned','is_finished'])}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#F36B21] hover:bg-[#D4591A] text-white text-xs font-bold rounded-lg transition-all active:scale-95 shadow-sm">
              <Download size={12}/> Export
            </button>
          </div>

          {/* Activity Table */}
          <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-gray-200 dark:border-blue-900/40 bg-white dark:bg-[#0C1830]">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="w-5 h-5 border-2 border-[#F36B21] border-t-transparent rounded-full animate-spin"/>
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex items-center justify-center h-full text-xs text-gray-400">No orders found</div>
            ) : (
              <>
                {/* Header */}
                <div className="sticky top-0 bg-gray-50 dark:bg-[#0A1628] z-10 flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 dark:border-blue-900/40 text-[9px] font-bold uppercase tracking-wider text-gray-400">
                  <span className="w-4 flex-shrink-0"></span>
                  <span className="w-20 flex-shrink-0">Card ID</span>
                  <span className="w-28 flex-shrink-0">UNC Code</span>
                  <span className="w-12 flex-shrink-0 text-right">Qty</span>
                  <span className="w-20 flex-shrink-0">Due Date</span>
                  <span className="w-12 flex-shrink-0">Size</span>
                  <span className="w-32 flex-shrink-0">Comment</span>
                  <span className="w-12 flex-shrink-0">Urgent</span>
                  <span className="w-16 flex-shrink-0">Created By</span>
                  <span className="w-20 flex-shrink-0">Created At</span>
                  <span className="w-20 flex-shrink-0">On Board</span>
                  <span className="w-10 flex-shrink-0 text-center">Edits</span>
                  <span className="w-24 flex-shrink-0">Last Edit Field</span>
                  <span className="w-20 flex-shrink-0">Old Value</span>
                  <span className="w-20 flex-shrink-0">New Value</span>
                  <span className="w-20 flex-shrink-0">Edited At</span>
                  <span className="w-16 flex-shrink-0">Edited By</span>
                  <span className="w-16 flex-shrink-0">Status</span>
                  <span className="w-8 flex-shrink-0"></span>
                </div>
                {filtered.map(o => <ActivityLogRow key={o.id} o={o} onEdit={setEditOrder}/>)}
              </>
            )}
          </div>
          <div className="text-[10px] text-gray-400 flex-shrink-0">{filtered.length} orders</div>
        </div>
      ) : (
        <TableBrowser/>
      )}

      {editOrder && (
        <EditModal
          table="production_orders"
          row={editOrder as unknown as Record<string, unknown>}
          columns={TABLE_COLUMNS.production_orders}
          onClose={() => setEditOrder(null)}
          onSaved={fetchData}
        />
      )}
    </div>
  );
}
