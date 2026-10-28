import { useState, useEffect, useCallback, useMemo, useRef, memo } from 'react';
import { createPortal } from 'react-dom';
import { RefreshCw, CalendarDays, Search, X, SlidersHorizontal, Pencil, ZoomIn, Plus, Trash2, Maximize2, Minimize2, User, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logOrderDelete } from '../lib/deleteLog';
import type { ProductionOrder, Machine } from '../types';
import PlanCard, { formatUncCodeForCard, totalQty, formatCardDate } from './PlanCard';
import UnassignedDock from './UnassignedDock';
import ProductionForm from './ProductionForm';
import { type UserRole, canMove, canEdit, canConfirm, useAuth } from '../contexts/AuthContext';

function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const SIZE_GROUPS = [
  { label: '5T-30T',   sizes: [5, 30] },
  { label: '50T',      sizes: [50] },
  { label: '100T',     sizes: [100] },
  { label: '150T',     sizes: [150] },
  { label: '250T-350T', sizes: [250, 300, 350, 450] },
] as const;

const COL_MACHINE_W = 64;
const COL_SIZE_W    = 46;
const COL_MC_W      = 42;

// Card: 1.0in × 0.5in → 96px × 48px
const CARD_W_PX      = 96;
const CARD_H_PX      = 48;
const COL_DATE_W     = 106;  // 1.1in ≈ 105.6px

// Leadtime arrow dimensions
const ARROW_H_PX       = 14;    // 0.15in ≈ 14.4px
// 24H = 1.1in = 105.6px → 1H = 4.4px
const ARROW_PX_PER_HOUR = (1.1 * 96) / 24;
// Subtract 1.15in = 110.4px from computed length
const ARROW_OFFSET_PX  = 1.15 * 96;
const ARROW_GAP_PX     = 5;    // 0.05in gap between card right and arrow start

// Row height: tall enough to centre card + clear arrow vertically
const ROW_H_PX = Math.max(CARD_H_PX, ARROW_H_PX) + 12;

// Days since fixed epoch (2020-01-01). Stored in x_offset column.
const EPOCH_MS = new Date('2020-01-01').getTime();
function daysFromEpoch(d: Date): number {
  return (d.getTime() - EPOCH_MS) / 86400000;
}

function toDateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function addDays(d: Date, n: number) { const r = new Date(d); r.setDate(r.getDate() + n); return r; }
function todayStart() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function isToday(d: Date) { return toDateKey(d) === toDateKey(new Date()); }
function isWeekend(d: Date) { return d.getDay() === 0 || d.getDay() === 6; }
function pad2(n: number) { return String(n).padStart(2, '0'); }
function fmtDateLabel(d: Date) { return `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}`; }

function getXOffset(order: ProductionOrder): number {
  if (order.x_offset != null) return order.x_offset;
  if (order.scheduled_date) return daysFromEpoch(new Date(order.scheduled_date + 'T00:00:00'));
  return daysFromEpoch(new Date());
}

function arrowColors(order: ProductionOrder, dark: boolean): { fill: string; stroke: string } {
  if (order.urgent && order.is_updated) return dark
    ? { fill: '#2D0C00', stroke: '#FB923C' }
    : { fill: '#FCA98B', stroke: '#9A3412' };
  if (order.urgent) return dark
    ? { fill: '#3B0000', stroke: '#FF2222' }
    : { fill: '#FCA5A5', stroke: '#991B1B' };
  if (order.is_planned) return dark
    ? { fill: '#052E16', stroke: '#4ADE80' }
    : { fill: '#4ADE80', stroke: '#15803D' };
  if (order.plan_type === 'Yellow') return dark
    ? { fill: '#1A1200', stroke: '#FBBF24' }
    : { fill: '#FDE68A', stroke: '#D97706' };
  return dark
    ? { fill: '#060F22', stroke: '#60A5FA' }
    : { fill: '#BFDBFE', stroke: '#2563EB' };
}

function computeArrowWidthPx(order: ProductionOrder): number {
  const totalHours = (order.leadtime ?? 0) * 24 + (order.leadtime_hours ?? 0);
  return totalHours * ARROW_PX_PER_HOUR - ARROW_OFFSET_PX;
}

// ── LeadtimeArrow ─────────────────────────────────────────────────────────────
interface ArrowProps {
  order: ProductionOrder;
  leftPx: number;
  topPx: number;
  ghost?: boolean;
  dark?: boolean;
  boardStartDays?: number;
  holidays?: Set<string>;
  colW?: number;
}

function LeadtimeArrow({ order, leftPx, topPx, ghost = false, dark = false, boardStartDays = 0, holidays, colW = COL_DATE_W }: ArrowProps) {
  const baseW = computeArrowWidthPx(order);
  if (baseW <= 0) return null;

  const { fill, stroke } = arrowColors(order, dark);
  const h       = ARROW_H_PX;
  const opacity = ghost ? 0.5 : 0.9;
  const zBase   = ghost ? 201 : 3;

  // Extend totalW past holidays: holidays don't consume leadtime — they push the end date
  // forward. Iterate until span stabilises (each holiday in span adds colW, which may expose
  // further holidays; converges in at most #holidays-in-span iterations).
  let totalW = baseW;
  if (holidays && holidays.size > 0) {
    for (let iter = 0; iter < 60; iter++) {
      let count = 0;
      holidays.forEach(dateStr => {
        const dayNum = daysFromEpoch(new Date(dateStr + 'T00:00:00'));
        const dayIdx = Math.round(dayNum - boardStartDays);
        const gs = dayIdx * colW - leftPx;
        const ge = gs + colW;
        if (ge > 0 && gs < totalW) count++;
      });
      const newW = baseW + count * colW;
      if (Math.abs(newW - totalW) < 0.001) break;
      totalW = newW;
    }
  }

  // Build holiday gaps within the extended span
  const gaps: Array<{ start: number; end: number }> = [];
  if (holidays && holidays.size > 0) {
    holidays.forEach(dateStr => {
      const dayNum   = daysFromEpoch(new Date(dateStr + 'T00:00:00'));
      const dayIdx   = Math.round(dayNum - boardStartDays);
      const colLeft  = dayIdx * colW;
      const colRight = (dayIdx + 1) * colW;
      const gs = colLeft  - leftPx;
      const ge = colRight - leftPx;
      if (ge > 0 && gs < totalW) {
        gaps.push({ start: Math.max(0, gs), end: Math.min(totalW, ge) });
      }
    });
    gaps.sort((a, b) => a.start - b.start);
  }

  // Merge overlapping/adjacent gaps
  const merged: Array<{ start: number; end: number }> = [];
  for (const g of gaps) {
    if (merged.length === 0 || g.start > merged[merged.length - 1].end) {
      merged.push({ ...g });
    } else {
      merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, g.end);
    }
  }

  // Build continuous segments between gaps
  const segments: Array<{ start: number; width: number; isLast: boolean }> = [];
  let pos = 0;
  for (const g of merged) {
    if (g.start > pos) segments.push({ start: pos, width: g.start - pos, isLast: false });
    pos = g.end;
  }
  if (pos < totalW) segments.push({ start: pos, width: totalW - pos, isLast: false });
  if (segments.length === 0) return null;
  segments[segments.length - 1].isLast = true;

  return (
    <>
      {segments.map((seg, i) => {
        const w = seg.width;
        if (w <= 0) return null;
        let pts: string;
        if (seg.isLast) {
          const tipW  = Math.min(h * 0.7, w * 0.28);
          const bodyW = w - tipW;
          pts = `0,0 ${bodyW},0 ${w},${h / 2} ${bodyW},${h} 0,${h}`;
        } else {
          pts = `0,0 ${w},0 ${w},${h} 0,${h}`;
        }
        return (
          <div key={i} style={{
            position: 'absolute', top: topPx, left: leftPx + seg.start,
            pointerEvents: 'none', opacity, zIndex: zBase,
          }}>
            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} overflow="visible">
              <polygon
                points={pts}
                fill={ghost ? 'none' : fill}
                stroke={stroke}
                strokeWidth={dark ? 1.5 : 1}
                strokeLinejoin="round"
                strokeDasharray={ghost ? '6 3' : undefined}
              />
            </svg>
          </div>
        );
      })}
    </>
  );
}

// ── FloatingCard — click to expand 1.5×, portal-rendered when expanded ────────
interface FloatingCardProps {
  order: ProductionOrder;
  leftPx: number;
  baseZIndex: number;
  rowHeight: number;
  isDragging: boolean;
  isHighlighted?: boolean;
  canMoveCards: boolean;
  canEditCard: boolean;
  canConfirmCards: boolean;
  canPlanCards: boolean;
  canDeleteCard: boolean;
  canFinishCard: boolean;
  canPrint: boolean;
  zoom: number;
  isDark: boolean;
  boardStartDays: number;
  holidays: Set<string>;
  colW: number;
  onDragStart: (e: React.DragEvent, order: ProductionOrder) => void;
  onDragEnd: () => void;
  onUnassign: (order: ProductionOrder) => void;
  onEdit: (order: ProductionOrder) => void;
  onConfirm: (order: ProductionOrder) => void;
  onPlan: (order: ProductionOrder) => void;
  onUnplan: (order: ProductionOrder) => void;
  onDelete: (order: ProductionOrder) => void;
  onFinish: (order: ProductionOrder) => void;
  onPrint: (order: ProductionOrder) => void;
}

