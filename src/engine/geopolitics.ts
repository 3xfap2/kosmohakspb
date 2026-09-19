/**
 * Блок геополитических изменений (бонусная часть кейса).
 *
 * Пользователь задаёт сценарное событие: какие каналы затронуты, какая составляющая
 * меняется, в какой период, на какую величину или в каком диапазоне. Модуль строит
 * причинную цепочку «изменение условий → параметр цены → расходы и решения оператора»,
 * пересчитывает план и позволяет вернуться к исходным ценам.
 *
 * Это условные сценарии, а не прогноз политических событий: вероятность не выдумывается,
 * основание каждого допущения указывается явно. Модуль работает на копии сценария и не
 * меняет обязательные контрольные расчёты.
 */
import { SCENARIOS, sourceById } from './caseData';
import { evaluatePlan, type Evaluation } from './planner';
import type { Plan } from './plan';
import type { DemandVariant } from './simulate';
import type { Scenario } from './types';

/** Какая составляющая условий меняется событием. */
export type GeoComponent = 'variable_price' | 'reservation_rate' | 'delivery_share';

export interface GeoEvent {
  event_id: string;
  label: string;
  description: string;
  affected_source_ids: string[];
  component: GeoComponent;
  from_year: number;
  to_year: number;
  /** Величина изменения: +0,25 — рост на 25%; для доли поставки это снижение на 25%. */
  magnitude: number;
  /** Обоснованный диапазон вместо точечной оценки, если статистики нет. */
  range?: [number, number];
  basis: string;
  /**
   * Разрешено ли начислять эффект поверх обязательного стресса в те же годы.
   * По умолчанию false: один и тот же ценовой шок не учитывается дважды.
   */
  stack_with_mandatory_stress: boolean;
}

export const GEO_PRESETS: GeoEvent[] = [
  {
    event_id: 'TRADE_RESTRICTIONS',
    label: 'Торговые ограничения на поставки с Земли',
    description: 'Ограничения на поставки компонентов и услуг запуска поднимают агрегированную цену доставки в узел.',
    affected_source_ids: ['A', 'B'],
    component: 'variable_price',
    from_year: 2037,
    to_year: 2040,
    magnitude: 0.2,
    range: [0.1, 0.35],
    basis: 'Сценарное допущение команды. Величина сопоставима с масштабом обязательного ценового шока +25%, заданного организатором.',
    stack_with_mandatory_stress: false,
  },
  {
    event_id: 'SUPPLIER_EXIT',
    label: 'Уход нового поставщика с рынка',
    description: 'Поставщик Earth-New прекращает обслуживание: фактическая поставка канала падает.',
    affected_source_ids: ['C'],
    component: 'delivery_share',
    from_year: 2038,
    to_year: 2040,
    magnitude: 0.5,
    range: [0.3, 1],
    basis: 'Сценарное допущение: реализация риска контрагента у канала с наименьшей подтверждённой надёжностью (0,88 в первый год).',
    stack_with_mandatory_stress: true,
  },
  {
    event_id: 'INSURANCE_LOGISTICS',
    label: 'Рост страховых и логистических затрат',
    description: 'Удорожание страхования и наземной логистики поднимает плату за резервирование мощности.',
    affected_source_ids: ['A', 'B', 'C', 'E'],
    component: 'reservation_rate',
    from_year: 2036,
    to_year: 2040,
    magnitude: 0.3,
    range: [0.15, 0.5],
    basis: 'Сценарное допущение: страховая составляющая относится к резервированию мощности, а не к цене тонны.',
    stack_with_mandatory_stress: true,
  },
];

/**
 * Годы, в которых сценарий уже меняет ту же составляющую того же канала.
 * Проверка обязана работать для всех составляющих, а не только для цены:
 * обязательный стресс задаёт долю фактической поставки лунного канала, и
 * пользовательское событие на поставку поверх него начислялось бы повторно.
 */
function yearsAlreadyShocked(base: Scenario, event: GeoEvent): number[] {
  const byComponent: Record<GeoComponent, Record<string, Record<string, number>> | undefined> = {
    variable_price: base.variable_price_multiplier,
    delivery_share: base.actual_delivery_share,
    reservation_rate: base.reservation_rate_multiplier,
  };
  const years: number[] = [];
  for (const id of event.affected_source_ids) {
    const name = sourceById(id).name;
    const byYear = byComponent[event.component]?.[name];
    if (!byYear) continue;
    for (let y = event.from_year; y <= event.to_year; y++) if ((byYear[String(y)] ?? 1) !== 1) years.push(y);
  }
  return [...new Set(years)];
}

export interface GeoApplication {
  scenario: Scenario;
  skipped_years: number[];
  magnitude: number;
}

