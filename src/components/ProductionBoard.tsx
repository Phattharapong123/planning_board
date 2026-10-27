import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { AlertTriangle, RefreshCw, Trash2, Search, Pencil, User, Download, CalendarDays, X, CheckCircle2, Eye, ChevronDown, Filter, Database, LayoutList } from 'lucide-react';
import { type UserRole, canEdit, canDelete, useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import { logOrderDelete } from '../lib/deleteLog';
import type { ProductionOrder, PlanType } from '../types';
import ProductionForm from './ProductionForm';

function formatDate(dateStr: string | null) {
  if (!dateStr) return '—';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' });
}

function formatLeadtime(days: number | null, hours: number | null) {
  if (days == null && hours == null) return '—';
  const parts: string[] = [];
  if (days != null) parts.push(`${days}วัน`);
  if (hours != null) parts.push(`${hours}ชม.`);
  return parts.join(' ') || '—';
}

function getUncPairs(order: ProductionOrder) {
  return [
    { code: order.unc_code_1, qty: order.qty_1 },
    { code: order.unc_code_2, qty: order.qty_2 },
    { code: order.unc_code_3, qty: order.qty_3 },
    { code: order.unc_code_4, qty: order.qty_4 },
  ].filter(p => p.code);
}

const PLAN_BADGE: Record<PlanType, string> = {
  White: 'bg-white border border-gray-200 text-gray-600',
  Yellow: 'bg-amber-100 text-amber-700 border border-amber-200',
};

interface Props {
  refresh: number;
  role?: UserRole;
  onGoToBoard?: (orderId: string) => void;
}

export default function ProductionBoard({ refresh, role = 'viewer', onGoToBoard }: Props) {
  const { user } = useAuth();
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterPlan, setFilterPlan] = useState<PlanType | 'All'>('All');
  const [filterUrgent, setFilterUrgent] = useState(false);
  const [filterIsPlanned, setFilterIsPlanned] = useState<boolean | null>(null);
  const [filterUser, setFilterUser] = useState<string>('All');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<ProductionOrder | null>(null);
  const [editingOrder, setEditingOrder] = useState<ProductionOrder | null>(null);
  const [showExportModal, setShowExportModal] = useState(false);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('production_orders')
      .select('*')
      .eq('is_finished', false)
      .order('created_at', { ascending: false })
      .limit(5000);
    if (!error && data) setOrders(data as ProductionOrder[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders, refresh]);

  async function deleteOrder(order: ProductionOrder) {
    setDeleteConfirm(order);
  }

  async function commitDeleteOrder(order: ProductionOrder) {
    setDeleteConfirm(null);
    setDeletingId(order.id);
    await supabase.from('production_orders').delete().eq('id', order.id);
    if (user) await logOrderDelete(order, user.username);
    setOrders(prev => prev.filter(o => o.id !== order.id));
    setDeletingId(null);
  }

  function canEditOrder(order: ProductionOrder): boolean {
    if (!canEdit(role)) return false;
    if (role === 'planner') return order.created_by === user?.username;
    return true;
  }

  const creators = useMemo(() => {
    const all = [...new Set(orders.map(o => o.created_by).filter(Boolean))] as string[];
    return all.sort();
  }, [orders]);

  const filtered = orders.filter(o => {
    if (filterUrgent && !o.urgent) return false;
    if (filterIsPlanned !== null && o.is_planned !== filterIsPlanned) return false;
    if (filterPlan !== 'All' && o.plan_type !== filterPlan) return false;
    if (filterUser !== 'All' && o.created_by !== filterUser) return false;
    if (dateFrom && o.due_date && o.due_date < dateFrom) return false;
    if (dateTo && o.due_date && o.due_date > dateTo) return false;
    if (search) {
      const q = search.toLowerCase();
      const codes = [o.unc_code_1, o.unc_code_2, o.unc_code_3, o.unc_code_4]
        .filter(Boolean).join(' ').toLowerCase();
      if (
        !o.order_id.toLowerCase().includes(q) &&
        !codes.includes(q) &&
        !(o.remark ?? '').toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const stats = [
    { label: 'Total', value: orders.length, cls: 'text-brand-black dark:text-[#F36B21] bg-brand-orange-muted dark:bg-[#1A0C00] border border-brand-orange/20 dark:border-[#F36B21]/30' },
    { label: 'Planned', value: orders.filter(o => o.is_planned).length, cls: 'text-gray-600 dark:text-green-400 bg-gray-100 dark:bg-[#04170B] border border-gray-300 dark:border-green-900/60' },
    { label: 'White', value: orders.filter(o => o.plan_type === 'White').length, cls: 'text-blue-700 dark:text-blue-300 bg-[#DBEAFE] dark:bg-[#060F22] border border-blue-300 dark:border-blue-900/60' },
    { label: 'Yellow', value: orders.filter(o => o.plan_type === 'Yellow').length, cls: 'text-amber-700 dark:text-yellow-300 bg-amber-50 dark:bg-[#1A1200] border border-amber-200 dark:border-yellow-900/60' },
    { label: 'Need Confirm', value: orders.filter(o => o.urgent).length, cls: 'text-orange-700 dark:text-red-400 bg-orange-50 dark:bg-[#200000] border border-orange-200 dark:border-red-900/60' },
  ];

  function exportToCSV() {
    const rows = [
      ['Order ID', 'UNC Code 1', 'Qty 1', 'UNC Code 2', 'Qty 2', 'UNC Code 3', 'Qty 3', 'UNC Code 4', 'Qty 4',
       'Size Ton', 'Leadtime (Days)', 'Leadtime (Hours)', 'Due Date', 'Plan Issue Date', 'Plan Type', 'Urgent', 'Planned', 'Press P', 'Creator', 'Machine ID', 'Scheduled Date', 'Remark'],
    ];
    for (const o of filtered) {
      rows.push([
        o.order_id,
        o.unc_code_1 ?? '', String(o.qty_1 ?? ''),
        o.unc_code_2 ?? '', String(o.qty_2 ?? ''),
        o.unc_code_3 ?? '', String(o.qty_3 ?? ''),
        o.unc_code_4 ?? '', String(o.qty_4 ?? ''),
        String(o.size_ton ?? ''),
        String(o.leadtime ?? ''),
        String(o.leadtime_hours ?? ''),
        o.due_date ?? '',
        o.plan_issue_date ?? '',
        o.plan_type,
        o.urgent ? 'Yes' : 'No',
        o.is_planned ? 'Yes' : 'No',
        o.is_printed ? 'Yes' : 'No',
        o.created_by ?? '',
        o.machine_id ?? '',
        o.scheduled_date ?? '',
        o.remark ?? '',
      ]);
    }
    const csvContent = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `production_orders_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportModal(false);
  }

  function exportPlanWeek() {
    const header = ['Order ID', 'UNC Code', 'Qty', 'Scheduled Date', 'Creator', 'Remark'];
    type Entry = { orderId: string; code: string; qty: string; sortDate: string; creator: string; remark: string };
    const entries: Entry[] = [];

    // Exclude PLANNED orders only (Press P orders are included)
    const source = filtered.filter(o => !o.is_planned);

    for (const o of source) {
      let sortDate = o.scheduled_date ?? '';
      if (!sortDate && o.due_date) {
        const ltDays = (o.leadtime ?? 0) + ((o.leadtime_hours ?? 0) > 0 ? 1 : 0) + 5;
        const due = new Date(o.due_date + 'T00:00:00');
        due.setDate(due.getDate() - ltDays);
        sortDate = due.toISOString().slice(0, 10);
      }
      const pairs = [
        { c: o.unc_code_1, q: o.qty_1 },
        { c: o.unc_code_2, q: o.qty_2 },
        { c: o.unc_code_3, q: o.qty_3 },
        { c: o.unc_code_4, q: o.qty_4 },
      ].filter(p => p.c);

      if (pairs.length === 0) {
        entries.push({ orderId: o.order_id, code: '', qty: '', sortDate, creator: o.created_by ?? '', remark: o.remark ?? '' });
      } else {
        pairs.forEach(({ c, q }) => {
          entries.push({ orderId: o.order_id, code: c!, qty: q != null ? String(q) : '', sortDate, creator: o.created_by ?? '', remark: o.remark ?? '' });
        });
      }
    }

    entries.sort((a, b) => {
      if (!a.sortDate && !b.sortDate) return 0;
      if (!a.sortDate) return 1;
      if (!b.sortDate) return -1;
      return a.sortDate.localeCompare(b.sortDate);
    });

    const rows = [header, ...entries.map(e => [e.orderId, e.code, e.qty, e.sortDate, e.creator, e.remark])];
    const csvContent = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `plan_week_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setShowExportModal(false);
  }

  // ── Filter dropdown helper ────────────────────────────────────────────────
  function UserFilterChip({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const active = value !== 'All';
    useEffect(() => {
      const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
      if (open) document.addEventListener('mousedown', h);
      return () => document.removeEventListener('mousedown', h);
    }, [open]);
    return (
      <div ref={ref} className="relative flex-shrink-0">
        <button
          onClick={() => setOpen(v => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
            active
              ? 'bg-brand-orange border-brand-orange text-white'
              : 'bg-white dark:bg-[#0C1830] border-gray-200 dark:border-blue-900/50 text-gray-600 dark:text-gray-300'
          }`}
        >
          <User size={11} />
          {value === 'All' ? 'All Users' : value}
          <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-[#0C1830] border border-gray-200 dark:border-blue-900/50 rounded-xl shadow-xl overflow-hidden min-w-[140px]">
            {(['All', ...options]).map(u => (
              <button key={u} onClick={() => { onChange(u); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors flex items-center gap-2 ${value === u ? 'bg-brand-orange/10 dark:bg-orange-900/20 text-brand-orange font-bold' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-blue-900/20'}`}>
                {u === 'All' ? 'All Users' : u}
                {value === u && <span className="ml-auto text-brand-orange">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── Filter dropdown helper ────────────────────────────────────────────────
  function FilterChip<T extends string>({
    label, value, options, onChange, color = 'orange',
  }: {
    label: string;
    value: T;
    options: { value: T; label: string }[];
    onChange: (v: T) => void;
    color?: 'orange' | 'green' | 'blue';
  }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const active = value !== options[0].value;
    const selected = options.find(o => o.value === value);
    const colorCls = {
      orange: active ? 'bg-brand-orange border-brand-orange text-white' : 'bg-white dark:bg-[#0C1830] border-gray-200 dark:border-blue-900/50 text-gray-600 dark:text-gray-300',
      green:  active ? 'bg-[#16A34A] border-[#16A34A] text-white' : 'bg-white dark:bg-[#0C1830] border-gray-200 dark:border-blue-900/50 text-gray-600 dark:text-gray-300',
      blue:   active ? 'bg-[#2563EB] border-[#2563EB] text-white' : 'bg-white dark:bg-[#0C1830] border-gray-200 dark:border-blue-900/50 text-gray-600 dark:text-gray-300',
    }[color];
    useEffect(() => {
      const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
      if (open) document.addEventListener('mousedown', h);
      return () => document.removeEventListener('mousedown', h);
    }, [open]);
    return (
      <div ref={ref} className="relative flex-shrink-0">
        <button
          onClick={() => setOpen(v => !v)}
          className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all ${colorCls}`}
        >
          {label}: <span className="font-bold">{selected?.label ?? value}</span>
          <ChevronDown size={10} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div className="absolute top-full left-0 mt-1 z-50 bg-white dark:bg-[#0C1830] border border-gray-200 dark:border-blue-900/50 rounded-xl shadow-xl overflow-hidden min-w-[130px]">
            {options.map(o => (
              <button key={o.value} onClick={() => { onChange(o.value); setOpen(false); }}
                className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors flex items-center gap-2 ${value === o.value ? 'bg-brand-orange/10 dark:bg-orange-900/20 text-brand-orange font-bold' : 'text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-blue-900/20'}`}>
                {o.label}
                {value === o.value && <span className="ml-auto text-brand-orange">✓</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Toolbar — row 1: search + active filter chips + actions */}
      <div className="flex flex-wrap gap-2 items-center mb-3">
        {/* Search */}
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Order ID, UNC Code, Remark..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-8 py-1.5 text-sm border border-gray-200 dark:border-blue-900/50 rounded-xl bg-white dark:bg-[#0C1830] text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand-orange placeholder:text-gray-300 dark:placeholder:text-gray-600"
          />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={12}/></button>}
        </div>

        {/* Filter chip: Plan Type */}
        <FilterChip<PlanType | 'All'>
          label="Type"
          value={filterPlan}
          onChange={setFilterPlan}
          options={[
            { value: 'All', label: 'All' },
            { value: 'White', label: 'White' },
            { value: 'Yellow', label: 'Yellow' },
          ]}
        />

        {/* Filter chip: Status */}
        <FilterChip<'all' | 'planned' | 'unplanned'>
          label="Status"
          value={
            filterIsPlanned === true ? 'planned'
            : filterIsPlanned === false ? 'unplanned'
            : 'all'
          }
          onChange={v => {
            setFilterIsPlanned(v === 'planned' ? true : v === 'unplanned' ? false : null);
          }}
          options={[
            { value: 'all',       label: 'All Status' },
            { value: 'planned',   label: 'Planned' },
            { value: 'unplanned', label: 'Unplanned' },
          ]}
          color="green"
        />

        {/* Filter chip: Urgent */}
        <button
          onClick={() => setFilterUrgent(p => !p)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border flex-shrink-0 transition-all ${
            filterUrgent
              ? 'bg-brand-orange border-brand-orange text-white'
              : 'bg-white dark:bg-[#0C1830] text-gray-600 dark:text-gray-300 border-gray-200 dark:border-blue-900/50 hover:border-orange-300'
          }`}
        >
          <AlertTriangle size={11} />
          Urgent
        </button>

        {/* Filter: Creator */}
        {creators.length > 0 && (
          <UserFilterChip value={filterUser} options={creators} onChange={setFilterUser} />
        )}

        {/* Date range */}
        <div className="flex items-center gap-1.5 bg-white dark:bg-[#0C1830] border border-gray-200 dark:border-blue-900/50 rounded-lg px-2 py-1.5 flex-shrink-0">
          <CalendarDays size={12} className="text-gray-400 flex-shrink-0" />
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
            className="text-xs border-0 outline-none text-gray-700 dark:text-gray-200 bg-transparent cursor-pointer w-[105px] [color-scheme:light] dark:[color-scheme:dark]"/>
          <span className="text-gray-300 dark:text-gray-600 text-xs">–</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
            className="text-xs border-0 outline-none text-gray-700 dark:text-gray-200 bg-transparent cursor-pointer w-[105px] [color-scheme:light] dark:[color-scheme:dark]"/>
          {(dateFrom || dateTo) && (
            <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-gray-400 hover:text-red-500 transition-colors flex-shrink-0"><X size={10}/></button>
          )}
        </div>

        {/* Active filter count badge + clear */}
        {(filterPlan !== 'All' || filterUrgent || filterIsPlanned !== null || filterUser !== 'All' || dateFrom || dateTo || search) && (
          <button
            onClick={() => { setSearch(''); setFilterPlan('All'); setFilterUrgent(false); setFilterIsPlanned(null); setFilterUser('All'); setDateFrom(''); setDateTo(''); }}
            className="flex items-center gap-1 px-2 py-1.5 text-xs text-red-500 hover:text-red-400 font-semibold border border-red-200 dark:border-red-900/40 rounded-lg bg-red-50 dark:bg-red-900/10 hover:bg-red-100 dark:hover:bg-red-900/20 transition-all flex-shrink-0"
          >
            <X size={10}/> Clear All
          </button>
        )}

        <div className="flex items-center gap-1.5 ml-auto flex-shrink-0">
          <button onClick={fetchOrders}
            className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-brand-orange border border-gray-200 dark:border-blue-900/50 rounded-lg bg-white dark:bg-[#0C1830] hover:bg-brand-orange-muted dark:hover:bg-orange-900/20 transition-all"
            title="Refresh"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /></button>
          <button onClick={() => setShowExportModal(true)}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-blue-900/50 rounded-lg bg-white dark:bg-[#0C1830] hover:bg-green-50 dark:hover:bg-green-900/20 hover:text-green-700 dark:hover:text-green-400 hover:border-green-300 transition-all flex-shrink-0"
            title="Export"><Download size={13}/> Export</button>
        </div>
      </div>

      {/* Result count line */}
      {(search || filterPlan !== 'All' || filterUrgent || filterIsPlanned !== null || filterUser !== 'All' || dateFrom || dateTo) && (
        <div className="flex items-center gap-2 mb-2">
          <Filter size={11} className="text-gray-400"/>
          <span className="text-xs text-gray-500 dark:text-gray-400">
            แสดง <span className="font-bold text-brand-orange">{filtered.length}</span> / {orders.length} รายการ
          </span>
        </div>
      )}

      {/* Stats */}
      <div className="flex flex-wrap gap-2 mb-5">
        {stats.map(s => (
          <div key={s.label} className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold ${s.cls}`}>
            <span>{s.label}</span>
            <span className="text-base font-extrabold">{s.value}</span>
          </div>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-9 h-9 border-2 border-brand-orange/20 border-t-brand-orange rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 gap-3 py-16">
          <p className="text-sm text-gray-500">
            {search || filterPlan !== 'All' || filterUrgent || filterIsPlanned !== null || filterUser !== 'All' || dateFrom || dateTo
              ? 'No matching records'
              : 'No data yet — click "+ CREATE PLAN" to add the first entry'}
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-auto rounded-2xl border border-gray-200 dark:border-blue-900/50 shadow-sm">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-brand-black dark:bg-[#070D1A] sticky top-0 z-10">
                {['Order ID', 'UNC CODE', 'QTY', 'Size Ton', 'Leadtime', 'Due Date', 'Plan Issue Date', 'Plan Type', 'Creator', 'Remark', ''].map(h => (
                  <th key={h} className="text-left text-xs font-bold text-gray-400 uppercase tracking-wider px-4 py-3 border-b border-white/10 whitespace-nowrap first:pl-5 last:pr-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((order, idx) => {
                const pairs = getUncPairs(order);
                const rowCount = Math.max(pairs.length, 1);
                const rowBg = `${idx % 2 === 0 ? 'bg-white dark:bg-[#0C1830]' : 'bg-gray-50/40 dark:bg-[#081323]'} ${order.is_finished ? 'border-l-[3px] border-l-teal-500 opacity-60' : order.urgent ? 'border-l-[3px] border-l-brand-orange' : ''} ${order.is_planned && !order.is_finished ? 'opacity-70' : ''}`;
                return pairs.length === 0 ? (
                  <tr key={order.id} className={`border-b border-gray-100 dark:border-blue-900/30 transition-colors hover:bg-brand-orange-muted dark:hover:bg-blue-900/20 group ${rowBg}`}>
                    <td className="px-4 py-3 pl-5 whitespace-nowrap" rowSpan={1}>
                      <div className="flex items-center gap-2">
                        {order.is_finished && <CheckCircle2 size={13} className="text-teal-500 flex-shrink-0" />}
                        {order.urgent && !order.is_finished && <AlertTriangle size={13} className="text-brand-orange flex-shrink-0" />}
                        {order.is_planned && !order.is_finished && <span className="text-[9px] bg-gray-200 dark:bg-[#1A3055] text-gray-500 dark:text-gray-400 font-bold px-1.5 rounded">PLANNED</span>}
                        {order.is_finished && <span className="text-[9px] bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 font-bold px-1.5 py-0.5 rounded border border-teal-200 dark:border-teal-800">FINISHED</span>}
                        <span className="font-mono font-bold text-brand-black dark:text-gray-100">{order.order_id}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-gray-400 dark:text-gray-600">—</td>
                    <td className="px-4 py-3 text-gray-400 dark:text-gray-600">—</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap font-medium">{order.size_ton != null ? `${order.size_ton}T` : '—'}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{formatLeadtime(order.leadtime, order.leadtime_hours)}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{formatDate(order.due_date)}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{formatDate(order.plan_issue_date)}</td>
                    <td className="px-4 py-3"><span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${PLAN_BADGE[order.plan_type]}`}>{order.plan_type}</span></td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs">{order.created_by ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400 max-w-[160px] truncate">{order.remark || '—'}</td>
                    <td className="pr-4 py-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        <button onClick={() => onGoToBoard?.(order.order_id)} className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all" title="Go to Board"><Eye size={14} /></button>
                        {canEditOrder(order) && (
                          <button onClick={() => setEditingOrder(order)} className="p-1.5 text-gray-400 hover:text-brand-orange hover:bg-brand-orange-muted dark:hover:bg-orange-900/20 rounded-lg transition-all" title="Edit"><Pencil size={14} /></button>
                        )}
                        {canDelete(role) && (
                          <button onClick={() => deleteOrder(order)} disabled={deletingId === order.id} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all disabled:opacity-30" title="Delete"><Trash2 size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : pairs.map((p, pIdx) => (
                  <tr key={`${order.id}-${pIdx}`} className={`border-b border-gray-100 dark:border-blue-900/30 transition-colors hover:bg-brand-orange-muted dark:hover:bg-blue-900/20 group ${pIdx === 0 ? rowBg : (idx % 2 === 0 ? 'bg-white dark:bg-[#0C1830]' : 'bg-gray-50/40 dark:bg-[#081323]')}`}>
                    {pIdx === 0 && (
                      <td className="px-4 py-3 pl-5 whitespace-nowrap align-top" rowSpan={rowCount}>
                        <div className="flex items-center gap-2">
                          {order.is_finished && <CheckCircle2 size={13} className="text-teal-500 flex-shrink-0" />}
                          {order.urgent && !order.is_finished && <AlertTriangle size={13} className="text-brand-orange flex-shrink-0" />}
                          {order.is_planned && !order.is_finished && <span className="text-[9px] bg-gray-200 dark:bg-[#1A3055] text-gray-500 dark:text-gray-400 font-bold px-1.5 rounded">PLANNED</span>}
                          {order.is_finished && <span className="text-[9px] bg-teal-100 dark:bg-teal-900/30 text-teal-700 dark:text-teal-400 font-bold px-1.5 py-0.5 rounded border border-teal-200 dark:border-teal-800">FINISHED</span>}
                          <span className="font-mono font-bold text-brand-black dark:text-gray-100">{order.order_id}</span>
                        </div>
                      </td>
                    )}
                    <td className="px-4 py-2">
                      <span className="font-mono text-xs font-bold text-brand-black dark:text-[#93C5FD] bg-brand-orange-muted dark:bg-[#060F22] border border-brand-orange/20 dark:border-blue-900/60 px-2 py-0.5 rounded-md inline-block">{p.code}</span>
                    </td>
                    <td className="px-4 py-2 text-brand-orange dark:text-[#FB923C] font-bold text-sm">{p.qty != null ? p.qty.toLocaleString() : '—'}</td>
                    {pIdx === 0 && (
                      <>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap font-medium align-top" rowSpan={rowCount}>{order.size_ton != null ? `${order.size_ton}T` : '—'}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap align-top" rowSpan={rowCount}>{formatLeadtime(order.leadtime, order.leadtime_hours)}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap align-top" rowSpan={rowCount}>{formatDate(order.due_date)}</td>
                        <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap align-top" rowSpan={rowCount}>{formatDate(order.plan_issue_date)}</td>
                        <td className="px-4 py-3 align-top" rowSpan={rowCount}><span className={`inline-block px-2.5 py-1 rounded-lg text-xs font-semibold ${PLAN_BADGE[order.plan_type]}`}>{order.plan_type}</span></td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 whitespace-nowrap text-xs align-top" rowSpan={rowCount}>{order.created_by ?? '—'}</td>
                        <td className="px-4 py-3 text-gray-500 dark:text-gray-400 max-w-[160px] truncate align-top" rowSpan={rowCount}>{order.remark || '—'}</td>
                        <td className="pr-4 py-3 align-top" rowSpan={rowCount}>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                            <button onClick={() => onGoToBoard?.(order.order_id)} className="p-1.5 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-all" title="Go to Board"><Eye size={14} /></button>
                            {canEditOrder(order) && (
                              <button onClick={() => setEditingOrder(order)} className="p-1.5 text-gray-400 hover:text-brand-orange hover:bg-brand-orange-muted dark:hover:bg-orange-900/20 rounded-lg transition-all" title="Edit"><Pencil size={14} /></button>
                            )}
                            {canDelete(role) && (
                              <button onClick={() => deleteOrder(order)} disabled={deletingId === order.id} className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all disabled:opacity-30" title="Delete"><Trash2 size={14} /></button>
                            )}
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Inline edit form */}
      {editingOrder && (
        <ProductionForm
          editOrder={editingOrder}
          onSaved={() => { setEditingOrder(null); fetchOrders(); }}
          onCancel={() => setEditingOrder(null)}
        />
      )}

      {/* Export modal */}
      {showExportModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0C1830] rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
            <div className="bg-brand-black px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Download size={15} className="text-brand-orange" />
                <span className="text-white font-bold text-sm">เลือกรูปแบบ Export</span>
              </div>
              <button onClick={() => setShowExportModal(false)} className="text-gray-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10">
                <X size={16} />
              </button>
            </div>
            <div className="p-5 flex flex-col gap-3">
              <button
                onClick={exportToCSV}
                className="flex items-start gap-3 w-full px-4 py-3.5 rounded-xl border border-gray-200 dark:border-blue-900/50 bg-gray-50 dark:bg-[#081323] hover:border-brand-orange hover:bg-brand-orange-muted dark:hover:bg-orange-900/10 transition-all text-left group"
              >
                <div className="w-8 h-8 rounded-lg bg-white dark:bg-[#0C1830] border border-gray-200 dark:border-blue-900/50 flex items-center justify-center flex-shrink-0 group-hover:border-brand-orange transition-colors">
                  <Database size={14} className="text-brand-orange" />
                </div>
                <div>
                  <div className="font-bold text-sm text-gray-800 dark:text-gray-100">Export Database</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">ส่งออกข้อมูลทั้งหมดแบบ Full Column</div>
                </div>
              </button>
              <button
                onClick={exportPlanWeek}
                className="flex items-start gap-3 w-full px-4 py-3.5 rounded-xl border border-gray-200 dark:border-blue-900/50 bg-gray-50 dark:bg-[#081323] hover:border-[#15803D] hover:bg-green-50 dark:hover:bg-green-900/10 transition-all text-left group"
              >
                <div className="w-8 h-8 rounded-lg bg-white dark:bg-[#0C1830] border border-gray-200 dark:border-blue-900/50 flex items-center justify-center flex-shrink-0 group-hover:border-[#15803D] transition-colors">
                  <LayoutList size={14} className="text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <div className="font-bold text-sm text-gray-800 dark:text-gray-100">Export Plan Week</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">ส่งออกข้อมูลเพื่อใช้คำนวณ Plan Week</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white dark:bg-[#0C1830] rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden">
            <div className="bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 px-5 py-4 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                <AlertTriangle size={16} className="text-red-500" />
              </div>
              <div>
                <div className="font-bold text-red-900 dark:text-red-300 text-sm">ยืนยันการลบ Plan</div>
                <div className="text-red-700 dark:text-red-400 text-xs mt-1 leading-relaxed">
                  ลบ <span className="font-bold">"{[deleteConfirm.unc_code_1, deleteConfirm.unc_code_2, deleteConfirm.unc_code_3, deleteConfirm.unc_code_4].filter(Boolean).join(', ') || deleteConfirm.order_id}"</span> หรือไม่? การลบไม่สามารถย้อนกลับได้
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-5 py-4">
              <button
                onClick={() => commitDeleteOrder(deleteConfirm)}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl transition-all active:scale-95"
              >
                ลบ
              </button>
              <button
                onClick={() => setDeleteConfirm(null)}
                className="flex-1 py-2.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm font-semibold rounded-xl transition-all"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
