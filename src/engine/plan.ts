/**
 * Решения оператора (TEAM_DECISION) и допущения команды (TEAM_ASSUMPTION).
 * Структура совместима со schemas/plan.schema.json организатора:
 * plan_id, scenario_id, decisions{ supply_orders, capacity_reservations, investments, inventory_policy }.
 */

export interface SupplyOrder {
  source_id: string;
  year: number;
  /** Заказанный к отбору объём года, т. Заказ ≠ поставка ≠ выданный объём. */
  volume_t: number;
}

export interface CapacityReservation {
  source_id: string;
  year: number;
  capacity_t_per_year: number;
}

export interface InvestmentDecision {
  investment_id: 'ZBO' | 'LUNAR_ISRU' | 'EARTH_NEW' | string;
  /** Год оплаты права/финансирования. */
  decision_year: number;
  /** Для EARTH_NEW — год реализации опциона (270 млн). По умолчанию равен decision_year. */
  exercise_year?: number;
}

export interface InventoryPolicy {
  /** Начальный запас на 01.01.2035, т. Закупается в подготовительный период и оплачивается в первом году. */
  opening_inventory_t: number;
  /** Канал, из которого куплен начальный запас. */
  opening_source_id: string;
  /** Распределение годового заказа по месяцам. */
  delivery_profile: 'even' | 'front_loaded';
}

export interface TeamAssumptions {
  /** Реальная ставка дисконтирования, TEAM_ASSUMPTION. */
  discount_rate: number;
  /** Момент приведения. */
  discount_t0: number;
  /** Какое значение диапазона lead time берём (18–24 мес Earth-New, 1–2 мес ISRU). */
  lead_time_policy: 'min' | 'max' | 'mid';
  /** Определение «базового канала» для ограничения Emergency: доля в обслуженном объёме года. */
  emergency_base_share: number;
  /**
   * Правило команды: заказ по каналу с платой за резервирование не превышает
   * зарезервированную мощность — право на поставку даёт именно резерв мощности.
   * Это TEAM_ASSUMPTION, а не ограничение организатора.
   */
  require_reservation_for_orders: boolean;
}

export interface Plan {
  plan_id: string;
  scenario_id: string;
  decisions: {
    supply_orders: SupplyOrder[];
    capacity_reservations: CapacityReservation[];
    investments: InvestmentDecision[];
    inventory_policy: InventoryPolicy;
  };
  assumptions: TeamAssumptions;
}

export const DEFAULT_ASSUMPTIONS: TeamAssumptions = {
  discount_rate: 0.07,
  discount_t0: 2035,
  lead_time_policy: 'max',
  emergency_base_share: 0.5,
  require_reservation_for_orders: true,
};

export const emptyPlan = (plan_id: string, scenario_id: string): Plan => ({
  plan_id,
  scenario_id,
  decisions: {
    supply_orders: [],
    capacity_reservations: [],
    investments: [],
    inventory_policy: { opening_inventory_t: 0, opening_source_id: 'A', delivery_profile: 'even' },
  },
  assumptions: { ...DEFAULT_ASSUMPTIONS },
});

export function orderFor(plan: Plan, source_id: string, year: number): number {
  return plan.decisions.supply_orders
    .filter((o) => o.source_id === source_id && o.year === year)
    .reduce((s, o) => s + o.volume_t, 0);
}

export function reservationFor(plan: Plan, source_id: string, year: number): number {
  return plan.decisions.capacity_reservations
    .filter((r) => r.source_id === source_id && r.year === year)
    .reduce((s, r) => s + r.capacity_t_per_year, 0);
}

export const investmentOf = (plan: Plan, id: string): InvestmentDecision | undefined =>
  plan.decisions.investments.find((i) => i.investment_id === id);
