/**
 * Проверка ограничений кейса. Правила берутся из data/constraints.csv (CASE_INPUT):
 * пороги не зашиты в код, а читаются из файла организатора вместе с их идентификаторами.
 *
 * Различаются два вида результатов:
 *  - hard: обязательное ограничение действующего сценария;
 *  - reference: ориентир устойчивости (требования сервиса заданы для BASE, в стрессе
 *    они показываются как ориентир, а нарушение отражается численно, а не скрывается).
 */
import { CASE, sourceById } from './caseData';
import { availabilityFraction, type SimulationResult } from './simulate';
import { orderFor, reservationFor, type Plan } from './plan';
import { capacityCheck } from './primitives';

export interface ConstraintCheck {
  constraint_id: string;
  metric: string;
  operator: '>=' | '<=';
  threshold: number;
  unit: string;
  period: string;
  scenario_scope: string;
  role: 'hard' | 'reference';
  year: number | null;
  actual: number;
  passed: boolean;
  description: string;
}

export interface PlanViolation {
  code:
    | 'CAPACITY_EXCEEDED'
    | 'ORDER_EXCEEDS_CAPACITY'
    | 'STORAGE_OVERFLOW'
    | 'INTAKE_EXCEEDED'
    | 'CHANNEL_NOT_AVAILABLE'
    | 'ISRU_FINANCING_LATE'
    | 'TEAM_RULE_RESERVATION'
    | 'INVALID_INPUT';
  source_id?: string;
  year?: number;
  actual: number;
  limit: number;
  message: string;
}

const compare = (actual: number, operator: '>=' | '<=', threshold: number): boolean =>
  operator === '>=' ? actual >= threshold - 1e-9 : actual <= threshold + 1e-9;

/** Годы, к которым относится ограничение, по полю period. */
function yearsForPeriod(period: string, years: number[]): number[] {
  if (period === 'annual') return years;
  if (period.startsWith('through_')) return [Number(period.slice('through_'.length))];
  const range = period.match(/^(\d{4})_(\d{4})$/);
  if (range) return years.filter((y) => y >= Number(range[1]) && y <= Number(range[2]));
  return years;
}

/** Максимальная серия подряд идущих лет, где Emergency был основным каналом снабжения. */
export function emergencyBaseStreak(result: SimulationResult, share_threshold: number): number {
  const years = result.years.map((y) => y.year);
  let streak = 0;
  let best = 0;
  for (const year of years) {
    const rows = result.sources.filter((s) => s.year === year);
    const delivered = rows.reduce((s, r) => s + r.delivered_t, 0);
    const emergency = rows.find((r) => r.source_id === 'E')?.delivered_t ?? 0;
    const isBase = delivered > 0 && emergency / delivered >= share_threshold;
    streak = isBase ? streak + 1 : 0;
    best = Math.max(best, streak);
  }
  return best;
}

function metricValue(metric: string, result: SimulationResult, plan: Plan, year: number | null): number {
  const y = year === null ? null : result.years.find((r) => r.year === year);
  switch (metric) {
    case 'critical_service_level':
      return y ? y.service_critical : 0;
    case 'total_service_level':
      return y ? y.service_total : 0;
    case 'cumulative_capex': {
      const row = result.finance.filter((f) => f.year <= (year ?? Infinity)).at(-1);
      return row ? row.cumulative_capex_mln : 0;
    }
    case 'reserve_equivalent_days':
      // Физический запас на начало года, выраженный в днях спроса этого года
      return y && y.total_demand_t > 0 ? (y.reserve_actual_t / y.total_demand_t) * 365 : 0;
    case 'emergency_base_channel_consecutive_years':
      return emergencyBaseStreak(result, plan.assumptions.emergency_base_share);
    case 'losses_divided_by_throughput':
      return y ? y.loss_share_of_throughput : 0;
    default:
      return Number.NaN;
  }
}

/**
 * Производные сценарии получают идентификатор вида «BASE+SENSisru0.9»: так их
 * помечают чувствительность, обратный стресс, реестр рисков, Монте-Карло и
 * геополитический блок. Ограничение, заданное для BASE, обязано оставаться
 * жёстким и на его производных — иначе требования сервиса молча превращаются
 * в ориентир ровно там, где ищется граница прочности плана.
 */
const baseScenarioId = (scenario_id: string): string => scenario_id.split('+')[0];

/**
 * Список нарушенных жёстких ограничений одной строкой. Нужен в каждой выгрузке,
 * где стоит колонка «исполним»: без причины `feasible=false` рядом с нулевым
 * дефицитом читается как ошибка модели.
 */
export function failedConstraintList(checks: ConstraintCheck[], violations: { code: string; year?: number }[] = []): string {
  const fromChecks = checks
    .filter((c) => !c.passed && c.role === 'hard')
    .map((c) => `${c.constraint_id}${c.year ? `:${c.year}` : ''}`);
  const fromViolations = violations.map((v) => `${v.code}${v.year ? `:${v.year}` : ''}`);
  return [...fromChecks, ...fromViolations].join(' ');
}

