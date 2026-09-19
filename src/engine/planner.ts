/**
 * Построение и сравнение стратегий.
 *
 * Оптимизатор кейсом не требуется, но перебор небольшого пространства инвестиционных
 * решений плюс прозрачное правило распределения объёмов даёт сопоставимые альтернативы
 * на единой базе данных — это и есть материал для критерия «сравнение альтернатив».
 *
 * Правило распределения: каналы упорядочиваются по полной стоимости тонны, реально
 * доставленной в узел (переменная цена сценария + ставка резервирования, делённые на
 * фактическую долю поставки). Emergency используется последним и ограничен по доле,
 * чтобы не становиться базовым каналом.
 */
import { CASE, SCENARIOS, getYears, sourceById, sourceYearFactor } from './caseData';
import { checkConstraints, isFeasible, planViolations, type ConstraintCheck, type PlanViolation } from './constraints';
import { DEFAULT_ASSUMPTIONS, emptyPlan, type InvestmentDecision, type Plan, type TeamAssumptions } from './plan';
import { availabilityFraction, demandFor, simulate, storageForYear, type DemandVariant, type SimulationResult } from './simulate';
import { reserveRequirement } from './primitives';

export interface Strategy {
  id: string;
  label: string;
  investments: InvestmentDecision[];
}

/** Небольшое пространство инвестиционных решений: что и когда финансируем. */
export function enumerateStrategies(): Strategy[] {
  const zbo: (InvestmentDecision | null)[] = [null, { investment_id: 'ZBO', decision_year: 2036 }, { investment_id: 'ZBO', decision_year: 2037 }];
  const isru: (InvestmentDecision | null)[] = [
    null,
    { investment_id: 'LUNAR_ISRU', decision_year: 2036 },
    { investment_id: 'LUNAR_ISRU', decision_year: 2037 },
  ];
  const earthNew: (InvestmentDecision | null)[] = [
    null,
    { investment_id: 'EARTH_NEW', decision_year: 2035, exercise_year: 2035 },
    { investment_id: 'EARTH_NEW', decision_year: 2035, exercise_year: 2036 },
    { investment_id: 'EARTH_NEW', decision_year: 2036, exercise_year: 2037 },
  ];

  const out: Strategy[] = [];
  for (const z of zbo)
    for (const i of isru)
      for (const c of earthNew) {
        const investments = [z, i, c].filter((x): x is InvestmentDecision => x !== null);
        const parts = investments.map((inv) =>
          inv.investment_id === 'EARTH_NEW'
            ? `Earth-New ${inv.decision_year}/${inv.exercise_year ?? inv.decision_year}`
            : `${inv.investment_id === 'ZBO' ? 'ZBO' : 'ISRU'} ${inv.decision_year}`,
        );
        out.push({
          id: investments.map((x) => `${x.investment_id}${x.decision_year}${x.exercise_year ?? ''}`).join('+') || 'NO_INVEST',
          label: parts.length ? parts.join(' + ') : 'Без инвестиций',
          investments,
        });
      }
  return out;
}

/** Полная стоимость тонны, доставленной каналом в узел в конкретном году сценария. */
function effectiveCost(source_id: string, year: number, scenario_id: string): number {
  const source = sourceById(source_id);
  const scenario = SCENARIOS[scenario_id];
  const price = source.variable_cost_mln_per_t * sourceYearFactor(scenario.variable_price_multiplier, source.name, year, 1);
  const share = sourceYearFactor(scenario.actual_delivery_share, source.name, year, 1);
  const reservationRate =
    source.reservation_rate_mln_per_t_year_capacity *
    sourceYearFactor(scenario.reservation_rate_multiplier, source.name, year, 1);
  const perOrderedTon = price + reservationRate;
  return share > 0 ? perOrderedTon / share : Number.POSITIVE_INFINITY;
}

export interface BuildOptions {
  scenario_id: string;
  variant?: DemandVariant;
  assumptions?: Partial<TeamAssumptions>;
  /** Доля года, выше которой Emergency считался бы базовым каналом. */
  emergency_cap_share?: number;
}

