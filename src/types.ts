export type PlanType = 'White' | 'Yellow';

export type SectionAccess = 'smartproduction' | 'production_control' | 'both';

export interface ProductionOrder {
  id: string;
  order_id: string;
  unc_code_1: string | null;
  qty_1: number | null;
  unc_code_2: string | null;
  qty_2: number | null;
  unc_code_3: string | null;
  qty_3: number | null;
  unc_code_4: string | null;
  qty_4: number | null;
  size_ton: number | null;
  leadtime: number | null;
  leadtime_hours: number | null;
  due_date: string | null;
  remark: string | null;
  plan_type: PlanType;
  urgent: boolean;
  is_planned: boolean;
  is_finished: boolean;
  finished_at: string | null;
  is_updated: boolean;
  is_printed: boolean;
  created_by: string | null;
  machine_id: string | null;
  scheduled_date: string | null;
  plan_issue_date: string | null;
  x_offset: number | null;
  prev_machine_id: string | null;
  prev_slot_index: number | null;
  created_at: string;
}

export interface Machine {
  id: string;
  machine_type: string;
  size_ton: number;
  mc_no: string;
  display_order: number;
  created_at: string;
}

export interface AppNotification {
  id: string;
  for_username: string;
  order_ref: string;
  order_id: string | null;
  message: string;
  edited_by: string;
  is_read: boolean;
  created_at: string;
}

export type ProductionOrderInsert = Omit<ProductionOrder, 'id' | 'order_id' | 'created_at'>;

export interface UncQtyPair {
  unc_code: string;
  qty: string;
}

export const SIZE_TON_OPTIONS = [5, 30, 50, 100, 150, 250, 300, 350, 450] as const;
export type SizeTonValue = (typeof SIZE_TON_OPTIONS)[number];
