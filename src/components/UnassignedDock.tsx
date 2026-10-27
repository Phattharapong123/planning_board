import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Package, ArrowUpToLine, GripHorizontal, ChevronUp, ChevronDown, Pencil, Trash2, CalendarDays } from 'lucide-react';
import type { ProductionOrder } from '../types';
import PlanCard from './PlanCard';

const MIN_HEIGHT = 68;
const MAX_HEIGHT = 300;
const COLLAPSED_HEIGHT = 28;
const CARD_H_PX = 58;
const CARD_W_PX = 96; // 1.0in
// Overhead: resize-handle(16) + header(~36) + pb(8) ≈ 60px
const TWO_ROW_THRESHOLD   = 60 + CARD_H_PX * 2 + 8;    // ~184px
const THREE_ROW_THRESHOLD = 60 + CARD_H_PX * 3 + 8 * 2; // ~250px

interface CardActions {
  canEditCard: (o: ProductionOrder) => boolean;
  canConfirmCards: boolean;
  canPlanCards: boolean;
  canDeleteCard: (o: ProductionOrder) => boolean;
  canFinishCards: boolean;
  onEdit: (o: ProductionOrder) => void;
  onConfirm: (o: ProductionOrder) => void;
  onPlan: (o: ProductionOrder) => void;
  onEditPlanDate: (o: ProductionOrder) => void;
  onUnplan: (o: ProductionOrder) => void;
  onDelete: (o: ProductionOrder) => void;
  onFinish: (o: ProductionOrder) => void;
  onPrint: (o: ProductionOrder) => void;
}

interface Props extends CardActions {
  orders: ProductionOrder[];
  draggingId: string | null;
  searchText: string;
  dockHeight: number;
  isDark?: boolean;
  highlightedId?: string | null;
  onHeightChange: (h: number) => void;
  onCardDragStart: (e: React.DragEvent, order: ProductionOrder) => void;
  onCardDragEnd: () => void;
  onDockDrop: (e: React.DragEvent) => void;
}

// ── UserFilter — custom dropdown for creator filtering ────────────────────────
function UserFilter({ creators, value, onChange }: { creators: string[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const h = () => setOpen(false);
    const t = setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => { clearTimeout(t); document.removeEventListener('mousedown', h); };
  }, [open]);

  function handleToggle() {
    if (!open && btnRef.current) setRect(btnRef.current.getBoundingClientRect());
    setOpen(v => !v);
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={handleToggle}
        className="flex items-center gap-1 text-[10px] font-semibold bg-white/10 hover:bg-white/20 text-gray-200 border border-white/20 hover:border-brand-orange/60 rounded-md px-2 py-0.5 transition-colors"
      >
        {value === 'All' ? 'All Users' : value}
        <ChevronDown size={8} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && rect && createPortal(
        <div
          style={{
            position: 'fixed',
            bottom: window.innerHeight - rect.top + 4,
            left: rect.left,
            zIndex: 999999,
          }}
          className="bg-[#0C1830] border border-blue-900/60 rounded-lg shadow-2xl overflow-hidden min-w-[130px]"
          onMouseDown={e => e.stopPropagation()}
        >
          {(['All', ...creators] as string[]).map(c => (
            <button
              key={c}
              onMouseDown={() => { onChange(c); setOpen(false); }}
              className={`w-full text-left px-3 py-1.5 text-[10px] font-medium flex items-center justify-between gap-2 transition-colors ${
                value === c
                  ? 'bg-brand-orange/20 text-brand-orange font-bold'
                  : 'text-gray-200 hover:bg-white/10 hover:text-white'
              }`}
            >
              {c === 'All' ? 'All Users' : c}
              {value === c && <span className="text-brand-orange text-[9px]">✓</span>}
            </button>
          ))}
        </div>,
        document.body
      )}
    </>
  );
}