/** Строит план снабжения под стратегию: заказы, резервирование, начальный запас. */
export function buildPlan(strategy: Strategy, opts: BuildOptions): Plan {
  const scenario = SCENARIOS[opts.scenario_id];
  const variant = opts.variant ?? 'base';
  const emergencyCap = opts.emergency_cap_share ?? 0.4;

  const plan = emptyPlan(`${strategy.id}__${opts.scenario_id}`, opts.scenario_id);
  plan.assumptions = { ...DEFAULT_ASSUMPTIONS, ...opts.assumptions };
  plan.decisions.investments = strategy.investments.map((i) => ({ ...i }));

  // Начальный запас покрывает 45-дневный резерв первого года
  const firstYearDemand = demandFor(getYears()[0], scenario, variant).total_t;
  plan.decisions.inventory_policy = {
    opening_inventory_t: Math.ceil(reserveRequirement(firstYearDemand) * 10) / 10,
    opening_source_id: 'A',
    delivery_profile: 'even',
  };

  let opening = plan.decisions.inventory_policy.opening_inventory_t;

  for (const year of getYears()) {
    const storage = storageForYear(plan, year);
    const demand = demandFor(year, scenario, variant).total_t;
    const nextYear = getYears()[getYears().indexOf(year) + 1];
    const targetEnd = reserveRequirement(nextYear ? demandFor(nextYear, scenario, variant).total_t : demand);

    const netNeed = Math.max(0, demand + targetEnd - opening);
    let remaining = netNeed / (1 - storage.loss_rate_on_throughput); // потери начисляются на валовое поступление

    const order = CASE.sources
      .map((s) => ({ source_id: s.source_id, cost: effectiveCost(s.source_id, year, opts.scenario_id) }))
      .sort((a, b) => a.cost - b.cost);

    let deliveredPlanned = 0;
    const emergencyLimit = emergencyCap * remaining;

    for (const { source_id } of order) {
      if (remaining <= 1e-9) break;
      const source = sourceById(source_id);
      const fraction = availabilityFraction(plan, source_id, year);
      if (fraction <= 0) continue;
      const share = sourceYearFactor(scenario.actual_delivery_share, source.name, year, 1);
      if (share <= 0) continue;

      const deliverableCap = source.capacity_t_per_year * fraction * share;
      let take = Math.min(remaining, deliverableCap);
      if (source_id === 'E') take = Math.min(take, emergencyLimit);
      if (take <= 1e-9) continue;

      // Объём заказа округляем вверх до 0,1 т: иначе округление вниз может
      // оставить запас на доли тонны ниже 45-дневного резерва
      const ordered = Math.min(roundUp(take / share), source.capacity_t_per_year * fraction);
      plan.decisions.supply_orders.push({ source_id, year, volume_t: ordered });
      if (source.reservation_rate_mln_per_t_year_capacity > 0)
        plan.decisions.capacity_reservations.push({
          source_id,
          year,
          capacity_t_per_year: roundUp(Math.min(ordered / Math.max(fraction, 1e-9), source.capacity_t_per_year)),
        });
      const delivered = ordered * share;
      remaining -= delivered;
      deliveredPlanned += delivered;
    }

    const grossInflow = deliveredPlanned;
    opening = Math.max(0, opening + grossInflow * (1 - storage.loss_rate_on_throughput) - demand);
    if (opening > storage.capacity_t) opening = storage.capacity_t;
  }

  return plan;
}

const roundUp = (v: number) => Math.ceil(v * 10) / 10;

export interface Evaluation {
  strategy_id: string;
  label: string;
  plan: Plan;
  result: SimulationResult;
  checks: ConstraintCheck[];
  violations: PlanViolation[];
  feasible: boolean;
  min_service_total: number;
  min_service_critical: number;
  discounted_cost_mln: number;
  total_cost_mln: number;
  capex_mln: number;
  shortage_total_t: number;
  /** Доля объёма, идущего по каналам без take-or-pay, — простая мера гибкости плана. */
  flexibility_share: number;
  /** Запас на конец 2040 года в днях спроса: показывает планы, доедающие резерв к концу горизонта. */
  end_horizon_reserve_days: number;
}

export function evaluatePlan(plan: Plan, opts: { scenario_id?: string; variant?: DemandVariant; label?: string } = {}): Evaluation {
  const result = simulate(plan, opts);
  const checks = checkConstraints(result, plan);
  const violations = planViolations(result, plan);
  const delivered = result.sources.reduce((s, r) => s + r.delivered_t, 0);
  const flexible = result.sources
    .filter((r) => sourceById(r.source_id).take_or_pay_share === 0)
    .reduce((s, r) => s + r.delivered_t, 0);

  return {
    strategy_id: plan.plan_id,
    label: opts.label ?? plan.plan_id,
    plan,
    result,
    checks,
    violations,
    feasible: isFeasible(checks, violations),
    min_service_total: Math.min(...result.years.map((y) => y.service_total)),
    min_service_critical: Math.min(...result.years.map((y) => y.service_critical)),
    discounted_cost_mln: result.totals.discounted_cost_mln,
    total_cost_mln: result.totals.total_cost_mln,
    capex_mln: result.totals.capex_mln,
    shortage_total_t: result.totals.shortage_total_t,
    flexibility_share: delivered > 0 ? flexible / delivered : 0,
    end_horizon_reserve_days: result.totals.end_horizon_reserve_days,
  };
}

/** Перебор стратегий на единой базе данных: возвращает оценки, отсортированные по приведённым расходам. */
export function searchStrategies(opts: BuildOptions): Evaluation[] {
  return enumerateStrategies()
    .map((strategy) => {
      const plan = buildPlan(strategy, opts);
      return evaluatePlan(plan, { scenario_id: opts.scenario_id, variant: opts.variant, label: strategy.label });
    })
    .sort((a, b) => Number(b.feasible) - Number(a.feasible) || a.discounted_cost_mln - b.discounted_cost_mln);
}

/** Множество Парето по приведённым расходам, минимальному сервису и гибкости. */
export function paretoFront(evaluations: Evaluation[]): Evaluation[] {
  return evaluations.filter(
    (a) =>
      !evaluations.some(
        (b) =>
          b !== a &&
          b.discounted_cost_mln <= a.discounted_cost_mln &&
          b.min_service_total >= a.min_service_total &&
          b.flexibility_share >= a.flexibility_share &&
          (b.discounted_cost_mln < a.discounted_cost_mln ||
            b.min_service_total > a.min_service_total ||
            b.flexibility_share > a.flexibility_share),
      ),
  );
}
