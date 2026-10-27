import { useState, useRef, useEffect, useCallback } from 'react';
import { Plus, X, AlertTriangle, Save, ChevronDown, CheckCircle, Clock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import type { UncQtyPair, PlanType, ProductionOrder } from '../types';
import { SIZE_TON_OPTIONS } from '../types';
import { useAuth } from '../contexts/AuthContext';
import type { UncPart } from './PartList';

interface FormState {
  pairs: UncQtyPair[];
  sizeTon: string;
  leadtimeDays: string;
  leadtimeHours: string;
  dueDate: string;   // display format: DD/MM/YYYY
  planIssueDate: string;
  remark: string;
  planType: PlanType;
  urgent: boolean;
}

interface FieldErrors {
  pairs: { unc_code: boolean; qty: boolean }[];
  sizeTon: boolean;
  leadtimeDays: boolean;
  leadtimeHours: boolean;
  dueDate: boolean;
  planIssueDate: boolean;
}

const MAX_PAIRS = 4;

function isPairComplete(pair: UncQtyPair) {
  return pair.unc_code.trim() !== '' && pair.qty.trim() !== '';
}

// Convert YYYY-MM-DD → d/m/yy for display (short year)
function isoToDisplay(iso: string): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${parseInt(d)}/${parseInt(m)}/${y.slice(2)}`;
}

// Convert d/m/yy, d/m/yyyy, or d/m (auto-fills current year) → YYYY-MM-DD for storage
// Returns null if invalid
function displayToISO(display: string): string | null {
  const parts = display.trim().split('/').map(p => p.trim());
  if (parts.length < 2) return null;
  const [d, m] = parts;
  if (!d || !m || !/^\d{1,2}$/.test(d) || !/^\d{1,2}$/.test(m)) return null;
  const currentYY = String(new Date().getFullYear()).slice(2);
  const rawY = parts[2] ?? currentYY;
  const year = rawY.length === 2 ? '20' + rawY : rawY;
  if (!/^\d{4}$/.test(year)) return null;
  const dd = d.padStart(2, '0');
  const mm = m.padStart(2, '0');
  const dateObj = new Date(`${year}-${mm}-${dd}`);
  if (isNaN(dateObj.getTime())) return null;
  return `${year}-${mm}-${dd}`;
}

// On blur: if user typed d/m (no year), append current 2-digit year
function normalizeDateOnBlur(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  const parts = trimmed.split('/');
  if (parts.length === 2 && parts[0] && parts[1]) {
    const yy = String(new Date().getFullYear()).slice(2);
    return `${parts[0]}/${parts[1]}/${yy}`;
  }
  return trimmed;
}

function blankForm(): FormState {
  return {
    pairs: [{ unc_code: '', qty: '' }],
    sizeTon: '',
    leadtimeDays: '',
    leadtimeHours: '',
    dueDate: '',
    planIssueDate: '',
    remark: '',
    planType: 'White',
    urgent: false,
  };
}

function blankErrors(pairCount = 1): FieldErrors {
  return {
    pairs: Array.from({ length: pairCount }, () => ({ unc_code: false, qty: false })),
    sizeTon: false, leadtimeDays: false, leadtimeHours: false, dueDate: false, planIssueDate: false,
  };
}

function orderToFormState(order: ProductionOrder): FormState {
  const pairs: UncQtyPair[] = [];
  const slots = [
    { code: order.unc_code_1, qty: order.qty_1 },
    { code: order.unc_code_2, qty: order.qty_2 },
    { code: order.unc_code_3, qty: order.qty_3 },
    { code: order.unc_code_4, qty: order.qty_4 },
  ];
  for (const s of slots) {
    if (s.code) pairs.push({ unc_code: s.code, qty: String(s.qty ?? '') });
  }
  if (pairs.length === 0) pairs.push({ unc_code: '', qty: '' });
  return {
    pairs,
    sizeTon: order.size_ton != null ? String(order.size_ton) : '',
    leadtimeDays: order.leadtime != null ? String(order.leadtime) : '',
    leadtimeHours: order.leadtime_hours != null ? String(order.leadtime_hours) : '',
    dueDate: order.due_date ? isoToDisplay(order.due_date) : '',
    planIssueDate: order.plan_issue_date ? isoToDisplay(order.plan_issue_date) : '',
    remark: order.remark ?? '',
    planType: order.plan_type,
    urgent: order.urgent,
  };
}

interface Props {
  onSaved: () => void;
  onCreated?: () => void;
  onCancel: () => void;
  editOrder?: ProductionOrder;
}

export default function ProductionForm({ onSaved, onCreated, onCancel, editOrder }: Props) {
  const { user } = useAuth();

  // Internal edit state — can be switched via Recent Plans panel
  const [internalEditOrder, setInternalEditOrder] = useState<ProductionOrder | undefined>(editOrder);
  const isEdit = !!internalEditOrder;

  const [form, setForm] = useState<FormState>(() =>
    internalEditOrder ? orderToFormState(internalEditOrder) : blankForm()
  );
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>(() => blankErrors(editOrder ? 1 : 1));
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Recent Plans — only orders created by this user
  const [recentOrders, setRecentOrders] = useState<ProductionOrder[]>([]);
  const fetchRecent = useCallback(async () => {
    if (!user?.username) return;
    const { data } = await supabase
      .from('production_orders')
      .select('*')
      .eq('created_by', user.username)
      .order('created_at', { ascending: false })
      .limit(10);
    if (data) setRecentOrders(data as ProductionOrder[]);
  }, [user?.username]);
  useEffect(() => { fetchRecent(); }, [fetchRecent]);

  // Part List (UNC Code master) — for autocomplete
  const [uncParts, setUncParts] = useState<UncPart[]>([]);
  useEffect(() => {
    supabase.from('unc_parts').select('*').order('unc_code').then(({ data }) => {
      if (data) setUncParts(data as UncPart[]);
    });
  }, []);

  // Autocomplete state for UNC code 1 field
  const [partSuggestions, setPartSuggestions] = useState<UncPart[]>([]);
  const [showPartDrop, setShowPartDrop]       = useState(false);
  const partDropRef = useRef<HTMLDivElement>(null);

  const uncRefs  = useRef<(HTMLInputElement | null)[]>([null, null, null, null]);
  const qtyRefs  = useRef<(HTMLInputElement | null)[]>([null, null, null, null]);
  const sizeTonRef        = useRef<HTMLSelectElement>(null);
  const leadtimeDaysRef   = useRef<HTMLInputElement>(null);
  const leadtimeHoursRef  = useRef<HTMLInputElement>(null);
  const dueDateRef        = useRef<HTMLInputElement>(null);
  const remarkRef         = useRef<HTMLTextAreaElement>(null);
  const planTypeRef       = useRef<HTMLSelectElement>(null);
  const urgentRef         = useRef<HTMLButtonElement>(null);
  const submitRef         = useRef<HTMLButtonElement>(null);

  function getNavOrder(): (HTMLElement | null)[] {
    const order: (HTMLElement | null)[] = [];
    for (let i = 0; i < form.pairs.length; i++) {
      order.push(uncRefs.current[i]);
      order.push(qtyRefs.current[i]);
    }
    order.push(sizeTonRef.current, dueDateRef.current, leadtimeDaysRef.current, leadtimeHoursRef.current,
      remarkRef.current, planTypeRef.current, urgentRef.current, submitRef.current);
    return order;
  }

  function focusNext(currentEl: HTMLElement) {
    const order = getNavOrder();
    const idx = order.findIndex(el => el === currentEl);
    if (idx !== -1 && idx < order.length - 1) order[idx + 1]?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLElement>) {
    if (e.key === 'Enter') { e.preventDefault(); focusNext(e.currentTarget as HTMLElement); }
  }

  function handleSelectKeyDown(e: React.KeyboardEvent<HTMLSelectElement>) {
    if (e.key === 'Enter') { e.preventDefault(); focusNext(e.currentTarget); }
  }

  const lastPair = form.pairs[form.pairs.length - 1];
  const canAddPair = form.pairs.length < MAX_PAIRS && isPairComplete(lastPair);

  function updatePair(index: number, field: keyof UncQtyPair, value: string) {
    setForm(prev => ({ ...prev, pairs: prev.pairs.map((p, i) => i === index ? { ...p, [field]: value } : p) }));
    setErrors(prev => ({ ...prev, pairs: prev.pairs.map((p, i) => i === index ? { ...p, [field]: false } : p) }));
  }

  function addPair() {
    if (!canAddPair) return;
    setForm(prev => ({ ...prev, pairs: [...prev.pairs, { unc_code: '', qty: '' }] }));
    setErrors(prev => ({ ...prev, pairs: [...prev.pairs, { unc_code: false, qty: false }] }));
  }

  function removePair(index: number) {
    if (form.pairs.length === 1) return;
    setForm(prev => ({ ...prev, pairs: prev.pairs.filter((_, i) => i !== index) }));
    setErrors(prev => ({ ...prev, pairs: prev.pairs.filter((_, i) => i !== index) }));
  }

  function applyUncPart(part: UncPart) {
    const newPairs: UncQtyPair[] = [{ unc_code: part.unc_code, qty: form.pairs[0]?.qty ?? '' }];
    if (part.unc_code_2) newPairs.push({ unc_code: part.unc_code_2, qty: '' });
    if (part.unc_code_3) newPairs.push({ unc_code: part.unc_code_3, qty: '' });
    if (part.unc_code_4) newPairs.push({ unc_code: part.unc_code_4, qty: '' });
    setForm(prev => ({
      ...prev,
      pairs: newPairs,
      sizeTon: part.size_ton != null ? String(part.size_ton) : prev.sizeTon,
      planType: (part.plan_type as PlanType) || prev.planType,
    }));
    setErrors(blankErrors(newPairs.length));
    setShowPartDrop(false);
    setPartSuggestions([]);
    setTimeout(() => qtyRefs.current[0]?.focus(), 30);
  }

  async function upsertUncPart() {
    const unc1 = form.pairs[0]?.unc_code.trim();
    if (!unc1) return;
    const unc2 = form.pairs[1]?.unc_code.trim() || null;
    const unc3 = form.pairs[2]?.unc_code.trim() || null;
    const unc4 = form.pairs[3]?.unc_code.trim() || null;
    const newCodeCount = [unc1, unc2, unc3, unc4].filter(Boolean).length;
    const existing = uncParts.find(p => p.unc_code === unc1);

    if (existing) {
      const existingCount = [existing.unc_code, existing.unc_code_2, existing.unc_code_3, existing.unc_code_4].filter(Boolean).length;
      const shouldUpdateCodes = newCodeCount >= existingCount;
      await supabase.from('unc_parts').update({
        ...(shouldUpdateCodes ? { unc_code_2: unc2, unc_code_3: unc3, unc_code_4: unc4 } : {}),
        size_ton: form.sizeTon ? Number(form.sizeTon) : null,
        plan_type: form.planType,
        updated_at: new Date().toISOString(),
      }).eq('unc_code', unc1);
    } else {
      await supabase.from('unc_parts').insert({
        unc_code: unc1, unc_code_2: unc2, unc_code_3: unc3, unc_code_4: unc4,
        size_ton: form.sizeTon ? Number(form.sizeTon) : null,
        plan_type: form.planType,
      });
    }
    // Refresh local part cache
    const { data } = await supabase.from('unc_parts').select('*').order('unc_code');
    if (data) setUncParts(data as UncPart[]);
  }

  function validate(): boolean {
    const pairErrors = form.pairs.map(p => ({ unc_code: p.unc_code.trim() === '', qty: p.qty.trim() === '' }));
    const ltBothEmpty = form.leadtimeDays.trim() === '' && form.leadtimeHours.trim() === '';
    const newErrors: FieldErrors = {
      pairs: pairErrors,
      sizeTon: form.sizeTon === '',
      leadtimeDays: ltBothEmpty,
      leadtimeHours: ltBothEmpty,
      dueDate: !displayToISO(form.dueDate),
      planIssueDate: form.planIssueDate.trim() !== '' && !displayToISO(form.planIssueDate),
    };
    setErrors(newErrors);
    return !pairErrors.some(p => p.unc_code || p.qty) && !newErrors.sizeTon &&
      !newErrors.leadtimeDays && !newErrors.dueDate;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    if (!validate()) { setSubmitError('กรุณากรอกข้อมูลให้ครบถ้วน'); return; }
    setSaving(true);
    try {
      const planIssueDate = form.planIssueDate.trim() ? displayToISO(form.planIssueDate) : null;
      const payload: Record<string, unknown> = {
        size_ton: Number(form.sizeTon),
        leadtime: form.leadtimeDays.trim() ? Number(form.leadtimeDays) : null,
        leadtime_hours: form.leadtimeHours.trim() ? Number(form.leadtimeHours) : null,
        due_date: displayToISO(form.dueDate),
        plan_issue_date: planIssueDate,
        remark: form.remark.trim() || null,
        plan_type: form.planType,
        urgent: form.urgent,
        unc_code_1: null, qty_1: null,
        unc_code_2: null, qty_2: null,
        unc_code_3: null, qty_3: null,
        unc_code_4: null, qty_4: null,
      };
      form.pairs.forEach((pair, i) => {
        const n = i + 1;
        payload[`unc_code_${n}`] = pair.unc_code.trim() || null;
        payload[`qty_${n}`] = pair.qty.trim() ? Number(pair.qty) : null;
      });

      if (isEdit && internalEditOrder) {
        const isAssigned = !!internalEditOrder.machine_id;

        // Only mark urgent/updated and notify when the card is already placed on the board
        if (isAssigned) {
          payload.urgent = true;
          payload.is_updated = true;
        }

        // Build human-readable diff message
        const changes: string[] = [];
        const oldUnc = [internalEditOrder.unc_code_1, internalEditOrder.unc_code_2, internalEditOrder.unc_code_3, internalEditOrder.unc_code_4].filter(Boolean).join(', ');
        const newUnc = [payload.unc_code_1, payload.unc_code_2, payload.unc_code_3, payload.unc_code_4].filter(Boolean).join(', ');
        if (oldUnc !== newUnc) changes.push(`UNC Code: ${oldUnc || '—'} → ${newUnc || '—'}`);

        const oldQty = [internalEditOrder.qty_1, internalEditOrder.qty_2, internalEditOrder.qty_3, internalEditOrder.qty_4].filter(v => v != null).join(', ');
        const newQty = [payload.qty_1, payload.qty_2, payload.qty_3, payload.qty_4].filter(v => v != null).join(', ');
        if (oldQty !== newQty) changes.push(`Qty: ${oldQty || '—'} → ${newQty || '—'}`);

        if (internalEditOrder.size_ton !== Number(form.sizeTon)) changes.push(`Size Ton: ${internalEditOrder.size_ton ?? '—'} → ${form.sizeTon}`);
        if (internalEditOrder.leadtime !== Number(form.leadtimeDays)) changes.push(`Leadtime: ${internalEditOrder.leadtime ?? '—'}D → ${form.leadtimeDays}D`);
        if (internalEditOrder.leadtime_hours !== Number(form.leadtimeHours)) changes.push(`Leadtime Hours: ${internalEditOrder.leadtime_hours ?? '—'}H → ${form.leadtimeHours}H`);
        if (internalEditOrder.due_date !== displayToISO(form.dueDate)) changes.push(`Due Date: ${internalEditOrder.due_date ?? '—'} → ${displayToISO(form.dueDate) ?? '—'}`);
        if (internalEditOrder.plan_issue_date !== planIssueDate) changes.push(`Plan Issue Date: ${internalEditOrder.plan_issue_date ?? '—'} → ${planIssueDate ?? '—'}`);
        if (internalEditOrder.plan_type !== form.planType) changes.push(`Plan Type: ${internalEditOrder.plan_type} → ${form.planType}`);
        if ((internalEditOrder.remark ?? '') !== form.remark.trim()) changes.push(`Remark: "${internalEditOrder.remark ?? ''}" → "${form.remark.trim()}"`);

        const diffMsg = changes.length > 0 ? changes.join(' | ') : 'minor edit';
        const uncDisplay = [internalEditOrder.unc_code_1, internalEditOrder.unc_code_2, internalEditOrder.unc_code_3, internalEditOrder.unc_code_4].filter(Boolean).join(', ') || internalEditOrder.order_id;

        const { error: dbError } = await supabase.from('production_orders').update(payload).eq('id', internalEditOrder.id);
        if (dbError) throw dbError;

        // Write history entries for each changed field
        const historyRows: object[] = [];
        const unc_codes_display = [internalEditOrder.unc_code_1, internalEditOrder.unc_code_2, internalEditOrder.unc_code_3, internalEditOrder.unc_code_4].filter(Boolean).join(', ') || internalEditOrder.order_id;
        const baseHistory = { order_id: internalEditOrder.id, order_ref: internalEditOrder.order_id, unc_codes: unc_codes_display, event_type: 'updated', changed_by: user?.username ?? '' };
        if (oldUnc !== newUnc) historyRows.push({ ...baseHistory, field_name: 'UNC Code', old_value: oldUnc || null, new_value: newUnc || null });
        if (oldQty !== newQty) historyRows.push({ ...baseHistory, field_name: 'Qty', old_value: oldQty || null, new_value: newQty || null });
        if (internalEditOrder.size_ton !== Number(form.sizeTon)) historyRows.push({ ...baseHistory, field_name: 'Size Ton', old_value: String(internalEditOrder.size_ton ?? ''), new_value: form.sizeTon });
        if (internalEditOrder.leadtime !== Number(form.leadtimeDays)) historyRows.push({ ...baseHistory, field_name: 'Leadtime (D)', old_value: String(internalEditOrder.leadtime ?? ''), new_value: form.leadtimeDays });
        if (internalEditOrder.leadtime_hours !== Number(form.leadtimeHours)) historyRows.push({ ...baseHistory, field_name: 'Leadtime (H)', old_value: String(internalEditOrder.leadtime_hours ?? ''), new_value: form.leadtimeHours });
        if (internalEditOrder.due_date !== displayToISO(form.dueDate)) historyRows.push({ ...baseHistory, field_name: 'Due Date', old_value: internalEditOrder.due_date ?? null, new_value: displayToISO(form.dueDate) });
        if (internalEditOrder.plan_issue_date !== planIssueDate) historyRows.push({ ...baseHistory, field_name: 'Plan Issue Date', old_value: internalEditOrder.plan_issue_date ?? null, new_value: planIssueDate });
        if (internalEditOrder.plan_type !== form.planType) historyRows.push({ ...baseHistory, field_name: 'Plan Type', old_value: internalEditOrder.plan_type, new_value: form.planType });
        if ((internalEditOrder.remark ?? '') !== form.remark.trim()) historyRows.push({ ...baseHistory, field_name: 'Remark', old_value: internalEditOrder.remark ?? null, new_value: form.remark.trim() || null });
        if (historyRows.length > 0) await supabase.from('plan_history').insert(historyRows);

        const orderOwner = internalEditOrder.created_by;
        const editorUsername = user?.username ?? '';
        const editorDisplay = user?.displayName ?? editorUsername;
        const editorRole = user?.role ?? '';
        const isElevatedEditor = editorRole === 'admin' || editorRole === 'machine_planner';
        const isPlannerEditor = editorRole === 'planner';

        const notifBase = {
          order_ref: uncDisplay,
          order_id: internalEditOrder.id,
          message: `Edited by ${editorDisplay} (${editorRole}): ${diffMsg}`,
          edited_by: editorUsername,
        };

        const inserts: object[] = [];

        if (isElevatedEditor && orderOwner && orderOwner !== editorUsername) {
          inserts.push({ ...notifBase, for_username: orderOwner });
        }

        if (isPlannerEditor && isAssigned) {
          const { data: mpUsers } = await supabase
            .from('app_users')
            .select('username')
            .eq('role', 'machine_planner');
          if (mpUsers) {
            for (const mp of mpUsers) {
              if (mp.username !== editorUsername) {
                inserts.push({ ...notifBase, for_username: mp.username });
              }
            }
          }
        }

        if (inserts.length > 0) {
          await supabase.from('notifications').insert(inserts);
        }

        // If editing from Recent Plans (not the original editOrder prop), go back to create mode
        if (!editOrder) {
          setInternalEditOrder(undefined);
          setForm(blankForm());
          setErrors(blankErrors(1));
          await fetchRecent();
          await upsertUncPart();
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 2500);
        } else {
          await upsertUncPart();
          onSaved();
        }
      } else {
        // New order — record who created it
        payload.created_by = user?.username ?? null;
        const { data: newOrder, error: dbError } = await supabase.from('production_orders').insert(payload).select().single();
        if (dbError) throw dbError;
        // Write creation history
        if (newOrder) {
          const unc_codes_display = [payload.unc_code_1, payload.unc_code_2, payload.unc_code_3, payload.unc_code_4].filter(Boolean).join(', ') || (newOrder as { order_id: string }).order_id;
          await supabase.from('plan_history').insert({
            order_id: (newOrder as { id: string }).id,
            order_ref: (newOrder as { order_id: string }).order_id,
            unc_codes: unc_codes_display,
            event_type: 'created',
            field_name: null, old_value: null, new_value: null,
            changed_by: user?.username ?? '',
          });
        }
        onCreated?.();
        setForm(blankForm());
        setErrors(blankErrors(1));
        setJustSaved(true);
        setTimeout(() => setJustSaved(false), 2500);
        setTimeout(() => uncRefs.current[0]?.focus(), 50);
        await fetchRecent();
        await upsertUncPart();
      }
    } catch (err: unknown) {
      setSubmitError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด กรุณาลองใหม่');
    } finally {
      setSaving(false);
    }
  }

  const inputBase = 'w-full px-3 py-2.5 border rounded-xl text-sm transition-all bg-white dark:bg-[#0A1628] dark:text-gray-100 dark:border-blue-900/50 placeholder:text-gray-300 dark:placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-brand-orange focus:border-transparent dark:focus:ring-brand-orange/60';
  const inputError = 'border-red-400 bg-red-50 dark:bg-red-900/20 dark:border-red-500/60';
  const inputNormal = 'border-gray-200 hover:border-gray-300 dark:hover:border-blue-700';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="w-full max-w-2xl bg-white dark:bg-[#0C1830] rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="bg-brand-black px-6 py-4 flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="text-white text-lg font-bold tracking-wide">
              {isEdit ? `Edit Order — ${internalEditOrder!.order_id}` : 'New Production Order'}
            </h2>
            <p className="text-gray-400 text-xs mt-0.5">กรอกข้อมูลการผลิต — Enter เพื่อไปช่องถัดไป</p>
          </div>
          <button type="button" onClick={onCancel}
            className="text-gray-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/10">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 bg-white dark:bg-[#0C1830]">
          <div className="p-6 space-y-5">

            {/* Success flash */}
            {justSaved && (
              <div className="bg-green-50 dark:bg-green-900/20 border border-green-300 dark:border-green-700/50 rounded-xl px-4 py-3 text-green-700 dark:text-green-300 text-sm flex items-center gap-2 font-semibold">
                <CheckCircle size={15} />
                บันทึกข้อมูลสำเร็จ! กรอกรายการถัดไปได้เลย
              </div>
            )}

            {/* UNC CODE / QTY Pairs */}
            <div className="space-y-2">
              <label className="block text-xs font-bold text-brand-black dark:text-gray-300 uppercase tracking-widest">UNC CODE &amp; QTY</label>
              {form.pairs.map((pair, index) => (
                <div key={index} className="flex gap-2 items-start">
                  <div className="flex items-center justify-center w-6 mt-2.5 text-xs font-bold text-gray-400 select-none">{index + 1}</div>
                  <div className="flex-1 relative">
                    <input ref={el => { uncRefs.current[index] = el; }} type="text" placeholder="UNC CODE *"
                      value={pair.unc_code}
                      onChange={e => {
                        const val = e.target.value.toUpperCase();
                        updatePair(index, 'unc_code', val);
                        if (index === 0) {
                          const q = val.trim();
                          const matches = q.length >= 1
                            ? uncParts
                                .filter(p => p.unc_code.toUpperCase().startsWith(q))
                                .sort((a, b) => a.unc_code.localeCompare(b.unc_code))
                            : [];
                          setPartSuggestions(matches);
                          setShowPartDrop(matches.length > 0);
                        }
                      }}
                      onFocus={() => {
                        if (index === 0 && pair.unc_code.length >= 1) {
                          const matches = uncParts
                            .filter(p => p.unc_code.toUpperCase().startsWith(pair.unc_code.toUpperCase()))
                            .sort((a, b) => a.unc_code.localeCompare(b.unc_code));
                          setPartSuggestions(matches);
                          setShowPartDrop(matches.length > 0);
                        }
                      }}
                      onBlur={() => setTimeout(() => setShowPartDrop(false), 150)}
                      onKeyDown={e => {
                        if (e.key === 'Escape') { setShowPartDrop(false); return; }
                        handleKeyDown(e);
                      }}
                      className={`${inputBase} font-mono uppercase ${errors.pairs[index]?.unc_code ? inputError : inputNormal}`}
                    />
                    {/* Autocomplete dropdown — only for UNC Code 1 */}
                    {index === 0 && showPartDrop && partSuggestions.length > 0 && (
                      <div ref={partDropRef}
                        className="absolute left-0 top-full mt-1 z-50 w-full bg-white dark:bg-[#0C1830] border border-gray-200 dark:border-blue-900/50 rounded-xl shadow-2xl overflow-y-auto"
                        style={{ minWidth: 300, maxHeight: 260 }}>
                        {partSuggestions.map(part => (
                          <button key={part.id} type="button"
                            onMouseDown={() => applyUncPart(part)}
                            className="w-full text-left px-3 py-2.5 hover:bg-orange-50/60 dark:hover:bg-orange-900/15 transition-colors border-b border-gray-50 dark:border-blue-900/30 last:border-0 flex items-center gap-3">
                            <span className="font-mono font-black text-[13px] text-brand-orange flex-shrink-0">{part.unc_code}</span>
                            {(part.unc_code_2 || part.unc_code_3 || part.unc_code_4) && (
                              <span className="font-mono text-[10px] text-gray-400 dark:text-gray-500 truncate">
                                {[part.unc_code_2, part.unc_code_3, part.unc_code_4].filter(Boolean).join(', ')}
                              </span>
                            )}
                            <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                              {part.size_ton != null && (
                                <span className="text-[10px] font-bold text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-blue-900/30 px-1.5 py-0.5 rounded">{part.size_ton}T</span>
                              )}
                              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${part.plan_type === 'Yellow' ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-yellow-300' : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}`}>{part.plan_type}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="w-28">
                    <input ref={el => { qtyRefs.current[index] = el; }} type="text" inputMode="numeric" placeholder="QTY *"
                      value={pair.qty !== '' ? Number(pair.qty).toLocaleString('en-US') : ''}
                      onChange={e => {
                        const digits = e.target.value.replace(/[^0-9]/g, '');
                        updatePair(index, 'qty', digits);
                      }}
                      onKeyDown={handleKeyDown}
                      className={`${inputBase} ${errors.pairs[index]?.qty ? inputError : inputNormal}`} />
                  </div>
                  {index > 0 && (
                    <button type="button" onClick={() => removePair(index)}
                      className="mt-1 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0">
                      <X size={15} />
                    </button>
                  )}
                </div>
              ))}
              {canAddPair && (
                <button type="button" onClick={addPair}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-brand-orange border border-dashed border-brand-orange/40 rounded-xl hover:bg-brand-orange-muted hover:border-brand-orange transition-all w-full justify-center font-medium">
                  <Plus size={15} />เพิ่ม UNC CODE &amp; QTY ({form.pairs.length}/{MAX_PAIRS})
                </button>
              )}
            </div>

            {/* Size Ton + Due Date + Leadtime Days + Leadtime Hrs — all in one row */}
            <div>
              <div className="grid grid-cols-4 gap-2 items-start">
                {/* Size Ton */}
                <div>
                  <label className="block text-xs font-bold text-brand-black dark:text-gray-300 uppercase tracking-widest mb-1.5">
                    Size Ton <span className="text-red-400">*</span>
                  </label>
                  <div className="relative">
                    <select ref={sizeTonRef} value={form.sizeTon}
                      onChange={e => { setForm(p => ({ ...p, sizeTon: e.target.value })); setErrors(p => ({ ...p, sizeTon: false })); }}
                      onKeyDown={handleSelectKeyDown}
                      className={`${inputBase} appearance-none pr-7 cursor-pointer ${errors.sizeTon ? inputError : inputNormal}`}>
                      <option value="">— T</option>
                      {SIZE_TON_OPTIONS.map(v => <option key={v} value={v}>{v}T</option>)}
                    </select>
                    <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                  </div>
                  {errors.sizeTon && <p className="text-red-500 text-xs mt-1">กรุณาเลือก</p>}
                </div>

                {/* Due Date */}
                <div>
                  <label className="block text-xs font-bold text-brand-black dark:text-gray-300 uppercase tracking-widest mb-1.5">
                    Due Date <span className="text-red-400">*</span>
                  </label>
                  <input
                    ref={dueDateRef}
                    type="text"
                    inputMode="numeric"
                    placeholder="d/m/yy"
                    maxLength={10}
                    value={form.dueDate}
                    onChange={e => {
                      setForm(p => ({ ...p, dueDate: e.target.value }));
                      setErrors(p => ({ ...p, dueDate: false }));
                    }}
                    onBlur={e => {
                      const normalized = normalizeDateOnBlur(e.target.value);
                      if (normalized !== e.target.value) {
                        setForm(p => ({ ...p, dueDate: normalized }));
                      }
                    }}
                    onKeyDown={handleKeyDown}
                    className={`${inputBase} ${errors.dueDate ? inputError : inputNormal} text-brand-black`}
                  />
                  {errors.dueDate && <p className="text-red-500 text-xs mt-1">d/m/yy</p>}
                </div>

                {/* Leadtime Days */}
                <div>
                  <label className="block text-xs font-bold text-brand-black dark:text-gray-300 uppercase tracking-widest mb-1.5">
                    LT Day
                  </label>
                  <div className="relative">
                    <input ref={leadtimeDaysRef} type="text" inputMode="numeric" placeholder="—"
                      value={form.leadtimeDays}
                      onChange={e => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 2);
                        setForm(p => ({ ...p, leadtimeDays: v }));
                        setErrors(p => ({ ...p, leadtimeDays: false, leadtimeHours: false }));
                      }}
                      onKeyDown={handleKeyDown}
                      className={`${inputBase} pr-10 ${errors.leadtimeDays ? inputError : inputNormal}`} />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium pointer-events-none">วัน</span>
                  </div>
                  {errors.leadtimeDays && <p className="text-red-500 text-xs mt-1">ใส่อย่างน้อย 1</p>}
                </div>

                {/* Leadtime Hours */}
                <div>
                  <label className="block text-xs font-bold text-brand-black dark:text-gray-300 uppercase tracking-widest mb-1.5">
                    LT Hrs
                  </label>
                  <div className="relative">
                    <input ref={leadtimeHoursRef} type="text" inputMode="numeric" placeholder="—"
                      value={form.leadtimeHours}
                      onChange={e => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 2);
                        setForm(p => ({ ...p, leadtimeHours: v }));
                        setErrors(p => ({ ...p, leadtimeDays: false, leadtimeHours: false }));
                      }}
                      onKeyDown={handleKeyDown}
                      className={`${inputBase} pr-8 ${errors.leadtimeHours ? inputError : inputNormal}`} />
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400 font-medium pointer-events-none">ชม.</span>
                  </div>
                  {errors.leadtimeHours && !errors.leadtimeDays && <p className="text-red-500 text-xs mt-1">ใส่อย่างน้อย 1</p>}
                </div>
              </div>
            </div>

            {/* Plan Issue Date */}
            <div>
              <label className="block text-xs font-bold text-brand-black dark:text-gray-300 uppercase tracking-widest mb-1.5">
                Plan Issue Date <span className="text-gray-400 dark:text-gray-500 font-normal normal-case">(ไม่บังคับ)</span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                placeholder="d/m/yy"
                maxLength={10}
                value={form.planIssueDate}
                onChange={e => {
                  setForm(p => ({ ...p, planIssueDate: e.target.value }));
                  setErrors(p => ({ ...p, planIssueDate: false }));
                }}
                onBlur={e => {
                  const normalized = normalizeDateOnBlur(e.target.value);
                  if (normalized !== e.target.value) {
                    setForm(p => ({ ...p, planIssueDate: normalized }));
                  }
                }}
                onKeyDown={handleKeyDown}
                className={`${inputBase} ${errors.planIssueDate ? inputError : inputNormal} text-brand-black`}
              />
              {errors.planIssueDate && <p className="text-red-500 text-xs mt-1">กรุณากรอกวันที่เป็น d/m/yy</p>}
            </div>

            {/* Remark */}
            <div>
              <label className="block text-xs font-bold text-brand-black dark:text-gray-300 uppercase tracking-widest mb-1.5">
                Remark <span className="text-gray-400 dark:text-gray-500 font-normal normal-case">(ไม่บังคับ)</span>
              </label>
              <textarea ref={remarkRef} rows={2} placeholder="หมายเหตุ..." value={form.remark}
                onChange={e => setForm(p => ({ ...p, remark: e.target.value }))}
                onKeyDown={handleKeyDown}
                className={`${inputBase} resize-none ${inputNormal}`} />
            </div>

            {/* Plan Type + Urgent */}
            <div className="grid grid-cols-2 gap-4 items-end">
              <div>
                <label className="block text-xs font-bold text-brand-black dark:text-gray-300 uppercase tracking-widest mb-1.5">Plan Type</label>
                <div className="relative">
                  <select ref={planTypeRef} value={form.planType}
                    onChange={e => setForm(p => ({ ...p, planType: e.target.value as PlanType }))}
                    onKeyDown={handleSelectKeyDown}
                    className={`${inputBase} appearance-none pr-9 cursor-pointer ${inputNormal}`}>
                    <option value="White">White</option>
                    <option value="Yellow">Yellow</option>
                  </select>
                  <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-brand-black dark:text-gray-300 uppercase tracking-widest mb-1.5">Urgent</label>
                <button ref={urgentRef} type="button"
                  onClick={() => setForm(p => ({ ...p, urgent: !p.urgent }))}
                  onKeyDown={handleKeyDown}
                  className={`w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl border-2 text-sm font-semibold transition-all ${
                  form.urgent ? 'bg-red-600 border-red-700 text-white' : 'bg-white dark:bg-[#0A1628] border-gray-200 dark:border-blue-900/50 text-gray-500 dark:text-gray-400 hover:border-red-300 hover:text-red-500'
                  }`}>
                  <AlertTriangle size={15} />
                  {form.urgent ? 'URGENT' : 'ทั่วไป'}
                </button>
              </div>
            </div>

            {submitError && (
              <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700/50 rounded-xl px-4 py-3 text-red-700 dark:text-red-300 text-sm">{submitError}</div>
            )}
          </div>

          {/* Buttons */}
          <div className="px-6 pb-4 flex gap-3 bg-white dark:bg-[#0C1830]">
            <button type="button" onClick={onCancel}
              className="flex-1 px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-blue-900/50 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-all">
              Close
            </button>
            {isEdit && !editOrder && (
              <button type="button" onClick={() => { setInternalEditOrder(undefined); setForm(blankForm()); setErrors(blankErrors(1)); }}
                className="flex-1 px-4 py-2.5 text-sm font-semibold text-gray-600 dark:text-gray-300 border border-dashed border-gray-300 dark:border-blue-900/50 rounded-xl hover:bg-gray-50 dark:hover:bg-white/5 transition-all">
                ← สร้างใหม่
              </button>
            )}
            <button ref={submitRef} type="submit" disabled={saving}
              className="flex-[2] flex items-center justify-center gap-2 px-6 py-2.5 text-sm font-bold text-white bg-brand-orange hover:bg-brand-orange-dark disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all shadow-md shadow-brand-orange/30 active:scale-95">
              <Save size={16} />
              {saving ? 'Saving...' : isEdit ? 'Save Changes' : 'Save & Continue'}
            </button>
          </div>

          {/* Recent Plans — below save button, 3 visible, scroll to 10 */}
          {recentOrders.length > 0 && (
            <div className="px-6 pb-6">
              <div className="border border-gray-200 dark:border-blue-900/50 rounded-xl overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-[#091526] border-b border-gray-100 dark:border-blue-900/50">
                  <Clock size={12} className="text-[#F36B21]" />
                  <span className="text-xs font-bold text-gray-800 dark:text-gray-200">Recent Plans</span>
                  <span className="text-[9px] text-gray-400 dark:text-gray-500 ml-1">(เฉพาะของคุณ — คลิกเพื่อแก้ไข)</span>
                </div>
                <div className="overflow-y-auto" style={{ maxHeight: 180 }}>
                  {recentOrders.map(order => {
                    const uncCodes = [order.unc_code_1, order.unc_code_2, order.unc_code_3, order.unc_code_4].filter(Boolean).join(', ');
                    const isSelected = internalEditOrder?.id === order.id;
                    return (
                      <button
                        key={order.id}
                        type="button"
                        onClick={() => {
                          setInternalEditOrder(order);
                          setForm(orderToFormState(order));
                          setErrors(blankErrors(1));
                          setSubmitError(null);
                        }}
                        className={`text-left w-full px-3 py-2 border-b border-gray-50 dark:border-blue-900/30 last:border-0 transition-all flex items-center gap-3 ${isSelected ? 'bg-orange-50 dark:bg-orange-900/20' : 'bg-white dark:bg-[#0C1830] hover:bg-orange-50/40 dark:hover:bg-orange-900/10'}`}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-black text-[#F36B21] truncate">{uncCodes || order.order_id}</div>
                          <div className="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5">{order.size_ton}T · {order.leadtime}D{order.leadtime_hours ? `+${order.leadtime_hours}H` : ''} · Due: {order.due_date ?? '—'}</div>
                        </div>
                        <div className="text-[9px] text-gray-400 flex-shrink-0">{new Date(order.created_at).toLocaleDateString('en-GB')}</div>
                        {order.is_planned && <span className="text-[8px] font-bold bg-gray-200 dark:bg-blue-900/50 text-gray-600 dark:text-gray-300 px-1.5 py-0.5 rounded-full flex-shrink-0">Planned</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
