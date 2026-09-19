/**
 * Примитивы контрольной семантики кейса.
 * Каждая функция соответствует правилу из docs/CALCULATION_RULES.md организатора
 * и проверяется синтетическим примером V01–V10 (validation/control_cases.md).
 * Здесь нет стратегии закупок — только арифметика, которую проверяет жюри.
 */

/** V01. I_end = I_start + Q_delivered − Losses − Q_served */
export function closingInventory(input: {
  opening_t: number;
  delivered_t: number;
  losses_t: number;
  served_t: number;
}): number {
  return input.opening_t + input.delivered_t - input.losses_t - input.served_t;
}

/**
 * V02. Дефицит — отдельная величина, а не отрицательный запас.
 * Выдаём не больше, чем физически доступно.
 */
export function serve(available_t: number, demand_t: number): { served_t: number; shortage_t: number } {
  const served_t = Math.min(demand_t, Math.max(0, available_t));
  return { served_t, shortage_t: Math.max(0, demand_t - served_t) };
}

/** V06. Потери начисляются один раз на валовое поступление периода. */
export const losses = (throughput_t: number, loss_rate: number): number => throughput_t * loss_rate;

/** V07. R_y = D_y × 45 / 365 (конвенция организатора — 365 дней). */
export const reserveRequirement = (annual_demand_t: number, days = 45, year_days = 365): number =>
  (annual_demand_t * days) / year_days;

/** V03/V04. Оплачиваемый объём: минимум take-or-pay уже внутри max(), вторым платежом не добавляется. */
export const payableVolume = (order_t: number, take_or_pay_share: number, reserved_period_t: number): number =>
  Math.max(order_t, take_or_pay_share * reserved_period_t);

export const variablePayment = (price_mln_per_t: number, payable_t: number): number => price_mln_per_t * payable_t;

/** V05. Плата за резервирование пропорциональна длительности периода. */
export const reservationPayment = (
  reservation_rate: number,
  annual_reserved_capacity_t: number,
  period_fraction: number,
): number => reservation_rate * annual_reserved_capacity_t * period_fraction;

/** V07/service. Доли обслуживания; нулевой спрос трактуется явно как 1 (нечего не обслужить). */
export const serviceLevel = (served_t: number, demand_t: number): number => (demand_t > 0 ? served_t / demand_t : 1);

export interface CapacityViolation {
  violation: 'CAPACITY_EXCEEDED';
  excess_t: number;
}

/** V08. Резервируемая мощность не может превышать мощность канала. */
export function capacityCheck(reserved_t_per_year: number, capacity_t_per_year: number): CapacityViolation | null {
  const excess = reserved_t_per_year - capacity_t_per_year;
  return excess > 0 ? { violation: 'CAPACITY_EXCEEDED', excess_t: excess } : null;
}

/**
 * V10. Фактическая поставка в стрессе = план × заданная доля.
 * Коэффициент надёжности сюда не входит: он относится к отдельному риск-блоку.
 */
export const actualDelivery = (planned_t: number, actual_delivery_share: number): number =>
  planned_t * actual_delivery_share;

/** Стоимость хранения по среднему физическому запасу с учётом времени. */
export const holdingCost = (
  average_inventory_t: number,
  holding_rate_mln_per_t_year: number,
  period_fraction: number,
): number => average_inventory_t * holding_rate_mln_per_t_year * period_fraction;

/** Приведение разновременных затрат; ставка и момент приведения — TEAM_ASSUMPTION. */
export const presentValue = (cash_flow_mln: number, rate: number, years_from_t0: number): number =>
  cash_flow_mln / (1 + rate) ** years_from_t0;
