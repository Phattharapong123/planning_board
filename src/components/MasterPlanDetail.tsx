import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  ArrowLeft, Save, Plus, Trash2, RefreshCw, Download,
  Settings2, AlertTriangle, ChevronDown, ChevronUp, Cpu,
  X, Check, ChevronRight, ChevronLeft, Calendar,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { MasterPlan, MasterPlanParameter, MasterPlanDaily } from './MasterPlan';
import { getParamValue } from './MasterPlan';
import type { ProductionOrder } from '../types';
import { useForecast } from '../contexts/ForecastContext';

// ── Constants ─────────────────────────────────────────────────────────────────
const ALL_ROW_TYPES = ['Forecast', 'Order', 'Stock', 'Plan', 'Actual'] as const;
type AllRow = typeof ALL_ROW_TYPES[number];

const ROW_META: Record<AllRow, { label: string; lightCls: string; darkCls: string }> = {
  Forecast: { label: 'Forecast', lightCls: 'bg-blue-50 text-blue-700',    darkCls: 'text-blue-300' },
  Order:    { label: 'Order',    lightCls: 'bg-indigo-50 text-indigo-700', darkCls: 'text-indigo-300' },
  Stock:    { label: 'Stock',    lightCls: 'bg-amber-50 text-amber-700',   darkCls: 'text-amber-300' },
  Plan:     { label: 'Plan',     lightCls: 'bg-green-50 text-green-700',   darkCls: 'text-green-300' },
  Actual:   { label: 'Actual',   lightCls: 'bg-orange-50 text-orange-700', darkCls: 'text-orange-300' },
};

const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const COL_W          = 64;
const LABEL_W        = 120;
const GROUP_HEADER_H = 56;   // fixed height for plan group header row
const DATE_ROW_H     = 28;

// Board-matching weekend/holiday colours (same as PlanBoard.tsx)
function dayBg(isSat: boolean, isSun: boolean, isHol: boolean, dark: boolean): string {
  if (isHol) return dark ? '#2D0F0F' : '#FEE2E2';
  if (isSat || isSun) return dark ? '#1C2E10' : '#FED7AA';
  return '';
}
function dayTextCls(isSat: boolean, isSun: boolean, isHol: boolean, dark: boolean): string {
  if (isHol) return dark ? 'text-red-400' : 'text-red-700';
  if (isSat || isSun) return dark ? 'text-amber-400' : 'text-amber-800';
  return dark ? 'text-gray-400' : 'text-gray-500';
}

