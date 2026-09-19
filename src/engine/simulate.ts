/**
 * Помесячная модель топливного узла на 2035–2040.
 *
 * Шаг — месяц: он различает 6 недель Emergency, 4 месяца Earth-Flex и 12 месяцев
 * Earth-Core, выявляет внутригодовой дефицит и переполнение хранилища и позволяет
 * пропорционально начислять плату за резервирование и хранение
 * (docs/CALCULATION_RULES.md, п. 10).
 *
 * Разделение сущностей соблюдается строго: reserved ≠ ordered ≠ delivered ≠ served.
 */
import { CASE, SCENARIOS, getYears, leadTimeMonths, sourceById, sourceYearFactor, yearFactor } from './caseData';
import {
  actualDelivery,
  closingInventory,
  holdingCost,
  losses as lossesOf,
  payableVolume,
  presentValue,
  reservationPayment,
  serve,
  serviceLevel,
  variablePayment,
} from './primitives';
import { investmentOf, orderFor, reservationFor, type Plan } from './plan';
import type { Scenario, StorageOption } from './types';

export type DemandVariant = 'base' | 'low' | 'high';

export interface MonthRow {
  year: number;
  month: number; // 1..12
  opening_t: number;
  delivered_t: number;
  losses_t: number;
  served_total_t: number;
  served_critical_t: number;
  shortage_t: number;
  closing_t: number;
  storage_capacity_t: number;
  overflow_t: number;
}

export interface SourceYearRow {
  year: number;
  source_id: string;
  name: string;
  available_fraction: number;
  reserved_t_per_year: number;
  ordered_t: number;
  delivered_t: number;
  payable_t: number;
  price_mln_per_t: number;
  variable_payment_mln: number;
  reservation_payment_mln: number;
}

export interface YearRow {
  year: number;
  total_demand_t: number;
  critical_demand_t: number;
  opening_t: number;
  delivered_t: number;
  losses_t: number;
  served_total_t: number;
  served_critical_t: number;
  shortage_t: number;
  closing_t: number;
  service_total: number;
  service_critical: number;
  loss_share_of_throughput: number;
  reserve_required_t: number;
  reserve_actual_t: number;
  storage_capacity_t: number;
  storage_id: string;
}

export interface FinanceRow {
  year: number;
  procurement_mln: number;
  reservation_mln: number;
  holding_mln: number;
  fixed_opex_mln: number;
  capex_mln: number;
  total_mln: number;
  discounted_mln: number;
  cumulative_capex_mln: number;
}

export interface SimulationResult {
  plan_id: string;
  scenario_id: string;
  demand_variant: DemandVariant;
  months: MonthRow[];
  years: YearRow[];
  sources: SourceYearRow[];
  finance: FinanceRow[];
  totals: {
    total_cost_mln: number;
    discounted_cost_mln: number;
    capex_mln: number;
    served_total_t: number;
    shortage_total_t: number;
    cost_per_served_t: number;
    /**
     * Запас на конец горизонта, выраженный в днях спроса последнего года.
     * Это не ограничение организатора, а показатель команды: план может формально
     * пройти проверку резерва на начало каждого года и при этом закончить 2040-й
     * с опустошённым узлом, переложив дефицит за горизонт модели.
     */
    end_horizon_reserve_days: number;
  };
}

const MONTHS = 12;

/** Спрос года с учётом варианта и множителей сценария. Критический вложен в общий. */
export function demandFor(year: number, scenario: Scenario, variant: DemandVariant) {
  const row = CASE.demand.find((d) => d.year === year)!;
  const base = row.base_total_t;
  const variantTotal = variant === 'low' ? row.low_total_t : variant === 'high' ? row.high_total_t : base;
  // Доля критического спроса сохраняется от базового года (требование постановки)
  const criticalShare = row.base_critical_t / base;
  const total = variantTotal * yearFactor(scenario.demand_multiplier, year);
  const critical = variantTotal * criticalShare * yearFactor(scenario.critical_demand_multiplier, year);
  return { total_t: total, critical_t: Math.min(critical, total) };
}