export function checkConstraints(result: SimulationResult, plan: Plan): ConstraintCheck[] {
  const years = result.years.map((y) => y.year);
  const checks: ConstraintCheck[] = [];

  for (const rule of CASE.constraints) {
    const applies = rule.scenario === 'ALL' || rule.scenario === baseScenarioId(result.scenario_id);
    const role: 'hard' | 'reference' = applies ? 'hard' : 'reference';
    // Ограничение только для другого сценария показываем как ориентир, но не для чужого стресса
    if (!applies && rule.scenario === 'MANDATORY_STRESS') continue;

    const perYear = rule.period === 'annual' || /^\d{4}_\d{4}$/.test(rule.period);
    const scope = yearsForPeriod(rule.period, years);

    if (perYear) {
      for (const year of scope) {
        const actual = metricValue(rule.metric, result, plan, year);
        checks.push({
          constraint_id: rule.constraint_id,
          metric: rule.metric,
          operator: rule.operator,
          threshold: rule.value,
          unit: rule.unit,
          period: rule.period,
          scenario_scope: rule.scenario,
          role,
          year,
          actual,
          passed: compare(actual, rule.operator, rule.value),
          description: rule.description,
        });
      }
    } else {
      const year = rule.period.startsWith('through_') ? Number(rule.period.slice(8)) : null;
      const actual = metricValue(rule.metric, result, plan, year);
      checks.push({
        constraint_id: rule.constraint_id,
        metric: rule.metric,
        operator: rule.operator,
        threshold: rule.value,
        unit: rule.unit,
        period: rule.period,
        scenario_scope: rule.scenario,
        role,
        year,
        actual,
        passed: compare(actual, rule.operator, rule.value),
        description: rule.description,
      });
    }
  }

  return checks;
}

/** Нарушения, не описанные строками constraints.csv: мощности, ёмкость, доступность каналов. */
export function planViolations(result: SimulationResult, plan: Plan): PlanViolation[] {
  const out: PlanViolation[] = [];

  for (const order of plan.decisions.supply_orders) {
    if (order.volume_t < 0)
      out.push({
        code: 'INVALID_INPUT',
        source_id: order.source_id,
        year: order.year,
        actual: order.volume_t,
        limit: 0,
        message: `Отрицательный объём заказа по каналу ${order.source_id} в ${order.year}`,
      });
  }

  for (const year of result.years.map((y) => y.year)) {
    for (const source of CASE.sources) {
      const capacity = source.capacity_t_per_year;
      const fraction = availabilityFraction(plan, source.source_id, year);
      const reserved = reservationFor(plan, source.source_id, year);
      const ordered = orderFor(plan, source.source_id, year);

      const capacityViolation = capacityCheck(reserved, capacity);
      if (capacityViolation)
        out.push({
          code: 'CAPACITY_EXCEEDED',
          source_id: source.source_id,
          year,
          actual: reserved,
          limit: capacity,
          message: `${source.name}: зарезервировано ${reserved} т/год при мощности ${capacity} т/год (превышение ${capacityViolation.excess_t} т/год)`,
        });

      if (ordered > capacity * fraction + 1e-9 && fraction > 0)
        out.push({
          code: 'ORDER_EXCEEDS_CAPACITY',
          source_id: source.source_id,
          year,
          actual: ordered,
          limit: capacity * fraction,
          message: `${source.name}: заказано ${ordered.toFixed(1)} т при доступной мощности ${(capacity * fraction).toFixed(1)} т в ${year}`,
        });

      if (
        plan.assumptions.require_reservation_for_orders &&
        source.reservation_rate_mln_per_t_year_capacity > 0 &&
        ordered > reserved + 1e-9
      )
        out.push({
          code: 'TEAM_RULE_RESERVATION',
          source_id: source.source_id,
          year,
          actual: ordered,
          limit: reserved,
          message: `${source.name}: заказ ${ordered.toFixed(1)} т превышает зарезервированную мощность ${reserved.toFixed(1)} т/год в ${year} (правило команды)`,
        });

      if (ordered > 0 && fraction === 0)
        out.push({
          code: 'CHANNEL_NOT_AVAILABLE',
          source_id: source.source_id,
          year,
          actual: ordered,
          limit: 0,
          message: `${source.name}: канал недоступен в ${year}, а заказано ${ordered.toFixed(1)} т`,
        });
    }
  }

  const isru = plan.decisions.investments.find((i) => i.investment_id === 'LUNAR_ISRU');
  if (isru && isru.decision_year > 2037)
    out.push({
      code: 'ISRU_FINANCING_LATE',
      year: isru.decision_year,
      actual: isru.decision_year,
      limit: 2037,
      message: 'CAPEX Lunar-ISRU должен быть профинансирован до 2038 года',
    });

  // Приёмная способность узла: поставка месяца должна быть физически принята.
  // Ограничение введено командой, поэтому нарушение называет и сам предел.
  const intakeLimit = plan.assumptions.intake_capacity_t_per_month;
  if (intakeLimit > 0) {
    for (const m of result.months) {
      if (m.delivered_t > intakeLimit + 1e-6)
        out.push({
          code: 'INTAKE_EXCEEDED',
          year: m.year,
          actual: m.delivered_t,
          limit: intakeLimit,
          message: `Приём ${m.year}-${String(m.month).padStart(2, '0')}: ${m.delivered_t.toFixed(1)} т при приёмной способности узла ${intakeLimit} т/мес (допущение команды)`,
        });
    }
  }

  for (const m of result.months) {
    if (m.overflow_t > 1e-6)
      out.push({
        code: 'STORAGE_OVERFLOW',
        year: m.year,
        actual: m.closing_t,
        limit: m.storage_capacity_t,
        message: `Переполнение хранилища ${m.year}-${String(m.month).padStart(2, '0')}: ${m.closing_t.toFixed(1)} т при ёмкости ${m.storage_capacity_t} т`,
      });
  }

  return out;
}

export const isFeasible = (checks: ConstraintCheck[], violations: PlanViolation[]): boolean =>
  violations.length === 0 && checks.every((c) => c.role !== 'hard' || c.passed);

/** Сводка по каналу — вспомогательное для интерфейса. */
export const channelName = (source_id: string): string => sourceById(source_id).name;