function toISODate(d: Date): string { return d.toISOString().split('T')[0]; }
function formatDateLabel(s: string): string {
  const [, m, dd] = s.split('-');
  return `${parseInt(dd, 10)}/${MONTHS_SHORT[parseInt(m, 10) - 1]}`;
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISODate(d);
}
function getDayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00').getDay();
}
function defaultDateRange(): { start: string; numDays: number } {
  const now   = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end   = new Date(now.getFullYear(), now.getMonth() + 3, 0);
  return { start: toISODate(start), numDays: Math.round((end.getTime() - start.getTime()) / 86400000) + 1 };
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface CardInfo {
  id: string; order_id: string; mc_no: string | null;
  qty: number; start: string; end: string;
  unc_code: string; leadtime: number; raw: ProductionOrder;
}
interface BoardDayInfo { qty: number; cards: CardInfo[] }
interface DailyMap { [date: string]: MasterPlanDaily }
interface BoardMap  { [date: string]: BoardDayInfo }

interface Props {
  plan: MasterPlan;
  relatedPlans: Array<MasterPlan & { params: MasterPlanParameter[] }>;
  params: MasterPlanParameter[];
  onBack: () => void;
  dark: boolean;
}

// ── Card edit modal ───────────────────────────────────────────────────────────
interface CardEditModalProps {
  cards: CardInfo[]; date: string; dark: boolean;
  onClose: () => void; onSaved: () => void;
}
function CardEditModal({ cards, date, dark, onClose, onSaved }: CardEditModalProps) {
  const [idx,    setIdx]    = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err,    setErr]    = useState<string | null>(null);
  const card = cards[idx];

  const [qtyPairs,  setQtyPairs]  = useState<Array<{ code: string; qty: string }>>([]);
  const [leadtime,  setLeadtime]  = useState('');
  const [leadtimeH, setLeadtimeH] = useState('');
  const [dueDate,   setDueDate]   = useState('');
  const [remark,    setRemark]    = useState('');
  const [urgent,    setUrgent]    = useState(false);
  const [machines,  setMachines]  = useState<Array<{ id: string; mc_no: string; size_ton: number }>>([]);
  const [machineId, setMachineId] = useState<string | null>(null);
  const [schedDate, setSchedDate] = useState('');

  useEffect(() => {
    supabase.from('machines').select('id,mc_no,size_ton').order('display_order')
      .then(({ data }) => { if (data) setMachines(data as Array<{ id: string; mc_no: string; size_ton: number }>); });
  }, []);

  useEffect(() => {
    if (!card) return;
    const o = card.raw;
    const pairs: Array<{ code: string; qty: string }> = [];
    [{ code: o.unc_code_1, qty: o.qty_1 }, { code: o.unc_code_2, qty: o.qty_2 },
     { code: o.unc_code_3, qty: o.qty_3 }, { code: o.unc_code_4, qty: o.qty_4 }]
      .forEach(s => { if (s.code) pairs.push({ code: s.code, qty: String(s.qty ?? '') }); });
    if (!pairs.length) pairs.push({ code: '', qty: '' });
    setQtyPairs(pairs);
    setLeadtime(o.leadtime != null ? String(o.leadtime) : '');
    setLeadtimeH(o.leadtime_hours != null ? String(o.leadtime_hours) : '');
    setDueDate(o.due_date ?? ''); setRemark(o.remark ?? '');
    setUrgent(o.urgent); setMachineId(o.machine_id);
    setSchedDate(o.scheduled_date ?? date);
    setErr(null); setSaved(false);
  }, [card, date, idx]);

  async function handleSave() {
    if (!card) return;
    setSaving(true); setErr(null);
    const slots = [0, 1, 2, 3].map(i => ({
      code: qtyPairs[i]?.code || null,
      qty:  qtyPairs[i]?.qty ? parseFloat(qtyPairs[i].qty) : null,
    }));
    const { error: e } = await supabase.from('production_orders').update({
      unc_code_1: slots[0].code, qty_1: slots[0].qty,
      unc_code_2: slots[1].code, qty_2: slots[1].qty,
      unc_code_3: slots[2].code, qty_3: slots[2].qty,
      unc_code_4: slots[3].code, qty_4: slots[3].qty,
      leadtime: leadtime ? parseInt(leadtime) : null,
      leadtime_hours: leadtimeH ? parseInt(leadtimeH) : null,
      due_date: dueDate || null, remark: remark || null,
      urgent, machine_id: machineId,
      scheduled_date: schedDate || null, is_updated: true,
    }).eq('id', card.id);
    setSaving(false);
    if (e) { setErr(e.message); return; }
    setSaved(true); onSaved(); setTimeout(() => setSaved(false), 1500);
  }

  const inp = `px-2 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F36B21] ${dark ? 'bg-gray-800 border-gray-600 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`;
  const lbl = `text-[10px] font-bold uppercase tracking-wider mb-1 ${dark ? 'text-gray-500' : 'text-gray-400'}`;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
      <div className={`w-full max-w-lg rounded-2xl shadow-2xl border flex flex-col ${dark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`} style={{ maxHeight: '90vh' }}>
        <div className={`flex items-center gap-2 px-4 py-3 border-b ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
          <div className="flex-1 min-w-0">
            <div className={`text-[10px] font-bold uppercase tracking-wider ${dark ? 'text-gray-500' : 'text-gray-400'}`}>Edit Board Card · {formatDateLabel(date)}</div>
            <div className={`text-sm font-black ${dark ? 'text-white' : 'text-gray-900'}`}>{card?.order_id}</div>
          </div>
          {cards.length > 1 && (
            <div className="flex items-center gap-1">
              <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0} className={`p-1 rounded-lg disabled:opacity-30 ${dark ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-600'}`}><ChevronLeft size={14} /></button>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${dark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}>{idx + 1}/{cards.length}</span>
              <button onClick={() => setIdx(i => Math.min(cards.length - 1, i + 1))} disabled={idx === cards.length - 1} className={`p-1 rounded-lg disabled:opacity-30 ${dark ? 'hover:bg-gray-700 text-gray-300' : 'hover:bg-gray-100 text-gray-600'}`}><ChevronRight size={14} /></button>
            </div>
          )}
          <button onClick={onClose} className={`p-1.5 rounded-xl ${dark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          <div>
            <div className={lbl}>UNC Code / Qty</div>
            <div className="space-y-2">
              {qtyPairs.map((pair, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input value={pair.code} onChange={e => setQtyPairs(p => p.map((x, j) => j === i ? { ...x, code: e.target.value } : x))} placeholder="UNC Code" className={`${inp} flex-1`} />
                  <input type="number" value={pair.qty} onChange={e => setQtyPairs(p => p.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} placeholder="Qty" className={`${inp} w-24`} />
                  {qtyPairs.length > 1 && <button onClick={() => setQtyPairs(p => p.filter((_, j) => j !== i))} className="p-1 text-red-400 rounded-lg transition-all"><X size={12} /></button>}
                </div>
              ))}
              {qtyPairs.length < 4 && <button onClick={() => setQtyPairs(p => [...p, { code: '', qty: '' }])} className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg ${dark ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-500 hover:bg-gray-50'}`}><Plus size={11} /> Add slot</button>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className={lbl}>Scheduled Date</div><input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} className={`${inp} w-full`} /></div>
            <div>
              <div className={lbl}>Machine</div>
              <select value={machineId ?? ''} onChange={e => setMachineId(e.target.value || null)} className={`${inp} w-full`}>
                <option value="">— unassigned —</option>
                {machines.map(m => <option key={m.id} value={m.id}>{m.mc_no} ({m.size_ton}T)</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className={lbl}>Leadtime (Days)</div><input type="number" min="1" value={leadtime} onChange={e => setLeadtime(e.target.value)} className={`${inp} w-full`} /></div>
            <div><div className={lbl}>Leadtime (Hours)</div><input type="number" min="0" max="23" value={leadtimeH} onChange={e => setLeadtimeH(e.target.value)} className={`${inp} w-full`} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className={lbl}>Due Date</div><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={`${inp} w-full`} /></div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} className="w-4 h-4 rounded accent-[#F36B21]" />
                <span className={`text-xs font-semibold ${dark ? 'text-gray-300' : 'text-gray-700'}`}>Urgent</span>
              </label>
            </div>
          </div>
          <div><div className={lbl}>Remark</div><textarea value={remark} onChange={e => setRemark(e.target.value)} rows={2} className={`${inp} w-full resize-none`} /></div>
          {err && <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs"><AlertTriangle size={12} />{err}</div>}
        </div>
        <div className={`flex items-center justify-between gap-2 px-4 py-3 border-t ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
          <button onClick={onClose} className={`px-3 py-1.5 text-xs font-semibold rounded-xl ${dark ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-100'}`}>Cancel</button>
          <button onClick={handleSave} disabled={saving} className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-xl shadow active:scale-95 disabled:opacity-60 ${saved ? 'bg-green-500 text-white' : 'bg-[#F36B21] text-white hover:bg-[#D4591A]'}`}>
            {saved ? <><Check size={12} /> Saved!</> : saving ? <><RefreshCw size={12} className="animate-spin" /> Saving…</> : <><Save size={12} /> Save Card</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Create Plan modal — pre-filled, with auto-calculated leadtime ──────────────
interface CreatePlanModalProps {
  uncCode: string;
  scheduledDate: string;   // clicked column date → default scheduled date
  planType: string;
  cycleTime: number | null;
  planCavity: number | null;
  dark: boolean;
  onClose: () => void;
  onSaved: () => void;
}
function CreatePlanModal({
  uncCode, scheduledDate, planType, cycleTime, planCavity,
  dark, onClose, onSaved,
}: CreatePlanModalProps) {
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err,    setErr]    = useState<string | null>(null);

  const [qtyPairs,   setQtyPairs]   = useState<Array<{ code: string; qty: string }>>([{ code: uncCode, qty: '' }]);
  const [schedDate,  setSchedDate]  = useState(scheduledDate);
  const [dueDate,    setDueDate]    = useState(scheduledDate);
  const [leadtimeD,  setLeadtimeD]  = useState('1');
  const [leadtimeH,  setLeadtimeH]  = useState('0');
  const [selectedPlanType, setSelectedPlanType] = useState(planType || 'White');
  const [urgent,     setUrgent]     = useState(false);
  const [remark,     setRemark]     = useState('');
  const [machines,   setMachines]   = useState<Array<{ id: string; mc_no: string; size_ton: number }>>([]);
  const [machineId,  setMachineId]  = useState<string | null>(null);
  const [sizeTon,    setSizeTon]    = useState('');

  useEffect(() => {
    supabase.from('machines').select('id,mc_no,size_ton').order('display_order')
      .then(({ data }) => { if (data) setMachines(data as Array<{ id: string; mc_no: string; size_ton: number }>); });
  }, []);

  // Recalculate leadtime whenever qty changes (uses CT and Cav from params)
  function recalcLeadtime(qty: string) {
    const q = parseFloat(qty);
    if (!q || !cycleTime || !planCavity || cycleTime <= 0 || planCavity <= 0) return;
    const totalHours = q / ((3600 / cycleTime) * planCavity);
    const days       = Math.floor(totalHours / 24);
    const remHours   = Math.ceil(totalHours % 24);
    setLeadtimeD(String(Math.max(1, days + (remHours > 0 ? 0 : 0))));
    // If remainder hours exist, keep days as-is and set hours; otherwise hours=0
    // Edge: if totalHours < 24 → days=0 but we need at least 1 day with hours
    if (days === 0) {
      setLeadtimeD('1');
      setLeadtimeH(String(remHours > 0 ? remHours : 1));
    } else {
      setLeadtimeD(String(days));
      setLeadtimeH(String(remHours));
    }
  }

  async function handleSave() {
    const slots = [0, 1, 2, 3].map(i => ({
      code: qtyPairs[i]?.code?.trim() || null,
      qty:  qtyPairs[i]?.qty ? parseFloat(qtyPairs[i].qty) : null,
    }));
    if (!slots[0].code) { setErr('UNC Code is required'); return; }

    setSaving(true); setErr(null);
    const { error: e } = await supabase.from('production_orders').insert({
      // order_id intentionally omitted — DB auto-generates PL1-xxxxxx
      unc_code_1: slots[0].code, qty_1: slots[0].qty,
      unc_code_2: slots[1].code, qty_2: slots[1].qty,
      unc_code_3: slots[2].code, qty_3: slots[2].qty,
      unc_code_4: slots[3].code, qty_4: slots[3].qty,
      size_ton:       sizeTon   ? parseInt(sizeTon)    : null,
      leadtime:       leadtimeD ? parseInt(leadtimeD)  : 1,
      leadtime_hours: leadtimeH ? parseInt(leadtimeH)  : 0,
      due_date:      dueDate    || null,
      scheduled_date: schedDate || null,
      remark: remark || null,
      plan_type: selectedPlanType,
      urgent, machine_id: machineId,
      is_planned: true, is_printed: false, is_finished: false, is_updated: false,
    });
    setSaving(false);
    if (e) { setErr(e.message); return; }
    setSaved(true);
    onSaved();
    setTimeout(() => { setSaved(false); onClose(); }, 1200);
  }

  const inp = `px-2 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F36B21] ${dark ? 'bg-gray-800 border-gray-600 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`;
  const lbl = `text-[10px] font-bold uppercase tracking-wider mb-1 ${dark ? 'text-gray-500' : 'text-gray-400'}`;
  const canRecalc = !!(cycleTime && planCavity);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-lg rounded-2xl shadow-2xl border flex flex-col ${dark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`} style={{ maxHeight: '92vh' }}>
        {/* Header */}
        <div className="bg-[#1a1a2e] px-5 py-4 rounded-t-2xl flex items-center justify-between flex-shrink-0">
          <div>
            <div className="text-gray-400 text-[10px] font-bold uppercase tracking-wider">New Production Order</div>
            <div className="text-white text-sm font-black mt-0.5">{uncCode} <span className="text-[#F36B21]">· {formatDateLabel(scheduledDate)}</span></div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-all"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* UNC Code / Qty */}
          <div>
            <div className={lbl}>UNC Code / Qty</div>
            <div className="space-y-2">
              {qtyPairs.map((pair, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input value={pair.code}
                    onChange={e => setQtyPairs(p => p.map((x, j) => j === i ? { ...x, code: e.target.value } : x))}
                    placeholder="UNC Code" className={`${inp} flex-1`} />
                  <input type="number" value={pair.qty}
                    onChange={e => {
                      const val = e.target.value;
                      setQtyPairs(p => p.map((x, j) => j === i ? { ...x, qty: val } : x));
                      if (i === 0) recalcLeadtime(val);
                    }}
                    placeholder="Qty" className={`${inp} w-24`} />
                  {qtyPairs.length > 1 && (
                    <button onClick={() => setQtyPairs(p => p.filter((_, j) => j !== i))} className="p-1 text-red-400 rounded-lg"><X size={12} /></button>
                  )}
                </div>
              ))}
              {qtyPairs.length < 4 && (
                <button onClick={() => setQtyPairs(p => [...p, { code: '', qty: '' }])}
                  className={`flex items-center gap-1 text-xs px-2 py-1 rounded-lg ${dark ? 'text-gray-400 hover:bg-gray-800' : 'text-gray-500 hover:bg-gray-50'}`}>
                  <Plus size={11} /> Add slot
                </button>
              )}
            </div>
          </div>

          {/* Leadtime — auto-calculated */}
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className={lbl.replace('mb-1','')}>Leadtime</div>
              {canRecalc && (
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold ${dark ? 'bg-green-900/40 text-green-400' : 'bg-green-50 text-green-700'}`}>
                  Auto (CT={cycleTime}s · Cav={planCavity})
                </span>
              )}
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <div className={`${lbl} mt-0`} style={{ marginBottom: 4 }}>Days</div>
                <input type="number" min="0" value={leadtimeD} onChange={e => setLeadtimeD(e.target.value)} className={`${inp} w-full`} />
              </div>
              <div className="flex-1">
                <div className={`${lbl} mt-0`} style={{ marginBottom: 4 }}>Hours</div>
                <input type="number" min="0" max="23" value={leadtimeH} onChange={e => setLeadtimeH(e.target.value)} className={`${inp} w-full`} />
              </div>
            </div>
          </div>

          {/* Dates + Machine */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className={lbl}>Scheduled Date</div>
              <input type="date" value={schedDate} onChange={e => setSchedDate(e.target.value)} className={`${inp} w-full`} />
            </div>
            <div>
              <div className={lbl}>Due Date</div>
              <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className={`${inp} w-full`} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className={lbl}>Machine</div>
              <select value={machineId ?? ''} onChange={e => setMachineId(e.target.value || null)} className={`${inp} w-full`}>
                <option value="">— unassigned —</option>
                {machines.map(m => <option key={m.id} value={m.id}>{m.mc_no} ({m.size_ton}T)</option>)}
              </select>
            </div>
            <div>
              <div className={lbl}>Size Ton</div>
              <input type="number" value={sizeTon} onChange={e => setSizeTon(e.target.value)} placeholder="e.g. 350" className={`${inp} w-full`} />
            </div>
          </div>

          {/* Plan Type + Urgent */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className={lbl}>Plan Type</div>
              <select value={selectedPlanType} onChange={e => setSelectedPlanType(e.target.value)} className={`${inp} w-full`}>
                <option value="White">White</option>
                <option value="Yellow">Yellow</option>
              </select>
            </div>
            <div className="flex items-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} className="w-4 h-4 rounded accent-[#F36B21]" />
                <span className={`text-xs font-semibold ${dark ? 'text-gray-300' : 'text-gray-700'}`}>Urgent</span>
              </label>
            </div>
          </div>

          <div>
            <div className={lbl}>Remark</div>
            <textarea value={remark} onChange={e => setRemark(e.target.value)} rows={2} className={`${inp} w-full resize-none`} />
          </div>

          {err && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
              <AlertTriangle size={12} />{err}
            </div>
          )}
        </div>

        <div className={`flex items-center justify-between gap-2 px-4 py-3 border-t ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
          <button onClick={onClose} className={`px-3 py-1.5 text-xs font-semibold rounded-xl ${dark ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-100'}`}>Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className={`flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-xl shadow active:scale-95 disabled:opacity-60 ${saved ? 'bg-green-500 text-white' : 'bg-[#F36B21] text-white hover:bg-[#D4591A]'}`}>
            {saved ? <><Check size={12} /> Created!</> : saving ? <><RefreshCw size={12} className="animate-spin" /> Creating…</> : <><Plus size={12} /> Create Plan</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Plan cell (board cards + create button) ───────────────────────────────────
interface PlanCellProps {
  date: string; dateIndex: number; totalDates: number;
  info: BoardDayInfo | undefined; startingCards: CardInfo[];
  dark: boolean;
  onEdit:   (date: string, cards: CardInfo[]) => void;
  onCreate: (date: string) => void;
}
function PlanCell({ date, dateIndex, totalDates, info, startingCards, dark, onEdit, onCreate }: PlanCellProps) {
  const [showTip, setShowTip] = useState(false);
  const hasCards = (info?.cards?.length ?? 0) > 0;
  const qty = info?.qty ?? 0;
  const fill = dark ? '#4ade80' : '#16a34a';
  return (
    <td
      className={`relative p-0 border-r border-gray-200/40 dark:border-gray-700/40 w-16 min-w-[64px] select-none group cursor-pointer`}
      style={{ height: 36, overflow: 'visible' }}
      onClick={() => hasCards ? onEdit(date, info!.cards) : onCreate(date)}
      onMouseEnter={() => hasCards && setShowTip(true)}
      onMouseLeave={() => setShowTip(false)}
    >
      {startingCards.map((card, i) => {
        const spanDays = Math.min(card.leadtime, totalDates - dateIndex);
        const w = spanDays * COL_W;
        const h = 7; const tip = 5;
        return (
          <div key={card.id} style={{ position: 'absolute', bottom: 2 + i * 9, left: 0, width: w, height: h, pointerEvents: 'none', zIndex: 4 }}>
            <svg width={w} height={h} style={{ display: 'block', overflow: 'visible' }}>
              {spanDays >= card.leadtime
                ? <polygon points={`0,0 ${w - tip},0 ${w},${h / 2} ${w - tip},${h} 0,${h}`} fill={fill} opacity={0.75} />
                : <rect x={0} y={0} width={w} height={h} fill={fill} opacity={0.55} />}
            </svg>
          </div>
        );
      })}
      <div className={`relative z-10 flex items-center justify-center h-full text-xs font-semibold ${
        qty === 0
          ? 'text-gray-200 dark:text-gray-700 group-hover:text-[#F36B21] dark:group-hover:text-[#F36B21] transition-colors'
          : dark ? 'text-green-300' : 'text-green-700'
      }`}>
        {qty === 0 ? <Plus size={10} className="opacity-0 group-hover:opacity-100 transition-opacity" /> : qty.toLocaleString()}
      </div>
      {showTip && info && info.cards.length > 0 && (
        <div className={`absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-1.5 w-56 rounded-xl shadow-2xl border text-left p-2.5 text-[10px] ${dark ? 'bg-gray-800 border-gray-600 text-gray-200' : 'bg-white border-gray-200 text-gray-700'}`} style={{ pointerEvents: 'none' }}>
          <div className={`mb-2 text-[9px] font-bold uppercase tracking-wider ${dark ? 'text-gray-500' : 'text-gray-400'}`}>Click to edit · {info.cards.length} card{info.cards.length > 1 ? 's' : ''}</div>
          {info.cards.map((c, i) => (
            <div key={i} className={`${i > 0 ? `mt-1.5 pt-1.5 border-t ${dark ? 'border-gray-700' : 'border-gray-100'}` : ''}`}>
              <div className="flex items-center justify-between gap-1">
                <span className="font-bold text-[#F36B21]">{c.order_id}</span>
                {c.mc_no && <span className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded font-semibold text-[9px] ${dark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-600'}`}><Cpu size={7} />{c.mc_no}</span>}
              </div>
              <div className={dark ? 'text-gray-400' : 'text-gray-500'}>{c.unc_code} · <span className="font-semibold">{c.qty.toLocaleString()} pcs</span></div>
              <div className={dark ? 'text-gray-500' : 'text-gray-400'}>{formatDateLabel(c.start)} → {formatDateLabel(c.end)} · {c.leadtime}D</div>
            </div>
          ))}
        </div>
      )}
    </td>
  );
}

// ── Stock cell ────────────────────────────────────────────────────────────────
interface StockCellProps {
  date: string; computedVal: number; manualVal: number | null;
  dark: boolean; stockMin: number;
  onSave: (date: string, val: number) => Promise<void>;
}
function StockCell({ date, computedVal, manualVal, dark, stockMin, onSave }: StockCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const displayVal = manualVal != null ? manualVal : computedVal;
  const isRed      = displayVal <= stockMin && displayVal !== 0;
  const isManual   = manualVal != null;

  function startEdit() { setDraft(displayVal === 0 ? '' : String(displayVal)); setEditing(true); }
  async function commit() {
    const n = parseFloat(draft);
    const val = isNaN(n) ? computedVal : n;
    setEditing(false);
    await onSave(date, val);
  }
  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') setEditing(false);
  }
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  if (editing) {
    return (
      <td className="p-0 border-r border-gray-200/40 dark:border-gray-700/40 w-16 min-w-[64px]">
        <input ref={inputRef} type="number" value={draft}
          onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={handleKey}
          className={`w-full h-9 px-1 text-xs text-center outline-none ring-2 ring-inset ring-[#F36B21] ${dark ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}
          autoFocus />
      </td>
    );
  }
  return (
    <td onClick={startEdit}
      className={`relative px-1 py-1 text-xs text-center font-bold border-r border-gray-200/40 dark:border-gray-700/40 w-16 min-w-[64px] cursor-pointer hover:ring-2 hover:ring-inset hover:ring-[#F36B21]/40 select-none transition-colors ${
        isRed ? 'text-red-500 bg-red-50 dark:bg-red-900/20' : dark ? 'text-amber-300' : 'text-amber-700'
      }`} style={{ height: 36 }}>
      {displayVal === 0 ? <span className="text-gray-300 dark:text-gray-600 font-normal">—</span> : displayVal.toLocaleString()}
      {isManual && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-[#F36B21] opacity-70" />}
    </td>
  );
}

// ── Editable cell (Forecast / Order / Actual) ─────────────────────────────────
interface SimpleCellProps {
  value: number; date: string; rowType: 'Forecast' | 'Order' | 'Actual';
  dark: boolean;
  onChange: (date: string, row: 'Forecast' | 'Order' | 'Actual', val: number) => void;
  onCommit: (date: string, row: 'Forecast' | 'Order' | 'Actual') => void;
}
function SimpleCell({ value, date, rowType, dark, onChange, onCommit }: SimpleCellProps) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  function startEdit() { setDraft(value === 0 ? '' : String(value)); setEditing(true); }
  function commit() {
    const n = parseFloat(draft);
    const committed = isNaN(n) ? 0 : Math.max(0, n);
    // Call onChange first so the parent state is updated, then commit with that value
    onChange(date, rowType, committed);
    onCommit(date, rowType);
    setEditing(false);
  }
  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') setEditing(false);
  }
  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);
  const colorCls =
    rowType === 'Forecast' ? (dark ? 'text-blue-300'   : 'text-blue-700')   :
    rowType === 'Order'    ? (dark ? 'text-indigo-300' : 'text-indigo-700') :
                             (dark ? 'text-orange-300' : 'text-orange-700');
  if (editing) {
    return (
      <td className="p-0 border-r border-gray-200/40 dark:border-gray-700/40 w-16 min-w-[64px]">
        <input ref={inputRef} type="number" value={draft}
          onChange={e => setDraft(e.target.value)} onBlur={commit} onKeyDown={handleKey}
          className={`w-full h-9 px-1 text-xs text-center outline-none ring-2 ring-inset ring-[#F36B21] ${dark ? 'bg-gray-900 text-white' : 'bg-white text-gray-900'}`}
          autoFocus />
      </td>
    );
  }
  return (
    <td onClick={startEdit}
      className={`px-1 py-1 text-xs text-center border-r border-gray-200/40 dark:border-gray-700/40 w-16 min-w-[64px] cursor-pointer hover:ring-2 hover:ring-inset hover:ring-[#F36B21]/40 select-none ${colorCls}`}
      style={{ height: 36 }}>
      {value === 0 ? <span className="text-gray-300 dark:text-gray-600">—</span> : value.toLocaleString()}
    </td>
  );
}

// ── Parameter pill ────────────────────────────────────────────────────────────
function ParamRow({ param, dark, onChange, onDelete }: {
  param: MasterPlanParameter; dark: boolean;
  onChange: (id: string, val: number | null) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState(param.parameter_value != null ? String(param.parameter_value) : '');
  const cls = `w-28 px-2 py-1.5 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F36B21] text-right ${dark ? 'bg-gray-800 border-gray-600 text-gray-200' : 'bg-white border-gray-200 text-gray-800'}`;
  function commit() { const n = parseFloat(draft); onChange(param.id, isNaN(n) ? null : n); }
  return (
    <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border ${dark ? 'bg-gray-800 border-gray-700' : 'bg-gray-50 border-gray-200'}`}>
      <span className={`flex-1 text-xs font-semibold ${dark ? 'text-gray-200' : 'text-gray-700'}`}>{param.parameter_name}</span>
      <input type="number" className={cls} value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') commit(); }} />
      <button onClick={() => onDelete(param.id)} className="p-1 text-red-400 hover:text-red-600 rounded-lg transition-all"><Trash2 size={11} /></button>
    </div>
  );
}

// ── PlanRows ──────────────────────────────────────────────────────────────────
interface PlanRowsProps {
  plan: MasterPlan; params: MasterPlanParameter[];
  dates: string[]; today: string; dark: boolean;
  holidaySet: Set<string>;
  onParamChange: (id: string, val: number | null) => void;
  onParamDelete: (id: string) => void;
  onParamAdd:    (name: string) => void;
  paramSaving:   boolean;
  onEditParams:  () => void;
}

function PlanRows({ plan, params, dates, today, dark, holidaySet, onParamChange, onParamDelete, onParamAdd, paramSaving, onEditParams }: PlanRowsProps) {
  const { getQty } = useForecast();

  const [dailyMap,    setDailyMap]    = useState<DailyMap>({});
  const [boardMap,    setBoardMap]    = useState<BoardMap>({});
  const [savingDates, setSavingDates] = useState<Set<string>>(new Set());
  const [showParams,  setShowParams]  = useState(false);
  const [newParamName, setNewParamName] = useState('');
  const [error,       setError]       = useState<string | null>(null);
  const [editModalDate,   setEditModalDate]   = useState<string | null>(null);
  const [editModalCards,  setEditModalCards]  = useState<CardInfo[]>([]);
  const [createModalDate, setCreateModalDate] = useState<string | null>(null);

  // Ref always holds the latest dailyMap — used in handleCommit to avoid stale closure
  const dailyMapRef = useRef<DailyMap>(dailyMap);
  useEffect(() => { dailyMapRef.current = dailyMap; }, [dailyMap]);

  const uncCodes = useMemo(() =>
    [plan.unc_code, plan.unc_code_2, plan.unc_code_3, plan.unc_code_4].filter((c): c is string => !!c),
    [plan.unc_code, plan.unc_code_2, plan.unc_code_3, plan.unc_code_4]
  );

  const fetchDaily = useCallback(async () => {
    if (!dates.length) return;
    const { data, error: e } = await supabase.from('master_plan_daily').select('*')
      .eq('master_plan_id', plan.id)
      .gte('date', dates[0]).lte('date', dates[dates.length - 1]);
    if (!e && data) {
      const map: DailyMap = {};
      (data as MasterPlanDaily[]).forEach(r => { map[r.date] = r; });
      setDailyMap(map);
    }
  }, [plan.id, dates]);

  const fetchBoard = useCallback(async () => {
    if (!uncCodes.length || !dates.length) return;
    const orFilter = uncCodes.flatMap(c => [
      `unc_code_1.eq.${c}`, `unc_code_2.eq.${c}`,
      `unc_code_3.eq.${c}`, `unc_code_4.eq.${c}`,
    ]).join(',');
    const { data, error: e } = await supabase.from('production_orders').select('*, machines(mc_no)')
      .or(orFilter).not('scheduled_date', 'is', null)
      .gte('scheduled_date', addDays(dates[0], -60))
      .lte('scheduled_date', dates[dates.length - 1]);
    if (e || !data) return;

    const map: BoardMap = {};
    for (const raw of data as Array<ProductionOrder & { machines: { mc_no: string } | null }>) {
      if (!raw.scheduled_date) continue;
      const mc_no    = (raw.machines as unknown as { mc_no: string } | null)?.mc_no ?? null;
      const leadtime = Math.max(1, raw.leadtime ?? 1);
      const cardStart = raw.scheduled_date;
      const cardEnd   = addDays(cardStart, leadtime - 1);
      const slots = [
        { code: raw.unc_code_1, qty: raw.qty_1 }, { code: raw.unc_code_2, qty: raw.qty_2 },
        { code: raw.unc_code_3, qty: raw.qty_3 }, { code: raw.unc_code_4, qty: raw.qty_4 },
      ].filter(s => s.code && uncCodes.includes(s.code));
      if (!slots.length) continue;
      const totalQty  = slots.reduce((s, x) => s + (x.qty ?? 0), 0);
      const qtyPerDay = Math.round(totalQty / leadtime);
      const cardInfo: CardInfo = { id: raw.id, order_id: raw.order_id, mc_no, qty: totalQty,
        start: cardStart, end: cardEnd, unc_code: slots[0].code!, leadtime,
        raw: raw as unknown as ProductionOrder };
      for (let i = 0; i < leadtime; i++) {
        const d = addDays(cardStart, i);
        if (d < dates[0] || d > dates[dates.length - 1]) continue;
        if (!map[d]) map[d] = { qty: 0, cards: [] };
        map[d].qty += qtyPerDay;
        if (!map[d].cards.find(c => c.order_id === raw.order_id)) map[d].cards.push(cardInfo);
      }
    }
    setBoardMap(map);
  }, [uncCodes, dates]);

  useEffect(() => { fetchDaily(); }, [fetchDaily]);
  useEffect(() => { fetchBoard(); }, [fetchBoard]);

  const stockMin     = getParamValue(params, 'Stock Min')     ?? 0;
  const currentStock = getParamValue(params, 'Current Stock') ?? 0;

  const computedStocks = useMemo(() => {
    const stocks: Record<string, number> = {};
    let prev = currentStock;
    for (const date of dates) {
      const manualStock = dailyMap[date]?.stock;
      if (manualStock != null) {
        stocks[date] = manualStock;
        prev = manualStock;
      } else {
        const forecast = dailyMap[date]?.forecast ?? 0;
        const orderQty = getQty(plan.unc_code, plan.customer, date) || dailyMap[date]?.order_qty || 0;
        const actual   = dailyMap[date]?.actual ?? 0;
        const plan_qty = boardMap[date]?.qty ?? 0;
        stocks[date]   = prev - forecast - orderQty + (actual > 0 ? actual : plan_qty);
        prev = stocks[date];
      }
    }
    return stocks;
  }, [dates, dailyMap, boardMap, currentStock, getQty, plan.unc_code, plan.customer]);

  function handleChange(date: string, row: 'Forecast' | 'Order' | 'Actual', val: number) {
    setDailyMap(prev => {
      const base = prev[date] ?? { id: '', master_plan_id: plan.id, date, forecast: 0, order_qty: 0, stock: null, plan: 0, actual: 0 };
      return { ...prev, [date]: { ...base,
        forecast:  row === 'Forecast' ? val : base.forecast,
        order_qty: row === 'Order'    ? val : (base.order_qty ?? 0),
        actual:    row === 'Actual'   ? val : base.actual,
      }};
    });
  }

  // ── Fix: read latest state via ref, not stale closure ────────────────────────
  async function handleCommit(date: string, _row: 'Forecast' | 'Order' | 'Actual') {
    setSavingDates(prev => new Set(prev).add(date));
    try {
      const base = dailyMapRef.current[date] ?? { master_plan_id: plan.id, date, forecast: 0, order_qty: 0, stock: null, plan: 0, actual: 0 };
      const { error: e } = await supabase.from('master_plan_daily').upsert({
        master_plan_id: plan.id, date,
        forecast:  base.forecast,
        order_qty: base.order_qty ?? 0,
        plan:      base.plan,
        actual:    base.actual,
      }, { onConflict: 'master_plan_id,date' });
      if (e) setError(e.message);
    } finally {
      setSavingDates(prev => { const s = new Set(prev); s.delete(date); return s; });
    }
  }

  async function handleStockSave(date: string, val: number) {
    setSavingDates(prev => new Set(prev).add(date));
    setDailyMap(prev => {
      const base = prev[date] ?? { id: '', master_plan_id: plan.id, date, forecast: 0, order_qty: 0, stock: null, plan: 0, actual: 0 };
      return { ...prev, [date]: { ...base, stock: val } };
    });
    try {
      const base = dailyMapRef.current[date] ?? { master_plan_id: plan.id, date, forecast: 0, order_qty: 0, stock: null, plan: 0, actual: 0 };
      const { error: e } = await supabase.from('master_plan_daily').upsert({
        master_plan_id: plan.id, date,
        forecast: base.forecast, order_qty: base.order_qty ?? 0,
        stock: val, plan: base.plan, actual: base.actual,
      }, { onConflict: 'master_plan_id,date' });
      if (e) setError(e.message);
    } finally {
      setSavingDates(prev => { const s = new Set(prev); s.delete(date); return s; });
    }
  }

  const headerBg = dark ? 'bg-gray-800' : 'bg-slate-100';
  const border   = dark ? 'border-gray-700' : 'border-gray-200';

  // Key params to always show inline
  const cycleTime  = getParamValue(params, 'Cycle Time');
  const planCavity = getParamValue(params, 'Plan Cavity') ?? (plan.plan_cavity || null);
  const stockMax   = getParamValue(params, 'Stock Max');
  const stockMinV  = getParamValue(params, 'Stock Min');

  // Today highlight colour for column cells
  const todayBg = dark ? 'rgba(243,107,33,0.12)' : 'rgba(243,107,33,0.07)';

  return (
    <>
      {/* ── Group header row — sticky top:0 so it stays visible on vertical scroll ── */}
      <tr style={{ height: GROUP_HEADER_H }}>
        {/* LEFT: sticky both axes — UNC code + all params + Edit Params button */}
        <td
          className={`border-r border-b ${border} ${headerBg}`}
          style={{ position: 'sticky', top: 0, left: 0, zIndex: 25, width: LABEL_W, minWidth: LABEL_W, height: GROUP_HEADER_H, verticalAlign: 'top', padding: '6px 8px' }}
        >
          {/* UNC Code — no wrap */}
          <div className="flex items-center gap-1 min-w-0 mb-1">
            <span className="text-xs font-black text-[#F36B21] truncate leading-tight" title={plan.unc_code}>{plan.unc_code}</span>
            {[plan.unc_code_2, plan.unc_code_3, plan.unc_code_4].filter(Boolean).map((c, i) => (
              <span key={i} className={`flex-shrink-0 text-[8px] px-1 py-0 rounded border font-semibold leading-tight ${dark ? 'border-gray-600 text-gray-400' : 'border-gray-300 text-gray-500'}`}>{c}</span>
            ))}
          </div>
          {/* Key params — always visible here since this cell is sticky both ways */}
          <div className={`text-[8px] leading-tight space-y-px ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
            {cycleTime  != null && <div>CT: <span className="font-bold">{cycleTime}s</span></div>}
            {planCavity != null && <div>Cav: <span className="font-bold">{planCavity}</span></div>}
            {stockMax   != null && <div>Max: <span className="font-bold">{stockMax.toLocaleString()}</span></div>}
            {stockMinV  != null && <div>Min: <span className="font-bold">{stockMinV.toLocaleString()}</span></div>}
          </div>
          {/* Edit Params + collapse */}
          <div className="flex items-center gap-1 mt-1">
            <button onClick={onEditParams}
              className={`flex items-center gap-0.5 text-[8px] font-bold px-1.5 py-0.5 rounded border transition-all ${dark ? 'text-[#F36B21] border-[#F36B21]/30 hover:bg-[#F36B21]/10' : 'text-[#F36B21] border-[#F36B21]/30 hover:bg-orange-50'}`}>
              <Settings2 size={7} /> Params {paramSaving && <RefreshCw size={7} className="animate-spin" />}
            </button>
            <button onClick={() => setShowParams(v => !v)}
              className={`flex items-center gap-0.5 text-[8px] px-1 py-0.5 rounded transition-all ${dark ? 'text-gray-500 hover:bg-gray-700' : 'text-gray-400 hover:bg-gray-200'}`}>
              {showParams ? <ChevronUp size={7} /> : <ChevronDown size={7} />}
            </button>
          </div>
        </td>
        {/* RIGHT: minimal — just saving/error status; all params are in the sticky left column */}
        <td colSpan={dates.length} className={`px-3 border-b ${border} ${headerBg}`}
          style={{ position: 'sticky', top: 0, zIndex: 15 }}>
          <div className="flex items-center gap-3 text-[10px] h-full">
            {savingDates.size > 0 && <span className="flex items-center gap-1 text-[#F36B21]"><RefreshCw size={8} className="animate-spin" /> saving…</span>}
            {error && <span className="text-red-500 flex items-center gap-1"><AlertTriangle size={10} />{error}</span>}
          </div>
        </td>
      </tr>

      {/* ── Parameters row (collapsible) ── */}
      {showParams && (
        <tr>
          <td className={`border-r border-b ${border} ${dark ? 'bg-gray-900' : 'bg-white'}`}
            style={{ position: 'sticky', top: GROUP_HEADER_H, left: 0, zIndex: 25, width: LABEL_W, minWidth: LABEL_W }}>
            <span className={`text-[9px] font-bold px-2 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>PARAMS</span>
          </td>
          <td colSpan={dates.length} className={`px-3 py-2 border-b ${border} ${dark ? 'bg-gray-900' : 'bg-white'}`}>
            <div className="flex flex-wrap gap-2">
              {params.map(p => (
                <ParamRow key={p.id} param={p} dark={dark} onChange={onParamChange} onDelete={onParamDelete} />
              ))}
              <div className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed ${dark ? 'border-gray-600' : 'border-gray-300'}`}>
                <input type="text" placeholder="Parameter name…" value={newParamName}
                  onChange={e => setNewParamName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && newParamName.trim()) { onParamAdd(newParamName); setNewParamName(''); } }}
                  className={`text-xs bg-transparent outline-none w-32 ${dark ? 'text-gray-200 placeholder:text-gray-600' : 'text-gray-700 placeholder:text-gray-400'}`} />
                <button onClick={() => { if (newParamName.trim()) { onParamAdd(newParamName); setNewParamName(''); } }}
                  disabled={!newParamName.trim()} className="p-1 text-[#F36B21] rounded-lg disabled:opacity-40"><Plus size={12} /></button>
              </div>
            </div>
          </td>
        </tr>
      )}

      {/* ── Date header row — sticky below group header ── */}
      <tr>
        <td className={`border-r border-b ${border} ${dark ? 'bg-gray-800' : 'bg-gray-100'}`}
          style={{ position: 'sticky', top: GROUP_HEADER_H, left: 0, zIndex: 25, height: DATE_ROW_H, width: LABEL_W, minWidth: LABEL_W }}>
          <span className={`text-[9px] font-bold uppercase tracking-wide px-2 ${dark ? 'text-gray-500' : 'text-gray-400'}`}>Date</span>
        </td>
        {dates.map(d => {
          const isToday  = d === today;
          const dow      = getDayOfWeek(d);
          const isSat    = dow === 6;
          const isSun    = dow === 0;
          const isHol    = holidaySet.has(d);
          const bg       = isToday ? '#F36B21' : dayBg(isSat, isSun, isHol, dark);
          const txtCls   = isToday ? 'text-white' : dayTextCls(isSat, isSun, isHol, dark);
          return (
            <td key={d}
              className={`px-0 py-1 text-center text-[10px] font-bold border-r border-b whitespace-nowrap ${txtCls}`}
              style={{ position: 'sticky', top: GROUP_HEADER_H, zIndex: 10, height: DATE_ROW_H, background: bg || (dark ? '#1e293b' : '#f1f5f9') }}>
              {formatDateLabel(d)}
            </td>
          );
        })}
      </tr>

      {/* ── Data rows ── */}
      {ALL_ROW_TYPES.map(rowType => {
        const meta    = ROW_META[rowType];
        const isStock = rowType === 'Stock';
        const isPlan  = rowType === 'Plan';
        return (
          <tr key={`${plan.id}-${rowType}`}>
            <td className={`border-r border-b ${border} ${dark ? 'bg-gray-900' : 'bg-white'}`}
              style={{ position: 'sticky', left: 0, zIndex: 10, height: 36, width: LABEL_W, minWidth: LABEL_W, padding: '4px 8px' }}>
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${dark ? meta.darkCls + ' bg-gray-800' : meta.lightCls}`}>{meta.label}</span>
            </td>

            {dates.map((date, dateIndex) => {
              const isSaving = savingDates.has(date);
              const isToday  = date === today;
              const dow      = getDayOfWeek(date);
              const isSat    = dow === 6;
              const isSun    = dow === 0;
              const isHol    = holidaySet.has(date);
              // Today: full-column highlight stripe; Sat/Sun/Holiday: tinted bg
              const cellBg   = isToday ? todayBg
                             : dayBg(isSat, isSun, isHol, dark)
                               ? `${dayBg(isSat, isSun, isHol, dark)}33`
                               : undefined;

              if (isStock) {
                return (
                  <td key={date} className={`border-b ${border} ${isSaving ? 'opacity-50' : ''} p-0`}
                    style={{ height: 36, overflow: 'visible', background: cellBg }}>
                    <StockCell date={date} computedVal={computedStocks[date] ?? 0}
                      manualVal={dailyMap[date]?.stock ?? null} dark={dark} stockMin={stockMin} onSave={handleStockSave} />
                  </td>
                );
              }

              if (isPlan) {
                const startingCards = (boardMap[date]?.cards ?? []).filter(c => c.start === date);
                return (
                  <td key={date} className={`border-b ${border} p-0`}
                    style={{ height: 36, overflow: 'visible', background: cellBg }}>
                    <PlanCell date={date} dateIndex={dateIndex} totalDates={dates.length}
                      info={boardMap[date]} startingCards={startingCards} dark={dark}
                      onEdit={(d, cards) => { setEditModalDate(d); setEditModalCards(cards); }}
                      onCreate={(d) => setCreateModalDate(d)} />
                  </td>
                );
              }

              const value =
                rowType === 'Forecast' ? (dailyMap[date]?.forecast ?? 0) :
                rowType === 'Order'    ? (getQty(plan.unc_code, plan.customer, date) || dailyMap[date]?.order_qty || 0) :
                                         (dailyMap[date]?.actual ?? 0);
              return (
                <td key={date} className={`border-b ${border} ${isSaving ? 'opacity-50' : ''} p-0`}
                  style={{ height: 36, background: cellBg }}>
                  <SimpleCell value={value} date={date} rowType={rowType as 'Forecast' | 'Order' | 'Actual'}
                    dark={dark} onChange={handleChange} onCommit={handleCommit} />
                </td>
              );
            })}
          </tr>
        );
      })}

      {/* Spacer */}
      <tr><td colSpan={dates.length + 1} style={{ height: 8 }} className={dark ? 'bg-gray-900' : 'bg-gray-50'} /></tr>

      {/* Modals */}
      {editModalDate && editModalCards.length > 0 && (
        <CardEditModal cards={editModalCards} date={editModalDate} dark={dark}
          onClose={() => { setEditModalDate(null); setEditModalCards([]); }}
          onSaved={() => fetchBoard()} />
      )}
      {/* Create Plan — pre-filled with UNC code, date, plan type, auto-calc leadtime */}
      {createModalDate && (
        <CreatePlanModal
          uncCode={plan.unc_code}
          scheduledDate={createModalDate}
          planType={plan.plan_type ?? 'White'}
          cycleTime={cycleTime ?? null}
          planCavity={planCavity ?? null}
          dark={dark}
          onClose={() => setCreateModalDate(null)}
          onSaved={() => { fetchBoard(); setCreateModalDate(null); }}
        />
      )}
    </>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function MasterPlanDetail({ plan, relatedPlans, params: initialParams, onBack, dark }: Props) {
  const today = useMemo(() => toISODate(new Date()), []);
  const { start: defaultStart, numDays: defaultNumDays } = useMemo(() => defaultDateRange(), []);
  const dates = useMemo(() => {
    const arr: string[] = [];
    for (let i = 0; i < defaultNumDays; i++) arr.push(addDays(defaultStart, i));
    return arr;
  }, [defaultStart, defaultNumDays]);

  // Holiday set for O(1) lookup
  const [holidaySet, setHolidaySet] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!dates.length) return;
    supabase.from('holidays').select('date')
      .gte('date', dates[0]).lte('date', dates[dates.length - 1])
      .then(({ data }) => {
        if (data) setHolidaySet(new Set(data.map((h: { date: string }) => h.date)));
      });
  }, [dates]);

  const allPlans = useMemo(() => {
    const seen = new Set<string>();
    const merged: Array<MasterPlan & { params: MasterPlanParameter[] }> = [];
    for (const p of relatedPlans) {
      if (!seen.has(p.id)) { seen.add(p.id); merged.push(p); }
    }
    if (!seen.has(plan.id)) merged.unshift({ ...plan, params: initialParams });
    return merged;
  }, [relatedPlans, plan, initialParams]);

  const [paramsMap,   setParamsMap]   = useState<Record<string, MasterPlanParameter[]>>(() => ({ [plan.id]: initialParams }));
  const [paramSaving, setParamSaving] = useState<Record<string, boolean>>({});
  const [error,       setError]       = useState<string | null>(null);

  // Edit params modal
  const [editParamsPlanId, setEditParamsPlanId] = useState<string | null>(null);
  const editParamsPlan = editParamsPlanId ? allPlans.find(p => p.id === editParamsPlanId) : null;

  useEffect(() => {
    for (const p of allPlans) {
      supabase.from('master_plan_parameters').select('*')
        .eq('master_plan_id', p.id).order('display_order')
        .then(({ data }) => {
          if (data) setParamsMap(prev => ({ ...prev, [p.id]: data as MasterPlanParameter[] }));
        });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allPlans.length]);

  async function handleParamChange(planId: string, id: string, value: number | null) {
    setParamsMap(prev => ({ ...prev, [planId]: (prev[planId] ?? []).map(p => p.id === id ? { ...p, parameter_value: value } : p) }));
    setParamSaving(prev => ({ ...prev, [planId]: true }));
    const { error: e } = await supabase.from('master_plan_parameters').update({ parameter_value: value }).eq('id', id);
    if (e) setError(e.message);
    setParamSaving(prev => ({ ...prev, [planId]: false }));
  }
  async function handleParamDelete(planId: string, id: string) {
    setParamSaving(prev => ({ ...prev, [planId]: true }));
    await supabase.from('master_plan_parameters').delete().eq('id', id);
    const { data } = await supabase.from('master_plan_parameters').select('*').eq('master_plan_id', planId).order('display_order');
    if (data) setParamsMap(prev => ({ ...prev, [planId]: data as MasterPlanParameter[] }));
    setParamSaving(prev => ({ ...prev, [planId]: false }));
  }
  async function handleParamAdd(planId: string, name: string) {
    if (!name.trim()) return;
    setParamSaving(prev => ({ ...prev, [planId]: true }));
    const cur = paramsMap[planId] ?? [];
    const maxOrder = cur.reduce((m, p) => Math.max(m, p.display_order), -1);
    const { error: e } = await supabase.from('master_plan_parameters').insert({
      master_plan_id: planId, parameter_name: name.trim(), parameter_value: null, display_order: maxOrder + 1,
    });
    if (e) setError(e.message);
    else {
      const { data } = await supabase.from('master_plan_parameters').select('*').eq('master_plan_id', planId).order('display_order');
      if (data) setParamsMap(prev => ({ ...prev, [planId]: data as MasterPlanParameter[] }));
    }
    setParamSaving(prev => ({ ...prev, [planId]: false }));
  }

  const labelCls  = `text-[10px] font-bold uppercase tracking-wider ${dark ? 'text-gray-500' : 'text-gray-400'}`;
  const tableMinW = LABEL_W + dates.length * COL_W;

  return (
    <div className={`flex-1 flex flex-col min-h-0 ${dark ? 'bg-gray-900' : 'bg-gray-50'}`}>

      {/* Top bar */}
      <div className={`flex items-center gap-3 px-4 py-2.5 border-b flex-wrap flex-shrink-0 shadow-sm ${dark ? 'bg-gray-900 border-gray-700/60' : 'bg-white border-gray-200'}`}>
        <button onClick={onBack} className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${dark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'}`}>
          <ArrowLeft size={13} /> Back
        </button>
        <div className={`w-px h-5 ${dark ? 'bg-gray-700' : 'bg-gray-200'}`} />
        <div>
          <div className={labelCls}>UNC Code</div>
          <span className="text-sm font-black text-[#F36B21]">{plan.unc_code}</span>
        </div>
        <div>
          <div className={labelCls}>Part Name</div>
          <div className={`text-sm font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>{plan.part_name}</div>
        </div>
        <div className="hidden sm:block">
          <div className={labelCls}>Planner</div>
          <div className={`text-xs ${dark ? 'text-gray-300' : 'text-gray-700'}`}>{plan.planner}</div>
        </div>
        {allPlans.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap ml-2">
            <span className={`text-[10px] ${dark ? 'text-gray-500' : 'text-gray-400'}`}>Related:</span>
            {allPlans.map(p => (
              <span key={p.id} className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${dark ? 'border-gray-600 text-gray-300' : 'border-gray-300 text-gray-600'}`}>{p.unc_code}</span>
            ))}
          </div>
        )}
        {error && <div className="ml-auto flex items-center gap-1 text-xs text-red-500"><AlertTriangle size={12} />{error}<button onClick={() => setError(null)} className="ml-1 font-bold">×</button></div>}
      </div>

      {/* Legend + holiday key + export */}
      <div className={`flex items-center gap-3 px-4 py-2 border-b flex-shrink-0 flex-wrap ${dark ? 'bg-gray-900 border-gray-700/60' : 'bg-white border-gray-100'}`}>
        <div className={`text-[10px] font-semibold ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
          {dates.length > 0 && `${formatDateLabel(dates[0])} → ${formatDateLabel(dates[dates.length - 1])}`}
        </div>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          {[
            { color: 'bg-blue-400',   label: 'Forecast' },
            { color: 'bg-indigo-400', label: 'Order' },
            { color: 'bg-amber-400',  label: 'Stock' },
            { color: 'bg-green-500',  label: 'Plan' },
            { color: 'bg-orange-400', label: 'Actual' },
          ].map(({ color, label }) => (
            <span key={label} className="flex items-center gap-1 text-[10px]">
              <span className={`w-2 h-2 rounded-full ${color}`} />
              <span className={dark ? 'text-gray-500' : 'text-gray-400'}>{label}</span>
            </span>
          ))}
          {/* Weekend / holiday legend — matching Board colours */}
          <span className={`w-px h-4 ${dark ? 'bg-gray-700' : 'bg-gray-200'}`} />
          <span className="flex items-center gap-1 text-[10px]">
            <span className={`w-2 h-2 rounded-sm border`} style={{ background: dark ? '#1C2E10' : '#FED7AA', borderColor: dark ? '#365314' : '#F59E0B' }} />
            <span className={dark ? 'text-gray-500' : 'text-gray-400'}>Sat/Sun</span>
          </span>
          <span className="flex items-center gap-1 text-[10px]">
            <span className={`w-2 h-2 rounded-sm border`} style={{ background: dark ? '#2D0F0F' : '#FEE2E2', borderColor: dark ? '#7F1D1D' : '#FCA5A5' }} />
            <Calendar size={8} className={dark ? 'text-gray-500' : 'text-gray-400'} />
            <span className={dark ? 'text-gray-500' : 'text-gray-400'}>Holiday</span>
          </span>
          <button onClick={() => {
            const xml = `<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Plan"><Table><Row>${['Row/Date', ...dates.map(d => formatDateLabel(d))].map(c => `<Cell><Data ss:Type="String">${c}</Data></Cell>`).join('')}</Row></Table></Worksheet></Workbook>`;
            const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href = url; a.download = `${plan.unc_code}_DailyPlan.xls`; a.click();
            URL.revokeObjectURL(url);
          }} className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${dark ? 'bg-gray-700 text-green-400 hover:bg-gray-600' : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'}`}>
            <Download size={12} /> Export
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <div style={{ minWidth: tableMinW }}>
          <table className="border-collapse text-xs w-full" style={{ tableLayout: 'fixed', width: tableMinW }}>
            <colgroup>
              <col style={{ width: LABEL_W, minWidth: LABEL_W }} />
              {dates.map(d => (
                <col key={d} style={{
                  width: COL_W, minWidth: COL_W,
                  ...(d === today ? { background: dark ? 'rgba(243,107,33,0.10)' : 'rgba(243,107,33,0.07)' } : {}),
                }} />
              ))}
            </colgroup>
            <tbody>
              {allPlans.map(p => (
                <PlanRows
                  key={p.id}
                  plan={p}
                  params={paramsMap[p.id] ?? []}
                  dates={dates}
                  today={today}
                  dark={dark}
                  holidaySet={holidaySet}
                  onParamChange={(id, val) => handleParamChange(p.id, id, val)}
                  onParamDelete={(id) => handleParamDelete(p.id, id)}
                  onParamAdd={(name) => handleParamAdd(p.id, name)}
                  paramSaving={paramSaving[p.id] ?? false}
                  onEditParams={() => setEditParamsPlanId(p.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit params panel (modal) */}
      {editParamsPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div className={`w-full max-w-lg rounded-2xl shadow-2xl border flex flex-col ${dark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`} style={{ maxHeight: '80vh' }}>
            <div className={`flex items-center justify-between px-4 py-3 border-b ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
              <div>
                <div className={`text-[10px] font-bold uppercase tracking-wider ${dark ? 'text-gray-500' : 'text-gray-400'}`}>Parameters</div>
                <div className={`text-sm font-black text-[#F36B21]`}>{editParamsPlan.unc_code}</div>
              </div>
              <button onClick={() => setEditParamsPlanId(null)} className={`p-1.5 rounded-xl ${dark ? 'hover:bg-gray-700 text-gray-400' : 'hover:bg-gray-100 text-gray-500'}`}><X size={16} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {(paramsMap[editParamsPlan.id] ?? []).map(p => (
                <ParamRow key={p.id} param={p} dark={dark}
                  onChange={(id, val) => handleParamChange(editParamsPlan.id, id, val)}
                  onDelete={(id) => handleParamDelete(editParamsPlan.id, id)} />
              ))}
              {/* Add new param */}
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed ${dark ? 'border-gray-600' : 'border-gray-300'}`}>
                <input type="text" placeholder="New parameter name…"
                  className={`flex-1 text-xs bg-transparent outline-none ${dark ? 'text-gray-200 placeholder:text-gray-600' : 'text-gray-700 placeholder:text-gray-400'}`}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                      handleParamAdd(editParamsPlan.id, (e.target as HTMLInputElement).value.trim());
                      (e.target as HTMLInputElement).value = '';
                    }
                  }} />
                <span className={`text-[10px] ${dark ? 'text-gray-500' : 'text-gray-400'}`}>Enter to add</span>
              </div>
            </div>
            <div className={`px-4 py-3 border-t flex justify-end ${dark ? 'border-gray-700' : 'border-gray-200'}`}>
              <button onClick={() => setEditParamsPlanId(null)} className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-bold rounded-xl bg-[#F36B21] text-white hover:bg-[#D4591A]">
                <Check size={12} /> Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