/** Активный режим хранилища в конкретном году: базовый или ZBO после ввода. */
export function storageForYear(plan: Plan, year: number): StorageOption {
  const base = CASE.storage.find((s) => s.storage_id === 'BASE')!;
  const zbo = CASE.storage.find((s) => s.storage_id === 'ZBO')!;
  const decision = investmentOf(plan, 'ZBO');
  if (!decision) return base;
  const commissioned = Math.max(decision.decision_year, zbo.available_from_year);
  return year >= commissioned ? zbo : base;
}

/**
 * Доля года, в течение которой канал доступен.
 * Earth-New: после реализации опциона плюс подготовка 18–24 мес (политика из допущений).
 * Lunar-ISRU: CAPEX финансируется до 2038, канал доступен с 2038.
 */
export function availabilityFraction(plan: Plan, source_id: string, year: number): number {
  const source = sourceById(source_id);
  const monthsInYear = (fromMonthIndex: number) => Math.max(0, Math.min(MONTHS, MONTHS - fromMonthIndex)) / MONTHS;

  if (source_id === 'C') {
    const decision = investmentOf(plan, 'EARTH_NEW');
    if (!decision) return 0;
    const exercise = decision.exercise_year ?? decision.decision_year;
    const readyMonth = exercise * MONTHS + leadTimeMonths(source, plan.assumptions.lead_time_policy);
    const yearStart = year * MONTHS;
    return monthsInYear(readyMonth - yearStart);
  }

  if (source_id === 'D') {
    const decision = investmentOf(plan, 'LUNAR_ISRU');
    if (!decision) return 0;
    // Обязательное условие кейса: финансирование до 2038 года
    if (decision.decision_year > 2037) return 0;
    const from = source.available_from_year ?? 2038;
    if (year < from) return 0;
    // Срок поставки лунного канала отсчитывается от ввода в эксплуатацию, а не от
    // начала года: в первый рабочий год доступна не вся мощность.
    const readyMonth = from * MONTHS + leadTimeMonths(source, plan.assumptions.lead_time_policy);
    return monthsInYear(readyMonth - year * MONTHS);
  }

  const from = source.available_from_year ?? getYears()[0];
  return year >= from ? 1 : 0;
}

/** Профиль помесячной поставки внутри года с учётом доступности канала. */
function monthlyShares(profile: 'even' | 'front_loaded', availableFrom: number): number[] {
  const shares = new Array<number>(MONTHS).fill(0);
  const active: number[] = [];
  for (let m = 0; m < MONTHS; m++) if (m >= availableFrom) active.push(m);
  if (!active.length) return shares;
  if (profile === 'front_loaded') {
    const half = Math.max(1, Math.ceil(active.length / 2));
    active.slice(0, half).forEach((m) => (shares[m] = 1 / half));
  } else active.forEach((m) => (shares[m] = 1 / active.length));
  return shares;
}

