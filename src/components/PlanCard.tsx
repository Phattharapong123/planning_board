import { memo } from 'react';
import type { ProductionOrder } from '../types';

export function formatUncCodeForCard(order: ProductionOrder): string {
  const codes = [order.unc_code_1, order.unc_code_2, order.unc_code_3, order.unc_code_4].filter(
    (c): c is string => c !== null && c !== ''
  );
  if (codes.length === 0) return '—';
  if (codes.length === 1) return codes[0];
  return codes.map(c => c.slice(0, 4)).join(',');
}

// Single value if all qtys are equal; otherwise QTY1-QTY2-... per UNC code present
export function totalQty(order: ProductionOrder): string {
  const pairs = [
    { code: order.unc_code_1, qty: order.qty_1 },
    { code: order.unc_code_2, qty: order.qty_2 },
    { code: order.unc_code_3, qty: order.qty_3 },
    { code: order.unc_code_4, qty: order.qty_4 },
  ].filter(p => p.code != null && p.code !== '');

  if (pairs.length === 0) return '—';

  const qtys = pairs.map(p => p.qty ?? 0);
  const allSame = qtys.every(q => q === qtys[0]);

  if (allSame) {
    return qtys[0] > 0 ? qtys[0].toLocaleString('th-TH') : '—';
  }
  return qtys.map(q => q.toLocaleString('th-TH')).join('-');
}

export function formatCardDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y.slice(2)}`;
}

interface CardStyle { bg: string; border: string; color: string; glow?: string }

function cardStyle(order: ProductionOrder, dark: boolean): CardStyle {
  if (order.urgent && order.is_updated) return dark
    ? { bg: '#3D1200', border: '#FB923C', color: '#FFD0A8', glow: '0 0 8px rgba(251,146,60,0.75),0 0 18px rgba(251,146,60,0.25)' }
    : { bg: '#EA580C', border: '#9A3412', color: '#FFFFFF' };
  if (order.urgent) return dark
    ? { bg: '#500000', border: '#FF3333', color: '#FFC0C0', glow: '0 0 10px rgba(255,51,51,0.9),0 0 24px rgba(255,51,51,0.35)' }
    : { bg: '#DC2626', border: '#991B1B', color: '#FFFFFF' };
  if (order.is_planned) return dark
    ? { bg: '#072515', border: '#4ADE80', color: '#D4FFE5', glow: '0 0 8px rgba(74,222,128,0.65),0 0 16px rgba(74,222,128,0.2)' }
    : { bg: '#22C55E', border: '#15803D', color: '#052E16' };
  if (order.plan_type === 'Yellow') return dark
    ? { bg: '#251A00', border: '#FBBF24', color: '#FFF4C2', glow: '0 0 6px rgba(251,191,36,0.6),0 0 14px rgba(251,191,36,0.2)' }
    : { bg: '#FDE68A', border: '#D97706', color: '#451A03' };
  return dark
    ? { bg: '#091828', border: '#60A5FA', color: '#D0EAFF', glow: '0 0 6px rgba(96,165,250,0.6),0 0 14px rgba(96,165,250,0.2)' }
    : { bg: '#BFDBFE', border: '#2563EB', color: '#1E3A5F' };
}

// Card: width=1.0in (96px), height=0.5in (48px)
interface Props {
  order: ProductionOrder;
  onClick?: (order: ProductionOrder) => void;
  onDragStart?: (e: React.DragEvent, order: ProductionOrder) => void;
  onDragEnd?: () => void;
  onUnassign?: (order: ProductionOrder) => void;
  isDragging?: boolean;
  isDark?: boolean;
}

const PlanCard = memo(function PlanCard({ order, onClick, onDragStart, onDragEnd, onUnassign, isDragging, isDark = false }: Props) {
  const canDrag = !!onDragStart;
  const cs = cardStyle(order, isDark);

  return (
    <div
      draggable={canDrag}
      onClick={() => onClick?.(order)}
      onDragStart={(e) => onDragStart?.(e, order)}
      onDragEnd={onDragEnd}
      title={`${order.order_id}\n${order.unc_code_1 ?? ''}`}
      className={`
        relative group border rounded flex flex-col overflow-hidden flex-shrink-0
        select-none
        ${canDrag ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}
        ${isDragging ? 'opacity-0' : ''}
      `}
      style={{
        width: '1in',
        height: '48px',
        padding: '1px 3px',
        fontSize: '7px',
        lineHeight: '1.1',
        boxSizing: 'border-box',
        background: cs.bg,
        borderColor: cs.border,
        borderWidth: isDark ? '1.5px' : '1px',
        borderStyle: 'solid',
        color: cs.color,
        boxShadow: isDark && cs.glow ? cs.glow : undefined,
        transition: 'opacity 150ms',
      }}
    >
      {/* P stamp overlay — only when printed and not yet planned */}
      {order.is_printed && !order.is_planned && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', zIndex: 10,
        }}>
          <span style={{
            fontSize: 36, fontWeight: 900, lineHeight: 1,
            color: cs.border,
            opacity: isDark ? 0.65 : 0.55,
            fontFamily: '"Aptos Narrow", "Aptos", "Arial Narrow", Arial, sans-serif',
            letterSpacing: '-1px',
            textShadow: isDark ? `0 0 10px ${cs.border}55` : `0 1px 4px ${cs.border}44`,
            userSelect: 'none',
          }}>P</span>
        </div>
      )}

      {/* Unassign button */}
      {onUnassign && (
        <button
          onClick={(e) => { e.stopPropagation(); onUnassign(order); }}
          className="absolute top-0 right-0 w-3 h-3 bg-red-500/80 hover:bg-red-600 text-white rounded-bl hidden group-hover:flex items-center justify-center z-10 flex-shrink-0"
          style={{ fontSize: '8px', fontWeight: 700, transition: 'background-color 150ms' }}
          title="Return to pool"
        >
          ×
        </button>
      )}

      {/* UNC Code */}
      <div
        className="font-bold truncate"
        style={{ fontSize: '7.5px', borderBottom: `1px solid ${cs.border}`, paddingBottom: '1px', marginBottom: '1px', opacity: 0.9 }}
      >
        {formatUncCodeForCard(order)}
      </div>

      {/* SizeTon | Leadtime */}
      <div className="flex justify-between items-baseline">
        <span className="font-bold">{order.size_ton != null ? `${order.size_ton}T` : '—'}</span>
        <span>{order.leadtime ?? 0}D/{order.leadtime_hours ?? 0}H</span>
      </div>

      {/* Qty | DueDate */}
      <div className="flex justify-between items-baseline">
        <span className="font-semibold truncate">{totalQty(order)}</span>
        <span className="flex-shrink-0 ml-1">{formatCardDate(order.due_date)}</span>
      </div>

      <div className="flex justify-end">
        <span className="flex-shrink-0">Send Plan: {formatCardDate(order.plan_issue_date)}</span>
      </div>

      {/* Remark */}
      {order.remark && (
        <div className="truncate" style={{ fontSize: '6px', lineHeight: 1, marginTop: '1px' }}>
          {order.remark}
        </div>
      )}
    </div>
  );
});

export default PlanCard;
