import { describe, expect, it } from 'vitest';
import { CASE, SCENARIOS, getBaseYears, getYears, setHorizonExtension } from '../caseData';
import { GEO_PRESETS, applyGeoEvent, assessGeoEvent } from '../geopolitics';
import { CRITERIA, PROFILES, compareProfiles, normalizeValues, scoreByProfile, weightSensitivity } from '../mcda';
import { searchStrategies } from '../planner';
import { adaptationAnalysis, decisionDeadline, reverseStress } from '../stressLab';

const baseRanked = searchStrategies({ scenario_id: 'BASE' });
const plan = baseRanked[0].plan;

describe('Геополитический блок', () => {
  it('меняет только заданную составляющую и не трогает исходный сценарий', () => {
    const event = GEO_PRESETS.find((e) => e.event_id === 'TRADE_RESTRICTIONS')!;
    const before = JSON.stringify(SCENARIOS.BASE);
    const { scenario } = applyGeoEvent(SCENARIOS.BASE, event);

    expect(JSON.stringify(SCENARIOS.BASE)).toBe(before);
    expect(scenario.variable_price_multiplier?.['Earth-Core']?.['2037']).toBeCloseTo(1.2, 9);
    expect(scenario.variable_price_multiplier?.['Earth-Core']?.['2036']).toBeUndefined();
    expect(scenario.actual_delivery_share?.['Earth-Core']).toBeUndefined();
    expect(scenario.status).toBe('TEAM_ASSUMPTION');
  });

  it('не начисляет ценовой шок дважды поверх обязательного стресса', () => {
    const event = GEO_PRESETS.find((e) => e.event_id === 'TRADE_RESTRICTIONS')!;
    const { scenario, skipped_years } = applyGeoEvent(SCENARIOS.MANDATORY_STRESS, event);

    // В 2038 и 2039 обязательный стресс уже поднимает цену на 25%
    expect(skipped_years).toEqual(expect.arrayContaining([2038, 2039]));
    expect(scenario.variable_price_multiplier?.['Earth-Core']?.['2038']).toBeCloseTo(1.25, 9);
    expect(scenario.variable_price_multiplier?.['Earth-Core']?.['2037']).toBeCloseTo(1.2, 9);
  });

  it('считает последствия и строит причинную цепочку', () => {
    const impact = assessGeoEvent(plan, 'BASE', GEO_PRESETS[0]);
    expect(impact.delta_cost_mln).toBeGreaterThan(0);
    expect(impact.chain.length).toBeGreaterThanOrEqual(5);
    expect(impact.range_costs!.high).toBeGreaterThan(impact.range_costs!.low);
    expect(SCENARIOS['BASE+TRADE_RESTRICTIONS']).toBeUndefined();
  });

  it('удорожание резервирования повышает расходы, но не влияет на объёмы поставки', () => {
    const impact = assessGeoEvent(plan, 'BASE', GEO_PRESETS.find((e) => e.event_id === 'INSURANCE_LOGISTICS')!);
    expect(impact.delta_cost_mln).toBeGreaterThan(0);
    expect(impact.delta_shortage_t).toBeCloseTo(0, 6);
  });
});

describe('Интересы сторон и MCDA', () => {
  const evaluations = baseRanked.slice(0, 12);

  it('нормализация приводит критерий к 0..1 и учитывает направление', () => {
    const costs = normalizeValues(evaluations, 'cost');
    const cheapest = evaluations.reduce((a, b) => (a.discounted_cost_mln <= b.discounted_cost_mln ? a : b));
    expect(costs.get(cheapest.label)).toBeCloseTo(1, 9);
    expect([...costs.values()].every((v) => v >= -1e-9 && v <= 1 + 1e-9)).toBe(true);
  });

  it('веса профилей в сумме дают единицу', () => {
    for (const p of PROFILES) {
      const sum = CRITERIA.reduce((s, c) => s + p.weights[c.id], 0);
      expect(sum).toBeCloseTo(1, 6);
    }
  });

  it('разные стороны выбирают разные стратегии', () => {
    const comparison = compareProfiles(evaluations);
    expect(comparison).toHaveLength(PROFILES.length);
    expect(new Set(comparison.map((c) => c.top.label)).size).toBeGreaterThan(1);
  });

  it('вариант с провалом критического сервиса исключается при любых весах', () => {
    const broken = searchStrategies({ scenario_id: 'MANDATORY_STRESS' }).filter((e) => !e.feasible);
    const mixed = [...evaluations, ...broken.slice(0, 3)];
    for (const profile of PROFILES) {
      const rows = scoreByProfile(mixed, profile);
      for (const row of rows.filter((r) => r.excluded_reason)) expect(row.score).toBe(0);
      expect(rows[0].excluded_reason).toBeNull();
    }
  });

  it('чувствительность к весам показывает, меняется ли выбор', () => {
    const rows = weightSensitivity(evaluations, PROFILES[0]);
    expect(rows).toHaveLength(CRITERIA.length * 2);
    expect(rows.every((r) => typeof r.changed === 'boolean')).toBe(true);
  });
});