// ── DockFloatingCard — portal zoom+menu for cards in Unplanned bar ────────────
function DockFloatingCard({
  order, isDark, actions,
  onDragStart, onDragEnd, isDragging,
}: {
  order: ProductionOrder;
  isDark: boolean;
  actions: CardActions;
  onDragStart: (e: React.DragEvent, o: ProductionOrder) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [cardRect, setCardRect] = useState<DOMRect | null>(null);
  const [animReady, setAnimReady] = useState(false);
  const origRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (expanded) {
      const t = requestAnimationFrame(() => setAnimReady(true));
      return () => cancelAnimationFrame(t);
    } else {
      setAnimReady(false);
    }
  }, [expanded]);

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation();
    if (!expanded && origRef.current) {
      setCardRect(origRef.current.getBoundingClientRect());
    }
    setExpanded(v => !v);
  }

  // Portal card position: bottom-center aligned to original, scaled 1.5×
  const expandScale = 1.5;
  const portalCardTop  = cardRect ? cardRect.top  + CARD_H_PX - CARD_H_PX : 0;
  const portalCardLeft = cardRect ? cardRect.left + CARD_W_PX / 2 - CARD_W_PX / 2 : 0;
  const scaledCenterX  = cardRect ? cardRect.left + CARD_W_PX / 2 : 0;
  const scaledTopY     = cardRect ? cardRect.top  + CARD_H_PX - CARD_H_PX * expandScale : 0;

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
          transform: animReady ? `scale(${expandScale})` : 'scale(1)',
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
      {/* Action buttons above scaled card */}
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
        {actions.canEditCard(order) && (
          <button onMouseDown={e => { e.stopPropagation(); actions.onEdit(order); setExpanded(false); }} style={btnStyle('#F36B21')}>
            <Pencil size={9} /> Edit
          </button>
        )}
        {actions.canPlanCards && !order.urgent && (
          order.is_planned
            ? <button onMouseDown={e => { e.stopPropagation(); actions.onUnplan(order); setExpanded(false); }} style={btnStyle('#6B7280')}>↩ UNPLAN</button>
            : <button onMouseDown={e => { e.stopPropagation(); actions.onPlan(order); setExpanded(false); }} style={btnStyle('#0F766E')}>✓ PLAN</button>
        )}
        {actions.canPlanCards && (
          <button onMouseDown={e => { e.stopPropagation(); actions.onEditPlanDate(order); setExpanded(false); }} style={btnStyle('#0F766E')}>
            <CalendarDays size={9} /> {order.plan_issue_date ? 'Edit Date' : 'Set Date'}
          </button>
        )}
        {actions.canFinishCards && (
          <button onMouseDown={e => { e.stopPropagation(); actions.onFinish(order); setExpanded(false); }} style={btnStyle('#1D4ED8')}>✓ FINISHED</button>
        )}
        {actions.canFinishCards && !order.is_planned && (
          <button onMouseDown={e => { e.stopPropagation(); actions.onPrint(order); setExpanded(false); }} style={btnStyle(order.is_printed ? '#6B7280' : '#7C3AED')}>
            {order.is_printed ? 'Cancel P' : 'Press P'}
          </button>
        )}
        {actions.canDeleteCard(order) && (
          <button onMouseDown={e => { e.stopPropagation(); actions.onDelete(order); setExpanded(false); }} style={btnStyle('#DC2626')}>
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
      <div ref={origRef} style={{ opacity: isDragging ? 0 : 1 }}>
        <div onClick={handleClick} style={{ cursor: 'pointer' }}>
          <PlanCard
            order={order}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            isDragging={isDragging}
            isDark={isDark}
          />
        </div>
      </div>
      {portalContent}
    </>
  );
}

