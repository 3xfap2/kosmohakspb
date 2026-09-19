/**
 * Стресс-лаборатория: обратный стресс-тест и цена адаптации.
 *
 * Обратный стресс-тест ищет сочетание условий, при котором план перестаёт выполнять
 * ограничения, — то есть границу прочности, а не просто «плохой сценарий».
 *
 * Анализ адаптации отвечает на вопрос кейса «что можно изменить, узнав об ухудшении
 * условий, и сколько это стоит»: решения ограничены сроками поставки, поэтому реакция
 * возможна не раньше, чем через lead time выбранного канала.
 */
import { SCENARIOS, getYears, leadTimeMonths, sourceById } from './caseData';
import { failedConstraintList } from './constraints';
import { evaluatePlan, type Evaluation } from './planner';
import { orderFor, reservationFor, type Plan } from './plan';
import type { DemandVariant } from './simulate';
import type { Scenario } from './types';

// ---------- Обратный стресс-тест ----------

export interface ShockPoint {
  demand_factor: number;
  price_factor: number;
  isru_share_factor: number;
  feasible: boolean;
  min_service_total: number;
  shortage_t: number;
  total_cost_mln: number;
  failed: string[];
}

function shockScenario(base: Scenario, demand: number, price: number, isru: number): Scenario {
  const next: Scenario = JSON.parse(JSON.stringify(base));
  next.scenario_id = `${base.scenario_id}+RS${demand}_${price}_${isru}`;
  next.demand_multiplier = next.demand_multiplier ?? {};
  next.critical_demand_multiplier = next.critical_demand_multiplier ?? {};
  next.variable_price_multiplier = next.variable_price_multiplier ?? {};
  next.actual_delivery_share = next.actual_delivery_share ?? {};

  for (const year of getYears()) {
    const key = String(year);
    next.demand_multiplier[key] = (next.demand_multiplier[key] ?? 1) * demand;
    next.critical_demand_multiplier[key] = (next.critical_demand_multiplier[key] ?? 1) * demand;
    for (const name of ['Earth-Core', 'Earth-Flex']) {
      const current = next.variable_price_multiplier[name] ?? {};
      current[key] = (current[key] ?? 1) * price;
      next.variable_price_multiplier[name] = current;
    }
    const isruShare = next.actual_delivery_share['Lunar-ISRU'] ?? {};
    isruShare[key] = Math.min(1, (isruShare[key] ?? 1) * isru);
    next.actual_delivery_share['Lunar-ISRU'] = isruShare;
  }
  return next;
}

function evaluateShock(plan: Plan, base: Scenario, point: [number, number, number], variant: DemandVariant): ShockPoint {
  const [demand, price, isru] = point;
  const scenario = shockScenario(base, demand, price, isru);
  SCENARIOS[scenario.scenario_id] = scenario;
  const evaluation = evaluatePlan(plan, { scenario_id: scenario.scenario_id, variant });
  delete SCENARIOS[scenario.scenario_id];

  return {
    demand_factor: demand,
    price_factor: price,
    isru_share_factor: isru,
    feasible: evaluation.feasible,
    min_service_total: evaluation.min_service_total,
    shortage_t: evaluation.shortage_total_t,
    total_cost_mln: evaluation.total_cost_mln,
    failed: [
      ...evaluation.checks.filter((c) => !c.passed && c.role === 'hard').map((c) => `${c.constraint_id}${c.year ? ` ${c.year}` : ''}`),
      ...new Set(evaluation.violations.map((v) => v.code)),
    ],
  };
}

export interface ReverseStressResult {
  /** Минимальный одиночный шок, ломающий план. */
  thresholds: {
    demand_only: number | null;
    price_only: number | null;
    isru_only: number | null;
  };
  /** Ближайшее к исходным условиям сочетание шоков, ломающее план. */
  nearest_break: ShockPoint | null;
  grid: ShockPoint[];
  steps: number;
}

/**
 * Поиск границы прочности. Сначала — по одному параметру, затем по сетке сочетаний;
 * «ближайшим» считается сочетание с минимальной суммой относительных отклонений.
 */
