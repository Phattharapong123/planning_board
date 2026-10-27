import { useEffect, useState, useCallback, useMemo } from 'react';
import { RefreshCw, Clock, Maximize2, Minimize2, AlertTriangle, Activity, BarChart2, Trophy } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { ProductionOrder, Machine } from '../types';
import PlanBoard from './PlanBoard';
import { type UserRole } from '../contexts/AuthContext';

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

const EPOCH_MS = new Date('2020-01-01').getTime();
const DAYS_WINDOW = 14;

const SIZE_GROUPS = [
  { label: '5T-30T',    sizes: [5, 30] },
  { label: '50T',       sizes: [50] },
  { label: '100T',      sizes: [100] },
  { label: '150T',      sizes: [150] },
  { label: '250T-350T', sizes: [250, 300, 350, 450] },
] as const;

function daysFromEpoch(d: Date): number {
  return Math.floor((d.getTime() - EPOCH_MS) / 86400000);
}
function getXOffset(order: ProductionOrder): number {
  if (order.x_offset != null) return order.x_offset;
  if (order.scheduled_date) return daysFromEpoch(new Date(order.scheduled_date + 'T00:00:00'));
  return -1;
}
function pad2(n: number) { return String(n).padStart(2, '0'); }
function fmtTime(iso: string) {
  const d = new Date(iso);
  return `${pad2(d.getDate())}/${pad2(d.getMonth()+1)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

interface HistoryRow {
  id: string;
  order_id: string | null;
  order_ref: string;
  unc_codes: string | null;
  event_type: string;
  field_name: string | null;
  old_value: string | null;
  new_value: string | null;
  changed_by: string | null;
  created_at: string;
}

// ── Small KPI chip ───────────────────────────────────────────────────────────
function KpiChip({ label, value, sub, color, bg, border }: {
  label: string; value: number | string; sub?: string; color: string; bg: string; border: string;
}) {
  return (
    <div className="rounded-lg border px-3 py-2 flex flex-col gap-0 flex-1" style={{ background: bg, borderColor: border, minWidth: 90 }}>
      <div className="text-xl font-black leading-none" style={{ color }}>{value}</div>
      {sub && <div className="text-[9px] font-semibold mt-0.5" style={{ color, opacity: 0.6 }}>{sub}</div>}
      <div className="text-[9px] font-bold uppercase tracking-widest leading-tight mt-1 text-gray-500 whitespace-nowrap">{label}</div>
    </div>
  );
}

// ── Machine Status Line Chart ─────────────────────────────────────────────────
function MachineLineChart({ machines, orders, sizeGroup, onSizeGroupChange }: {
  machines: Machine[];
  orders: ProductionOrder[];
  sizeGroup: string | null;
  onSizeGroupChange: (v: string | null) => void;
}) {
  const todayDays = useMemo(() => daysFromEpoch(new Date()), []);

  const sizeSet = useMemo(() => {
    if (!sizeGroup) return null;
    const g = SIZE_GROUPS.find(g => g.label === sizeGroup);
    return g ? new Set<number>(g.sizes) : null;
  }, [sizeGroup]);

  const filtered = useMemo(() =>
    sizeSet ? machines.filter(m => sizeSet.has(m.size_ton)) : machines,
  [machines, sizeSet]);

  const daySummary = useMemo(() => Array.from({ length: DAYS_WINDOW }, (_, i) => {
    const d = todayDays + i;
    const working = filtered.filter(m =>
      orders.some(o => {
        if (o.machine_id !== m.id) return false;
        const x = getXOffset(o);
        if (x < 0) return false;
        const totalDays = (o.leadtime ?? 0) + ((o.leadtime_hours ?? 0) > 0 ? 1 : 0);
        return x <= d && d < x + Math.max(totalDays, 1);
      })
    ).length;
    return { working, idle: filtered.length - working };
  }), [filtered, orders, todayDays]);

  const dayLabels = useMemo(() => Array.from({ length: DAYS_WINDOW }, (_, i) => {
    const d = new Date(EPOCH_MS + (todayDays + i) * 86400000);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
  }), [todayDays]);

  const totalMachines = Math.max(filtered.length, 1);

  // SVG layout
  const SL = 28, SR = 10, ST = 14, SB = 26;
  const SW = 600, SH = 132;
  const cw = SW - SL - SR;
  const ch = SH - ST - SB;

  function px(i: number) { return SL + (i / (DAYS_WINDOW - 1)) * cw; }
  function py(v: number) { return ST + ch - (v / totalMachines) * ch; }

  const workingLine = daySummary.map((d, i) => `${px(i).toFixed(1)},${py(d.working).toFixed(1)}`).join(' ');
  const idleLine    = daySummary.map((d, i) => `${px(i).toFixed(1)},${py(d.idle).toFixed(1)}`).join(' ');

  // Area fills
  const baseY = (ST + ch).toFixed(1);
  const workingArea = `M${px(0).toFixed(1)},${py(daySummary[0].working).toFixed(1)} `
    + daySummary.map((d, i) => `L${px(i).toFixed(1)},${py(d.working).toFixed(1)}`).join(' ')
    + ` L${px(DAYS_WINDOW-1).toFixed(1)},${baseY} L${px(0).toFixed(1)},${baseY} Z`;
  const idleArea = `M${px(0).toFixed(1)},${py(daySummary[0].idle).toFixed(1)} `
    + daySummary.map((d, i) => `L${px(i).toFixed(1)},${py(d.idle).toFixed(1)}`).join(' ')
    + ` L${px(DAYS_WINDOW-1).toFixed(1)},${baseY} L${px(0).toFixed(1)},${baseY} Z`;

  // Y-axis ticks
  const yTicks = [0, Math.ceil(totalMachines / 4), Math.ceil(totalMachines / 2), Math.ceil(totalMachines * 3 / 4), totalMachines];

  // X-axis ticks every 2 days for 14-day window
  const xTicks = [0, 2, 4, 6, 8, 10, 12, 13];

  return (
    <div className="bg-white dark:bg-[#0C1830] rounded-xl border border-gray-200 dark:border-blue-900/50 shadow-sm overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-blue-900/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={11} className="text-[#FF7619]" />
          <span className="text-[11px] font-bold text-gray-800 dark:text-gray-200">Machine Status</span>
          <span className="text-[9px] text-gray-400">(30 วันถัดไป)</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-1.5 rounded-full bg-green-400 inline-block" />
            <span className="text-[9px] text-green-700 dark:text-green-400 font-bold">Working</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-1.5 rounded-full bg-yellow-400 inline-block" />
            <span className="text-[9px] text-yellow-700 dark:text-yellow-400 font-bold">Idle</span>
          </div>
          <div className="flex items-center gap-1 flex-wrap">
            <button onClick={() => onSizeGroupChange(null)}
              className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-all ${!sizeGroup ? 'bg-[#F36B21] text-white' : 'bg-gray-100 dark:bg-[#0C1830] text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-blue-900/40'}`}>
              All
            </button>
            {SIZE_GROUPS.map(g => (
              <button key={g.label} onClick={() => onSizeGroupChange(sizeGroup === g.label ? null : g.label)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold transition-all ${sizeGroup === g.label ? 'bg-[#F36B21] text-white' : 'bg-gray-100 dark:bg-[#0C1830] text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-blue-900/40'}`}>
                {g.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* SVG Chart */}
      <div className="flex-1 p-1 min-h-0">
        <svg viewBox={`0 0 ${SW} ${SH}`} width="100%" height="100%" preserveAspectRatio="none" style={{ display: 'block' }}>
          <defs>
            <linearGradient id="wGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4ADE80" stopOpacity="0.3" />
              <stop offset="100%" stopColor="#4ADE80" stopOpacity="0.02" />
            </linearGradient>
            <linearGradient id="iGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#FACC15" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#FACC15" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {/* Y-axis grid lines + labels */}
          {yTicks.map(v => {
            const y = py(v);
            return (
              <g key={v}>
                <line x1={SL} y1={y} x2={SW - SR} y2={y} stroke="#E5E7EB" strokeWidth="0.5" />
                <text x={SL - 3} y={y + 3} textAnchor="end" fontSize="8" fill="#9CA3AF" fontWeight="600">{v}</text>
              </g>
            );
          })}

          {/* Today vertical marker */}
          <line x1={px(0)} y1={ST} x2={px(0)} y2={ST + ch} stroke="#F36B21" strokeWidth="1.5" strokeDasharray="3 2" opacity="0.6" />
          <text x={px(0)} y={ST - 3} textAnchor="middle" fontSize="8" fill="#F36B21" fontWeight="700">Today</text>

          {/* Area fills */}
          <path d={workingArea} fill="url(#wGrad)" />
          <path d={idleArea}    fill="url(#iGrad)" />

          {/* Lines */}
          <polyline points={workingLine} fill="none" stroke="#22C55E" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
          <polyline points={idleLine}    fill="none" stroke="#EAB308" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />

          {/* Data point dots (every 5 days) */}
          {xTicks.map(i => (
            <g key={i}>
              <circle cx={px(i)} cy={py(daySummary[i].working)} r="2.5" fill="#22C55E" />
              <circle cx={px(i)} cy={py(daySummary[i].idle)}    r="2.5" fill="#EAB308" />
              {/* Value labels at tick points */}
              <text x={px(i)} y={py(daySummary[i].working) - 4} textAnchor="middle" fontSize="7.5" fill="#16A34A" fontWeight="700">
                {daySummary[i].working}
              </text>
            </g>
          ))}

          {/* X-axis labels */}
          {xTicks.map(i => (
            <text key={i} x={px(i)} y={SH - 2} textAnchor="middle" fontSize="7.5" fill="#6B7280" fontWeight="500">
              {dayLabels[i]}
            </text>
          ))}

          {/* Axes */}
          <line x1={SL} y1={ST} x2={SL} y2={ST + ch} stroke="#E5E7EB" strokeWidth="0.8" />
          <line x1={SL} y1={ST + ch} x2={SW - SR} y2={ST + ch} stroke="#E5E7EB" strokeWidth="0.8" />
        </svg>
      </div>
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export default function Dashboard({ role = 'viewer', sizeGroup: externalSizeGroup, onSizeGroupChange: externalOnSizeGroupChange }: {
  role?: UserRole;
  sizeGroup?: string | null;
  onSizeGroupChange?: (v: string | null) => void;
}) {
  const [orders, setOrders]     = useState<ProductionOrder[]>([]);
  const [machines, setMachines] = useState<Machine[]>([]);
  const [history, setHistory]   = useState<HistoryRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [statusSizeGroup, setStatusSizeGroup] = useState<string | null>(externalSizeGroup ?? null);
  const isDark = useIsDark();

  const statusSizeSet = useMemo(() => {
    if (!statusSizeGroup) return null;
    const g = SIZE_GROUPS.find(g => g.label === statusSizeGroup);
    return g ? new Set<number>(g.sizes) : null;
  }, [statusSizeGroup]);

  // Keep in sync with external filter
  useEffect(() => {
    if (externalSizeGroup !== undefined) setStatusSizeGroup(externalSizeGroup ?? null);
  }, [externalSizeGroup]);

  function handleSizeGroupChange(v: string | null) {
    setStatusSizeGroup(v);
    externalOnSizeGroupChange?.(v);
  }

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data: oData }, { data: mData }, { data: hData }] = await Promise.all([
      supabase.from('production_orders').select('*').eq('is_finished', false).order('created_at').limit(5000),
      supabase.from('machines').select('*').order('display_order'),
      supabase.from('plan_history').select('*').order('created_at', { ascending: false }).limit(30),
    ]);
    if (oData) setOrders(oData as ProductionOrder[]);
    if (mData) setMachines(mData as Machine[]);
    if (hData) setHistory(hData as HistoryRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setFullscreen(false);
    }
  }

  useEffect(() => {
    function onFsChange() { setFullscreen(!!document.fullscreenElement); }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Filter orders by the active size group
  const filteredOrders = useMemo(() =>
    statusSizeSet ? orders.filter(o => o.size_ton != null && statusSizeSet.has(o.size_ton)) : orders,
  [orders, statusSizeSet]);

  // KPIs — all derived from filteredOrders
  const totalPlan  = filteredOrders.length;
  const planned    = filteredOrders.filter(o => o.is_planned).length;
  const unplanned  = filteredOrders.filter(o => !o.is_planned).length;
  const usesOpe    = filteredOrders.filter(o => !o.is_planned && !o.urgent && o.plan_type === 'Yellow').length;
  const noOpe      = filteredOrders.filter(o => !o.is_planned && !o.urgent && o.plan_type === 'White').length;
  const waiting    = filteredOrders.filter(o => o.urgent).length;
  const unassigned = filteredOrders.filter(o => !o.machine_id).length;
  const utilRate   = totalPlan > 0 ? Math.round((planned / totalPlan) * 100) : 0;

  // Top 5 UNC codes — from filtered planned orders
  const top5Unc = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of filteredOrders) {
      if (!o.machine_id) continue;
      ([[o.unc_code_1, o.qty_1],[o.unc_code_2, o.qty_2],[o.unc_code_3, o.qty_3],[o.unc_code_4, o.qty_4]] as [string|null, number|null][])
        .forEach(([code, qty]) => { if (code && qty) map.set(code, (map.get(code) ?? 0) + qty); });
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [filteredOrders]);

  // Recent Activity — filtered by order IDs in filteredOrders
  const filteredHistory = useMemo(() => {
    if (!statusSizeGroup) return history;
    const ids = new Set(filteredOrders.map(o => o.id));
    return history.filter(h => h.order_id == null || ids.has(h.order_id));
  }, [history, filteredOrders, statusSizeGroup]);

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="w-9 h-9 border-2 border-[#FF7619]/20 border-t-[#FF7619] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col gap-1.5 min-h-0 overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2 flex-wrap">
          <BarChart2 size={15} className="text-[#F36B21]" />
          <span className="font-black text-gray-800 dark:text-gray-100 text-sm tracking-wide">Dashboard Overview</span>
          {statusSizeGroup && (
            <span className="text-[10px] font-bold bg-[#F36B21] text-white px-2 py-0.5 rounded-full">
              {statusSizeGroup}
            </span>
          )}
          <span className="text-[10px] text-gray-400 font-medium hidden sm:inline">
            {new Date().toLocaleDateString('th-TH', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchData} className="p-1.5 text-gray-500 hover:text-[#FF7619] border border-gray-200 dark:border-blue-900/50 rounded-lg bg-white dark:bg-[#0C1830] hover:bg-orange-50 transition-all">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
          <button onClick={toggleFullscreen} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0A0B0D] hover:bg-gray-800 text-white text-xs font-bold rounded-lg transition-all">
            {fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            {fullscreen ? 'Exit' : 'Full'}
          </button>
        </div>
      </div>

      {/* ── Row 1: KPI strip ── */}
      <div className="flex gap-1.5 flex-shrink-0 flex-wrap">
        <KpiChip label="Total Plan"      value={totalPlan}  bg={isDark ? '#052E16' : '#F0FDF4'} border={isDark ? '#166534' : '#86EFAC'} color={isDark ? '#4ADE80' : '#15803D'} />
        <KpiChip label="Planned"         value={planned}    sub={`${utilRate}%`} bg={isDark ? '#091526' : '#E5E7EB'} border={isDark ? '#1A3055' : '#9CA3AF'} color={isDark ? '#93C5FD' : '#374151'} />
        <KpiChip label="Unplanned"       value={unplanned}  bg={isDark ? '#091526' : '#EFF6FF'} border={isDark ? '#1D4ED8' : '#93C5FD'} color={isDark ? '#60A5FA' : '#1D4ED8'} />
        <KpiChip label="Uses Operator"   value={usesOpe}    bg={isDark ? '#0F1A05' : '#FEF9C3'} border={isDark ? '#D97706' : '#D97706'} color={isDark ? '#FCD34D' : '#92400E'} />
        <KpiChip label="No Operator"     value={noOpe}      bg={isDark ? '#091526' : '#BFDBFE'} border={isDark ? '#2563EB' : '#2563EB'} color={isDark ? '#93C5FD' : '#1E3A5F'} />
        <KpiChip label="Waiting Confirm" value={waiting}    bg={isDark ? '#150A00' : '#FED7AA'} border={isDark ? '#EA580C' : '#EA580C'} color={isDark ? '#FB923C' : '#9A3412'} />
        <KpiChip label="Unassigned"      value={unassigned} bg={isDark ? '#091526' : '#F3F4F6'} border={isDark ? '#1A3055' : '#D1D5DB'} color={isDark ? '#60A5FA' : '#6B7280'} />
        <div className="flex items-center gap-2 ml-auto flex-shrink-0 bg-white dark:bg-[#0C1830] border border-gray-200 dark:border-blue-900/50 rounded-lg px-3 py-2">
          <Clock size={12} className="text-blue-500 flex-shrink-0" />
          <span className="text-[10px] font-bold text-gray-600 dark:text-gray-300">Utilization</span>
          <span className="text-base font-black text-blue-600 dark:text-blue-400">{utilRate}%</span>
          <div className="w-20 h-1.5 bg-gray-100 dark:bg-blue-900/50 rounded-full overflow-hidden">
            <div className="h-full bg-blue-400 rounded-full" style={{ width: `${utilRate}%` }} />
          </div>
        </div>
      </div>

      {/* ── Row 2: Machine Status Line Chart + side panels ── */}
      <div className="flex gap-2 flex-shrink-0 overflow-hidden" style={{ height: 180, maxHeight: 180 }}>

        {/* Machine Line Chart — 45% */}
        <div style={{ flex: '5 1 0%', minWidth: 0 }}>
          <MachineLineChart
            machines={machines}
            orders={orders}
            sizeGroup={statusSizeGroup}
            onSizeGroupChange={handleSizeGroupChange}
          />
        </div>

        {/* Top 5 UNC Codes — 20% */}
        <div style={{ flex: '2 0 0%' }} className="bg-white dark:bg-[#0C1830] rounded-xl border border-gray-200 dark:border-blue-900/50 shadow-sm overflow-hidden flex flex-col">
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-100 dark:border-blue-900/50 flex-shrink-0">
            <Trophy size={11} className="text-amber-500" />
            <span className="text-[11px] font-bold text-gray-800 dark:text-gray-200">Top 5 UNC Qty</span>
          </div>
          <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1">
            {top5Unc.length === 0 ? (
              <div className="text-[10px] text-gray-400 text-center py-4">ยังไม่มีข้อมูล</div>
            ) : top5Unc.map(([code, qty], idx) => (
              <div key={code} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-amber-50 dark:bg-[#0F1A05] border border-amber-100 dark:border-amber-900/50">
                <span className={`text-[10px] font-black w-4 flex-shrink-0 ${idx === 0 ? 'text-amber-500' : idx === 1 ? 'text-gray-400' : 'text-amber-700'}`}>#{idx+1}</span>
                <span className="flex-1 text-[11px] font-bold text-gray-800 dark:text-gray-200 truncate">{code}</span>
                <span className="text-[11px] font-black text-[#F36B21] flex-shrink-0">{qty.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Activity — 35% */}
        <div style={{ flex: '3 0 0%' }} className="bg-white dark:bg-[#0C1830] rounded-xl border border-gray-200 dark:border-blue-900/50 shadow-sm overflow-hidden flex flex-col">
          <div className="flex items-center gap-1.5 px-3 py-2 border-b border-gray-100 dark:border-blue-900/50 flex-shrink-0">
            <AlertTriangle size={11} className="text-[#FF7619]" />
            <span className="text-[11px] font-bold text-gray-800 dark:text-gray-200">Recent Activity</span>
            {filteredHistory.length === 0 && <span className="text-[10px] text-gray-400 ml-1">ยังไม่มีข้อมูล</span>}
          </div>
          {filteredHistory.length > 0 && (
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-[11px] border-collapse">
                <thead className="sticky top-0 bg-gray-50 dark:bg-[#091526]">
                  <tr>
                    <th className="text-left px-2 py-1 text-[9px] font-bold text-gray-400 uppercase tracking-wide whitespace-nowrap">Time</th>
                    <th className="text-left px-2 py-1 text-[9px] font-bold text-gray-400 uppercase tracking-wide">UNC Code</th>
                    <th className="text-left px-2 py-1 text-[9px] font-bold text-gray-400 uppercase tracking-wide">Change</th>
                    <th className="text-left px-2 py-1 text-[9px] font-bold text-gray-400 uppercase tracking-wide">By</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map(h => (
                    <tr key={h.id} className="border-t border-gray-50 dark:border-blue-900/30 hover:bg-orange-50/20 dark:hover:bg-blue-900/20">
                      <td className="px-2 py-1.5 text-gray-400 whitespace-nowrap font-mono">{fmtTime(h.created_at)}</td>
                      <td className="px-2 py-1.5 font-bold whitespace-nowrap" style={{ color: '#FF7619' }}>{h.unc_codes || h.order_ref}</td>
                      <td className="px-2 py-1.5 whitespace-nowrap">
                        {h.event_type === 'created' ? (
                          <span className="bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400 text-[9px] font-bold px-1.5 py-0.5 rounded-full">New Plan</span>
                        ) : (
                          <span className="text-gray-600 dark:text-gray-400 text-[10px]">{h.field_name ?? h.event_type}</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400 whitespace-nowrap">{h.changed_by || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ── Row 3: Planning Board ── */}
      <div className="flex-1 flex flex-col min-h-0">
        <PlanBoard
          role="viewer"
          hideDock={true}
          sizeGroup={statusSizeGroup}
          onSizeGroupChange={handleSizeGroupChange}
        />
      </div>
    </div>
  );
}
