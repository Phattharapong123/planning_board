import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Plus, Search, Filter, Download, Edit2, Trash2, Copy,
  ChevronRight, X, Save, AlertTriangle, Package, RefreshCw,
  FileText,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../contexts/AuthContext';
import { useForecast } from '../contexts/ForecastContext';
import MasterPlanDetail from './MasterPlanDetail';
import ForecastImport from './ForecastImport';

// ── Allowed usernames (case-insensitive) ──────────────────────────────────────
const ALLOWED_USERS = ['chawankorn', 'dev1'];

// ── Types ─────────────────────────────────────────────────────────────────────
export interface MasterPlan {
  id: string;
  unc_code: string;
  unc_code_2: string | null;
  unc_code_3: string | null;
  unc_code_4: string | null;
  part_name: string;
  planner: string;
  customer: string;
  size_ton: number | null;
  cycle_time: number | null;
  plan_cavity: number;
  plan_type: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface MasterPlanParameter {
  id: string;
  master_plan_id: string;
  parameter_name: string;
  parameter_value: number | null;
  display_order: number;
}

export interface MasterPlanDaily {
  id: string;
  master_plan_id: string;
  date: string;
  forecast: number;
  order_qty: number;
  stock: number | null;
  plan: number;
  actual: number;
}

// Plan type → badge color
const PLAN_TYPE_COLORS: Record<string, string> = {
  White:  'bg-gray-100 text-gray-700 border-gray-200',
  Yellow: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  Blue:   'bg-blue-100 text-blue-800 border-blue-200',
};

const PLAN_TYPES = ['White', 'Yellow'] as const;
const SIZE_TON_OPTS = [null, 5, 30, 50, 100, 150, 250, 300, 350, 450];
const STATUS_OPTS = ['Active', 'Inactive'];

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// ── Helper: get parameter value from array ────────────────────────────────────
export function getParamValue(params: MasterPlanParameter[], name: string): number | null {
  return params.find(p => p.parameter_name === name)?.parameter_value ?? null;
}

// ── Form modal ─────────────────────────────────────────────────────────────────
interface FormState {
  unc_code: string;
  unc_code_2: string;
  unc_code_3: string;
  unc_code_4: string;
  part_name: string;
  planner: string;
  customer: string;
  size_ton: string;
  cycle_time: string;
  plan_cavity: string;
  plan_type: string;
  status: string;
  stock_max: string;
  stock_min: string;
  current_stock: string;
}

function emptyForm(): FormState {
  return {
    unc_code: '', unc_code_2: '', unc_code_3: '', unc_code_4: '',
    part_name: '', planner: '', customer: '',
    size_ton: '', cycle_time: '', plan_cavity: '1',
    plan_type: 'White', status: 'Active',
    stock_max: '', stock_min: '', current_stock: '',
  };
}

function planToForm(p: MasterPlan, params: MasterPlanParameter[]): FormState {
  return {
    unc_code:      p.unc_code,
    unc_code_2:    p.unc_code_2 ?? '',
    unc_code_3:    p.unc_code_3 ?? '',
    unc_code_4:    p.unc_code_4 ?? '',
    part_name:     p.part_name,
    planner:       p.planner,
    customer:      p.customer,
    size_ton:      p.size_ton != null ? String(p.size_ton) : '',
    cycle_time:    p.cycle_time != null ? String(p.cycle_time) : '',
    plan_cavity:   String(p.plan_cavity),
    plan_type:     p.plan_type,
    status:        p.status,
    stock_max:     String(getParamValue(params, 'Stock Max') ?? ''),
    stock_min:     String(getParamValue(params, 'Stock Min') ?? ''),
    current_stock: String(getParamValue(params, 'Current Stock') ?? ''),
  };
}

interface PlanFormModalProps {
  initial?: { plan: MasterPlan; params: MasterPlanParameter[] };
  onClose: () => void;
  onSaved: () => void;
  dark: boolean;
}

function PlanFormModal({ initial, onClose, onSaved, dark }: PlanFormModalProps) {
  const [form, setForm] = useState<FormState>(() =>
    initial ? planToForm(initial.plan, initial.params) : emptyForm()
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isEdit = !!initial;

  const set = (k: keyof FormState, v: string) => setForm(f => ({ ...f, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.unc_code.trim()) { setError('UNC Code is required'); return; }
    if (!form.part_name.trim()) { setError('Part Name is required'); return; }
    if (!form.planner.trim()) { setError('Planner is required'); return; }
    setSaving(true);

    try {
      const planPayload = {
        unc_code:    form.unc_code.trim(),
        unc_code_2:  form.unc_code_2.trim() || null,
        unc_code_3:  form.unc_code_3.trim() || null,
        unc_code_4:  form.unc_code_4.trim() || null,
        part_name:   form.part_name.trim(),
        planner:     form.planner.trim(),
        customer:    form.customer.trim(),
        size_ton:    form.size_ton ? Number(form.size_ton) : null,
        cycle_time:  form.cycle_time ? Number(form.cycle_time) : null,
        plan_cavity: Number(form.plan_cavity) || 1,
        plan_type:   form.plan_type,
        status:      form.status,
        updated_at:  new Date().toISOString(),
      };

      let planId = initial?.plan.id ?? '';
      if (isEdit) {
        const { error: e } = await supabase.from('master_plans').update(planPayload).eq('id', planId);
        if (e) throw e;
      } else {
        const { data, error: e } = await supabase.from('master_plans').insert(planPayload).select('id').single();
        if (e) throw e;
        planId = data.id;
      }

      // Upsert core parameters
      const coreParams: Array<{ master_plan_id: string; parameter_name: string; parameter_value: number | null; display_order: number }> = [
        { master_plan_id: planId, parameter_name: 'Stock Max',      parameter_value: form.stock_max     ? Number(form.stock_max)     : null, display_order: 0 },
        { master_plan_id: planId, parameter_name: 'Stock Min',      parameter_value: form.stock_min     ? Number(form.stock_min)     : null, display_order: 1 },
        { master_plan_id: planId, parameter_name: 'Current Stock',  parameter_value: form.current_stock ? Number(form.current_stock) : null, display_order: 2 },
      ];
      const { error: pe } = await supabase.from('master_plan_parameters').upsert(coreParams, { onConflict: 'master_plan_id,parameter_name' });
      if (pe) throw pe;

      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  const inputCls = `w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F36B21] ${dark ? 'bg-gray-800 border-gray-600 text-gray-100' : 'bg-white border-gray-200 text-gray-800'}`;
  const labelCls = 'block text-xs font-bold uppercase tracking-wider mb-1 ' + (dark ? 'text-gray-400' : 'text-gray-500');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className={`w-full max-w-2xl rounded-2xl shadow-2xl overflow-hidden ${dark ? 'bg-gray-900' : 'bg-white'}`}>
        <div className="bg-gray-900 dark:bg-gray-800 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package size={14} className="text-[#F36B21]" />
            <span className="text-white font-bold text-sm">{isEdit ? 'Edit Master Plan' : 'New Master Plan'}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-all">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto max-h-[80vh]">
          {/* UNC Codes */}
          <div className={`mb-4 p-3.5 rounded-xl border ${dark ? 'border-gray-700 bg-gray-800/50' : 'border-orange-100 bg-orange-50/50'}`}>
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#F36B21] mb-2.5">UNC Codes (linked to Board cards)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>UNC Code 1 *</label>
                <input className={inputCls} value={form.unc_code} onChange={e => set('unc_code', e.target.value)} placeholder="e.g. ABC-001" />
              </div>
              <div>
                <label className={labelCls}>UNC Code 2</label>
                <input className={inputCls} value={form.unc_code_2} onChange={e => set('unc_code_2', e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label className={labelCls}>UNC Code 3</label>
                <input className={inputCls} value={form.unc_code_3} onChange={e => set('unc_code_3', e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label className={labelCls}>UNC Code 4</label>
                <input className={inputCls} value={form.unc_code_4} onChange={e => set('unc_code_4', e.target.value)} placeholder="Optional" />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Part Name *</label>
                <input className={inputCls} value={form.part_name} onChange={e => set('part_name', e.target.value)} placeholder="Part description" />
            </div>
            <div>
              <label className={labelCls}>Planner *</label>
              <input className={inputCls} value={form.planner} onChange={e => set('planner', e.target.value)} placeholder="Planner name" />
            </div>
            <div>
              <label className={labelCls}>Customer</label>
              <input className={inputCls} value={form.customer} onChange={e => set('customer', e.target.value)} placeholder="Customer name" />
            </div>
            <div>
              <label className={labelCls}>Size Ton</label>
              <select className={inputCls} value={form.size_ton} onChange={e => set('size_ton', e.target.value)}>
                <option value="">— Select —</option>
                {SIZE_TON_OPTS.filter(Boolean).map(v => <option key={v} value={v!}>{v} T</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Cycle Time (sec)</label>
              <input type="number" min="0" step="0.1" className={inputCls} value={form.cycle_time} onChange={e => set('cycle_time', e.target.value)} placeholder="e.g. 120" />
            </div>
            <div>
              <label className={labelCls}>Plan Cavity</label>
              <input type="number" min="1" className={inputCls} value={form.plan_cavity} onChange={e => set('plan_cavity', e.target.value)} />
            </div>
            <div>
              <label className={labelCls}>Plan Type</label>
              <select className={inputCls} value={form.plan_type} onChange={e => set('plan_type', e.target.value)}>
                {PLAN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Status</label>
              <select className={inputCls} value={form.status} onChange={e => set('status', e.target.value)}>
                {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <div className={`mt-5 pt-4 border-t ${dark ? 'border-gray-700' : 'border-gray-100'}`}>
            <p className="text-xs font-bold uppercase tracking-wider text-[#F36B21] mb-3">Core Parameters</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className={labelCls}>Stock Max</label>
                <input type="number" min="0" className={inputCls} value={form.stock_max} onChange={e => set('stock_max', e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className={labelCls}>Stock Min</label>
                <input type="number" min="0" className={inputCls} value={form.stock_min} onChange={e => set('stock_min', e.target.value)} placeholder="0" />
              </div>
              <div>
                <label className={labelCls}>Current Stock</label>
                <input type="number" min="0" className={inputCls} value={form.current_stock} onChange={e => set('current_stock', e.target.value)} placeholder="0" />
              </div>
            </div>
          </div>

          {error && (
            <div className="mt-4 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              <AlertTriangle size={14} /> {error}
            </div>
          )}

          <div className="mt-5 flex justify-end gap-2">
            <button type="button" onClick={onClose} className={`px-4 py-2 rounded-xl text-sm font-semibold transition-all ${dark ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Cancel</button>
            <button type="submit" disabled={saving} className="flex items-center gap-2 px-5 py-2 bg-[#F36B21] hover:bg-[#D4591A] text-white text-sm font-bold rounded-xl shadow shadow-[#F36B21]/30 transition-all active:scale-95 disabled:opacity-60">
              <Save size={13} /> {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Excel export ───────────────────────────────────────────────────────────────
function exportToExcel(plans: Array<MasterPlan & { params: MasterPlanParameter[] }>) {
  const rows = [
    ['UNC Code 1', 'UNC Code 2', 'UNC Code 3', 'UNC Code 4', 'Part Name', 'Planner', 'Customer', 'Size Ton', 'Cycle Time', 'Plan Cavity', 'Plan Type', 'Stock Max', 'Stock Min', 'Current Stock', 'Status', 'Last Update'],
    ...plans.map(p => [
      p.unc_code, p.unc_code_2 ?? '', p.unc_code_3 ?? '', p.unc_code_4 ?? '',
      p.part_name, p.planner, p.customer,
      p.size_ton ?? '', p.cycle_time ?? '', p.plan_cavity, p.plan_type,
      getParamValue(p.params, 'Stock Max') ?? '',
      getParamValue(p.params, 'Stock Min') ?? '',
      getParamValue(p.params, 'Current Stock') ?? '',
      p.status,
      new Date(p.updated_at).toLocaleDateString('en-GB'),
    ]),
  ];

  const xml = `<?xml version="1.0"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
          xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Master Plans">
    <Table>
      ${rows.map(row => `<Row>${row.map(cell => `<Cell><Data ss:Type="${typeof cell === 'number' ? 'Number' : 'String'}">${String(cell).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</Data></Cell>`).join('')}</Row>`).join('\n      ')}
    </Table>
  </Worksheet>
</Workbook>`;

  const blob = new Blob([xml], { type: 'application/vnd.ms-excel' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MasterPlan_${new Date().toISOString().split('T')[0]}.xls`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Main MasterPlan component ─────────────────────────────────────────────────
export default function MasterPlan() {
  const { user }  = useAuth();
  const { currentVersion } = useForecast();
  const dark      = useIsDark();
  const [view, setView] = useState<'list' | 'forecast'>('list');

  // Access control
  const hasAccess = ALLOWED_USERS.includes(user?.username?.toLowerCase() ?? '');

  const [plans, setPlans]             = useState<Array<MasterPlan & { params: MasterPlanParameter[] }>>([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [filterPlanner, setFilterPlanner] = useState('');
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterSizeTon, setFilterSizeTon]   = useState('');
  const [filterPlanType, setFilterPlanType] = useState('');
  const [showForm, setShowForm]       = useState(false);
  const [editTarget, setEditTarget]   = useState<{ plan: MasterPlan; params: MasterPlanParameter[] } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MasterPlan | null>(null);
  const [deleting, setDeleting]       = useState(false);
  const [selectedId, setSelectedId]     = useState<string | null>(null);
  const [relatedPlans, setRelatedPlans] = useState<Array<MasterPlan & { params: MasterPlanParameter[] }>>([]);

  async function openDetail(id: string) {
    setSelectedId(id);
    const target = plans.find(p => p.id === id);
    if (!target) return;
    const codes = [target.unc_code, target.unc_code_2, target.unc_code_3, target.unc_code_4]
      .filter((c): c is string => !!c);
    const orFilter = codes.flatMap(code => [
      `unc_code.eq.${code}`, `unc_code_2.eq.${code}`,
      `unc_code_3.eq.${code}`, `unc_code_4.eq.${code}`,
    ]).join(',');
    const { data } = await supabase
      .from('master_plans')
      .select('*, master_plan_parameters(*)')
      .or(orFilter);
    if (data) {
      setRelatedPlans(data.map((row: MasterPlan & { master_plan_parameters: MasterPlanParameter[] }) => ({
        ...row, params: row.master_plan_parameters ?? [],
      })));
    }
  }

  const fetchPlans = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('master_plans')
      .select('*, master_plan_parameters(*)')
      .order('created_at', { ascending: false });
    if (!error && data) {
      setPlans(data.map((row: MasterPlan & { master_plan_parameters: MasterPlanParameter[] }) => ({
        ...row,
        params: row.master_plan_parameters ?? [],
      })));
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (hasAccess) fetchPlans(); }, [hasAccess, fetchPlans]);

  // Distinct filter options
  const planners   = useMemo(() => [...new Set(plans.map(p => p.planner).filter(Boolean))].sort(), [plans]);
  const customers  = useMemo(() => [...new Set(plans.map(p => p.customer).filter(Boolean))].sort(), [plans]);
  const sizeTons   = useMemo(() => [...new Set(plans.map(p => p.size_ton).filter(v => v != null) as number[])].sort((a, b) => a - b), [plans]);

  const filtered = useMemo(() => {
    let list = plans;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(p =>
        p.unc_code.toLowerCase().includes(q) ||
        (p.unc_code_2 ?? '').toLowerCase().includes(q) ||
        (p.unc_code_3 ?? '').toLowerCase().includes(q) ||
        (p.unc_code_4 ?? '').toLowerCase().includes(q) ||
        p.part_name.toLowerCase().includes(q) ||
        p.planner.toLowerCase().includes(q) ||
        p.customer.toLowerCase().includes(q)
      );
    }
    if (filterPlanner)   list = list.filter(p => p.planner === filterPlanner);
    if (filterCustomer)  list = list.filter(p => p.customer === filterCustomer);
    if (filterSizeTon)   list = list.filter(p => String(p.size_ton) === filterSizeTon);
    if (filterPlanType)  list = list.filter(p => p.plan_type === filterPlanType);
    return list;
  }, [plans, search, filterPlanner, filterCustomer, filterSizeTon, filterPlanType]);

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    await supabase.from('master_plans').delete().eq('id', deleteTarget.id);
    setDeleteTarget(null);
    setDeleting(false);
    fetchPlans();
  }

  async function handleDuplicate(p: MasterPlan & { params: MasterPlanParameter[] }) {
    const { data, error } = await supabase
      .from('master_plans')
      .insert({
        unc_code:    p.unc_code + ' (copy)',
        unc_code_2:  p.unc_code_2,
        unc_code_3:  p.unc_code_3,
        unc_code_4:  p.unc_code_4,
        part_name:   p.part_name,
        planner:     p.planner,
        customer:    p.customer,
        size_ton:    p.size_ton,
        cycle_time:  p.cycle_time,
        plan_cavity: p.plan_cavity,
        plan_type:   p.plan_type,
        status:      p.status,
        updated_at:  new Date().toISOString(),
      })
      .select('id')
      .single();
    if (!error && data && p.params.length > 0) {
      await supabase.from('master_plan_parameters').insert(
        p.params.map(param => ({
          master_plan_id: data.id,
          parameter_name: param.parameter_name,
          parameter_value: param.parameter_value,
          display_order: param.display_order,
        }))
      );
    }
    fetchPlans();
  }

  // ── Detail view ──
  if (selectedId) {
    const plan = plans.find(p => p.id === selectedId);
    if (plan) {
      return (
        <MasterPlanDetail
          plan={plan}
          relatedPlans={relatedPlans}
          params={plan.params}
          onBack={() => { setSelectedId(null); setRelatedPlans([]); fetchPlans(); }}
          dark={dark}
        />
      );
    }
  }

  // ── Access denied ──
  if (!hasAccess) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className={`text-center p-10 rounded-2xl shadow-lg ${dark ? 'bg-gray-800' : 'bg-white'}`}>
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <AlertTriangle size={28} className="text-red-500" />
          </div>
          <h2 className={`text-xl font-bold mb-2 ${dark ? 'text-white' : 'text-gray-900'}`}>Access Denied</h2>
          <p className={`text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>You do not have permission to access Master Plan.</p>
        </div>
      </div>
    );
  }

  // ── Forecast Import sub-view ──
  if (view === 'forecast') {
    return (
      <div className={`flex-1 flex flex-col min-h-0 ${dark ? 'bg-gray-900' : 'bg-gray-50'}`}>
        <div className={`flex items-center gap-2 px-4 py-2 border-b flex-shrink-0 ${dark ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-200'}`}>
          <button onClick={() => setView('list')}
            className={`flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg transition-all ${dark ? 'text-gray-300 hover:bg-gray-700' : 'text-gray-600 hover:bg-gray-100'}`}>
            ← Master Plan
          </button>
        </div>
        <ForecastImport />
      </div>
    );
  }

  const selectCls = `px-3 py-2 text-xs border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#F36B21] ${dark ? 'bg-gray-800 border-gray-600 text-gray-200' : 'bg-white border-gray-200 text-gray-700'}`;
  const thCls = `px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider whitespace-nowrap ${dark ? 'text-gray-400 bg-gray-800' : 'text-gray-500 bg-gray-50'} border-b ${dark ? 'border-gray-700' : 'border-gray-200'} sticky top-0 z-10`;

  return (
    <div className={`flex-1 flex flex-col min-h-0 rounded-xl overflow-hidden border ${dark ? 'bg-gray-900 border-gray-700/60' : 'bg-white border-gray-200'} shadow-sm`}>
      {/* ── Toolbar ── */}
      <div className={`flex items-center gap-2 px-4 py-3 border-b flex-wrap ${dark ? 'border-gray-700/60 bg-gray-900' : 'border-gray-100 bg-white'}`}>
        <div className="flex items-center gap-1.5 mr-1">
          <Package size={15} className="text-[#F36B21]" />
          <span className={`font-black text-sm ${dark ? 'text-white' : 'text-gray-900'}`}>Master Plan</span>
          <span className={`ml-1 text-xs px-2 py-0.5 rounded-full font-semibold ${dark ? 'bg-gray-700 text-gray-300' : 'bg-gray-100 text-gray-500'}`}>{filtered.length}</span>
        </div>

        {/* Forecast Import tab button */}
        <button
          onClick={() => setView('forecast')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all border ${
            dark
              ? 'border-gray-700 text-gray-300 hover:bg-gray-700'
              : 'border-gray-200 text-gray-600 hover:bg-gray-50'
          }`}
        >
          <FileText size={12} className="text-[#F36B21]" />
          Update New Order
          {currentVersion && (
            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${dark ? 'bg-green-900/40 text-green-400' : 'bg-green-100 text-green-700'}`}>
              v{currentVersion.version_number}
            </span>
          )}
        </button>

        {/* Search */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-sm flex-1 min-w-[180px] max-w-xs ${dark ? 'bg-gray-800 border-gray-600' : 'bg-gray-50 border-gray-200'}`}>
          <Search size={12} className="text-gray-400 flex-shrink-0" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search UNC code, part name…"
            className={`flex-1 bg-transparent outline-none text-xs ${dark ? 'text-gray-200 placeholder:text-gray-500' : 'text-gray-700 placeholder:text-gray-400'}`}
          />
          {search && <button onClick={() => setSearch('')}><X size={11} className="text-gray-400" /></button>}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Filter size={11} className="text-gray-400" />
          <select className={selectCls} value={filterPlanner} onChange={e => setFilterPlanner(e.target.value)}>
            <option value="">All Planners</option>
            {planners.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className={selectCls} value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}>
            <option value="">All Customers</option>
            {customers.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <select className={selectCls} value={filterSizeTon} onChange={e => setFilterSizeTon(e.target.value)}>
            <option value="">All Sizes</option>
            {sizeTons.map(v => <option key={v} value={v}>{v} T</option>)}
          </select>
          <select className={selectCls} value={filterPlanType} onChange={e => setFilterPlanType(e.target.value)}>
            <option value="">All Types</option>
            {PLAN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => exportToExcel(filtered)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-semibold rounded-lg transition-all ${dark ? 'bg-gray-700 text-green-400 hover:bg-gray-600' : 'bg-green-50 text-green-700 hover:bg-green-100 border border-green-200'}`}
          >
            <Download size={12} /> Export
          </button>
          <button onClick={fetchPlans} className={`p-2 rounded-lg transition-all ${dark ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-100'}`} title="Refresh">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => { setEditTarget(null); setShowForm(true); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-[#F36B21] hover:bg-[#D4591A] text-white text-xs font-bold rounded-lg shadow shadow-[#F36B21]/25 transition-all active:scale-95"
          >
            <Plus size={12} /> Add New
          </button>
        </div>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse text-sm min-w-[1000px]">
          <thead>
            <tr>
              {['UNC Codes', 'Part Name', 'Planner', 'Customer', 'Size T', 'Cycle Time', 'Stock Max', 'Stock Min', 'Current Stock', 'Plan Type', 'Status', 'Last Update', ''].map(h => (
                <th key={h} className={thCls}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={13} className={`py-16 text-center text-sm ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                <RefreshCw size={20} className="animate-spin mx-auto mb-2 text-[#F36B21]" />Loading…
              </td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={13} className={`py-16 text-center text-sm ${dark ? 'text-gray-500' : 'text-gray-400'}`}>
                No master plans found
              </td></tr>
            ) : filtered.map((p, idx) => {
              const stockMax     = getParamValue(p.params, 'Stock Max');
              const stockMin     = getParamValue(p.params, 'Stock Min');
              const currentStock = getParamValue(p.params, 'Current Stock');
              const isLowStock   = currentStock != null && stockMin != null && currentStock <= stockMin;
              const rowCls = `border-b transition-colors cursor-pointer ${dark
                ? idx % 2 === 0 ? 'bg-gray-900 hover:bg-gray-800 border-gray-700/50' : 'bg-gray-800/40 hover:bg-gray-800 border-gray-700/50'
                : idx % 2 === 0 ? 'bg-white hover:bg-orange-50/40 border-gray-100' : 'bg-gray-50/50 hover:bg-orange-50/40 border-gray-100'}`;
              const tdCls = `px-3 py-2.5 text-xs ${dark ? 'text-gray-300' : 'text-gray-700'}`;
              const extraCodes = [p.unc_code_2, p.unc_code_3, p.unc_code_4].filter(Boolean);

              return (
                <tr key={p.id} className={rowCls} onClick={() => openDetail(p.id)}>
                  <td className={`${tdCls} max-w-[180px]`}>
                    <span className="font-bold text-[#F36B21]">{p.unc_code}</span>
                    {extraCodes.length > 0 && (
                      <div className="flex flex-wrap gap-0.5 mt-0.5">
                        {extraCodes.map((c, i) => (
                          <span key={i} className={`text-[10px] px-1 py-0 rounded border ${dark ? 'border-gray-600 text-gray-400' : 'border-gray-200 text-gray-400'}`}>{c}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className={`${tdCls} font-medium max-w-[160px] truncate`}>{p.part_name}</td>
                  <td className={tdCls}>{p.planner}</td>
                  <td className={tdCls}>{p.customer}</td>
                  <td className={tdCls}>{p.size_ton != null ? `${p.size_ton} T` : '—'}</td>
                  <td className={tdCls}>{p.cycle_time != null ? `${p.cycle_time}s` : '—'}</td>
                  <td className={tdCls}>{stockMax != null ? stockMax.toLocaleString() : '—'}</td>
                  <td className={tdCls}>{stockMin != null ? stockMin.toLocaleString() : '—'}</td>
                  <td className={`${tdCls} font-semibold ${isLowStock ? 'text-red-500' : ''}`}>
                    {currentStock != null ? currentStock.toLocaleString() : '—'}
                  </td>
                  <td className={tdCls}>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border ${PLAN_TYPE_COLORS[p.plan_type] ?? 'bg-gray-100 text-gray-600 border-gray-200'}`}>
                      {p.plan_type}
                    </span>
                  </td>
                  <td className={tdCls}>
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${p.status === 'Active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className={`${tdCls} whitespace-nowrap`}>{new Date(p.updated_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })}</td>
                  <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { setEditTarget({ plan: p, params: p.params }); setShowForm(true); }}
                        className={`p-1.5 rounded-lg transition-all ${dark ? 'text-blue-400 hover:bg-gray-700' : 'text-blue-600 hover:bg-blue-50'}`}
                        title="Edit"
                      ><Edit2 size={12} /></button>
                      <button
                        onClick={() => handleDuplicate(p)}
                        className={`p-1.5 rounded-lg transition-all ${dark ? 'text-gray-400 hover:bg-gray-700' : 'text-gray-500 hover:bg-gray-100'}`}
                        title="Duplicate"
                      ><Copy size={12} /></button>
                      <button
                        onClick={() => setDeleteTarget(p)}
                        className={`p-1.5 rounded-lg transition-all ${dark ? 'text-red-400 hover:bg-gray-700' : 'text-red-500 hover:bg-red-50'}`}
                        title="Delete"
                      ><Trash2 size={12} /></button>
                      <button
                        onClick={() => openDetail(p.id)}
                        className={`p-1.5 rounded-lg transition-all ${dark ? 'text-[#F36B21] hover:bg-gray-700' : 'text-[#F36B21] hover:bg-orange-50'}`}
                        title="Open"
                      ><ChevronRight size={12} /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Form modal ── */}
      {showForm && (
        <PlanFormModal
          initial={editTarget ?? undefined}
          dark={dark}
          onClose={() => { setShowForm(false); setEditTarget(null); }}
          onSaved={() => { setShowForm(false); setEditTarget(null); fetchPlans(); }}
        />
      )}

      {/* ── Delete confirm ── */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className={`w-full max-w-sm rounded-2xl shadow-2xl p-6 ${dark ? 'bg-gray-900' : 'bg-white'}`}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center flex-shrink-0">
                <Trash2 size={18} className="text-red-500" />
              </div>
              <div>
                <h3 className={`font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>Delete Master Plan</h3>
                <p className={`text-xs mt-0.5 ${dark ? 'text-gray-400' : 'text-gray-500'}`}>This will also delete all parameters and daily data.</p>
              </div>
            </div>
            <div className={`rounded-xl px-3 py-2.5 mb-5 ${dark ? 'bg-gray-800' : 'bg-gray-50'}`}>
              <p className={`text-sm font-bold ${dark ? 'text-white' : 'text-gray-900'}`}>{deleteTarget.unc_code}</p>
              <p className={`text-xs ${dark ? 'text-gray-400' : 'text-gray-500'}`}>{deleteTarget.part_name}</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteTarget(null)} className={`px-4 py-2 rounded-xl text-sm font-semibold ${dark ? 'bg-gray-700 text-gray-200 hover:bg-gray-600' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'} transition-all`}>Cancel</button>
              <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-bold rounded-xl transition-all active:scale-95 disabled:opacity-60">
                {deleting ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