export function reverseStress(
  plan: Plan,
  scenario_id: string,
  opts: { variant?: DemandVariant; steps?: number } = {},
): ReverseStressResult {
  const variant = opts.variant ?? 'base';
  const base = SCENARIOS[scenario_id];
  const steps = opts.steps ?? 6;

  const singleThreshold = (build: (f: number) => [number, number, number], factors: number[]): number | null => {
    for (const f of factors) {
      const point = evaluateShock(plan, base, build(f), variant);
      if (!point.feasible) return f;
    }
    return null;
  };

  // Шаг сетки задаёт точность границы прочности: на шаге 10% первым «ломающим»
  // значением оказывалось −10% только потому, что −5% не проверялось.
  const up = Array.from({ length: steps }, (_, i) => 1 + (i + 1) * 0.05);
  const down = Array.from({ length: steps * 2 }, (_, i) => 1 - (i + 1) * 0.05);

  const thresholds = {
    demand_only: singleThreshold((f) => [f, 1, 1], up),
    price_only: singleThreshold((f) => [1, f, 1], up.map((f) => 1 + (f - 1) * 4)),
    isru_only: singleThreshold((f) => [1, 1, f], down),
  };

  const grid: ShockPoint[] = [];
  const demandGrid = [1, 1.05, 1.1, 1.15];
  const priceGrid = [1, 1.15, 1.3];
  const isruGrid = [1, 0.75, 0.5];
  for (const d of demandGrid)
    for (const p of priceGrid)
      for (const i of isruGrid) grid.push(evaluateShock(plan, base, [d, p, i], variant));

  const distance = (s: ShockPoint) =>
    Math.abs(s.demand_factor - 1) + Math.abs(s.price_factor - 1) + Math.abs(1 - s.isru_share_factor);
  const nearest = grid
    .filter((s) => !s.feasible)
    .sort((a, b) => distance(a) - distance(b))[0] ?? null;

  return { thresholds, nearest_break: nearest, grid, steps };
}

// ---------- Цена адаптации ----------

export interface AdaptationOption {
  option_id: string;
  label: string;
  /** Первый год, на который решение вообще может повлиять с учётом lead time. */
  first_effective_year: number | null;
  evaluation: Evaluation;
  added_volume_t: number;
  delta_cost_mln: number;
  shortage_after_t: number;
  service_after: number;
  feasible: boolean;
  /** Какие жёсткие ограничения нарушены после реакции. */
  failed_constraints: string;
  note: string;
}

/**
 * Что можно сделать, узнав об ухудшении условий в начале года learn_year.
 * Канал можно задействовать не раньше, чем через его lead time; Earth-Core с его
 * 12 месяцами реагирует только со следующего года, Emergency с 6 неделями — почти сразу.
 */
export function adaptationAnalysis(
  plan: Plan,
  opts: { scenario_id: string; learn_year: number; variant?: DemandVariant },
): { baseline: AdaptationOption; options: AdaptationOption[] } {
  const { scenario_id, learn_year } = opts;
  const variant = opts.variant ?? 'base';
  const years = getYears();

  const baselineEval = evaluatePlan(plan, { scenario_id, variant, label: 'сохранить план' });
  const baseline: AdaptationOption = {
    option_id: 'KEEP',
    label: 'Сохранить исходную стратегию',
    first_effective_year: null,
    evaluation: baselineEval,
    added_volume_t: 0,
    delta_cost_mln: 0,
    shortage_after_t: baselineEval.shortage_total_t,
    service_after: baselineEval.min_service_total,
    feasible: baselineEval.feasible,
    failed_constraints: failedConstraintList(baselineEval.checks, baselineEval.violations),
    note: 'Ничего не меняем: издержек нет, но дефицит остаётся',
  };

  const options: AdaptationOption[] = [];

  for (const source of ['B', 'E', 'A'].map((id) => sourceById(id))) {
    const leadMonths = leadTimeMonths(source, plan.assumptions.lead_time_policy);
    const firstYear = years.find((y) => y >= learn_year + Math.ceil(leadMonths / 12) - (leadMonths < 12 ? 1 : 0)) ?? null;
    const effectiveYears = firstYear === null ? [] : years.filter((y) => y >= firstYear);
    if (!effectiveYears.length) continue;

    const adapted: Plan = JSON.parse(JSON.stringify(plan));
    adapted.plan_id = `${plan.plan_id}+ADAPT_${source.source_id}`;
    let added = 0;

    for (const year of effectiveYears) {
      // Сколько не хватает в этом году по базовому прогону
      const row = baselineEval.result.years.find((y) => y.year === year);
      const gap = row ? row.shortage_t : 0;
      if (gap <= 1e-6) continue;

      const currentOrder = orderFor(adapted, source.source_id, year);
      // В первый год реакции доступна не вся годовая мощность: часть года уже прошла
      const fraction = year === firstYear && leadMonths < 12 ? Math.max(0.25, 1 - leadMonths / 12) : 1;
      const room = Math.max(0, source.capacity_t_per_year * fraction - currentOrder);
      const add = Math.min(gap * 1.05, room);
      if (add <= 1e-6) continue;

      adapted.decisions.supply_orders.push({ source_id: source.source_id, year, volume_t: Math.round(add * 10) / 10 });
      if (source.reservation_rate_mln_per_t_year_capacity > 0) {
        const currentReservation = reservationFor(adapted, source.source_id, year);
        adapted.decisions.capacity_reservations.push({
          source_id: source.source_id,
          year,
          capacity_t_per_year: Math.round(Math.min(source.capacity_t_per_year - currentReservation, add) * 10) / 10,
        });
      }
      added += add;
    }

    const evaluation = evaluatePlan(adapted, { scenario_id, variant, label: `адаптация через ${source.name}` });
    options.push({
      option_id: `ADAPT_${source.source_id}`,
      label: `Добрать объёмы через ${source.name}`,
      first_effective_year: firstYear,
      evaluation,
      added_volume_t: added,
      delta_cost_mln: evaluation.total_cost_mln - baselineEval.total_cost_mln,
      shortage_after_t: evaluation.shortage_total_t,
      service_after: evaluation.min_service_total,
      feasible: evaluation.feasible,
      failed_constraints: failedConstraintList(evaluation.checks, evaluation.violations),
      note:
        added <= 1e-6
          ? 'Свободной мощности канала не осталось: адаптация невозможна'
          : `Реакция возможна с ${firstYear} года: lead time ${source.lead_time_min_value}–${source.lead_time_max_value} ${source.lead_time_unit}`,
    });
  }

  return { baseline, options };
}

