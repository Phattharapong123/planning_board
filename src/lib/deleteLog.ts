import { supabase } from './supabase';
import type { ProductionOrder } from '../types';

function formatUncCode(order: ProductionOrder): string {
  return [order.unc_code_1, order.unc_code_2, order.unc_code_3, order.unc_code_4]
    .filter(Boolean)
    .join(', ');
}

function formatQty(order: ProductionOrder): string {
  return [order.qty_1, order.qty_2, order.qty_3, order.qty_4]
    .filter(q => q !== null && q !== undefined && String(q) !== '0')
    .map(q => String(q))
    .join(', ');
}

export async function logDelete(
  tableName: string,
  recordId: string,
  deletedBy: string,
  snapshot?: Record<string, unknown>,
  orderId?: string,
  uncCode?: string,
  dueDate?: string | null,
  qty?: string,
) {
  await supabase.from('delete_log').insert({
    table_name: tableName,
    record_id: recordId,
    order_id: orderId ?? null,
    deleted_by: deletedBy,
    snapshot: snapshot ?? null,
    unc_code: uncCode ?? null,
    due_date: dueDate ?? null,
    qty: qty ?? null,
  });
}

export async function logOrderDelete(order: ProductionOrder, deletedBy: string) {
  await logDelete(
    'production_orders',
    order.id,
    deletedBy,
    {
      order_id: order.order_id,
      unc_code_1: order.unc_code_1,
      qty_1: order.qty_1,
      unc_code_2: order.unc_code_2,
      qty_2: order.qty_2,
      unc_code_3: order.unc_code_3,
      qty_3: order.qty_3,
      unc_code_4: order.unc_code_4,
      qty_4: order.qty_4,
      size_ton: order.size_ton,
      leadtime: order.leadtime,
      leadtime_hours: order.leadtime_hours,
      due_date: order.due_date,
      plan_issue_date: order.plan_issue_date,
      remark: order.remark,
      plan_type: order.plan_type,
      urgent: order.urgent,
      machine_id: order.machine_id,
      scheduled_date: order.scheduled_date,
      is_planned: order.is_planned,
      is_finished: order.is_finished,
      is_printed: order.is_printed,
    },
    order.order_id,
    formatUncCode(order),
    order.due_date,
    formatQty(order),
  );
}