const FloatingCard = memo(function FloatingCard({ order, leftPx, baseZIndex, rowHeight, isDragging, isHighlighted, canMoveCards, canEditCard, canConfirmCards, canPlanCards, canDeleteCard, canFinishCard, canPrint, zoom, isDark, boardStartDays, holidays, colW, onDragStart, onDragEnd, onUnassign, onEdit, onConfirm, onPlan, onUnplan, onDelete, onFinish, onPrint }: FloatingCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [showTip, setShowTip] = useState(false);
  const [cardRect, setCardRect] = useState<DOMRect | null>(null);
  const [animReady, setAnimReady] = useState(false);
  const origRef = useRef<HTMLDivElement>(null);
  const tipTimer = useRef<ReturnType<typeof setTimeout>>();
  const top = Math.floor((rowHeight - CARD_H_PX) / 2);
  const lt = `${order.leadtime ?? 0}D${order.leadtime_hours ? ` ${order.leadtime_hours}H` : ''}`;
  const ORANGE = '#F36523';

  useEffect(() => {
    if (isHighlighted) setExpanded(true);
  }, [isHighlighted]);

  // Tooltip timer
  useEffect(() => () => clearTimeout(tipTimer.current), []);

  // Trigger CSS transition after portal mounts (next tick)
  useEffect(() => {
    if (expanded) {
      const t = requestAnimationFrame(() => setAnimReady(true));
      return () => cancelAnimationFrame(t);
    } else {
      setAnimReady(false);
    }
  }, [expanded]);

  function handleToggleExpand(e: React.MouseEvent) {
    e.stopPropagation();
    if (!expanded && origRef.current) {
      setCardRect(origRef.current.getBoundingClientRect());
    }
    setExpanded(v => !v);
  }

  const arrowLeft = leftPx + CARD_W_PX + ARROW_GAP_PX;
  const arrowTop  = Math.floor((rowHeight - ARROW_H_PX) / 2);

  // Portal card position: align with original card accounting for board zoom.
  // getBoundingClientRect() returns zoomed viewport coords.
  // Card natural size: CARD_W_PX × CARD_H_PX. With zoom factor, visual size is smaller.
  // We position the portal card (natural size) so its bottom-center aligns with original bottom-center.
  const zoomFactor = zoom / 100;
  const portalCardTop  = cardRect ? cardRect.top  + CARD_H_PX * zoomFactor - CARD_H_PX : 0;
  const portalCardLeft = cardRect ? cardRect.left + CARD_W_PX * zoomFactor / 2 - CARD_W_PX / 2 : 0;
  // Scale: zoom to match original, then 1.5× expansion
  const expandScale = zoomFactor * 1.5;
  // Center X of scaled card in viewport (used for button centering)
  const scaledCenterX = cardRect ? cardRect.left + (CARD_W_PX * zoomFactor) / 2 : 0;
  // Top of scaled card = bottom-center minus height of scaled card
  const scaledTopY = cardRect ? cardRect.top + CARD_H_PX * zoomFactor - CARD_H_PX * expandScale : 0;

  const btnStyle = (bg: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: 3,
    padding: '3px 7px', borderRadius: 5,
    background: bg, color: '#fff',
    fontSize: 10, fontWeight: 700, border: 'none', cursor: 'pointer',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    whiteSpace: 'nowrap',
  });

  const portalContent = expanded && cardRect ? createPortal(
    <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', zIndex: 99999, pointerEvents: 'none' }}>
      {/* Backdrop */}
      <div style={{ position: 'absolute', inset: 0, pointerEvents: 'auto' }} onMouseDown={() => setExpanded(false)} />
      {/* Scaled card */}
      <div
        style={{
          position: 'absolute',
          top: portalCardTop,
          left: portalCardLeft,
          transformOrigin: 'bottom center',
          transform: animReady ? `scale(${expandScale})` : `scale(${zoomFactor})`,
          transition: 'transform 0.18s cubic-bezier(0.34,1.56,0.64,1), filter 0.15s ease',
          filter: animReady ? 'drop-shadow(0 6px 18px rgba(0,0,0,0.35))' : 'none',
          pointerEvents: 'auto',
          zIndex: 2,
        }}
        onMouseDown={e => e.stopPropagation()}
        onClick={() => setExpanded(false)}
      >
        <PlanCard order={order} isDragging={false} isDark={isDark} />
      </div>
      {/* Buttons centered above scaled card */}
      <div
        style={{
          position: 'absolute',
          top: scaledTopY - 30,
          left: scaledCenterX,
          transform: 'translateX(-50%)',
          display: 'flex', gap: 3, pointerEvents: 'auto', zIndex: 3,
          opacity: animReady ? 1 : 0,
          transition: 'opacity 0.12s ease',
        }}
        onMouseDown={e => e.stopPropagation()}
      >
        {canEditCard && (
          <button onMouseDown={e => { e.stopPropagation(); onEdit(order); setExpanded(false); }} style={btnStyle('#F36B21')}>
            <Pencil size={9} /> Edit
          </button>
        )}
        {canPlanCards && !order.urgent && (
          order.is_planned
            ? <button onMouseDown={e => { e.stopPropagation(); onUnplan(order); setExpanded(false); }} style={btnStyle('#6B7280')}>↩ UNPLAN</button>
            : <button onMouseDown={e => { e.stopPropagation(); onPlan(order); setExpanded(false); }} style={btnStyle('#0F766E')}>✓ PLAN</button>
        )}
        {order.urgent && canConfirmCards && (
          <button onMouseDown={e => { e.stopPropagation(); onConfirm(order); setExpanded(false); }} style={btnStyle('#16A34A')}>✓ Confirm</button>
        )}
        {canFinishCard && (
          <button onMouseDown={e => { e.stopPropagation(); onFinish(order); setExpanded(false); }} style={btnStyle('#1D4ED8')}>✓ FINISHED</button>
        )}
        {canPrint && !order.is_planned && (
          <button onMouseDown={e => { e.stopPropagation(); onPrint(order); setExpanded(false); }} style={btnStyle(order.is_printed ? '#6B7280' : '#7C3AED')}>
            {order.is_printed ? 'Cancel P' : 'Press P'}
          </button>
        )}
        {canDeleteCard && (
          <button onMouseDown={e => { e.stopPropagation(); onDelete(order); setExpanded(false); }} style={btnStyle('#DC2626')}>
            <Trash2 size={9} /> Del
          </button>
        )}
        <button onMouseDown={e => { e.stopPropagation(); setExpanded(false); }} style={btnStyle('#374151')}>×</button>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <>
      {!isDragging && (
        <LeadtimeArrow order={order} leftPx={arrowLeft} topPx={arrowTop} ghost={false} dark={isDark} boardStartDays={boardStartDays} holidays={holidays} colW={colW} />
      )}
      <div
        ref={origRef}
        style={{ position: 'absolute', top, left: leftPx, zIndex: baseZIndex }}
        onMouseEnter={() => { tipTimer.current = setTimeout(() => setShowTip(true), 500); }}
        onMouseLeave={() => { clearTimeout(tipTimer.current); setShowTip(false); }}
      >
        <div
          onClick={handleToggleExpand}
          style={{
            transformOrigin: 'bottom center',
            transform: 'scale(1)',
            cursor: 'pointer',
            position: 'relative',
          }}
        >
          <PlanCard
            order={order}
            onDragStart={!canMoveCards ? undefined : onDragStart}
            onDragEnd={onDragEnd}
            onUnassign={!canMoveCards ? undefined : onUnassign}
            isDragging={isDragging}
            isDark={isDark}
          />
          {showTip && !expanded && !isDragging && (
            <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 8, width: 192, zIndex: 200, pointerEvents: 'none', background: isDark ? '#0A1628' : '#fff', border: `1px solid ${isDark ? 'rgba(30,58,138,0.5)' : '#e5e7eb'}`, borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', color: isDark ? '#f1f5f9' : '#1f2937' }}>
              <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10 }}>
                <div style={{ fontWeight: 700, color: ORANGE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.order_id}</div>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatUncCodeForCard(order)}</div>
                <div style={{ display: 'flex', gap: 8, color: isDark ? '#94a3b8' : '#6b7280' }}>
                  <span>Qty: <b style={{ color: isDark ? '#e2e8f0' : '#1f2937' }}>{totalQty(order)}</b></span>
                  <span>LT: <b style={{ color: isDark ? '#e2e8f0' : '#1f2937' }}>{lt}</b></span>
                </div>
                {order.due_date && <div style={{ color: isDark ? '#94a3b8' : '#6b7280' }}>Due: <b>{formatCardDate(order.due_date)}</b></div>}
                {order.remark && <div style={{ fontStyle: 'italic', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.remark}</div>}
              </div>
              <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', borderWidth: 5, borderStyle: 'solid', borderColor: `${isDark ? '#0A1628' : '#fff'} transparent transparent transparent` }} />
            </div>
          )}
        </div>
      </div>
      {portalContent}
    </>
  );
}, (prev, next) =>
  prev.order === next.order &&
  prev.leftPx === next.leftPx &&
  prev.baseZIndex === next.baseZIndex &&
  prev.isDragging === next.isDragging &&
  prev.isHighlighted === next.isHighlighted &&
  prev.canMoveCards === next.canMoveCards &&
  prev.canEditCard === next.canEditCard &&
  prev.canConfirmCards === next.canConfirmCards &&
  prev.canPlanCards === next.canPlanCards &&
  prev.canDeleteCard === next.canDeleteCard &&
  prev.canFinishCard === next.canFinishCard &&
  prev.canPrint === next.canPrint &&
  prev.zoom === next.zoom &&
  prev.isDark === next.isDark &&
  prev.boardStartDays === next.boardStartDays &&
  prev.holidays === next.holidays &&
  prev.colW === next.colW
);

// ── ManageMachinesDialog ──────────────────────────────────────────────────────
interface ManageMachinesDialogProps {
  machines: Machine[];
  onClose: () => void;
  onChanged: (updated: Machine[]) => void;
}