// ---------- Дедлайн решения ----------

/**
 * До какого года ухудшение ещё можно отыграть.
 *
 * Анализ адаптации отвечает на вопрос «сколько стоит реакция, если узнать в таком-то
 * году». Здесь тот же расчёт прогоняется по всем годам горизонта, чтобы получить
 * управленческий ответ: начиная с какого момента дефицит уже нечем закрыть.
 * Аварийный канал вынесен отдельно — он закрывает дефицит, но по условиям кейса
 * не может быть базовым каналом, поэтому «закрыли Emergency» и «успели штатно» —
 * это разные ответы.
 */
export interface DeadlineRow {
  learn_year: number;
  /** Дефицит закрывается без аварийного канала. */
  closes_regular: boolean;
  /** Дефицит закрывается хоть каким-то каналом, включая аварийный. */
  closes_any: boolean;
  /** Самый дешёвый вариант, который закрывает дефицит полностью. */
  cheapest_label: string | null;
  cheapest_cost_mln: number | null;
  /**
   * Проходит ли этот вариант жёсткие ограничения кейса. Закрыть выдачу и остаться
   * исполнимым — разные вещи: аварийный канал успевает закрыть спрос, но не
   * восстанавливает 45-дневный резерв.
   */
  cheapest_feasible: boolean;
  /** Что именно нарушено у самого дешёвого закрывающего варианта. */
  cheapest_blocking: string;
  /** Что остаётся, если выбрать лучший доступный вариант. */
  residual_shortage_t: number;
}

export interface DeadlineAnalysis {
  rows: DeadlineRow[];
  /** Последний год, когда ещё можно обойтись штатными каналами. */
  last_regular_year: number | null;
  /** Последний год, когда дефицит закрывается вообще, даже ценой нарушения резерва. */
  last_any_year: number | null;
  /** Последний год, когда после реакции план остаётся полностью исполнимым. */
  last_feasible_year: number | null;
  /** Дефицит, который нужно закрыть, если ничего не делать. */
  baseline_shortage_t: number;
}

export function decisionDeadline(
  plan: Plan,
  opts: { scenario_id: string; variant?: DemandVariant },
): DeadlineAnalysis {
  const rows: DeadlineRow[] = [];
  let baseline_shortage_t = 0;

  for (const learn_year of getYears()) {
    const { baseline, options } = adaptationAnalysis(plan, { ...opts, learn_year });
    baseline_shortage_t = baseline.shortage_after_t;

    const closing = options.filter((o) => o.shortage_after_t <= 1e-6);
    const regular = closing.filter((o) => o.option_id !== 'ADAPT_E');
    const cheapest = closing.length
      ? closing.reduce((best, o) => (o.delta_cost_mln < best.delta_cost_mln ? o : best))
      : null;
    const residual = options.length
      ? Math.min(...options.map((o) => o.shortage_after_t))
      : baseline.shortage_after_t;

    rows.push({
      learn_year,
      closes_regular: regular.length > 0,
      closes_any: closing.length > 0,
      cheapest_label: cheapest?.label ?? null,
      cheapest_cost_mln: cheapest?.delta_cost_mln ?? null,
      cheapest_feasible: cheapest?.feasible ?? false,
      cheapest_blocking: cheapest?.failed_constraints ?? '',
      residual_shortage_t: residual,
    });
  }

  const last = (filter: (r: DeadlineRow) => boolean) => {
    const hits = rows.filter(filter).map((r) => r.learn_year);
    return hits.length ? Math.max(...hits) : null;
  };

  return {
    rows,
    last_regular_year: last((r) => r.closes_regular),
    last_any_year: last((r) => r.closes_any),
    last_feasible_year: last((r) => r.closes_any && r.cheapest_feasible),
    baseline_shortage_t,
  };
}
