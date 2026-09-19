/**
 * Проверки автоподбора: план должен быть исполнимым в стандартном сценарии,
 * а в стрессе ограничения проверяются численно (дефицит не прячется).
 */
import { describe, expect, it } from 'vitest';
import { buildPlan, enumerateStrategies, evaluatePlan, paretoFront, searchStrategies } from '../planner';

describe('Подбор стратегии', () => {
  const base = searchStrategies({ scenario_id: 'BASE' });
  const best = base[0];

  it('перебирает инвестиционные решения', () => {
    expect(enumerateStrategies().length).toBe(3 * 3 * 4);
  });

  it('находит исполнимый план стандартного сценария', () => {
    expect(best.feasible).toBe(true);
    expect(best.min_service_total).toBeGreaterThanOrEqual(0.97);
    expect(best.min_service_critical).toBeGreaterThanOrEqual(0.99);
    expect(best.violations).toHaveLength(0);
  });

  it('в лучшем плане соблюдены лимиты CAPEX', () => {
    const capex2037 = best.checks.find((c) => c.constraint_id === 'CAPEX_2037')!;
    const capex2040 = best.checks.find((c) => c.constraint_id === 'CAPEX_2040')!;
    expect(capex2037.passed).toBe(true);
    expect(capex2040.passed).toBe(true);
  });

  it('45-дневный резерв выполняется в каждом году', () => {
    const reserve = best.checks.filter((c) => c.constraint_id === 'RESERVE_45D');
    expect(reserve).toHaveLength(6);
    expect(reserve.every((c) => c.passed)).toBe(true);
  });

  it('Emergency не становится базовым каналом', () => {
    const streak = best.checks.find((c) => c.constraint_id === 'EMERGENCY_BASE_STREAK')!;
    expect(streak.passed).toBe(true);
  });

  it('фронт Парето не пуст и входит в набор оценок', () => {
    const front = paretoFront(base.filter((e) => e.feasible));
    expect(front.length).toBeGreaterThan(0);
    expect(base).toEqual(expect.arrayContaining(front));
  });
});

describe('Стрессовый сценарий', () => {
  const stress = searchStrategies({ scenario_id: 'MANDATORY_STRESS' });
  const best = stress[0];

  it('лучший план стресса удерживает ограничение потерь ≤2% с 2038', () => {
    const loss = best.checks.filter((c) => c.constraint_id === 'STRESS_LOSS_LIMIT');
    expect(loss.length).toBeGreaterThan(0);
    expect(loss.every((c) => c.passed)).toBe(true);
  });

  it('план без ZBO нарушает предел потерь в стрессе — нарушение видно численно', () => {
    const noZbo = enumerateStrategies().find((s) => s.investments.every((i) => i.investment_id !== 'ZBO'))!;
    const evaluation = evaluatePlan(buildPlan(noZbo, { scenario_id: 'MANDATORY_STRESS' }), {
      scenario_id: 'MANDATORY_STRESS',
    });
    const loss = evaluation.checks.filter((c) => c.constraint_id === 'STRESS_LOSS_LIMIT');
    expect(loss.some((c) => !c.passed)).toBe(true);
    expect(evaluation.feasible).toBe(false);
  });
});
