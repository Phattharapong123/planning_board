import React, {
  useState, useEffect, useCallback, useMemo, useRef, memo, useLayoutEffect,
} from 'react';
import {
  RefreshCw, Search, X, SlidersHorizontal, ZoomIn, Trash2, MoveRight,
  Info, Maximize2, Minimize2, Moon, Sun, RotateCcw, Check,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logOrderDelete } from '../lib/deleteLog';
import type { ProductionOrder, Machine } from '../types';
import { formatUncCodeForCard, totalQty, formatCardDate } from './PlanCard';
import { useAuth, canDelete, canEdit } from '../contexts/AuthContext';
import ProductionForm from './ProductionForm';

// ── Dark mode hook ────────────────────────────────────────────────────────────
function useIsDark() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    const obs = new MutationObserver(() =>
      setDark(document.documentElement.classList.contains('dark'))
    );
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const SIZE_GROUPS = [
  { label: '5T-30T',    sizes: [5, 30] },
  { label: '50T',       sizes: [50] },
  { label: '100T',      sizes: [100] },
  { label: '150T',      sizes: [150] },
  { label: '250T-350T', sizes: [250, 300, 350, 450] },
] as const;

const ZOOM_PRESETS = [50, 75, 100, 125, 150, 200];
const ORDER_SLOTS = 10;
const CARD_W = 163;
const CARD_H = 44;

const MC_W   = 175;
const STS_W  = 100;
const NOW_W  = CARD_W + 12;
const PCS_W  = 76;
const FROZEN_W = MC_W + STS_W + NOW_W + PCS_W;

const HDR1_H = 38;
const HDR2_H = 26;

const ORANGE = '#F36523';