/** Накладывает событие на копию сценария. Исходный сценарий не изменяется. */
export function applyGeoEvent(base: Scenario, event: GeoEvent, magnitude = event.magnitude): GeoApplication {
  const next: Scenario = JSON.parse(JSON.stringify(base));
  const skipped = event.stack_with_mandatory_stress ? [] : yearsAlreadyShocked(base, event);

  for (const id of event.affected_source_ids) {
    const name = sourceById(id).name;
    for (let year = event.from_year; year <= event.to_year; year++) {
      if (skipped.includes(year)) continue;
      const key = String(year);
      if (event.component === 'variable_price') {
        next.variable_price_multiplier = next.variable_price_multiplier ?? {};
        const current = next.variable_price_multiplier[name] ?? {};
        current[key] = (current[key] ?? 1) * (1 + magnitude);
        next.variable_price_multiplier[name] = current;
      } else if (event.component === 'reservation_rate') {
        next.reservation_rate_multiplier = next.reservation_rate_multiplier ?? {};
        const current = next.reservation_rate_multiplier[name] ?? {};
        current[key] = (current[key] ?? 1) * (1 + magnitude);
        next.reservation_rate_multiplier[name] = current;
      } else {
        next.actual_delivery_share = next.actual_delivery_share ?? {};
        const current = next.actual_delivery_share[name] ?? {};
        current[key] = (current[key] ?? 1) * (1 - magnitude);
        next.actual_delivery_share[name] = current;
      }
    }
  }

  next.scenario_id = `${base.scenario_id}+${event.event_id}`;
  next.status = 'TEAM_ASSUMPTION';
  next.notes = [
    ...(base.notes ?? []),
    `Исследовательский сценарий: ${event.label}. ${event.basis}`,
    skipped.length ? `Годы ${skipped.join(', ')} пропущены: обязательный стресс уже меняет эту составляющую, повторное начисление исключено.` : '',
  ].filter(Boolean);
  return { scenario: next, skipped_years: skipped, magnitude };
}

export interface ChainStep {
  step: string;
  value: string;
}

export interface GeoImpact {
  event: GeoEvent;
  magnitude: number;
  before: Evaluation;
  after: Evaluation;
  delta_cost_mln: number;
  delta_discounted_mln: number;
  delta_service: number;
  delta_shortage_t: number;
  skipped_years: number[];
  chain: ChainStep[];
  /** Оценка по нижней и верхней границе обоснованного диапазона. */
  range_costs?: { low: number; high: number };
}

/** Пересчёт плана при событии и построение причинной цепочки. */
export function assessGeoEvent(
  plan: Plan,
  scenario_id: string,
  event: GeoEvent,
  opts: { variant?: DemandVariant; magnitude?: number } = {},
): GeoImpact {
  const variant = opts.variant ?? 'base';
  const magnitude = opts.magnitude ?? event.magnitude;
  const base = SCENARIOS[scenario_id];
  const before = evaluatePlan(plan, { scenario_id, variant, label: 'до события' });

  const applied = applyGeoEvent(base, event, magnitude);
  SCENARIOS[applied.scenario.scenario_id] = applied.scenario;
  const after = evaluatePlan(plan, { scenario_id: applied.scenario.scenario_id, variant, label: 'после события' });

  const rangeCosts = event.range
    ? (() => {
        const run = (m: number) => {
          const a = applyGeoEvent(base, event, m);
          SCENARIOS[a.scenario.scenario_id + m] = { ...a.scenario, scenario_id: a.scenario.scenario_id + m };
          const cost = evaluatePlan(plan, { scenario_id: a.scenario.scenario_id + m, variant }).total_cost_mln;
          delete SCENARIOS[a.scenario.scenario_id + m];
          return cost;
        };
        return { low: run(event.range![0]), high: run(event.range![1]) };
      })()
    : undefined;

  delete SCENARIOS[applied.scenario.scenario_id];

  const names = event.affected_source_ids.map((id) => sourceById(id).name).join(', ');
  const componentLabel =
    event.component === 'variable_price'
      ? 'переменная цена доставки в узел'
      : event.component === 'reservation_rate'
        ? 'ставка платы за резервирование мощности'
        : 'фактическая доля поставки канала';

  const chain: ChainStep[] = [
    { step: 'Событие', value: `${event.label}, ${event.from_year}–${event.to_year}` },
    { step: 'Затронутые каналы', value: names },
    { step: 'Параметр', value: `${componentLabel}, изменение ${(magnitude * 100).toFixed(0)}%` },
    {
      step: 'Расходы оператора',
      value: `${before.total_cost_mln.toFixed(0)} → ${after.total_cost_mln.toFixed(0)} млн у.е. (${(after.total_cost_mln - before.total_cost_mln >= 0 ? '+' : '')}${(after.total_cost_mln - before.total_cost_mln).toFixed(0)})`,
    },
    {
      step: 'Обслуживание спроса',
      value: `${(before.min_service_total * 100).toFixed(1)}% → ${(after.min_service_total * 100).toFixed(1)}%`,
    },
    {
      step: 'Решение оператора',
      value:
        after.feasible && after.min_service_total >= before.min_service_total - 1e-9
          ? 'план остаётся исполнимым, пересмотр не требуется'
          : 'план требует пересмотра: объёмы по каналам или инвестиции',
    },
  ];

  return {
    event,
    magnitude,
    before,
    after,
    delta_cost_mln: after.total_cost_mln - before.total_cost_mln,
    delta_discounted_mln: after.discounted_cost_mln - before.discounted_cost_mln,
    delta_service: after.min_service_total - before.min_service_total,
    delta_shortage_t: after.shortage_total_t - before.shortage_total_t,
    skipped_years: applied.skipped_years,
    chain,
    range_costs: rangeCosts,
  };
}