export function simulate(plan: Plan, opts: { scenario_id?: string; variant?: DemandVariant } = {}): SimulationResult {
  const scenario = SCENARIOS[opts.scenario_id ?? plan.scenario_id];
  if (!scenario) throw new Error(`Неизвестный сценарий: ${opts.scenario_id ?? plan.scenario_id}`);
  const variant = opts.variant ?? 'base';
  const { discount_rate, discount_t0 } = plan.assumptions;

  const months: MonthRow[] = [];
  const yearsOut: YearRow[] = [];
  const sourcesOut: SourceYearRow[] = [];
  const finance: FinanceRow[] = [];

  let inventory = plan.decisions.inventory_policy.opening_inventory_t;
  let cumulativeCapex = 0;

  for (const year of getYears()) {
    const storage = storageForYear(plan, year);
    const demand = demandFor(year, scenario, variant);
    const monthlyDemand = demand.total_t / MONTHS;
    const monthlyCritical = demand.critical_t / MONTHS;

    // --- поставки по каналам ---
    const perSource = CASE.sources.map((source) => {
      const fraction = availabilityFraction(plan, source.source_id, year);
      const ordered = fraction > 0 ? orderFor(plan, source.source_id, year) : 0;
      const reserved = reservationFor(plan, source.source_id, year);
      const share = sourceYearFactor(scenario.actual_delivery_share, source.name, year, 1);
      const price =
        source.variable_cost_mln_per_t * sourceYearFactor(scenario.variable_price_multiplier, source.name, year, 1);
      const delivered = actualDelivery(ordered, share);
      const payable = payableVolume(ordered, source.take_or_pay_share, reserved * fraction);
      const firstActiveMonth = Math.round((1 - fraction) * MONTHS);
      return {
        source,
        fraction,
        ordered,
        reserved,
        delivered,
        payable,
        price,
        shares: monthlyShares(plan.decisions.inventory_policy.delivery_profile, firstActiveMonth),
      };
    });

    const yearStart = inventory;
    let yearDelivered = 0;
    let yearLosses = 0;
    let yearServed = 0;
    let yearServedCritical = 0;
    let yearShortage = 0;
    let inventoryTimeSum = 0;

    for (let m = 0; m < MONTHS; m++) {
      const opening = inventory;
      const delivered = perSource.reduce((sum, p) => sum + p.delivered * p.shares[m], 0);
      const losses = lossesOf(delivered, storage.loss_rate_on_throughput);
      const available = opening + delivered - losses;

      // Критический спрос обслуживается в первую очередь
      const critical = serve(available, monthlyCritical);
      const rest = serve(available - critical.served_t, monthlyDemand - monthlyCritical);
      const served = critical.served_t + rest.served_t;
      const shortage = critical.shortage_t + rest.shortage_t;

      // Физика склада: больше ёмкости хранить негде, избыток на следующий месяц не
      // переходит. Проверка STORAGE_OVERFLOW фиксирует сам факт, но баланс обязан
      // вести себя физично — иначе «лишние» тонны обслуживают спрос следующих месяцев.
      const closingRaw = closingInventory({ opening_t: opening, delivered_t: delivered, losses_t: losses, served_t: served });
      const overflow = Math.max(0, closingRaw - storage.capacity_t);
      const closing = closingRaw - overflow;

      months.push({
        year,
        month: m + 1,
        opening_t: opening,
        delivered_t: delivered,
        losses_t: losses,
        served_total_t: served,
        served_critical_t: critical.served_t,
        shortage_t: shortage,
        closing_t: closing,
        storage_capacity_t: storage.capacity_t,
        overflow_t: overflow,
      });

      inventoryTimeSum += (opening + closing) / 2;
      yearDelivered += delivered;
      yearLosses += losses;
      yearServed += served;
      yearServedCritical += critical.served_t;
      yearShortage += shortage;
      inventory = closing;
    }

    // --- финансы года ---
    let procurement = 0;
    let reservation = 0;
    for (const p of perSource) {
      const variablePay = variablePayment(p.price, p.payable);
      const reservationPay = reservationPayment(
        p.source.reservation_rate_mln_per_t_year_capacity *
          sourceYearFactor(scenario.reservation_rate_multiplier, p.source.name, year, 1),
        p.reserved,
        p.fraction,
      );
      procurement += variablePay;
      reservation += reservationPay;
      sourcesOut.push({
        year,
        source_id: p.source.source_id,
        name: p.source.name,
        available_fraction: p.fraction,
        reserved_t_per_year: p.reserved,
        ordered_t: p.ordered,
        delivered_t: p.delivered,
        payable_t: p.payable,
        price_mln_per_t: p.price,
        variable_payment_mln: variablePay,
        reservation_payment_mln: reservationPay,
      });
    }

    // Начальный запас: закупка подготовительного периода относится к первому году горизонта.
    // Она не бесплатна и не беспотерьна: чтобы в узле оказался нужный объём, поставить
    // нужно больше на величину потерь, а мощность канала на подготовительный период
    // резервируется и оплачивается по тем же правилам, что и обычный заказ.
    if (year === getYears()[0] && plan.decisions.inventory_policy.opening_inventory_t > 0) {
      const src = sourceById(plan.decisions.inventory_policy.opening_source_id);
      const net = plan.decisions.inventory_policy.opening_inventory_t;
      const gross = net / (1 - storage.loss_rate_on_throughput);
      procurement += src.variable_cost_mln_per_t * gross;
      reservation += reservationPayment(
        src.reservation_rate_mln_per_t_year_capacity *
          sourceYearFactor(scenario.reservation_rate_multiplier, src.name, year, 1),
        gross,
        1,
      );
      yearDelivered += gross;
      yearLosses += gross - net;
    }

    const holding = holdingCost(inventoryTimeSum / MONTHS, storage.holding_cost_mln_per_t_year, 1);

    let fixedOpex = 0;
    const zbo = investmentOf(plan, 'ZBO');
    if (zbo && year >= Math.max(zbo.decision_year, 2036)) {
      fixedOpex += CASE.investments.find((i) => i.investment_id === 'ZBO')!.fixed_opex_mln_per_year;
    }
    const isru = investmentOf(plan, 'LUNAR_ISRU');
    if (isru && availabilityFraction(plan, 'D', year) > 0) {
      fixedOpex += CASE.investments.find((i) => i.investment_id === 'LUNAR_ISRU')!.fixed_opex_mln_per_year;
    }

    let capex = 0;
    for (const decision of plan.decisions.investments) {
      const option = CASE.investments.find((i) => i.investment_id === decision.investment_id);
      if (!option) continue;
      if (decision.investment_id === 'EARTH_NEW') {
        // 90 — плата за право, 270 — реализация. Итог 360, третьим платежом не начисляется.
        if (decision.decision_year === year) capex += option.option_fee_mln;
        if ((decision.exercise_year ?? decision.decision_year) === year) capex += option.exercise_cost_mln;
      } else if (decision.decision_year === year) {
        capex += option.total_capex_mln;
      }
    }
    cumulativeCapex += capex;

    const total = procurement + reservation + holding + fixedOpex + capex;
    finance.push({
      year,
      procurement_mln: procurement,
      reservation_mln: reservation,
      holding_mln: holding,
      fixed_opex_mln: fixedOpex,
      capex_mln: capex,
      total_mln: total,
      discounted_mln: presentValue(total, discount_rate, year - discount_t0),
      cumulative_capex_mln: cumulativeCapex,
    });

    yearsOut.push({
      year,
      total_demand_t: demand.total_t,
      critical_demand_t: demand.critical_t,
      opening_t: yearStart,
      delivered_t: yearDelivered,
      losses_t: yearLosses,
      served_total_t: yearServed,
      served_critical_t: yearServedCritical,
      shortage_t: yearShortage,
      closing_t: inventory,
      service_total: serviceLevel(yearServed, demand.total_t),
      service_critical: serviceLevel(yearServedCritical, demand.critical_t),
      loss_share_of_throughput: yearDelivered > 0 ? yearLosses / yearDelivered : 0,
      reserve_required_t: (demand.total_t * 45) / 365,
      reserve_actual_t: yearStart,
      storage_capacity_t: storage.capacity_t,
      storage_id: storage.storage_id,
    });
  }

  const total_cost_mln = finance.reduce((s, f) => s + f.total_mln, 0);
  const served_total_t = yearsOut.reduce((s, y) => s + y.served_total_t, 0);
  const lastYear = yearsOut[yearsOut.length - 1];
  return {
    plan_id: plan.plan_id,
    scenario_id: scenario.scenario_id,
    demand_variant: variant,
    months,
    years: yearsOut,
    sources: sourcesOut,
    finance,
    totals: {
      total_cost_mln,
      discounted_cost_mln: finance.reduce((s, f) => s + f.discounted_mln, 0),
      capex_mln: finance.reduce((s, f) => s + f.capex_mln, 0),
      served_total_t,
      shortage_total_t: yearsOut.reduce((s, y) => s + y.shortage_t, 0),
      cost_per_served_t: served_total_t > 0 ? total_cost_mln / served_total_t : 0,
      end_horizon_reserve_days:
        lastYear.total_demand_t > 0 ? (lastYear.closing_t / lastYear.total_demand_t) * 365 : 0,
    },
  };
}