function formatBoardDate(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ── Card colors — unified single color for all cards ─────────────────────────
interface CardColors { bg: string; border: string; text: string; glow?: string }
function getPlanTypeColors(_order: ProductionOrder, dark: boolean): CardColors {
  return dark
    ? { bg: '#091828', border: '#60A5FA', text: '#D0EAFF', glow: '0 0 6px rgba(96,165,250,0.6)' }
    : { bg: '#BFDBFE', border: '#2563EB', text: '#1E3A5F' };
}

// ── Machine cell ──────────────────────────────────────────────────────────────
const MachineCellContent = memo(function MachineCellContent({
  machine, dark, rowBg,
}: { machine: Machine; dark: boolean; rowBg: string }) {
  const numColor   = dark ? '#e2e8f0' : '#172536';
  const brandColor = dark ? '#8899aa' : '#707884';
  return (
    <div style={{
      display: 'flex', alignItems: 'center', width: '100%', height: '100%',
      background: rowBg, borderTop: `3px solid ${ORANGE}`,
      padding: '0 10px', minHeight: 58,
    }}>
      <div style={{ flex: '0 0 52%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 46, fontWeight: 800, lineHeight: 1, color: numColor, letterSpacing: '-2px', fontVariantNumeric: 'tabular-nums' }}>
          {machine.mc_no}
        </span>
      </div>
      <div style={{ width: 2, height: '60%', background: ORANGE, borderRadius: 2, flexShrink: 0 }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3, paddingLeft: 10 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: brandColor, letterSpacing: '0.05em', textTransform: 'uppercase', lineHeight: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {machine.machine_type}
        </span>
        <span style={{ fontSize: 14, fontWeight: 700, color: ORANGE, letterSpacing: '0.02em', lineHeight: 1, whiteSpace: 'nowrap' }}>
          {machine.size_ton} TON
        </span>
      </div>
    </div>
  );
});

// ── Ghost card with confirm button ────────────────────────────────────────────
function GhostCard({
  order, dark, onConfirm,
}: { order: ProductionOrder; dark: boolean; onConfirm: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      {/* Ghost card */}
      <div style={{
        width: CARD_W, height: CARD_H,
        border: `1.5px dashed ${ORANGE}`,
        borderRadius: 6,
        background: dark ? 'rgba(243,101,35,0.08)' : 'rgba(243,101,35,0.06)',
        display: 'flex', flexDirection: 'column', justifyContent: 'center',
        padding: '3px 7px', gap: 3, boxSizing: 'border-box',
        boxShadow: `0 0 8px ${ORANGE}33`,
      }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: dark ? '#f97316' : '#ea580c', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {formatUncCodeForCard(order)}
        </div>
        <div style={{ fontSize: 8, color: dark ? '#fb923c' : '#f97316', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 4 }}>
          <span>{totalQty(order)}</span>
          <span style={{ opacity: 0.6 }}>· prev</span>
        </div>
      </div>
      {/* Confirm button */}
      <button
        onClick={e => { e.stopPropagation(); onConfirm(); }}
        style={{
          display: 'flex', alignItems: 'center', gap: 4,
          padding: '3px 10px', fontSize: 9, fontWeight: 800,
          background: ORANGE, color: '#fff', border: 'none', borderRadius: 5,
          cursor: 'pointer', letterSpacing: '0.05em', textTransform: 'uppercase',
          boxShadow: `0 2px 8px ${ORANGE}55`, whiteSpace: 'nowrap',
          transition: 'all 0.12s',
        }}
        onMouseEnter={e => (e.currentTarget.style.background = '#D4591A')}
        onMouseLeave={e => (e.currentTarget.style.background = ORANGE)}
      >
        <Check size={9} /> Confirm
      </button>
    </div>
  );
}

// ── Inline card ───────────────────────────────────────────────────────────────
interface InlineCardProps {
  order: ProductionOrder; dark: boolean; draggingId: string | null;
  onDragStart: (e: React.DragEvent, o: ProductionOrder) => void;
  onDragEnd: () => void;
  onClick: (o: ProductionOrder) => void;
  onContextMenu: (e: React.MouseEvent, o: ProductionOrder) => void;
}
const InlineCard = memo(function InlineCard({
  order, dark, draggingId, onDragStart, onDragEnd, onClick, onContextMenu,
}: InlineCardProps) {
  const [showTip, setShowTip] = useState(false);
  const tipTimer = useRef<ReturnType<typeof setTimeout>>();
  const colors = getPlanTypeColors(order, dark);
  const isDragging = draggingId === order.id;
  const lt = `${order.leadtime ?? 0}D${order.leadtime_hours ? ` ${order.leadtime_hours}H` : ''}`;

  return (
    <div
      draggable
      onDragStart={e => onDragStart(e, order)}
      onDragEnd={onDragEnd}
      onClick={() => onClick(order)}
      onContextMenu={e => onContextMenu(e, order)}
      onMouseEnter={() => { tipTimer.current = setTimeout(() => setShowTip(true), 500); }}
      onMouseLeave={() => { clearTimeout(tipTimer.current); setShowTip(false); }}
      style={{
        width: CARD_W, height: CARD_H, padding: '2px 6px', borderRadius: 6,
        boxSizing: 'border-box',
        background: colors.bg, border: `${dark ? '1.5px' : '1px'} solid ${colors.border}`,
        color: colors.text, opacity: isDragging ? 0.35 : 1,
        boxShadow: dark && colors.glow ? colors.glow : '0 1px 3px rgba(0,0,0,0.1)',
        cursor: 'grab', userSelect: 'none', WebkitUserDrag: 'element',
        display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 1,
        position: 'relative', transition: 'opacity 0.1s',
      } as React.CSSProperties}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: `1px solid ${colors.border}55`, paddingBottom: 1 }}>
        <span style={{ fontSize: 9, fontWeight: 900, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
          {formatUncCodeForCard(order)}
        </span>
        <span style={{ fontSize: 9.5, fontWeight: 700, flexShrink: 0, marginLeft: 4, opacity: 0.85 }}>
          {order.due_date ? formatBoardDate(order.due_date) : '—'}
        </span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 8.5 }}>
        <span style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{totalQty(order)}</span>
        <span style={{ fontWeight: 500, marginLeft: 4, flexShrink: 0, opacity: 0.75 }}>{lt}</span>
      </div>
      <div style={{ fontSize: 8, color: dark ? '#94a3b8' : '#6b7280', whiteSpace: 'nowrap' }}>
        Send Plan: {order.plan_issue_date ? formatBoardDate(order.plan_issue_date) : '—'}
      </div>
      {order.is_updated && (
        <div style={{ position: 'absolute', top: -4, right: -4, width: 8, height: 8, borderRadius: '50%', background: ORANGE, border: `1.5px solid ${dark ? '#070D1A' : '#fff'}`, boxShadow: `0 0 4px ${ORANGE}` }} />
      )}
      {showTip && (
        <div style={{ position: 'absolute', bottom: '100%', left: '50%', transform: 'translateX(-50%)', marginBottom: 8, width: 192, zIndex: 200, pointerEvents: 'none', background: dark ? '#0A1628' : '#fff', border: `1px solid ${dark ? 'rgba(30,58,138,0.5)' : '#e5e7eb'}`, borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.18)', color: dark ? '#f1f5f9' : '#1f2937' }}>
          <div style={{ padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: 4, fontSize: 10 }}>
            <div style={{ fontWeight: 700, color: ORANGE, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.order_id}</div>
            <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formatUncCodeForCard(order)}</div>
            <div style={{ display: 'flex', gap: 8, color: dark ? '#94a3b8' : '#6b7280' }}>
              <span>Qty: <b style={{ color: dark ? '#e2e8f0' : '#1f2937' }}>{totalQty(order)}</b></span>
              <span>LT: <b style={{ color: dark ? '#e2e8f0' : '#1f2937' }}>{lt}</b></span>
            </div>
            {order.due_date && <div style={{ color: dark ? '#94a3b8' : '#6b7280' }}>Due: <b>{formatCardDate(order.due_date)}</b></div>}
            {order.plan_issue_date && <div style={{ color: dark ? '#94a3b8' : '#6b7280' }}>Send Plan: <b>{formatCardDate(order.plan_issue_date)}</b></div>}
            {order.remark && <div style={{ fontStyle: 'italic', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{order.remark}</div>}
          </div>
          <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', borderWidth: 5, borderStyle: 'solid', borderColor: `${dark ? '#0A1628' : '#fff'} transparent transparent transparent` }} />
        </div>
      )}
    </div>
  );
});

// ── Drop cell (render only — drag events handled by td parent) ────────────────
interface DropCellProps {
  order: ProductionOrder | null; ghost: ProductionOrder | null;
  dark: boolean; draggingId: string | null; isTarget: boolean;
  onDragStart: (e: React.DragEvent, o: ProductionOrder) => void;
  onDragEnd: () => void;
  onClick: (o: ProductionOrder) => void;
  onContextMenu: (e: React.MouseEvent, o: ProductionOrder) => void;
  onConfirm: () => void;
}
const DropCell = memo(function DropCell({
  order, ghost, dark, draggingId, isTarget,
  onDragStart, onDragEnd, onClick, onContextMenu, onConfirm,
}: DropCellProps) {
  const showGhost = !!ghost;
  const hasOrder = !!order;
  const minH = showGhost ? CARD_H + 34 : CARD_H + 6;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: minH, gap: 0, position: 'relative' }}>
      {/* Ghost shown when slot is empty */}
      {showGhost && !hasOrder && (
        <GhostCard order={ghost!} dark={dark} onConfirm={onConfirm} />
      )}
      {/* Ghost overlay when slot has a real card too */}
      {showGhost && hasOrder && (
        <div style={{ position: 'absolute', top: 2, right: -18, zIndex: 15, pointerEvents: 'auto' }}>
          <button onClick={e => { e.stopPropagation(); onConfirm(); }} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '2px 7px', fontSize: 8, fontWeight: 800, background: ORANGE, color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', boxShadow: `0 1px 4px ${ORANGE}66` }}>
            <Check size={8} /> OK
          </button>
        </div>
      )}
      {/* Real card */}
      {hasOrder && (
        <InlineCard order={order!} dark={dark} draggingId={draggingId}
          onDragStart={onDragStart} onDragEnd={onDragEnd}
          onClick={onClick} onContextMenu={onContextMenu} />
      )}
      {/* Empty slot placeholder */}
      {!hasOrder && !showGhost && (
        <div style={{ width: CARD_W, height: CARD_H, borderRadius: 6, border: `1.5px dashed ${isTarget ? ORANGE : dark ? '#1e3a5f' : '#e2e8f0'}`, background: isTarget ? (dark ? '#0a1a30' : '#fff7ed') : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: isTarget ? ORANGE : 'transparent' }}>
          {isTarget ? 'Drop here' : ''}
        </div>
      )}
    </div>
  );
});

// ── Context menu ──────────────────────────────────────────────────────────────
interface CtxMenuProps {
  x: number; y: number; order: ProductionOrder;
  onDelete: () => void; onMoveToUnplanned: () => void; onEdit: () => void;
  onClose: () => void; canDel: boolean; canEd: boolean;
}
function CtxMenu({ x, y, order, onDelete, onMoveToUnplanned, onEdit, onClose, canDel, canEd }: CtxMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [onClose]);
  return (
    <div ref={ref} style={{ position: 'fixed', top: y, left: x, zIndex: 99999 }}
      className="bg-white dark:bg-[#0C1830] border border-gray-200 dark:border-blue-900/60 rounded-xl shadow-2xl overflow-hidden min-w-[180px] py-1">
      <div className="px-3 py-1.5 border-b border-gray-100 dark:border-blue-900/40">
        <div className="text-[10px] font-bold truncate" style={{ color: ORANGE }}>{order.order_id}</div>
        <div className="text-[10px] text-gray-500 truncate">{formatUncCodeForCard(order)}</div>
      </div>
      {canEd && <button onMouseDown={() => { onEdit(); onClose(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-blue-900/20 transition-colors"><Info size={13} /> Edit</button>}
      <button onMouseDown={() => { onMoveToUnplanned(); onClose(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-orange-50 dark:hover:bg-orange-900/10 transition-colors" style={{ color: ORANGE }}><MoveRight size={13} /> Move to Unplanned</button>
      {canDel && <button onMouseDown={() => { onDelete(); onClose(); }} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors"><Trash2 size={13} /> Delete</button>}
    </div>
  );
}

// ── Fullscreen mini-header ────────────────────────────────────────────────────
function FsHeader({ dark, onToggleDark, onExit }: { dark: boolean; onToggleDark: () => void; onExit: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', background: dark ? '#0A1628' : '#fff', borderBottom: `1px solid ${dark ? '#1a2a40' : '#e5e7eb'}`, padding: '0 20px', height: 48, flexShrink: 0, position: 'relative' }}>
      <div style={{ position: 'absolute', left: 20, display: 'flex', alignItems: 'center', gap: 10 }}>
        <img src={dark ? '/ChatGPT_Image_Jun_26,_2026,_01_21_02_PM.png' : '/Logo_UNC copy.png'} alt="UNC" style={{ height: dark ? 38 : 34, width: 'auto', objectFit: 'contain' }} />
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontWeight: 900, fontStyle: 'italic', fontSize: 13, color: dark ? '#fff' : '#111' }}>SMART</div>
          <div style={{ fontWeight: 900, fontStyle: 'italic', fontSize: 11, color: dark ? '#e2e8f0' : '#111' }}>PRODUCTION BOARD</div>
        </div>
      </div>
      <div style={{ fontWeight: 900, fontSize: 14, letterSpacing: '0.1em', textTransform: 'uppercase', color: dark ? '#f1f5f9' : '#1a1a1a' }}>
        Production Control Board
      </div>
      <div style={{ position: 'absolute', right: 20, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button onClick={onToggleDark} style={{ padding: '5px 8px', borderRadius: 8, border: `1px solid ${dark ? '#1e2d42' : '#e5e7eb'}`, background: dark ? '#1e2d42' : '#f8fafc', color: dark ? '#94a3b8' : '#6b7280', cursor: 'pointer', display: 'flex' }}>
          {dark ? <Sun size={14} /> : <Moon size={14} />}
        </button>
        <button onClick={onExit} style={{ padding: '5px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700, background: ORANGE, color: '#fff', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: `0 1px 6px ${ORANGE}66` }}>
          <Minimize2 size={12} /> Exit
        </button>
      </div>
    </div>
  );
}

// ── Arrow data ────────────────────────────────────────────────────────────────
interface ArrowData { id: string; path: string }

// ── Main component ────────────────────────────────────────────────────────────
export default function NextPlanBoard() {
  const { user } = useAuth();
  const dark = useIsDark();
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const [machines, setMachines] = useState<Machine[]>([]);
  const [orders, setOrders] = useState<ProductionOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sizeGroup, setSizeGroup] = useState<string | null>(null);
  const [planner, setPlanner] = useState('');
  const [zoom, setZoom] = useState(100);
  const [customZoomMode, setCustomZoomMode] = useState(false);
  const [customZoomStr, setCustomZoomStr] = useState('100');
  const [fullscreen, setFullscreen] = useState(false);
  const [draggingOrder, setDraggingOrder] = useState<ProductionOrder | null>(null);
  const [dropTarget, setDropTarget] = useState<{ machineId: string; slot: number } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; order: ProductionOrder } | null>(null);
  const [editOrder, setEditOrder] = useState<ProductionOrder | null>(null);
  const [isDarkLocal, setIsDarkLocal] = useState(dark);
  const [arrows, setArrows] = useState<ArrowData[]>([]);
  const [showArrows, setShowArrows] = useState(true);
  // Trigger re-layout on scroll
  const [scrollTick, setScrollTick] = useState(0);

  useEffect(() => { setIsDarkLocal(dark); }, [dark]);

  const toggleDark = useCallback(() => {
    const root = document.documentElement;
    const next = !root.classList.contains('dark');
    if (next) { root.classList.add('dark'); localStorage.setItem('theme', 'dark'); }
    else { root.classList.remove('dark'); localStorage.setItem('theme', 'light'); }
    setIsDarkLocal(next);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) containerRef.current?.requestFullscreen?.();
    else document.exitFullscreen?.();
  }, []);

  useEffect(() => {
    const handler = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [{ data: mData }, { data: oData }] = await Promise.all([
      supabase.from('machines').select('*').order('display_order'),
      supabase.from('production_orders').select('*')
        .eq('is_planned', true)
        .eq('is_finished', false)
        .order('x_offset', { nullsFirst: false }),
    ]);
    if (mData) setMachines(mData as Machine[]);
    if (oData) setOrders(oData as ProductionOrder[]);
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    const ch = supabase.channel('pcb-npb')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_orders' }, () => fetchData())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [fetchData]);

  // Trigger arrow re-layout on scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const h = () => setScrollTick(t => t + 1);
    el.addEventListener('scroll', h, { passive: true });
    return () => el.removeEventListener('scroll', h);
  }, []);

  const sizeSet = useMemo(() => {
    if (!sizeGroup) return null;
    const g = SIZE_GROUPS.find(g => g.label === sizeGroup);
    return g ? new Set<number>(g.sizes) : null;
  }, [sizeGroup]);

  const planners = useMemo(() => {
    const s = new Set(orders.map(o => o.created_by).filter(Boolean) as string[]);
    return Array.from(s).sort();
  }, [orders]);

  const filteredMachines = useMemo(() => {
    let result = machines;
    if (sizeSet) result = result.filter(m => sizeSet.has(m.size_ton));
    if (search.trim()) {
      const s = search.toLowerCase();
      const matchIds = new Set(
        orders.filter(o => [o.unc_code_1, o.unc_code_2, o.unc_code_3, o.unc_code_4, o.order_id]
          .some(v => v?.toLowerCase().includes(s))).map(o => o.machine_id).filter(Boolean) as string[]
      );
      result = result.filter(m => matchIds.has(m.id) || m.machine_type.toLowerCase().includes(s) || m.mc_no.toLowerCase().includes(s));
    }
    return result;
  }, [machines, sizeSet, orders, search]);

  const displayMachines = useMemo(() => {
    if (search.trim() || sizeGroup) return filteredMachines;
    const withOrders = new Set(orders.filter(o => o.machine_id).map(o => o.machine_id!));
    const withGhosts = new Set(
      orders.filter(o => o.is_updated && o.prev_machine_id && o.prev_machine_id !== o.machine_id)
        .map(o => o.prev_machine_id!)
    );
    return filteredMachines.filter(m => withOrders.has(m.id) || withGhosts.has(m.id));
  }, [filteredMachines, orders, search, sizeGroup]);

  const machineQueueMap = useMemo(() => {
    const map = new Map<string, ProductionOrder[]>();
    for (const m of machines) {
      const queue = orders
        .filter(o => o.machine_id === m.id && (planner === '' || o.created_by === planner))
        .sort((a, b) => {
          const xa = a.x_offset ?? 99999, xb = b.x_offset ?? 99999;
          if (xa !== xb) return xa - xb;
          return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        });
      map.set(m.id, queue);
    }
    return map;
  }, [machines, orders, planner]);

  // Ghost slot map: machineId:slot → order (cross-machine moves only)
  const ghostSlotMap = useMemo(() => {
    const map = new Map<string, ProductionOrder>();
    for (const o of orders) {
      if (!o.is_updated || !o.prev_machine_id || o.prev_slot_index === null) continue;
      if (o.prev_machine_id === o.machine_id) continue;
      map.set(`${o.prev_machine_id}:${o.prev_slot_index}`, o);
    }
    return map;
  }, [orders]);

  const movedOrders = useMemo(() =>
    orders.filter(o => o.is_updated && o.prev_machine_id && o.prev_machine_id !== o.machine_id && o.prev_slot_index !== null),
    [orders]
  );

  const counts = useMemo(() => {
    const machIds = new Set(filteredMachines.map(m => m.id));
    const assigned = orders.filter(o => o.machine_id && machIds.has(o.machine_id));
    return {
      total:  assigned.length,
      yellow: assigned.filter(o => o.plan_type === 'Yellow').length,
      white:  assigned.filter(o => o.plan_type !== 'Yellow').length,
    };
  }, [filteredMachines, orders]);

  // ── Arrow computation using column gap routing ────────────────────────────
  useLayoutEffect(() => {
    if (!scrollRef.current || !showArrows || movedOrders.length === 0) {
      setArrows([]);
      return;
    }
    const container = scrollRef.current;
    const cRect = container.getBoundingClientRect();

    function toSP(el: Element) {
      const r = el.getBoundingClientRect();
      return {
        left:   r.left - cRect.left + container.scrollLeft,
        top:    r.top  - cRect.top  + container.scrollTop,
        right:  r.right - cRect.left + container.scrollLeft,
        bottom: r.bottom - cRect.top + container.scrollTop,
        cx:     r.left - cRect.left + container.scrollLeft + r.width / 2,
        cy:     r.top  - cRect.top  + container.scrollTop  + r.height / 2,
        w: r.width, h: r.height,
      };
    }

    const newArrows: ArrowData[] = [];

    for (const order of movedOrders) {
      const prevSlot = order.prev_slot_index ?? 0;

      // Source (ghost) cell and destination cell
      const srcEl = container.querySelector(`[data-slot-key="${order.prev_machine_id}:${prevSlot}"]`);
      const currentQueue = machineQueueMap.get(order.machine_id!) ?? [];
      const queueIdx = currentQueue.findIndex(o => o.id === order.id);
      if (queueIdx < 0) continue;
      const currentSlot = queueIdx - 1;
      const dstEl = container.querySelector(`[data-slot-key="${order.machine_id}:${currentSlot}"]`);

      if (!srcEl || !dstEl) continue;

      const src = toSP(srcEl);
      const dst = toSP(dstEl);

      // ACTUAL row Y: use data-actual-slot attribute on ACTUAL row td
      const srcActualEl = container.querySelector(`[data-actual-slot="${order.prev_machine_id}:-1"]`);
      const dstActualEl = container.querySelector(`[data-actual-slot="${order.machine_id}:-1"]`);
      const srcRouteY = srcActualEl ? toSP(srcActualEl).cy : src.bottom + 12;
      const dstRouteY = dstActualEl ? toSP(dstActualEl).cy : dst.bottom + 12;

      // Find routing column X: gap between ghost slot and the slot to its right
      // This routes through the vertical column gap, not to the screen edge
      const gapSlotLeft = prevSlot; // the ghost's own slot
      const gapSlotRight = prevSlot < 9 ? prevSlot + 1 : prevSlot - 1; // next slot (or prev if last)
      const useRightSide = prevSlot < 9; // prefer gap to the right

      const leftEl = container.querySelector(`[data-slot-key="${order.prev_machine_id}:${gapSlotLeft}"]`);
      const rightEl = container.querySelector(`[data-slot-key="${useRightSide ? order.prev_machine_id : order.prev_machine_id}:${gapSlotRight}"]`);

      let routeX: number;
      if (leftEl && rightEl) {
        const lp = toSP(leftEl);
        const rp = toSP(rightEl);
        routeX = useRightSide
          ? (lp.right + rp.left) / 2   // gap to the right of ghost
          : (rp.right + lp.left) / 2;  // gap to the left of ghost
      } else if (leftEl) {
        const lp = toSP(leftEl);
        routeX = lp.right + 4;
      } else {
        routeX = src.right + 8;
      }

      // Ghost card anchor: bottom-center of ghost card within the src cell
      const ghostBotX = src.left + 5 + CARD_W / 2;  // card is padded 5px from cell left
      const ghostBotY = src.top  + 5 + CARD_H;       // card bottom = cell top + pad + card height

      // Dst card anchor: bottom-center of dst card
      const dstBotX = dst.left + 5 + CARD_W / 2;
      const dstBotY = dst.top  + 5 + CARD_H;

      // Path:
      // 1. Ghost card bottom → down to src ACTUAL row (routing lane, no cards here)
      // 2. Horizontal in ACTUAL row → to routing column gap
      // 3. Vertical through column gap → dst ACTUAL row
      // 4. Horizontal in dst ACTUAL row → dst card center
      // 5. Up into dst card
      const path = [
        `M ${ghostBotX},${ghostBotY}`,
        `V ${srcRouteY}`,     // go down into src ACTUAL row
        `H ${routeX}`,        // horizontal to routing column gap (in ACTUAL row, no card content)
        `V ${dstRouteY}`,     // vertical through column gap to dst ACTUAL row
        `H ${dstBotX}`,       // horizontal to dst card center (in ACTUAL row)
        `V ${dstBotY}`,       // go up to dst card bottom
      ].join(' ');

      newArrows.push({ id: order.id, path });
    }
    setArrows(newArrows);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movedOrders, machineQueueMap, showArrows, scrollTick, orders]);

  // ── Drag & Drop ──────────────────────────────────────────────────────────
  function handleDragStart(e: React.DragEvent, order: ProductionOrder) {
    setDraggingOrder(order);
    e.dataTransfer.effectAllowed = 'move';
  }
  function handleDragEnd() { setDraggingOrder(null); setDropTarget(null); }
  function handleDragOver(machineId: string, slot: number) {
    setDropTarget({ machineId, slot });
  }

  async function handleDrop(machineId: string, slotIdx: number, e: React.DragEvent) {
    e.stopPropagation(); // prevent double-fire from td+DropCell bubble
    if (!draggingOrder) return;

    const prevMachineId = draggingOrder.machine_id!;
    const currentQueue = machineQueueMap.get(prevMachineId) ?? [];
    const currentQueueIdx = currentQueue.findIndex(o => o.id === draggingOrder.id);
    const currentSlot = currentQueueIdx - 1;

    setDraggingOrder(null); setDropTarget(null);

    if (machineId === prevMachineId) {
      // ── Within-machine reorder ──────────────────────────────────────────
      const targetQueueIdx = slotIdx === -1 ? 0 : slotIdx + 1;
      if (currentQueueIdx < 0 || currentQueueIdx === targetQueueIdx) return;

      const newQueue = currentQueue.filter(o => o.id !== draggingOrder.id);
      const insertAt = Math.min(slotIdx === -1 ? 0 : slotIdx + 1, newQueue.length);
      newQueue.splice(insertAt, 0, draggingOrder);

      // Reassign x_offsets sequentially to reflect new order
      const batchUpdates = newQueue.map((o, i) => ({ id: o.id, x_offset: (i + 1) * 100 }));
      for (const u of batchUpdates) {
        await supabase.from('production_orders').update({ x_offset: u.x_offset }).eq('id', u.id);
      }
      fetchData();
      return;
    }

    // ── Cross-machine move — record prev position for ghost/arrow ──────────
    await supabase.from('production_orders').update({
      machine_id: machineId,
      prev_machine_id: prevMachineId,
      prev_slot_index: currentSlot,
      is_updated: true,
    }).eq('id', draggingOrder.id);
    fetchData();
  }

  async function handleConfirmMove(orderId: string) {
    await supabase.from('production_orders').update({
      is_updated: false,
      prev_machine_id: null,
      prev_slot_index: null,
    }).eq('id', orderId);
    fetchData();
  }

  async function handleMoveToUnplanned() {
    if (!contextMenu) return;
    await supabase.from('production_orders')
      .update({ machine_id: null, x_offset: null, is_planned: false })
      .eq('id', contextMenu.order.id);
    fetchData();
  }

  async function handleDelete() {
    if (!contextMenu) return;
    if (!confirm(`Delete ${contextMenu.order.order_id}?`)) return;
    await supabase.from('production_orders').delete().eq('id', contextMenu.order.id);
    if (user) await logOrderDelete(contextMenu.order, user.username);
    fetchData();
  }

  async function handleClearAllMoves() {
    const ids = movedOrders.map(o => o.id);
    if (!ids.length) return;
    await supabase.from('production_orders').update({
      is_updated: false, prev_machine_id: null, prev_slot_index: null,
    }).in('id', ids);
    fetchData();
  }

  const canDel = user ? canDelete(user.role) : false;
  const canEd  = user ? canEdit(user.role) : false;

  const hdrBg = isDarkLocal ? '#111827' : '#1F2937';
  const rowDiv = `1px solid ${isDarkLocal ? '#1a2a40' : '#e5e7eb'}`;
  const colDiv = `1px solid ${isDarkLocal ? '#1e2d42' : '#f1f5f9'}`;
  const frozenBorderR = `2px solid ${ORANGE}`;
  const nowPlanBg = isDarkLocal ? '#070f1c' : '#fdf7f4';
  const pageBase  = isDarkLocal ? '#070D1A' : '#ffffff';
  const pageAlt   = isDarkLocal ? '#08101E' : '#f8fafc';

  const thStyle = (extra: React.CSSProperties = {}): React.CSSProperties => ({
    background: hdrBg, fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
    textTransform: 'uppercase', color: '#e2e8f0', whiteSpace: 'nowrap', ...extra,
  });

  const LEFT_STS = MC_W;
  const LEFT_NOW = MC_W + STS_W;
  const LEFT_PCS = MC_W + STS_W + NOW_W;

  return (
    <div
      ref={containerRef}
      style={fullscreen
        ? { position: 'fixed', top: 0, bottom: 0, left: 24, right: 24, zIndex: 9999, borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: isDarkLocal ? '#070D1A' : '#fff', boxShadow: '0 8px 40px rgba(0,0,0,0.35)' }
        : { flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', borderRadius: 16, border: `1px solid ${isDarkLocal ? 'rgba(30,58,138,0.3)' : '#e5e7eb'}`, boxShadow: '0 1px 4px rgba(0,0,0,0.06)', background: isDarkLocal ? '#070D1A' : '#fff' }
      }
    >
      {fullscreen && <FsHeader dark={isDarkLocal} onToggleDark={toggleDark} onExit={() => document.exitFullscreen?.()} />}

      {!fullscreen && (
        <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap', flexShrink: 0, borderBottom: `1px solid ${isDarkLocal ? '#1a2a40' : '#e5e7eb'}`, background: isDarkLocal ? 'linear-gradient(90deg,#0A1628,#0C1830)' : 'linear-gradient(90deg,#fff8f4,#fff)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 3, height: 28, borderRadius: 9, background: ORANGE }} />
            <h2 style={{ fontSize: 15, fontWeight: 900, letterSpacing: '0.06em', textTransform: 'uppercase', color: isDarkLocal ? '#f1f5f9' : '#1a1a1a', margin: 0 }}>
              Production Control Board
            </h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11 }}>
            {[
              { label: 'Total Plan', val: counts.total, dotBg: ORANGE, cardBg: isDarkLocal ? '#1e293b40' : '#fff', border: isDarkLocal ? '#4b5563' : '#d1d5db', textColor: isDarkLocal ? '#e2e8f0' : '#374151' },
            ].map(b => (
              <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 8, border: `1px solid ${b.border}`, background: b.cardBg, color: b.textColor, fontWeight: 600 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: b.dotBg, flexShrink: 0 }} />
                {b.label}
                <span style={{ background: b.dotBg, color: '#fff', borderRadius: 999, padding: '1px 6px', fontSize: 9, fontWeight: 700 }}>{b.val}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '6px 16px', flexShrink: 0, borderBottom: `1px solid ${isDarkLocal ? 'rgba(30,58,138,0.4)' : '#e5e7eb'}`, background: isDarkLocal ? '#0A1628' : '#fff' }}>
        {/* Search */}
        <div style={{ position: 'relative' }}>
          <Search size={12} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search UNC..."
            style={{ paddingLeft: 28, paddingRight: 28, paddingTop: 6, paddingBottom: 6, fontSize: 12, border: `1px solid ${isDarkLocal ? 'rgba(30,58,138,0.5)' : '#e5e7eb'}`, borderRadius: 8, background: isDarkLocal ? '#0C1830' : '#fff', color: isDarkLocal ? '#f1f5f9' : '#1f2937', outline: 'none', width: 160 }} />
          {search && <button onClick={() => setSearch('')} style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#9ca3af', padding: 0 }}><X size={12} /></button>}
        </div>

        {/* Size group filter */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <SlidersHorizontal size={12} style={{ color: '#9ca3af' }} />
          <div style={{ display: 'flex', gap: 4 }}>
            {[null, ...SIZE_GROUPS.map(g => g.label)].map((g, i) => (
              <button key={i} onClick={() => setSizeGroup(g as string | null)} style={{ padding: '4px 10px', borderRadius: 8, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: sizeGroup === g ? ORANGE : isDarkLocal ? '#1e293b' : '#f1f5f9', color: sizeGroup === g ? '#fff' : isDarkLocal ? '#94a3b8' : '#64748b' }}>{g ?? 'All'}</button>
            ))}
          </div>
        </div>

        {planners.length > 0 && (
          <select value={planner} onChange={e => setPlanner(e.target.value)} style={{ padding: '5px 12px', fontSize: 12, border: `1px solid ${isDarkLocal ? 'rgba(30,58,138,0.5)' : '#e5e7eb'}`, borderRadius: 8, background: isDarkLocal ? '#0C1830' : '#fff', color: isDarkLocal ? '#e2e8f0' : '#374151', outline: 'none', cursor: 'pointer' }}>
            <option value="">All Planners</option>
            {planners.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}

        {fullscreen && counts.total > 0 && (
          <span style={{ padding: '3px 10px', borderRadius: 8, border: `1px solid ${isDarkLocal ? '#4b5563' : '#d1d5db'}`, background: isDarkLocal ? '#1e293b40' : '#fff', color: isDarkLocal ? '#e2e8f0' : '#374151', fontWeight: 600, fontSize: 11, display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: ORANGE }} />
            Total: {counts.total}
          </span>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {movedOrders.length > 0 && (
            <>
              <button onClick={() => setShowArrows(v => !v)} style={{ padding: '5px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, border: `1px solid ${showArrows ? ORANGE : isDarkLocal ? '#374151' : '#d1d5db'}`, background: showArrows ? `${ORANGE}18` : 'transparent', color: showArrows ? ORANGE : isDarkLocal ? '#9ca3af' : '#64748b', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: ORANGE }} />
                Moved ({movedOrders.length})
              </button>
              <button onClick={handleClearAllMoves} title="Confirm all moves" style={{ padding: '5px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600, border: `1px solid ${isDarkLocal ? '#374151' : '#d1d5db'}`, background: 'transparent', color: isDarkLocal ? '#9ca3af' : '#6b7280', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                <RotateCcw size={11} /> Clear All
              </button>
            </>
          )}
          <div style={{ width: 1, height: 16, background: isDarkLocal ? '#374151' : '#e5e7eb' }} />
          <ZoomIn size={12} style={{ color: '#9ca3af' }} />
          <select value={customZoomMode ? 'custom' : zoom} onChange={e => { if (e.target.value === 'custom') { setCustomZoomMode(true); setCustomZoomStr(String(zoom)); } else { setCustomZoomMode(false); setZoom(Number(e.target.value)); } }} style={{ border: `1px solid ${isDarkLocal ? 'rgba(30,58,138,0.5)' : '#e5e7eb'}`, borderRadius: 6, fontSize: 11, fontWeight: 700, padding: '3px 4px', background: isDarkLocal ? '#0C1830' : '#fff', color: isDarkLocal ? '#e2e8f0' : '#374151', outline: 'none', cursor: 'pointer' }}>
            {ZOOM_PRESETS.map(v => <option key={v} value={v}>{v}%</option>)}
            <option value="custom">{customZoomMode ? `${zoom}%` : 'Custom...'}</option>
          </select>
          {customZoomMode && (
            <div style={{ display: 'flex', alignItems: 'center', borderRadius: 8, overflow: 'hidden', border: `1px solid ${ORANGE}` }}>
              <input autoFocus type="number" min={25} max={300} value={customZoomStr}
                onChange={e => { setCustomZoomStr(e.target.value); setZoom(Math.min(300, Math.max(25, Number(e.target.value) || 25))); }}
                onKeyDown={e => { if (e.key === 'Escape' || e.key === 'Enter') setCustomZoomMode(false); }}
                style={{ width: 52, padding: '3px 6px', fontSize: 11, fontWeight: 700, background: isDarkLocal ? '#0C1830' : '#fff', color: isDarkLocal ? '#e2e8f0' : '#374151', border: 'none', outline: 'none' }} />
              <button onClick={() => setCustomZoomMode(false)} style={{ padding: '3px 6px', fontSize: 10, background: isDarkLocal ? '#1e293b' : '#f1f5f9', color: '#9ca3af', border: 'none', cursor: 'pointer' }}>✕</button>
            </div>
          )}
          <div style={{ width: 1, height: 16, background: isDarkLocal ? '#374151' : '#e5e7eb' }} />
          <button onClick={fetchData} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 10px', fontSize: 12, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: `1px solid ${isDarkLocal ? '#374151' : '#e5e7eb'}`, background: isDarkLocal ? '#1e293b80' : '#f8fafc', color: isDarkLocal ? '#94a3b8' : '#4b5563', opacity: loading ? 0.5 : 1 }}>
            <RefreshCw size={12} style={{ animation: loading ? 'spin 0.7s linear infinite' : 'none' }} /> Refresh
          </button>
          {!fullscreen && (
            <button onClick={toggleFullscreen} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', fontSize: 12, fontWeight: 700, borderRadius: 8, cursor: 'pointer', background: ORANGE, color: '#fff', border: 'none', boxShadow: `0 1px 6px ${ORANGE}66` }}>
              <Maximize2 size={12} /> Full Screen
            </button>
          )}
        </div>
      </div>

      {/* ── Scrollable table with SVG arrow overlay ── */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', zoom: zoom / 100, isolation: 'isolate', position: 'relative' }}>
        {loading && orders.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 120 }}>
            <div style={{ width: 24, height: 24, border: `2px solid ${ORANGE}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
          </div>
        ) : (
          <>
            {/* SVG arrow overlay — absolute inside scroll container */}
            {showArrows && arrows.length > 0 && (
              <svg
                style={{
                  position: 'absolute', top: 0, left: 0,
                  width: `${FROZEN_W + ORDER_SLOTS * (CARD_W + 8) + 80}px`,
                  minHeight: '100%',
                  pointerEvents: 'none', zIndex: 20, overflow: 'visible',
                }}
              >
                <defs>
                  <marker id="npb-ah" markerWidth="7" markerHeight="5" refX="6" refY="2.5" orient="auto">
                    <polygon points="0 0, 7 2.5, 0 5" fill={ORANGE} />
                  </marker>
                </defs>
                {arrows.map(a => (
                  <path key={a.id} d={a.path}
                    stroke={ORANGE} strokeWidth="2" fill="none"
                    strokeDasharray="6 3" markerEnd="url(#npb-ah)" opacity={0.9} />
                ))}
              </svg>
            )}

            <table style={{ borderCollapse: 'collapse', minWidth: FROZEN_W + ORDER_SLOTS * (CARD_W + 8) }}>
              <thead>
                <tr>
                  <th rowSpan={2} style={thStyle({ position: 'sticky', top: 0, left: 0, zIndex: 50, width: MC_W, minWidth: MC_W, borderRight: rowDiv, borderBottom: `2px solid ${ORANGE}`, textAlign: 'center', padding: '0 6px' })}>Machine</th>
                  <th rowSpan={2} style={thStyle({ position: 'sticky', top: 0, left: LEFT_STS, zIndex: 50, width: STS_W, minWidth: STS_W, borderRight: rowDiv, borderBottom: `2px solid ${ORANGE}`, textAlign: 'left', padding: '0 8px' })}>Status</th>
                  <th rowSpan={2} style={thStyle({ position: 'sticky', top: 0, left: LEFT_NOW, zIndex: 50, width: NOW_W, minWidth: NOW_W, borderRight: rowDiv, borderBottom: `2px solid ${ORANGE}`, textAlign: 'center', padding: '0 6px' })}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: ORANGE, display: 'inline-block' }} /> Now Plan
                    </span>
                  </th>
                  <th rowSpan={2} style={thStyle({ position: 'sticky', top: 0, left: LEFT_PCS, zIndex: 50, width: PCS_W, minWidth: PCS_W, borderRight: frozenBorderR, borderBottom: `2px solid ${ORANGE}`, textAlign: 'center', padding: '0 4px' })}>Pcs/Hr</th>
                  <th colSpan={ORDER_SLOTS} style={thStyle({ position: 'sticky', top: 0, zIndex: 30, height: HDR1_H, textAlign: 'center', padding: '0 8px', borderBottom: '1px solid #374151', color: '#fb923c', fontSize: 11, fontWeight: 900, letterSpacing: '0.15em' })}>Next Plan</th>
                </tr>
                <tr>
                  {Array.from({ length: ORDER_SLOTS }, (_, i) => (
                    <th key={i} style={thStyle({ position: 'sticky', top: HDR1_H, zIndex: 30, width: CARD_W + 8, minWidth: CARD_W + 8, height: HDR2_H, textAlign: 'center', padding: '0 4px', borderRight: i < ORDER_SLOTS - 1 ? '1px solid #374151' : 'none', borderBottom: `2px solid ${ORANGE}` })}>Order {i + 1}</th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {displayMachines.length === 0 ? (
                  <tr>
                    <td colSpan={4 + ORDER_SLOTS} style={{ padding: '48px 0', textAlign: 'center', color: isDarkLocal ? '#4b5563' : '#9ca3af', fontSize: 14 }}>
                      No machines with planned orders
                    </td>
                  </tr>
                ) : displayMachines.map((machine, idx) => {
                  const queue = machineQueueMap.get(machine.id) ?? [];
                  const nowPlan = queue[0] ?? null;
                  const slots = Array.from({ length: ORDER_SLOTS }, (_, i) => queue[i + 1] ?? null);
                  const rowBg = idx % 2 === 0 ? pageBase : pageAlt;
                  const nowGhost  = ghostSlotMap.get(`${machine.id}:-1`) ?? null;
                  const slotGhosts = Array.from({ length: ORDER_SLOTS }, (_, i) => ghostSlotMap.get(`${machine.id}:${i}`) ?? null);

                  return (
                    <React.Fragment key={machine.id}>
                      {/* PLAN row */}
                      <tr style={{ borderTop: `2px solid ${isDarkLocal ? '#1a2a40' : '#e5e7eb'}` }}>
                        <td rowSpan={2} style={{ position: 'sticky', left: 0, zIndex: 10, width: MC_W, minWidth: MC_W, borderRight: rowDiv, background: rowBg, padding: 0, verticalAlign: 'middle' }}>
                          <MachineCellContent machine={machine} dark={isDarkLocal} rowBg={rowBg} />
                        </td>
                        <td rowSpan={2} style={{ position: 'sticky', left: LEFT_STS, zIndex: 10, width: STS_W, minWidth: STS_W, background: rowBg, borderRight: rowDiv }} />

                        {/* Now Plan */}
                        <td data-slot-key={`${machine.id}:-1`}
                          style={{ position: 'sticky', left: LEFT_NOW, zIndex: 10, width: NOW_W, padding: '5px 6px 0', background: nowPlanBg, borderRight: rowDiv }}
                          onDragOver={e => { e.preventDefault(); handleDragOver(machine.id, -1); }}
                          onDrop={e => handleDrop(machine.id, -1, e)}>
                          <DropCell order={nowPlan} ghost={nowGhost} dark={isDarkLocal}
                            draggingId={draggingOrder?.id ?? null}
                            isTarget={dropTarget?.machineId === machine.id && dropTarget?.slot === -1}
                            onDragStart={handleDragStart} onDragEnd={handleDragEnd}
                            onClick={o => setEditOrder(o)}
                            onContextMenu={(e, o) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, order: o }); }}
                            onConfirm={() => handleConfirmMove(nowGhost!.id)} />
                        </td>

                        {/* Pcs/Hr */}
                        <td style={{ position: 'sticky', left: LEFT_PCS, zIndex: 10, width: PCS_W, textAlign: 'center', padding: '5px 4px 0', background: rowBg, borderRight: frozenBorderR }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: CARD_H }}>
                            <span style={{ width: 64, height: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 7, fontSize: 10, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#fff', background: ORANGE, boxShadow: `0 2px 8px ${ORANGE}55` }}>PLAN</span>
                          </div>
                        </td>

                        {/* Order slots 1–10 */}
                        {slots.map((order, i) => (
                          <td key={i}
                            data-slot-key={`${machine.id}:${i}`}
                            style={{ width: CARD_W + 8, padding: '5px 5px 0', borderRight: i < ORDER_SLOTS - 1 ? colDiv : 'none', background: rowBg }}
                            onDragOver={e => { e.preventDefault(); handleDragOver(machine.id, i); }}
                            onDrop={e => handleDrop(machine.id, i, e)}>
                            <DropCell order={order} ghost={slotGhosts[i]} dark={isDarkLocal}
                              draggingId={draggingOrder?.id ?? null}
                              isTarget={dropTarget?.machineId === machine.id && dropTarget?.slot === i}
                              onDragStart={handleDragStart} onDragEnd={handleDragEnd}
                              onClick={o => setEditOrder(o)}
                              onContextMenu={(e, o) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY, order: o }); }}
                              onConfirm={() => handleConfirmMove(slotGhosts[i]!.id)} />
                          </td>
                        ))}
                      </tr>

                      {/* ACTUAL row — used as routing lane for arrows */}
                      <tr style={{ borderBottom: `2px solid ${isDarkLocal ? '#1a2a40' : '#e5e7eb'}` }}>
                        <td data-actual-slot={`${machine.id}:-1`}
                          style={{ position: 'sticky', left: LEFT_NOW, zIndex: 10, background: nowPlanBg, padding: '0 6px 5px', borderRight: rowDiv }}>
                          <div style={{ height: 20 }} />
                        </td>
                        <td style={{ position: 'sticky', left: LEFT_PCS, zIndex: 10, textAlign: 'center', padding: '0 4px 5px', background: rowBg, borderRight: frozenBorderR }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 20 }}>
                            <span style={{ width: 64, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 6, fontSize: 10, fontWeight: 900, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#fff', background: isDarkLocal ? '#166534' : '#16a34a' }}>ACTUAL</span>
                          </div>
                        </td>
                        {Array.from({ length: ORDER_SLOTS }, (_, i) => (
                          <td key={i} style={{ padding: '0 5px 5px', borderRight: i < ORDER_SLOTS - 1 ? colDiv : 'none', background: rowBg }}>
                            <div style={{ height: 20 }} />
                          </td>
                        ))}
                      </tr>
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* Footer */}
      <div style={{ padding: '5px 16px', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, borderTop: `1px solid ${isDarkLocal ? 'rgba(30,58,138,0.2)' : '#f1f5f9'}`, background: isDarkLocal ? '#070910' : '#fafafa' }}>
        <Info size={10} style={{ color: '#9ca3af', flexShrink: 0 }} />
        <span style={{ fontSize: 10, color: isDarkLocal ? '#374151' : '#9ca3af' }}>
          Planned · Drag to reassign machine or reorder within machine · Orange ghost = moved · Click Confirm to acknowledge move
        </span>
      </div>

      {contextMenu && (
        <CtxMenu x={contextMenu.x} y={contextMenu.y} order={contextMenu.order}
          onDelete={handleDelete} onMoveToUnplanned={handleMoveToUnplanned}
          onEdit={() => setEditOrder(contextMenu.order)}
          onClose={() => setContextMenu(null)} canDel={canDel} canEd={canEd} />
      )}

      {editOrder && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)', padding: 16 }}
          onClick={() => setEditOrder(null)}>
          <div style={{ width: '100%', maxWidth: 576, maxHeight: '90vh', display: 'flex', flexDirection: 'column', borderRadius: 16, overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}
            onClick={e => e.stopPropagation()}>
            <ProductionForm editOrder={editOrder} onSaved={() => { setEditOrder(null); fetchData(); }} onCancel={() => setEditOrder(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