// ── UnassignedDock ────────────────────────────────────────────────────────────
export default function UnassignedDock({
  orders, draggingId, searchText, dockHeight, isDark = false,
  highlightedId = null,
  onHeightChange, onCardDragStart, onCardDragEnd, onDockDrop,
  canEditCard, canConfirmCards, canPlanCards, canDeleteCard, canFinishCards,
  onEdit, onConfirm, onPlan, onEditPlanDate, onUnplan, onDelete, onFinish, onPrint,
}: Props) {
  const [dropHover, setDropHover]       = useState(false);
  const [manualExpanded, setManualExpanded] = useState(false);
  const [filterUser, setFilterUser]     = useState('All');
  const dragStartY = useRef<number | null>(null);
  const dragStartH = useRef<number>(dockHeight);
  const prevOrderCount = useRef(orders.length);
  const cardsAreaRef = useRef<HTMLDivElement>(null);

  const isReturnDrag = draggingId !== null && orders.every(o => o.id !== draggingId);

  // Auto-scroll to highlighted card in dock
  useEffect(() => {
    if (!highlightedId || !cardsAreaRef.current) return;
    const scrollable = cardsAreaRef.current.querySelector('.dock-scroll') as HTMLElement;
    const el = cardsAreaRef.current.querySelector(`[data-card-id="${highlightedId}"]`) as HTMLElement;
    if (el && scrollable) {
      const elLeft = el.offsetLeft;
      const elWidth = el.offsetWidth;
      const containerWidth = scrollable.clientWidth;
      scrollable.scrollTo({ left: Math.max(0, elLeft - containerWidth / 2 + elWidth / 2), behavior: 'smooth' });
    }
  }, [highlightedId]);

  useEffect(() => {
    if (prevOrderCount.current === 0 && orders.length > 0) {
      setManualExpanded(false);
    }
    prevOrderCount.current = orders.length;
  }, [orders.length]);

  const isCollapsed = orders.length === 0 && !isReturnDrag && !manualExpanded;

  function matchesSearch(o: ProductionOrder): boolean {
    if (!searchText.trim()) return true;
    const s = searchText.toLowerCase();
    return [o.unc_code_1, o.unc_code_2, o.unc_code_3, o.unc_code_4, o.order_id]
      .some(v => v?.toLowerCase().includes(s));
  }

  const creators = useMemo(() => {
    const set = new Set(orders.map(o => o.created_by).filter(Boolean) as string[]);
    return Array.from(set).sort();
  }, [orders]);

  const visibleOrders = useMemo(() => {
    if (filterUser === 'All') return orders;
    return orders.filter(o => o.created_by === filterUser);
  }, [orders, filterUser]);

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragStartY.current = e.clientY;
    dragStartH.current = dockHeight;

    function onMove(mv: MouseEvent) {
      if (dragStartY.current === null) return;
      const delta = dragStartY.current - mv.clientY;
      const newH = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, dragStartH.current + delta));
      onHeightChange(newH);
    }
    function onUp() {
      dragStartY.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [dockHeight, onHeightChange]);

  const effectiveHeight = isCollapsed ? COLLAPSED_HEIGHT : dockHeight;

  // Multi-row layout when dock is tall enough
  const rowCount = !isCollapsed && dockHeight >= THREE_ROW_THRESHOLD ? 3
                 : !isCollapsed && dockHeight >= TWO_ROW_THRESHOLD   ? 2
                 : 1;
  const multiRow = rowCount > 1;

  const actions: CardActions = {
    canEditCard, canConfirmCards, canPlanCards, canDeleteCard, canFinishCards,
    onEdit, onConfirm, onPlan, onEditPlanDate, onUnplan, onDelete, onFinish, onPrint,
  };

  return (
    <div
      className={`
        flex-shrink-0 rounded-2xl overflow-hidden flex flex-col
        border-2 transition-all duration-300
        ${dropHover && isReturnDrag
          ? 'border-brand-orange bg-brand-orange/10'
          : 'border-brand-black bg-brand-black'}
      `}
      style={{ height: effectiveHeight }}
      onDragOver={(e) => { e.preventDefault(); setDropHover(true); }}
      onDragLeave={() => setDropHover(false)}
      onDrop={(e) => { setDropHover(false); onDockDrop(e); }}
    >
      {/* Resize handle */}
      {!isCollapsed && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="flex items-center justify-center h-4 flex-shrink-0 cursor-ns-resize hover:bg-white/10 transition-colors group"
          title="Drag to resize"
        >
          <GripHorizontal size={12} className="text-gray-600 group-hover:text-gray-400 transition-colors" />
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-1.5 flex-shrink-0 flex-wrap" style={{ paddingTop: isCollapsed ? 4 : undefined, paddingBottom: isCollapsed ? 4 : undefined }}>
        <div className="flex items-center gap-2">
          <Package size={12} className="text-brand-orange" />
          <span className="text-[11px] font-bold text-gray-300 uppercase tracking-widest">Unplanned</span>
          <span className="bg-brand-orange text-white text-[10px] font-extrabold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
            {visibleOrders.length}
          </span>
          {multiRow && (
            <span className="text-[9px] text-gray-600 font-medium">{rowCount} rows</span>
          )}
        </div>

        {/* User filter dropdown */}
        {!isCollapsed && creators.length > 0 && (
          <UserFilter creators={creators} value={filterUser} onChange={setFilterUser} />
        )}

        {isReturnDrag && dropHover ? (
          <span className="flex items-center gap-1.5 text-xs text-brand-orange font-semibold animate-pulse">
            <ArrowUpToLine size={11} />
            Drop here to return to pool
          </span>
        ) : draggingId && !isReturnDrag ? (
          <span className="text-[11px] text-gray-500">Dragging from pool...</span>
        ) : visibleOrders.length > 0 ? null : (
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-green-400 font-semibold">
              {filterUser === 'All' ? 'All plans placed on board' : `No unplanned cards for ${filterUser}`}
            </span>
            {filterUser === 'All' && (
              <button
                onClick={() => setManualExpanded(v => !v)}
                className="text-gray-500 hover:text-gray-300 transition-colors"
                title={manualExpanded ? 'Collapse' : 'Expand'}
              >
                <ChevronUp size={12} className={`transition-transform ${manualExpanded ? '' : 'rotate-180'}`} />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Cards area */}
      {!isCollapsed && (
        <div ref={cardsAreaRef} className="flex-1 min-h-0 px-3 pb-2 overflow-hidden">
          {visibleOrders.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-xs">
              No unplanned cards
            </div>
          ) : multiRow ? (
            // Multi-row grid: fill top row first, then overflow to next rows
            (() => {
              const cardsPerRow = Math.ceil(visibleOrders.length / rowCount);
              return (
                <div
                  className="dock-scroll overflow-x-auto overflow-y-hidden h-full"
                  style={{
                    display: 'grid',
                    gridAutoFlow: 'row',
                    gridTemplateColumns: `repeat(${cardsPerRow}, ${CARD_W_PX}px)`,
                    gridTemplateRows: `repeat(${rowCount}, ${CARD_H_PX}px)`,
                    gap: 8,
                    alignContent: 'center',
                  }}
                >
              {visibleOrders.map(order => {
                const dim = !!searchText.trim() && !matchesSearch(order);
                const isHlit = highlightedId === order.id;
                return (
                  <div key={order.id} data-card-id={order.id} style={{ opacity: dim ? 0.25 : 1, transition: 'opacity 0.15s', outline: isHlit ? '2px solid #F36B21' : 'none', outlineOffset: '2px', borderRadius: 4 }}>
                    <DockFloatingCard
                      order={order}
                      isDark={isDark}
                      actions={actions}
                      onDragStart={onCardDragStart}
                      onDragEnd={onCardDragEnd}
                      isDragging={draggingId === order.id}
                    />
                  </div>
                );
              })}
                </div>
              );
            })()
          ) : (
            // Single-row scroll layout
            <div className="dock-scroll flex gap-2 h-full items-center overflow-x-auto overflow-y-hidden">
              {visibleOrders.map(order => {
                const dim = !!searchText.trim() && !matchesSearch(order);
                const isHlit = highlightedId === order.id;
                return (
                  <div key={order.id} data-card-id={order.id} style={{ opacity: dim ? 0.25 : 1, transition: 'opacity 0.15s', flexShrink: 0, outline: isHlit ? '2px solid #F36B21' : 'none', outlineOffset: '2px', borderRadius: 4 }}>
                    <DockFloatingCard
                      order={order}
                      isDark={isDark}
                      actions={actions}
                      onDragStart={onCardDragStart}
                      onDragEnd={onCardDragEnd}
                      isDragging={draggingId === order.id}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