function ManageMachinesDialog({ machines: initMachines, onClose, onChanged }: ManageMachinesDialogProps) {
  const [list, setList]           = useState<Machine[]>(initMachines);
  const [machineType, setMachineType] = useState('');
  const [sizeTon, setSizeTon]     = useState('');
  const [mcNo, setMcNo]           = useState('');
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [dragId, setDragId]       = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMachineType, setEditMachineType] = useState('');
  const [editSizeTon, setEditSizeTon] = useState('');
  const [editMcNo, setEditMcNo] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  async function handleDelete(machineId: string) {
    if (!confirm('ลบเครื่องจักรนี้?')) return;
    setDeletingId(machineId);
    await supabase.from('machines').delete().eq('id', machineId);
    const updated = list.filter(m => m.id !== machineId);
    setList(updated);
    onChanged(updated);
    setDeletingId(null);
  }

  function startEdit(m: Machine) {
    setEditingId(m.id);
    setEditMachineType(m.machine_type);
    setEditSizeTon(String(m.size_ton));
    setEditMcNo(m.mc_no);
  }

  async function handleSaveEdit(machineId: string) {
    if (!editMachineType.trim() || !editSizeTon || !editMcNo.trim()) return;
    setEditSaving(true);
    const { error: dbErr } = await supabase.from('machines').update({
      machine_type: editMachineType.trim(),
      size_ton: Number(editSizeTon),
      mc_no: editMcNo.trim(),
    }).eq('id', machineId);
    setEditSaving(false);
    if (dbErr) return;
    const updated = list.map(m => m.id === machineId
      ? { ...m, machine_type: editMachineType.trim(), size_ton: Number(editSizeTon), mc_no: editMcNo.trim() }
      : m);
    setList(updated);
    onChanged(updated);
    setEditingId(null);
  }

  async function handleAdd() {
    if (!machineType.trim() || !sizeTon || !mcNo.trim()) {
      setError('กรุณากรอกข้อมูลให้ครบทุกช่อง');
      return;
    }
    setSaving(true);
    setError('');
    const nextOrder = list.length > 0 ? Math.max(...list.map(m => m.display_order)) + 1 : 1;
    const { data, error: dbErr } = await supabase
      .from('machines')
      .insert({ machine_type: machineType.trim(), size_ton: Number(sizeTon), mc_no: mcNo.trim(), display_order: nextOrder })
      .select()
      .single();
    setSaving(false);
    if (dbErr || !data) { setError(dbErr?.message ?? 'Save failed'); return; }
    const updated = [...list, data as Machine];
    setList(updated);
    onChanged(updated);
    setMachineType(''); setSizeTon(''); setMcNo('');
  }

  async function handleRowDrop(targetId: string) {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    const fromIdx = list.findIndex(m => m.id === dragId);
    const toIdx   = list.findIndex(m => m.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    const reordered = [...list];
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);
    const withNewOrder = reordered.map((m, i) => ({ ...m, display_order: i + 1 }));
    setList(withNewOrder);
    setDragId(null); setDragOverId(null);
    onChanged(withNewOrder);
    await Promise.all(
      withNewOrder.map(m => supabase.from('machines').update({ display_order: m.display_order }).eq('id', m.id))
    );
  }

  const inputCls = 'w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-brand-orange bg-white';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="bg-[#0A0B0D] px-5 py-4 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={14} className="text-brand-orange" />
            <span className="text-white font-bold text-sm">Manage M/C</span>
            <span className="bg-brand-orange text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">{list.length}</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors"><X size={16} /></button>
        </div>

        {/* Machine list */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4">
          {list.length === 0 ? (
            <div className="text-center text-gray-400 text-xs py-8">ยังไม่มีเครื่องจักร</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {list.map((m) => (
                <div
                  key={m.id}
                  draggable={editingId !== m.id}
                  onDragStart={() => editingId !== m.id && setDragId(m.id)}
                  onDragOver={(e) => { e.preventDefault(); setDragOverId(m.id); }}
                  onDragLeave={() => setDragOverId(null)}
                  onDrop={() => handleRowDrop(m.id)}
                  onDragEnd={() => { setDragId(null); setDragOverId(null); }}
                  style={{
                    opacity: dragId === m.id ? 0.35 : 1,
                    outline: dragOverId === m.id && dragId !== m.id ? '2px solid #F36B21' : undefined,
                    outlineOffset: '1px',
                    transition: 'opacity 0.12s',
                  }}
                  className="flex flex-col gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2.5 group hover:bg-orange-50/50 hover:border-orange-200 transition-colors"
                >
                  {editingId === m.id ? (
                    /* ── Inline edit form ── */
                    <div>
                      <div className="grid grid-cols-3 gap-2 mb-2">
                        <div>
                          <label className="block text-[9px] font-semibold text-gray-500 mb-1">Machine Type</label>
                          <input value={editMachineType} onChange={e => setEditMachineType(e.target.value)}
                            className={inputCls} autoFocus />
                        </div>
                        <div>
                          <label className="block text-[9px] font-semibold text-gray-500 mb-1">Size Ton</label>
                          <input type="number" value={editSizeTon} onChange={e => setEditSizeTon(e.target.value)}
                            className={inputCls} />
                        </div>
                        <div>
                          <label className="block text-[9px] font-semibold text-gray-500 mb-1">M/C No.</label>
                          <input value={editMcNo} onChange={e => setEditMcNo(e.target.value)}
                            className={inputCls} />
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => handleSaveEdit(m.id)} disabled={editSaving}
                          className="flex-1 py-1.5 bg-[#F36B21] hover:bg-[#D4591A] text-white text-xs font-bold rounded-lg transition-all disabled:opacity-50">
                          {editSaving ? 'กำลังบันทึก...' : 'บันทึก'}
                        </button>
                        <button onClick={() => setEditingId(null)}
                          className="px-3 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 text-xs font-semibold rounded-lg transition-all">
                          ยกเลิก
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* ── Normal display row ── */
                    <div className="flex items-center gap-3 cursor-grab active:cursor-grabbing">
                      <span className="text-gray-300 group-hover:text-gray-400 transition-colors flex-shrink-0 select-none" style={{ fontSize: 14, lineHeight: 1 }}>⠿</span>
                      <div className="flex-1 grid grid-cols-3 gap-3 text-xs">
                        <div>
                          <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">Machine Type</div>
                          <div className="font-semibold text-gray-800 truncate">{m.machine_type}</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">Size Ton</div>
                          <div className="font-bold text-gray-800">{m.size_ton}T</div>
                        </div>
                        <div>
                          <div className="text-[9px] font-bold text-gray-400 uppercase tracking-wide mb-0.5">M/C No.</div>
                          <div className="font-semibold text-gray-800">{m.mc_no}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={e => { e.stopPropagation(); startEdit(m); }}
                          className="p-1.5 text-gray-300 hover:text-blue-500 hover:bg-blue-50 rounded-lg transition-all"
                          title="แก้ไข"
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          onClick={e => { e.stopPropagation(); handleDelete(m.id); }}
                          disabled={deletingId === m.id}
                          className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all disabled:opacity-30"
                          title="ลบเครื่องจักร"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-gray-100 flex-shrink-0" />

        {/* Add form */}
        <div className="flex-shrink-0 p-4">
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
            <Plus size={10} className="text-brand-orange" /> เพิ่มเครื่องจักรใหม่
          </div>
          {error && <div className="text-xs text-red-500 bg-red-50 px-3 py-2 rounded-lg mb-2">{error}</div>}
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div>
              <label className="block text-[9px] font-semibold text-gray-500 mb-1">Machine Type</label>
              <input value={machineType} onChange={e => setMachineType(e.target.value)}
                placeholder="e.g. Injection"
                className={inputCls} />
            </div>
            <div>
              <label className="block text-[9px] font-semibold text-gray-500 mb-1">Size Ton</label>
              <input type="number" value={sizeTon} onChange={e => setSizeTon(e.target.value)}
                placeholder="e.g. 350"
                className={inputCls} />
            </div>
            <div>
              <label className="block text-[9px] font-semibold text-gray-500 mb-1">M/C No.</label>
              <input value={mcNo} onChange={e => setMcNo(e.target.value)}
                placeholder="e.g. MC-01"
                className={inputCls} />
            </div>
          </div>
          <button onClick={handleAdd} disabled={saving}
            className="w-full py-2 bg-[#F36B21] hover:bg-[#D4591A] text-white text-xs font-bold rounded-xl transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
            <Plus size={12} />
            {saving ? 'กำลังบันทึก...' : 'เพิ่มเครื่องจักร'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── PlanBoard ─────────────────────────────────────────────────────────────────
export default function PlanBoard({ role = 'viewer', highlightOrderId, initialSearch, sizeGroup: externalSizeGroup, onSizeGroupChange: externalOnSizeGroupChange, hideDock = false }: {
  role?: UserRole;
  highlightOrderId?: string | null;
  initialSearch?: string;
  sizeGroup?: string | null;
  onSizeGroupChange?: (v: string | null) => void;
  hideDock?: boolean;
}) {
  const { user }        = useAuth();
  const isDark          = useIsDark();
  const canMoveCards    = canMove(role);
  const canEditCards    = canEdit(role);
  const canConfirmCards = canConfirm(role);
  const canPlanCards    = canMove(role);
  const canFinishCards  = role === 'developer' || role === 'admin' || role === 'machine_planner';

  function canEditCard(order: ProductionOrder): boolean {
    if (!canEditCards) return false;
    if (role === 'planner') return order.created_by === user?.username;
    return true;
  }
  function canDeleteCard(order: ProductionOrder): boolean {
    if (role === 'developer' || role === 'admin' || role === 'machine_planner') return true;
    if (role === 'planner') return order.created_by === user?.username;
    return false;
  }
  const [machines, setMachines] = useState<Machine[]>([]);
  const [orders, setOrders]     = useState<ProductionOrder[]>([]);
  const [loading, setLoading]   = useState(true);
  const [startDate, setStartDate] = useState(() => addDays(todayStart(), -3));
  const [endDate, setEndDate]     = useState(() => addDays(todayStart(), 90));

  // Computed visible day count — capped at 120
  const visibleDays = useMemo(() => {
    const diff = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1;
    return Math.max(7, Math.min(diff, 120));
  }, [startDate, endDate]);

  const [searchText, setSearchText]       = useState(initialSearch ?? '');
  const [showSearchDropdown, setShowSearchDropdown] = useState(false);
  const [searchNavIdx, setSearchNavIdx]   = useState(0);
  const [myPlanMode, setMyPlanMode]       = useState(false);
  const [filterSizeGroup, setFilterSizeGroupInternal] = useState<string | null>(externalSizeGroup ?? null);

  function setFilterSizeGroup(v: string | null) {
    setFilterSizeGroupInternal(v);
    externalOnSizeGroupChange?.(v);
  }

  // Derive size set from group
  const filterSizeSet = useMemo(() => {
    if (!filterSizeGroup) return null;
    const g = SIZE_GROUPS.find(g => g.label === filterSizeGroup);
    return g ? new Set<number>(g.sizes) : null;
  }, [filterSizeGroup]);

  // Sync when external changes
  useEffect(() => {
    if (externalSizeGroup !== undefined) setFilterSizeGroupInternal(externalSizeGroup ?? null);
  }, [externalSizeGroup]);
  const [editingOrder, setEditingOrder]   = useState<ProductionOrder | null>(null);
  const [planDateOrder, setPlanDateOrder] = useState<ProductionOrder | null>(null);
  const [planSendDate, setPlanSendDate] = useState('');
  const [savingPlan, setSavingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [showAddMachine, setShowAddMachine] = useState(false);
  const [draggingId, setDraggingId]       = useState<string | null>(null);
  const [hoverRow, setHoverRow]           = useState<string | null>(null);
  const [ghostX, setGhostX]              = useState(0);
  const [shiftDrag, setShiftDrag]         = useState(false);
  const [dragOriginX, setDragOriginX]     = useState<number | null>(null);
  const [dragMachineId, setDragMachineId] = useState<string | null>(null);
  const [dragOffsetX, setDragOffsetX]     = useState(0);
  const [zoom, setZoom]                   = useState(100);
  const [customZoomMode, setCustomZoomMode] = useState(false);
  const [customZoomStr, setCustomZoomStr]   = useState('100');
  const [navIdx, setNavIdx] = useState<Record<string, number>>({ White: 0, Yellow: 0, urgent: 0, planned: 0 });
  const [highlightedCardId, setHighlightedCardId] = useState<string | null>(null);
  // Size-ton mismatch confirmation dialog
  const [sizeMismatch, setSizeMismatch] = useState<{
    order: ProductionOrder; machine: Machine; newXOffset: number; scheduledDate: string;
  } | null>(null);
  // Tracks (orderId:machineId) pairs the user has already approved for size mismatch
  const [approvedMismatches, setApprovedMismatches] = useState<Set<string>>(new Set());
  const [deleteConfirm, setDeleteConfirm] = useState<ProductionOrder | null>(null);
  const [dockHeight, setDockHeight] = useState(130);
  const [boardFullscreen, setBoardFullscreen] = useState(false);
  const [noResultToast, setNoResultToast] = useState(false);
  const [dockHighlightedId, setDockHighlightedId] = useState<string | null>(null);
  const scrollRef   = useRef<HTMLDivElement>(null);
  const dragRAFRef  = useRef<number | null>(null);

  // ── Holidays (working days) ───────────────────────────────────────────────
  const [holidaySet, setHolidaySet] = useState<Set<string>>(new Set());
  useEffect(() => {
    supabase.from('holidays').select('date').then(({ data }) => {
      if (data) setHolidaySet(new Set(data.map((h: { date: string }) => h.date)));
    });
  }, []);

  function isHoliday(d: Date): boolean { return holidaySet.has(toDateKey(d)); }

  function nextWorkingDay(d: Date, dir: 1 | -1): Date {
    let cur = addDays(d, dir);
    for (let i = 0; i < 60; i++) {
      if (!isWeekend(cur) && !isHoliday(cur)) return cur;
      cur = addDays(cur, dir);
    }
    return cur;
  }

  function toggleBoardFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setBoardFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setBoardFullscreen(false);
    }
  }
  useEffect(() => {
    function onFsChange() { setBoardFullscreen(!!document.fullscreenElement); }
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Navigate to a card from external "Go to" trigger (notification bell)
  useEffect(() => {
    if (!highlightOrderId) return;
    const target = orders.find(o => o.id === highlightOrderId);
    if (!target) return;

    if (target.machine_id) {
      // Card is on the board — scroll to it
      setHighlightedCardId(highlightOrderId);
      setTimeout(() => setHighlightedCardId(null), 3000);
      if (scrollRef.current) {
        const xOff = getXOffset(target);
        const cardLeftLogical = COL_MACHINE_W + COL_SIZE_W + COL_MC_W + (xOff - boardStartDays) * effectiveColW;
        const cardCenterLogical = cardLeftLogical + CARD_W_PX / 2;
        const containerWidth  = scrollRef.current.clientWidth;
        const containerHeight = scrollRef.current.clientHeight;
        const rowIndex = filteredMachines.findIndex(m => m.id === target.machine_id);
        const rowCenter = rowIndex * ROW_H_PX + ROW_H_PX / 2;
        scrollRef.current.scrollTo({
          left: Math.max(0, cardCenterLogical * (zoom / 100) - containerWidth / 2),
          top:  Math.max(0, rowCenter * (zoom / 100) - containerHeight / 2),
          behavior: 'smooth',
        });
      }
    } else {
      // Card is in the unplanned dock — highlight and scroll dock to it
      setDockHighlightedId(highlightOrderId);
      setTimeout(() => setDockHighlightedId(null), 3000);
    }
  }, [highlightOrderId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dates = useMemo(
    () => Array.from({ length: visibleDays }, (_, i) => addDays(startDate, i)),
    [startDate]
  );
  const boardStartDays = useMemo(() => daysFromEpoch(startDate), [startDate]);
  const boardEndDays   = useMemo(() => boardStartDays + visibleDays, [boardStartDays, visibleDays]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data: mData }, { data: oData }] = await Promise.all([
      supabase.from('machines').select('*').order('display_order'),
      supabase.from('production_orders').select('*').eq('is_finished', false).order('created_at', { ascending: false }).limit(5000),
    ]);
    if (mData) setMachines(mData as Machine[]);
    if (oData) setOrders(oData as ProductionOrder[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredMachines = useMemo(
    () => filterSizeSet ? machines.filter(m => filterSizeSet.has(m.size_ton)) : machines,
    [machines, filterSizeSet]
  );

  const assignedByMachine = useMemo(() => {
    const map = new Map<string, ProductionOrder[]>();
    orders.forEach(o => {
      if (!o.machine_id) return;
      map.set(o.machine_id, [...(map.get(o.machine_id) ?? []), o]);
    });
    return map;
  }, [orders]);

  const unassigned = useMemo(() => {
    const base = orders.filter(o => !o.machine_id);
    const filtered = filterSizeSet ? base.filter(o => o.size_ton != null && filterSizeSet.has(o.size_ton)) : base;
    return [...filtered].sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.localeCompare(b.due_date);
    });
  }, [orders, filterSizeSet]);

  function matchesSearch(o: ProductionOrder): boolean {
    if (!searchText.trim()) return true;
    const s = searchText.toLowerCase();
    return [o.unc_code_1, o.unc_code_2, o.unc_code_3, o.unc_code_4, o.order_id]
      .some(v => v?.toLowerCase().includes(s));
  }

  // All UNC codes for search dropdown suggestions
  const allUncCodes = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      [o.unc_code_1, o.unc_code_2, o.unc_code_3, o.unc_code_4].forEach(c => { if (c) set.add(c); });
    }
    return [...set].sort();
  }, [orders]);

  const searchSuggestions = useMemo(() => {
    if (!searchText.trim()) return [];
    const q = searchText.toLowerCase();
    return allUncCodes.filter(c => c.toLowerCase().includes(q)).slice(0, 8);
  }, [searchText, allUncCodes]);

  // Orders on board that match the current search query (for Enter key navigation)
  const searchMatchedOnBoard = useMemo(() => {
    if (!searchText.trim()) return [];
    const matched = orders.filter(o => o.machine_id && matchesSearch(o));
    return [...matched].sort((a, b) => {
      const xd = getXOffset(a) - getXOffset(b);
      if (xd !== 0) return xd;
      return filteredMachines.findIndex(m => m.id === a.machine_id) -
             filteredMachines.findIndex(m => m.id === b.machine_id);
    });
  }, [searchText, orders, filteredMachines]); // eslint-disable-line react-hooks/exhaustive-deps

  // Orders in unplanned dock that match the current search query
  const searchMatchedInDock = useMemo(() => {
    if (!searchText.trim()) return [];
    return orders.filter(o => !o.machine_id && matchesSearch(o));
  }, [searchText, orders]); // eslint-disable-line react-hooks/exhaustive-deps

  function showNoResultToast() {
    setNoResultToast(true);
    setTimeout(() => setNoResultToast(false), 2200);
  }

  function navigateToSearchMatch() {
    const q = searchText.trim().toLowerCase();
    if (!q) return;

    // Build combined list fresh (avoids stale-closure split issues)
    const boardCards = orders.filter(o => o.machine_id && matchesSearch(o));
    const dockCards  = orders.filter(o => !o.machine_id && matchesSearch(o));
    const sortedBoard = [...boardCards].sort((a, b) => {
      const xd = getXOffset(a) - getXOffset(b);
      if (xd !== 0) return xd;
      return filteredMachines.findIndex(m => m.id === a.machine_id) -
             filteredMachines.findIndex(m => m.id === b.machine_id);
    });
    const combined = [...sortedBoard, ...dockCards];

    if (combined.length === 0) { showNoResultToast(); return; }

    const idx    = searchNavIdx % combined.length;
    const target = combined[idx];
    setSearchNavIdx(idx + 1);

    if (target.machine_id) {
      setHighlightedCardId(target.id);
      setTimeout(() => setHighlightedCardId(null), 2500);
      if (scrollRef.current) {
        const xOff = getXOffset(target);
        const cardLeftLogical = COL_MACHINE_W + COL_SIZE_W + COL_MC_W + (xOff - boardStartDays) * effectiveColW;
        const cardCenterLogical = cardLeftLogical + CARD_W_PX / 2;
        const containerWidth  = scrollRef.current.clientWidth;
        const containerHeight = scrollRef.current.clientHeight;
        const rowIndex = filteredMachines.findIndex(m => m.id === target.machine_id);
        const rowCenter = rowIndex * ROW_H_PX + ROW_H_PX / 2;
        scrollRef.current.scrollTo({
          left: Math.max(0, cardCenterLogical * (zoom / 100) - containerWidth / 2),
          top:  Math.max(0, rowCenter * (zoom / 100) - containerHeight / 2),
          behavior: 'smooth',
        });
      }
    } else {
      setDockHighlightedId(target.id);
      setTimeout(() => setDockHighlightedId(null), 2500);
    }
  }

  // Trigger navigation when dropdown suggestion is selected
  const autoNavOnSelectRef = useRef(false);
  useEffect(() => {
    if (!autoNavOnSelectRef.current) return;
    if (searchMatchedOnBoard.length === 0 && searchMatchedInDock.length === 0) return;
    autoNavOnSelectRef.current = false;
    navigateToSearchMatch();
  }, [searchMatchedOnBoard, searchMatchedInDock]); // eslint-disable-line react-hooks/exhaustive-deps

  // After navigating from Plan List via eye button: auto-scroll to the searched card once data loads
  const didAutoNavRef = useRef(false);
  useEffect(() => {
    if (!initialSearch || didAutoNavRef.current || loading) return;
    if (searchMatchedOnBoard.length > 0) {
      didAutoNavRef.current = true;
      const target = searchMatchedOnBoard[0];
      setHighlightedCardId(target.id);
      setTimeout(() => setHighlightedCardId(null), 2500);
      if (scrollRef.current) {
        const xOff = getXOffset(target);
        const cardLeftLogical = COL_MACHINE_W + COL_SIZE_W + COL_MC_W + (xOff - boardStartDays) * effectiveColW;
        const cardCenterLogical = cardLeftLogical + CARD_W_PX / 2;
        const containerWidth  = scrollRef.current.clientWidth;
        const containerHeight = scrollRef.current.clientHeight;
        const rowIndex = filteredMachines.findIndex(m => m.id === target.machine_id);
        const rowCenter = rowIndex * ROW_H_PX + ROW_H_PX / 2;
        scrollRef.current.scrollTo({
          left: Math.max(0, cardCenterLogical * (zoom / 100) - containerWidth / 2),
          top:  Math.max(0, rowCenter * (zoom / 100) - containerHeight / 2),
          behavior: 'smooth',
        });
      }
    } else if (searchMatchedInDock.length > 0) {
      didAutoNavRef.current = true;
      const target = searchMatchedInDock[0];
      setDockHighlightedId(target.id);
      setTimeout(() => setDockHighlightedId(null), 2500);
    }
  }, [loading, searchMatchedOnBoard.length, searchMatchedInDock.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drag handlers ────────────────────────────────────────────────────────────

  function handleCardDragStart(e: React.DragEvent, order: ProductionOrder) {
    e.dataTransfer.setData('orderId', order.id);
    e.dataTransfer.effectAllowed = 'move';

    // Use invisible drag image so the browser's floating ghost is gone.
    // Our own ghost (aligned to cursor) is the only visual feedback.
    const canvas = document.createElement('canvas');
    canvas.width = 1; canvas.height = 1;
    e.dataTransfer.setDragImage(canvas, 0, 0);

    // Grab offset = where within the card the user clicked
    const grabX  = e.nativeEvent.offsetX;
    const isCtrl = e.ctrlKey;
    const originX = getXOffset(order);
    const machId  = order.machine_id ?? null;
    setTimeout(() => {
      setDraggingId(order.id);
      setShiftDrag(isCtrl);
      setDragOriginX(originX);
      setDragMachineId(machId);
      setDragOffsetX(grabX);
    }, 0);
  }

  function resetDragState() {
    if (dragRAFRef.current !== null) { cancelAnimationFrame(dragRAFRef.current); dragRAFRef.current = null; }
    setDraggingId(null);
    setHoverRow(null);
    setGhostX(0);
    setShiftDrag(false);
    setDragOriginX(null);
    setDragMachineId(null);
    setDragOffsetX(0);
  }

  function handleCardDragEnd() { resetDragState(); }

  async function commitSingleDrop(orderId: string, machine: Machine, newXOffset: number, scheduledDate: string) {
    setOrders(prev => prev.map(o =>
      o.id === orderId
        ? { ...o, machine_id: machine.id, x_offset: newXOffset, scheduled_date: scheduledDate }
        : o
    ));
    await supabase.from('production_orders')
      .update({ machine_id: machine.id, x_offset: newXOffset, scheduled_date: scheduledDate })
      .eq('id', orderId);
  }

  async function handleRowDrop(e: React.DragEvent, machine: Machine) {
    e.preventDefault();
    const orderId = e.dataTransfer.getData('orderId');
    if (!orderId) return;

    const newXOffset    = boardStartDays + ghostX / effectiveColW;
    const scheduledDate = toDateKey(new Date(EPOCH_MS + newXOffset * 86400000));

    // Shift+drag on same machine: move this card AND all cards to its right
    if (shiftDrag && dragMachineId === machine.id && dragOriginX !== null) {
      const delta = newXOffset - dragOriginX;
      const affected = orders.filter(
        o => o.machine_id === machine.id && getXOffset(o) >= dragOriginX!
      );
      const updates = affected.map(o => {
        const nx = getXOffset(o) + delta;
        return { id: o.id, x_offset: nx, scheduled_date: toDateKey(new Date(EPOCH_MS + nx * 86400000)) };
      });
      resetDragState();
      setOrders(prev => prev.map(o => {
        const u = updates.find(u => u.id === o.id);
        return u ? { ...o, x_offset: u.x_offset, scheduled_date: u.scheduled_date } : o;
      }));
      await Promise.all(updates.map(u =>
        supabase.from('production_orders')
          .update({ x_offset: u.x_offset, scheduled_date: u.scheduled_date })
          .eq('id', u.id)
      ));
    } else {
      const order = orders.find(o => o.id === orderId);
      resetDragState();
      // Check size-ton mismatch — skip popup if already approved for this machine
      const mismatchKey = `${orderId}:${machine.id}`;
      if (order && order.size_ton != null && order.size_ton !== machine.size_ton && !approvedMismatches.has(mismatchKey)) {
        setSizeMismatch({ order, machine, newXOffset, scheduledDate });
      } else {
        await commitSingleDrop(orderId, machine, newXOffset, scheduledDate);
      }
    }
  }

  async function handleUnassign(order: ProductionOrder) {
    setOrders(prev => prev.map(o =>
      o.id === order.id ? { ...o, machine_id: null, x_offset: null, scheduled_date: null } : o
    ));
    await supabase.from('production_orders')
      .update({ machine_id: null, x_offset: null, scheduled_date: null })
      .eq('id', order.id);
  }

  async function handleConfirmUrgent(order: ProductionOrder) {
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, urgent: false } : o));
    await supabase.from('production_orders').update({ urgent: false }).eq('id', order.id);
  }

  function handlePlan(order: ProductionOrder) {
    setPlanSendDate(order.plan_issue_date ?? '');
    setPlanError(null);
    setPlanDateOrder(order);
  }

  async function confirmPlan() {
    if (!planDateOrder || !planSendDate || savingPlan) return;
    setSavingPlan(true);
    setPlanError(null);

    try {
      const { error } = await supabase.from('production_orders')
        .update({ is_planned: true, is_printed: false, plan_issue_date: planSendDate })
        .eq('id', planDateOrder.id);
      if (error) {
        setPlanError(`บันทึกไม่สำเร็จ: ${error.message}`);
        return;
      }

      setOrders(prev => prev.map(o => o.id === planDateOrder.id
        ? { ...o, is_planned: true, is_printed: false, plan_issue_date: planSendDate }
        : o
      ));
      setPlanDateOrder(null);
    } catch (error) {
      setPlanError(`บันทึกไม่สำเร็จ: ${error instanceof Error ? error.message : 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ'}`);
    } finally {
      setSavingPlan(false);
    }
  }

  async function handleUnplan(order: ProductionOrder) {
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, is_planned: false } : o));
    await supabase.from('production_orders').update({ is_planned: false }).eq('id', order.id);
  }

  async function handleDeleteOrder(order: ProductionOrder) {
    setDeleteConfirm(order);
  }

  async function commitDeleteOrder(order: ProductionOrder) {
    setDeleteConfirm(null);
    setOrders(prev => prev.filter(o => o.id !== order.id));
    await supabase.from('production_orders').delete().eq('id', order.id);
    if (user) await logOrderDelete(order, user.username);
  }

  async function handleFinishOrder(order: ProductionOrder) {
    setOrders(prev => prev.filter(o => o.id !== order.id));
    await supabase.from('production_orders').update({ is_finished: true, finished_at: new Date().toISOString() }).eq('id', order.id);
  }

  async function handlePrintOrder(order: ProductionOrder) {
    const newVal = !order.is_printed;
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, is_printed: newVal } : o));
    await supabase.from('production_orders').update({ is_printed: newVal }).eq('id', order.id);
  }

  function navigateToCard(type: 'White' | 'Yellow' | 'urgent' | 'planned') {
    const machineIds = new Set(filteredMachines.map(m => m.id));
    const pool = orders.filter(o => {
      if (!o.machine_id || !machineIds.has(o.machine_id)) return false;
      if (type === 'urgent') return o.urgent;
      if (type === 'planned') return o.is_planned;
      // Uses Operator / No Operator: exclude planned and urgent cards
      return o.plan_type === type && !o.urgent && !o.is_planned;
    });
    if (pool.length === 0) { showNoResultToast(); return; }
    // Sort by x_offset then machine row index
    const sorted = [...pool].sort((a, b) => {
      const xd = (getXOffset(a)) - (getXOffset(b));
      if (xd !== 0) return xd;
      return filteredMachines.findIndex(m => m.id === a.machine_id) -
             filteredMachines.findIndex(m => m.id === b.machine_id);
    });
    const idx = (navIdx[type] ?? 0) % sorted.length;
    const target = sorted[idx];
    setNavIdx(prev => ({ ...prev, [type]: (idx + 1) % sorted.length }));
    // Highlight (auto-expand) the card
    setHighlightedCardId(target.id);
    setTimeout(() => setHighlightedCardId(null), 2500);
    // Scroll to center the card horizontally and vertically
    if (scrollRef.current) {
      const xOff = getXOffset(target);
      const cardLeftLogical = COL_MACHINE_W + COL_SIZE_W + COL_MC_W + (xOff - boardStartDays) * effectiveColW;
      const cardCenterLogical = cardLeftLogical + CARD_W_PX / 2;
      const containerWidth  = scrollRef.current.clientWidth;
      const containerHeight = scrollRef.current.clientHeight;
      const rowIndex = filteredMachines.findIndex(m => m.id === target.machine_id);
      const rowCenter = rowIndex * ROW_H_PX + ROW_H_PX / 2;
      scrollRef.current.scrollTo({
        left: Math.max(0, cardCenterLogical * (zoom / 100) - containerWidth / 2),
        top:  Math.max(0, rowCenter * (zoom / 100) - containerHeight / 2),
        behavior: 'smooth',
      });
    }
  }

  async function handleDockDrop(e: React.DragEvent) {
    e.preventDefault();
    const orderId = e.dataTransfer.getData('orderId');
    if (!orderId) return;
    resetDragState();
    const order = orders.find(o => o.id === orderId);
    if (!order?.machine_id) return;
    setOrders(prev => prev.map(o =>
      o.id === orderId ? { ...o, machine_id: null, x_offset: null, scheduled_date: null } : o
    ));
    await supabase.from('production_orders')
      .update({ machine_id: null, x_offset: null, scheduled_date: null })
      .eq('id', orderId);
  }

  const hasFilter  = !!searchText.trim() || filterSizeGroup !== null;
  // Effective column width: ensures column visual width is always an integer pixel,
  // eliminating cumulative sub-pixel drift between header and body grid lines under CSS zoom.
  const effectiveColW = Math.round(COL_DATE_W * zoom / 100) / (zoom / 100);
  const boardAreaW  = visibleDays * effectiveColW;

  // The dragging order (needed to render ghost)
  const draggingOrder = draggingId ? orders.find(o => o.id === draggingId) ?? null : null;

  return (
    <div className="flex-1 flex flex-col min-h-0 gap-2">

      {/* ── Toolbar ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-wrap flex-shrink-0">
        {/* Date range picker */}
        <div className="flex items-center gap-1.5 bg-white dark:bg-[#091526] border border-gray-200 dark:border-blue-900/50 rounded-lg px-2.5 py-1 text-[11px]">
          <CalendarDays size={11} className="text-brand-orange flex-shrink-0" />
          <input
            type="date"
            value={startDate.toISOString().slice(0, 10)}
            onChange={e => {
              const d = new Date(e.target.value + 'T00:00:00');
              if (!isNaN(d.getTime())) setStartDate(d);
            }}
            className="bg-transparent text-gray-700 dark:text-gray-200 font-semibold focus:outline-none cursor-pointer w-28"
          />
          <span className="text-gray-400 font-bold">—</span>
          <input
            type="date"
            value={endDate.toISOString().slice(0, 10)}
            min={startDate.toISOString().slice(0, 10)}
            max={addDays(todayStart(), 60).toISOString().slice(0, 10)}
            onChange={e => {
              const d = new Date(e.target.value + 'T00:00:00');
              if (!isNaN(d.getTime())) setEndDate(d);
            }}
            className="bg-transparent text-gray-700 dark:text-gray-200 font-semibold focus:outline-none cursor-pointer w-28"
          />
          <span className="text-gray-400 font-medium ml-1">({visibleDays}d)</span>
        </div>
        {/* Working-day navigation arrows — skip weekends & holidays */}
        <button
          onClick={() => setStartDate(d => nextWorkingDay(d, -1))}
          title="Previous working day (skip weekends & holidays)"
          className="px-2 py-1.5 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-blue-900/50 rounded-lg bg-white dark:bg-[#0C1830] hover:bg-[#F36B21] hover:text-white hover:border-[#F36B21] transition-all text-[13px] font-bold leading-none"
        >‹</button>
        <button
          onClick={() => setStartDate(d => nextWorkingDay(d, 1))}
          title="Next working day (skip weekends & holidays)"
          className="px-2 py-1.5 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-blue-900/50 rounded-lg bg-white dark:bg-[#0C1830] hover:bg-[#F36B21] hover:text-white hover:border-[#F36B21] transition-all text-[13px] font-bold leading-none"
        >›</button>
        <button onClick={() => { setStartDate(addDays(todayStart(), -3)); setEndDate(addDays(todayStart(), 90)); }}
          className="px-3 py-1.5 bg-brand-orange hover:bg-brand-orange-dark text-white text-[11px] font-bold rounded-lg transition-all active:scale-95">
          TODAY
        </button>
        <button onClick={fetchData}
          className="p-1.5 text-gray-500 dark:text-gray-400 hover:text-brand-orange border border-gray-200 dark:border-blue-900/50 rounded-lg bg-white dark:bg-[#0C1830] hover:bg-brand-orange-muted dark:hover:bg-orange-900/20 transition-all">
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
        {canMoveCards && (
          <button
            onClick={() => setShowAddMachine(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0A0B0D] hover:bg-gray-800 text-white text-[11px] font-bold rounded-lg transition-all active:scale-95 border border-gray-700"
          >
            <SlidersHorizontal size={11} className="text-brand-orange" /> Manage M/C
          </button>
        )}
        {(() => {
          const machIds = new Set(filteredMachines.map(m => m.id));
          const assigned = orders.filter(o => o.machine_id && machIds.has(o.machine_id));
          const plannedCnt     = assigned.filter(o => o.is_planned).length;
          const countWhite    = assigned.filter(o => !o.urgent && o.plan_type === 'White').length;
          const countYellow   = assigned.filter(o => !o.urgent && o.plan_type === 'Yellow').length;
          const countUrgent   = assigned.filter(o => o.urgent).length;
          return (
            <div className="flex items-center gap-2 text-[11px]">
              <button
                onClick={() => navigateToCard('planned')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#15803D] bg-[#22C55E] text-[#052E16] font-semibold hover:bg-[#16A34A] hover:text-white transition-all active:scale-95"
              >
                <span className="w-2 h-2 rounded-full bg-[#15803D] inline-block flex-shrink-0" />
                Planned
                <span className="ml-0.5 bg-[#15803D] text-white rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none">{plannedCnt}</span>
              </button>
              <button
                onClick={() => navigateToCard('Yellow')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#D97706] bg-[#FDE68A] text-[#451A03] font-semibold hover:bg-yellow-200 transition-all active:scale-95"
              >
                <span className="w-2 h-2 rounded-full bg-[#D97706] inline-block flex-shrink-0" />
                Uses Operator
                <span className="ml-0.5 bg-[#D97706] text-white rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none">{countYellow}</span>
              </button>
              <button
                onClick={() => navigateToCard('White')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#2563EB] bg-[#BFDBFE] text-[#1E3A5F] font-semibold hover:bg-blue-200 transition-all active:scale-95"
              >
                <span className="w-2 h-2 rounded-full bg-[#2563EB] inline-block flex-shrink-0" />
                No Operator
                <span className="ml-0.5 bg-[#2563EB] text-white rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none">{countWhite}</span>
              </button>
              <button
                onClick={() => navigateToCard('urgent')}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-[#9A3412] bg-[#FCA98B] text-[#431407] font-semibold hover:bg-orange-200 transition-all active:scale-95"
              >
                <span className="w-2 h-2 rounded-full bg-[#EA580C] inline-block flex-shrink-0 animate-pulse" />
                Pending Confirm
                <span className="ml-0.5 bg-[#EA580C] text-white rounded-full px-1.5 py-0.5 text-[9px] font-bold leading-none">{countUrgent}</span>
              </button>
            </div>
          );
        })()}
        <div className="ml-auto flex items-center gap-1">
          <div className="flex items-center gap-1 pl-2">
            <ZoomIn size={12} className="text-gray-400 flex-shrink-0" />
            <select
              value={customZoomMode ? 'custom' : zoom}
              onChange={e => {
                if (e.target.value === 'custom') {
                  setCustomZoomMode(true);
                  setCustomZoomStr(String(zoom));
                } else {
                  setCustomZoomMode(false);
                  setZoom(Number(e.target.value));
                }
              }}
              className="bg-white dark:bg-[#0C1830] border border-gray-200 dark:border-blue-900/50 rounded text-[11px] font-semibold text-gray-700 dark:text-gray-200 px-1 py-0.5 cursor-pointer outline-none hover:border-brand-orange transition-colors"
            >
              {[50,75,100,125,150,200].map(v => (
                <option key={v} value={v}>{v}%</option>
              ))}
              <option value="custom">
                {customZoomMode ? `${zoom}% (เอง)` : 'กำหนดเอง...'}
              </option>
            </select>
            {customZoomMode && (
              <div className="flex items-center bg-white dark:bg-[#0C1830] border border-brand-orange rounded overflow-hidden">
                <input
                  autoFocus
                  type="number" min={25} max={300}
                  value={customZoomStr}
                  onChange={e => {
                    setCustomZoomStr(e.target.value);
                    const v = Math.min(300, Math.max(25, Number(e.target.value) || 25));
                    setZoom(v);
                  }}
                  className="w-[40px] bg-transparent outline-none text-[11px] font-semibold text-gray-700 dark:text-gray-200 px-1.5 py-0.5 text-right [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
                <span className="text-[10px] text-gray-400 pr-1.5">%</span>
              </div>
            )}
          </div>
          <button
            onClick={toggleBoardFullscreen}
            className="flex items-center gap-1 px-2 py-1 bg-[#0A0B0D] hover:bg-gray-800 text-white text-[11px] font-bold rounded-lg transition-all ml-1"
            title={boardFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
          >
            {boardFullscreen ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
          </button>
        </div>
      </div>

      {/* ── Search & Filter ───────────────────────────────────────── */}
      <div className="flex items-center gap-2 flex-shrink-0 bg-white dark:bg-[#091526] border border-gray-200 dark:border-blue-900/50 rounded-xl px-3 py-2 shadow-sm flex-wrap">
        <SlidersHorizontal size={12} className="text-gray-400 flex-shrink-0" />
        {/* Search with dropdown */}
        <div className="relative flex items-center gap-1.5 bg-gray-50 dark:bg-[#0C1830] border border-gray-200 dark:border-blue-900/50 rounded-lg px-2.5 py-1 min-w-[200px]">
          <Search size={11} className="text-gray-400 flex-shrink-0" />
          <input
            type="text"
            placeholder="ค้นหา UNC Code..."
            value={searchText}
            onChange={e => { setSearchText(e.target.value); setShowSearchDropdown(true); setSearchNavIdx(0); }}
            onFocus={() => setShowSearchDropdown(true)}
            onBlur={() => setTimeout(() => setShowSearchDropdown(false), 150)}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); setShowSearchDropdown(false); navigateToSearchMatch(); } }}
            className="bg-transparent outline-none text-[11px] text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-600 w-full"
          />
          {searchText && <button onClick={() => { setSearchText(''); setSearchNavIdx(0); }}><X size={10} className="text-gray-400" /></button>}
          {searchText.trim() && (searchMatchedOnBoard.length > 0 || searchMatchedInDock.length > 0) && !showSearchDropdown && (() => {
            const total = searchMatchedOnBoard.length + searchMatchedInDock.length;
            const cur = searchNavIdx > 0 ? `${((searchNavIdx - 1) % total) + 1}/${total}` : `${total}`;
            return <span className="text-[9px] font-bold text-[#F36B21] flex-shrink-0 whitespace-nowrap">{cur} ↵</span>;
          })()}
          {/* Dropdown suggestions */}
          {showSearchDropdown && searchSuggestions.length > 0 && (
            <div className="absolute top-full left-0 mt-1 w-full min-w-[180px] bg-white dark:bg-[#0C1830] border border-gray-200 dark:border-blue-900/50 rounded-lg shadow-xl overflow-hidden" style={{ zIndex: 9999 }}>
              {searchSuggestions.map(code => (
                <button
                  key={code}
                  onMouseDown={() => { setSearchText(code); setSearchNavIdx(0); setShowSearchDropdown(false); autoNavOnSelectRef.current = true; }}
                  className="w-full text-left px-3 py-1.5 text-[11px] font-mono text-gray-700 dark:text-gray-200 hover:bg-orange-50 dark:hover:bg-[#2A1F14] hover:text-[#F36B21] transition-colors"
                >
                  {code}
                </button>
              ))}
            </div>
          )}
        </div>
        {/* My Plan button */}
        {user && (
          <button
            onClick={() => setMyPlanMode(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-bold border transition-all ${
              myPlanMode
                ? 'bg-[#F36B21] text-white border-[#F36B21]'
                : 'bg-white dark:bg-[#0C1830] text-gray-600 dark:text-gray-300 border-gray-200 dark:border-blue-900/50 hover:border-[#F36B21] hover:text-[#F36B21]'
            }`}
          >
            <User size={10} /> My Plan
          </button>
        )}
        <div className="h-4 w-px bg-gray-200 dark:bg-gray-700 mx-1" />
        <span className="text-[11px] text-gray-500 dark:text-gray-400 font-medium flex-shrink-0">Size:</span>
        <div className="flex items-center gap-1 flex-wrap">
          <button onClick={() => setFilterSizeGroup(null)}
            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all ${!filterSizeGroup ? 'bg-brand-orange text-white' : 'bg-gray-100 dark:bg-[#0C1830] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-blue-900/40'}`}>
            All
          </button>
          {SIZE_GROUPS.map(g => (
            <button key={g.label} onClick={() => setFilterSizeGroup(filterSizeGroup === g.label ? null : g.label)}
              className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all ${filterSizeGroup === g.label ? 'bg-brand-orange text-white' : 'bg-gray-100 dark:bg-[#0C1830] text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-blue-900/40'}`}>
              {g.label}
            </button>
          ))}
        </div>
        {(hasFilter || myPlanMode) && (
          <button onClick={() => { setSearchText(''); setFilterSizeGroup(null); setMyPlanMode(false); }}
            className="ml-auto flex items-center gap-1 text-[11px] text-red-500 hover:text-red-400 font-medium">
            <X size={10} /> Clear
          </button>
        )}
        {searchText.trim() && (() => {
          const boardCnt = searchMatchedOnBoard.length;
          const dockCnt  = searchMatchedInDock.length;
          const total    = boardCnt + dockCnt;
          return (
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              พบ <span className="font-bold text-brand-orange">{total}</span> รายการ
              {dockCnt > 0 && <span className="text-gray-400"> ({boardCnt} Board / <span className="text-amber-400">{dockCnt} Unplanned</span>)</span>}
            </span>
          );
        })()}
      </div>

      {/* ── Board ─────────────────────────────────────────────────── */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-8 h-8 border-[3px] border-brand-orange/20 border-t-brand-orange rounded-full animate-spin" />
        </div>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-auto rounded-xl border border-gray-200 dark:border-gray-700/60 shadow-sm min-h-0">
          <div style={{ zoom: zoom / 100 }}>
          <table className="border-collapse" style={{ tableLayout: 'fixed', width: COL_MACHINE_W + COL_SIZE_W + COL_MC_W + boardAreaW }}>
            <colgroup>
              <col style={{ width: COL_MACHINE_W }} />
              <col style={{ width: COL_SIZE_W }} />
              <col style={{ width: COL_MC_W }} />
              {dates.map(d => <col key={toDateKey(d)} style={{ width: effectiveColW }} />)}
            </colgroup>

            {/* ── Header — sticky as one <tr> unit so all cells move together, no compositing offset ── */}
            <thead>
              <tr style={{ position: 'sticky', top: 0, zIndex: 40 }}>
                <th style={{ position: 'sticky', left: 0, zIndex: 50, background: isDark ? '#091526' : '#FFFFFF', boxShadow: `2px 0 0 0 ${isDark ? '#1A3055' : '#E5E7EB'}, 0 2px 0 0 ${isDark ? '#1A3055' : '#E5E7EB'}` }}
                  className="text-gray-800 dark:text-gray-200 text-[11px] font-bold px-2 py-1.5 text-left whitespace-nowrap">
                  Machine
                </th>
                <th style={{ position: 'sticky', left: COL_MACHINE_W, zIndex: 50, background: isDark ? '#091526' : '#FFFFFF', boxShadow: `2px 0 0 0 ${isDark ? '#1A3055' : '#E5E7EB'}, 0 2px 0 0 ${isDark ? '#1A3055' : '#E5E7EB'}` }}
                  className="text-gray-800 dark:text-gray-200 text-[11px] font-bold px-1 py-1.5 text-center whitespace-nowrap">
                  Size<br />(T)
                </th>
                <th style={{ position: 'sticky', left: COL_MACHINE_W + COL_SIZE_W, zIndex: 50, background: isDark ? '#091526' : '#FFFFFF', boxShadow: `2px 0 0 0 ${isDark ? '#1A3055' : '#E5E7EB'}, 0 2px 0 0 ${isDark ? '#1A3055' : '#E5E7EB'}` }}
                  className="text-gray-800 dark:text-gray-200 text-[11px] font-bold px-1 py-1.5 text-center whitespace-nowrap">
                  M/C<br />No.
                </th>
                {dates.map(date => {
                  const today   = isToday(date);
                  const weekend = isWeekend(date);
                  const holiday = !today && isHoliday(date);
                  const bg = today ? '#F36B21' : holiday ? (isDark ? '#2D0F0F' : '#FEE2E2') : weekend ? (isDark ? '#1C2E10' : '#FED7AA') : (isDark ? '#0C1830' : '#F8FAFC');
                  return (
                    <th key={toDateKey(date)}
                      style={{ background: bg, boxShadow: `1px 0 0 0 ${isDark ? '#1A3055' : '#E5E7EB'}, 0 2px 0 0 ${isDark ? '#1A3055' : '#E5E7EB'}` }}
                      className="px-0.5 py-1 text-center">
                      <div className="text-[8px] font-bold" style={{ color: today ? '#FFFFFF' : holiday ? (isDark ? '#F87171' : '#991B1B') : weekend ? (isDark ? '#F59E0B' : '#92400E') : (isDark ? '#94A3B8' : '#64748B') }}>
                        {DAYS_SHORT[date.getDay()]}
                      </div>
                      <div className="text-[9px] font-extrabold" style={{ color: today ? '#FFE4CC' : holiday ? (isDark ? '#FCA5A5' : '#7F1D1D') : weekend ? (isDark ? '#FBBF24' : '#78350F') : (isDark ? '#CBD5E1' : '#374151') }}>
                        {fmtDateLabel(date)}
                      </div>
                      {holiday && (
                        <div className="text-[7px] font-bold leading-none" style={{ color: isDark ? '#F87171' : '#991B1B' }}>✕</div>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>

            {/* ── Body ── */}
            <tbody>
              {filteredMachines.map((machine, rowIdx) => {
                const rowBg = rowIdx % 2 === 0 ? (isDark ? '#0C1830' : '#FFFFFF') : (isDark ? '#081323' : '#FAFAFA');
                const isRowHover = hoverRow === machine.id && draggingId !== null;
                const rowCards   = assignedByMachine.get(machine.id) ?? [];
                const sorted     = [...rowCards].sort((a, b) => getXOffset(a) - getXOffset(b));
                const visible    = sorted.filter(o => {
                  const xOff = getXOffset(o);
                  return xOff >= boardStartDays - 2 && xOff <= boardEndDays + 2;
                });

                return (
                  <tr
                    key={machine.id}
                    style={{
                      transition: 'opacity 0.15s',
                    }}
                  >
                    {/* Frozen left cells — use box-shadow for border so it renders above colSpan cell */}
                    <td style={{ position: 'sticky', left: 0, zIndex: 30, background: rowBg, height: ROW_H_PX, boxShadow: `2px 0 0 0 ${isDark ? '#1A3055' : '#E5E7EB'}, 0 -1px 0 0 ${isDark ? '#1A3055' : '#E5E7EB'}` }}
                      className="px-1 text-[11px] font-semibold text-brand-black dark:text-gray-200 whitespace-nowrap align-middle">
                      <div className="flex items-center gap-1">
                        <span className="truncate">{machine.machine_type}</span>
                      </div>
                    </td>
                    <td style={{ position: 'sticky', left: COL_MACHINE_W, zIndex: 30, background: rowBg, height: ROW_H_PX, boxShadow: `2px 0 0 0 ${isDark ? '#1A3055' : '#E5E7EB'}, 0 -1px 0 0 ${isDark ? '#1A3055' : '#E5E7EB'}` }}
                      className="px-1 text-[11px] font-bold text-center text-brand-black dark:text-gray-200 whitespace-nowrap align-middle">
                      {machine.size_ton}
                    </td>
                    <td style={{ position: 'sticky', left: COL_MACHINE_W + COL_SIZE_W, zIndex: 30, background: rowBg, height: ROW_H_PX, boxShadow: `2px 0 0 0 ${isDark ? '#1A3055' : '#E5E7EB'}, 0 -1px 0 0 ${isDark ? '#1A3055' : '#E5E7EB'}` }}
                      className="px-1 text-[11px] font-bold text-center text-brand-black dark:text-gray-200 whitespace-nowrap align-middle">
                      {machine.mc_no}
                    </td>

                    {/* Single free-placement row cell spanning all date columns */}
                    <td
                      colSpan={visibleDays}
                      style={{
                        position: 'relative',
                        zIndex: 1,
                        height: ROW_H_PX,
                        padding: 0,
                        verticalAlign: 'top',
                        overflow: 'visible',
                        background: isRowHover ? (isDark ? '#0A2240' : '#FFF0E8') : rowBg,
                        transition: 'background 0.1s',
                      }}
                      onDragOver={e => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (hoverRow !== machine.id) setHoverRow(machine.id);
                        const clientX = e.clientX;
                        if (dragRAFRef.current !== null) return;
                        const rectLeft = e.currentTarget.getBoundingClientRect().left;
                        dragRAFRef.current = requestAnimationFrame(() => {
                          dragRAFRef.current = null;
                          setGhostX(Math.max(0, (clientX - rectLeft - dragOffsetX) / (zoom / 100)));
                        });
                      }}
                      onDragLeave={() => { setHoverRow(null); setGhostX(0); }}
                      onDrop={canMoveCards ? (e => handleRowDrop(e, machine)) : undefined}
                    >
                      {/* Date grid lines — zIndex 1 keeps them below all cards (z2+) */}
                      {dates.map((date, i) => (
                        <div key={i} style={{
                          position: 'absolute', top: 0, bottom: 0,
                          left: i * effectiveColW, width: i === 0 ? 0 : 1,
                          background: isToday(date) ? '#F36B21' : (isDark ? '#FFFFFF' : '#000000'),
                          opacity: isToday(date) ? 0.4 : (isDark ? 0.12 : 0.14),
                          pointerEvents: 'none', zIndex: 1,
                        }} />
                      ))}

                      {/* Today tint */}
                      {dates.map((date, i) => isToday(date) && (
                        <div key={`today-${i}`} style={{
                          position: 'absolute', top: 0, bottom: 0,
                          left: i * effectiveColW, width: effectiveColW,
                          background: 'rgba(243,107,33,0.04)',
                          pointerEvents: 'none', zIndex: 0,
                        }} />
                      ))}

                      {/* Holiday tint */}
                      {dates.map((date, i) => !isToday(date) && isHoliday(date) && (
                        <div key={`hol-${i}`} style={{
                          position: 'absolute', top: 0, bottom: 0,
                          left: i * effectiveColW, width: effectiveColW,
                          background: isDark ? 'rgba(220,38,38,0.12)' : 'rgba(220,38,38,0.08)',
                          pointerEvents: 'none', zIndex: 0,
                        }} />
                      ))}

                      {/* Drop ring — indigo when ctrl-drag, orange otherwise */}
                      {isRowHover && (
                        <div style={{
                          position: 'absolute', inset: 0,
                          border: `2px solid ${shiftDrag && dragMachineId === machine.id ? 'rgba(99,102,241,0.55)' : 'rgba(243,107,33,0.45)'}`,
                          pointerEvents: 'none', zIndex: 1,
                        }} />
                      )}

                      {/* Ghost: semi-transparent card(s) + ghost arrow — shows exactly where card will land */}
                      {isRowHover && draggingOrder && (() => {
                        const ghostCardTop  = Math.floor((ROW_H_PX - CARD_H_PX) / 2);
                        const ghostArrowTop = Math.floor((ROW_H_PX - ARROW_H_PX) / 2);
                        const newX   = boardStartDays + ghostX / effectiveColW;
                        const delta  = dragOriginX != null ? newX - dragOriginX : 0;
                        const isCtrlSameMachine = shiftDrag && dragMachineId === machine.id && dragOriginX != null;

                        // Ctrl-drag on same row: show ghost for ALL cards from dragOriginX onwards
                        const ghostCards = isCtrlSameMachine
                          ? (assignedByMachine.get(machine.id) ?? [])
                              .filter(o => getXOffset(o) >= dragOriginX!)
                          : [draggingOrder];

                        return ghostCards.map(gc => {
                          const cardOrigX  = getXOffset(gc);
                          const ghostLeft  = isCtrlSameMachine
                            ? (cardOrigX + delta - boardStartDays) * effectiveColW
                            : ghostX;
                          return (
                            <div key={`ghost-${gc.id}`}>
                              <div style={{
                                position: 'absolute',
                                top: ghostCardTop, left: ghostLeft,
                                opacity: 0.5, pointerEvents: 'none', zIndex: 200,
                              }}>
                                <PlanCard order={gc} isDark={isDark} />
                              </div>
                              <LeadtimeArrow
                                order={gc}
                                leftPx={ghostLeft + CARD_W_PX + ARROW_GAP_PX}
                                topPx={ghostArrowTop}
                                ghost
                                dark={isDark}
                                boardStartDays={boardStartDays}
                                holidays={holidaySet}
                                colW={effectiveColW}
                              />
                            </div>
                          );
                        });
                      })()}

                      {/* Cards + leadtime arrows */}
                      {visible.map((card, sortedIndex) => {
                        const xOff   = getXOffset(card);
                        const leftPx = (xOff - boardStartDays) * effectiveColW;
                        const dim    = (!!searchText.trim() && !matchesSearch(card))
                                    || (myPlanMode && card.created_by !== user?.username);
                        // During ctrl-drag, hide all cards that are shifting (including the dragged card)
                        const isShiftAffected = shiftDrag && dragMachineId === machine.id
                          && dragOriginX !== null && xOff >= dragOriginX;
                        const isBeingDragged = draggingId === card.id;
                        return (
                          <div key={card.id} style={{ opacity: dim ? 0.2 : 1, transition: 'opacity 0.15s' }}>
                            <FloatingCard
                              order={card}
                              leftPx={leftPx}
                              baseZIndex={sortedIndex + 2}
                              rowHeight={ROW_H_PX}
                              isDragging={isBeingDragged || isShiftAffected}
                              isHighlighted={highlightedCardId === card.id}
                              canMoveCards={canMoveCards}
                              canEditCard={canEditCard(card)}
                              canConfirmCards={canConfirmCards}
                              canPlanCards={canPlanCards}
                              canDeleteCard={canDeleteCard(card)}
                              canFinishCard={canFinishCards}
                              canPrint={canFinishCards}
                              zoom={zoom}
                              isDark={isDark}
                              boardStartDays={boardStartDays}
                              holidays={holidaySet}
                              colW={effectiveColW}
                              onDragStart={handleCardDragStart}
                              onDragEnd={handleCardDragEnd}
                              onUnassign={handleUnassign}
                              onEdit={setEditingOrder}
                              onConfirm={handleConfirmUrgent}
                              onPlan={handlePlan}
                              onUnplan={handleUnplan}
                              onDelete={handleDeleteOrder}
                              onFinish={handleFinishOrder}
                              onPrint={handlePrintOrder}
                            />
                          </div>
                        );
                      })}

                      {/* Gridline overlay — row bottom border */}
                      <div style={{
                        position: 'absolute', inset: 0,
                        borderBottom: `1px solid ${isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)'}`,
                        pointerEvents: 'none',
                        zIndex: 1,
                      }} />
                    </td>
                  </tr>
                );
              })}
              {filteredMachines.length === 0 && (
                <tr>
                  <td colSpan={3 + visibleDays} className="text-center py-12 text-gray-400 text-sm">
                    {filterSizeGroup ? `ไม่พบ Machine กลุ่ม ${filterSizeGroup}` : 'ไม่พบข้อมูล Machine'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* ── Unassigned dock ──────────────────────────────────────── */}
      {!hideDock && (
        <div style={{ zoom: zoom / 100 }}>
          <UnassignedDock
            orders={unassigned}
            draggingId={draggingId}
            searchText={searchText}
            dockHeight={dockHeight}
            isDark={isDark}
            highlightedId={dockHighlightedId}
            onHeightChange={setDockHeight}
            onCardDragStart={canMoveCards ? handleCardDragStart : undefined as never}
            onCardDragEnd={handleCardDragEnd}
            onDockDrop={handleDockDrop}
            canEditCard={canEditCard}
            canConfirmCards={canConfirmCards}
            canPlanCards={canPlanCards}
            canDeleteCard={canDeleteCard}
            canFinishCards={canFinishCards}
            onEdit={setEditingOrder}
            onConfirm={handleConfirmUrgent}
            onPlan={handlePlan}
            onEditPlanDate={setEditingOrder}
            onUnplan={handleUnplan}
            onDelete={handleDeleteOrder}
            onFinish={handleFinishOrder}
            onPrint={handlePrintOrder}
          />
        </div>
      )}

      {/* Edit modal */}
      {editingOrder && (
        <ProductionForm
          editOrder={editingOrder}
          onSaved={() => { setEditingOrder(null); fetchData(); }}
          onCreated={() => fetchData()}
          onCancel={() => setEditingOrder(null)}
        />
      )}

      {planDateOrder && createPortal(
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <form
            onSubmit={e => { e.preventDefault(); void confirmPlan(); }}
            className="w-full max-w-sm mx-4 overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-[#0C1830]"
          >
            <div className="border-b border-gray-200 px-5 py-4 dark:border-blue-900/50">
              <div className="text-sm font-bold text-gray-900 dark:text-gray-100">เลือกวันส่ง Plan</div>
              <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-400">
                {formatUncCodeForCard(planDateOrder)} · {planDateOrder.order_id}
              </div>
            </div>
            <div className="space-y-3 px-5 py-4">
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300" htmlFor="plan-send-date">
                Send Date
              </label>
              <input
                id="plan-send-date"
                type="date"
                required
                autoFocus
                value={planSendDate}
                onChange={e => setPlanSendDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800 focus:border-brand-orange focus:outline-none dark:border-blue-900/60 dark:bg-[#091526] dark:text-gray-100"
              />
              {planError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{planError}</p>}
            </div>
            <div className="flex gap-3 px-5 pb-5">
              <button
                type="submit"
                disabled={!planSendDate || savingPlan}
                className="flex-1 rounded-xl bg-[#0F766E] py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#115E59] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingPlan ? 'กำลังบันทึก…' : 'ยืนยัน Plan'}
              </button>
              <button
                type="button"
                disabled={savingPlan}
                onClick={() => setPlanDateOrder(null)}
                className="flex-1 rounded-xl bg-gray-100 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600"
              >
                ยกเลิก
              </button>
            </div>
          </form>
        </div>,
        document.body
      )}

      {/* ── Delete confirmation dialog ── */}
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

      {/* ── Size-ton mismatch confirmation dialog ── */}
      {sizeMismatch && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full mx-4 overflow-hidden">
            <div className="bg-amber-50 border-b border-amber-200 px-5 py-4 flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-amber-600 font-black text-base">!</span>
              </div>
              <div>
                <div className="font-bold text-amber-900 text-sm">Size Ton ไม่ตรง</div>
                <div className="text-amber-700 text-xs mt-1 leading-relaxed">
                  ป้าย <span className="font-bold">"{sizeMismatch.order.size_ton}T"</span> ต้องการ Plan ลงเครื่อง <span className="font-bold">"{sizeMismatch.machine.size_ton}T"</span> ใช่หรือไม่
                </div>
              </div>
            </div>
            <div className="flex gap-3 px-5 py-4">
              <button
                onClick={async () => {
                  const { order, machine, newXOffset, scheduledDate } = sizeMismatch;
                  setApprovedMismatches(prev => new Set(prev).add(`${order.id}:${machine.id}`));
                  setSizeMismatch(null);
                  await commitSingleDrop(order.id, machine, newXOffset, scheduledDate);
                }}
                className="flex-1 py-2.5 bg-[#F36B21] hover:bg-[#D4591A] text-white text-sm font-bold rounded-xl transition-all active:scale-95"
              >
                ยืนยันเพื่อ Plan "{sizeMismatch.machine.size_ton}T"
              </button>
              <button
                onClick={() => setSizeMismatch(null)}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-semibold rounded-xl transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Manage M/C dialog ── */}
      {showAddMachine && (
        <ManageMachinesDialog
          machines={machines}
          onClose={() => setShowAddMachine(false)}
          onChanged={(updated) => setMachines([...updated].sort((a, b) => a.display_order - b.display_order))}
        />
      )}

      {/* ── No-result toast ── */}
      {noResultToast && createPortal(
        <div
          style={{
            position: 'fixed', bottom: 32, left: '50%', transform: 'translateX(-50%)',
            zIndex: 999999, pointerEvents: 'none',
          }}
        >
          <div className="bg-gray-900/95 text-white px-5 py-2.5 rounded-xl shadow-2xl text-sm font-semibold flex items-center gap-2 border border-white/10">
            <span className="text-brand-orange text-base">⚠</span>
            ไม่พบข้อมูลที่ต้องการค้นหา
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