describe('Обратный стресс-тест', () => {
  const result = reverseStress(plan, 'BASE', { steps: 4 });

  it('находит границу по спросу', () => {
    expect(result.thresholds.demand_only).not.toBeNull();
    expect(result.thresholds.demand_only!).toBeGreaterThan(1);
  });

  it('находит ближайшее сочетание условий, ломающее план', () => {
    expect(result.nearest_break).not.toBeNull();
    expect(result.nearest_break!.failed.length).toBeGreaterThan(0);
  });

  it('исходные условия остаются исполнимыми', () => {
    const origin = result.grid.find((p) => p.demand_factor === 1 && p.price_factor === 1 && p.isru_share_factor === 1)!;
    expect(origin.feasible).toBe(true);
  });
});

describe('Адаптация во времени', () => {
  const stressPlan = searchStrategies({ scenario_id: 'BASE' })[0].plan;
  const { baseline, options } = adaptationAnalysis(stressPlan, { scenario_id: 'MANDATORY_STRESS', learn_year: 2038 });

  it('сохранение плана оставляет дефицит', () => {
    expect(baseline.shortage_after_t).toBeGreaterThan(0);
  });

  it('канал с длинным сроком поставки реагирует позже гибкого', () => {
    const flex = options.find((o) => o.option_id === 'ADAPT_B')!;
    const core = options.find((o) => o.option_id === 'ADAPT_A')!;
    expect(flex.first_effective_year!).toBeLessThanOrEqual(core.first_effective_year!);
  });

  it('адаптация уменьшает дефицит и стоит денег', () => {
    const best = options.filter((o) => o.added_volume_t > 0).sort((a, b) => a.shortage_after_t - b.shortage_after_t)[0];
    expect(best.shortage_after_t).toBeLessThan(baseline.shortage_after_t);
    expect(best.delta_cost_mln).toBeGreaterThan(0);
  });
});

describe('Горизонт за 2040 год', () => {
  it('расширяется на копии набора и возвращается обратно', () => {
    expect(getYears()).toEqual(getBaseYears());

    setHorizonExtension({ to_year: 2043, demand_growth: 0.12, method_note: 'постоянный темп роста последнего года' });
    expect(getYears().at(-1)).toBe(2043);
    expect(CASE.demand.at(-1)!.base_total_t).toBeGreaterThan(CASE.demand.find((d) => d.year === 2040)!.base_total_t);
    // доля критического спроса сохраняется
    const row = CASE.demand.at(-1)!;
    expect(row.base_critical_t / row.base_total_t).toBeCloseTo(250 / 390, 3);

    setHorizonExtension(null);
    expect(getYears()).toEqual(getBaseYears());
  });
});

describe('Дедлайн решения', () => {
  const best = searchStrategies({ scenario_id: 'BASE' })[0];
  const deadline = decisionDeadline(best.plan, { scenario_id: 'MANDATORY_STRESS' });

  it('покрывает весь горизонт по годам', () => {
    expect(deadline.rows.map((r) => r.learn_year)).toEqual(getBaseYears());
  });

  it('чем позже узнали, тем больше остаётся дефицита', () => {
    const residuals = deadline.rows.map((r) => r.residual_shortage_t);
    for (let i = 1; i < residuals.length; i++) expect(residuals[i]).toBeGreaterThanOrEqual(residuals[i - 1] - 1e-6);
  });

  it('последний год реакции — самый поздний из закрывающих дефицит', () => {
    const closing = deadline.rows.filter((r) => r.closes_any).map((r) => r.learn_year);
    expect(deadline.last_any_year).toBe(closing.length ? Math.max(...closing) : null);
  });

  it('если дефицит закрывается, названа цена и вариант', () => {
    for (const row of deadline.rows.filter((r) => r.closes_any)) {
      expect(row.cheapest_label).toBeTruthy();
      expect(row.cheapest_cost_mln).toBeGreaterThan(0);
      expect(row.residual_shortage_t).toBeLessThan(1e-6);
    }
  });

  it('в стандартном сценарии закрывать нечего', () => {
    const calm = decisionDeadline(best.plan, { scenario_id: 'BASE' });
    expect(calm.baseline_shortage_t).toBeLessThan(1e-6);
  });
});
