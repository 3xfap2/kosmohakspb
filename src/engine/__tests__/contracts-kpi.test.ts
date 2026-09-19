import { describe, expect, it } from 'vitest';
import { contractsForPlan, totalOverpay } from '../contracts';
import { kpis } from '../kpi';
import { searchStrategies } from '../planner';
import { monteCarlo } from '../risks';
import { DECISION_SCENARIOS, robustAnalysis } from '../robust';

const best = searchStrategies({ scenario_id: 'BASE' })[0];

describe('Договорные карточки', () => {
  const cards = contractsForPlan(best.plan, best);

  it('строятся по каждому каналу и отделяют данные кейса от предложений команды', () => {
    expect(cards).toHaveLength(5);
    for (const card of cards) {
      expect(card.terms.some((t) => t.status === 'CASE_INPUT')).toBe(true);
      expect(card.terms.some((t) => t.status === 'TEAM_ASSUMPTION')).toBe(true);
    }
  });

  it('оплаченный объём не меньше фактической поставки', () => {
    for (const card of cards) expect(card.paid_volume_t).toBeGreaterThanOrEqual(card.delivered_t - 1e-9);
  });

  it('переплата по take-or-pay считается по всем каналам', () => {
    const total = totalOverpay(cards);
    expect(total.tons).toBeGreaterThanOrEqual(0);
    expect(total.mln).toBeGreaterThanOrEqual(0);
  });

  it('у Earth-Core с take-or-pay 70% использование резерва не превышает единицы', () => {
    const core = cards.find((c) => c.source_id === 'A')!;
    expect(core.reservation_use).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe('KPI', () => {
  const list = kpis(best, monteCarlo(best.plan, 'BASE', { runs: 100, seed: 1 }));

  it('каждый показатель имеет формулу, цель и способ контроля', () => {
    expect(list.length).toBeGreaterThanOrEqual(9);
    for (const k of list) {
      expect(k.formula.length).toBeGreaterThan(5);
      expect(k.target.length).toBeGreaterThan(0);
      expect(k.control.length).toBeGreaterThan(10);
      expect(['ok', 'watch', 'bad']).toContain(k.status);
    }
  });

  it('показатели кейса и цели команды помечены раздельно', () => {
    expect(list.some((k) => k.source === 'CASE_INPUT')).toBe(true);
    expect(list.some((k) => k.source === 'TEAM_TARGET')).toBe(true);
  });

  it('сервис в KPI совпадает с расчётом плана', () => {
    const service = list.find((k) => k.id === 'SERVICE_TOTAL')!;
    expect(service.actual).toBeCloseTo(best.min_service_total, 9);
  });
});

describe('Робастный выбор', () => {
  const robust = robustAnalysis();

  it('считает расходы стратегии в каждом сценарии решения', () => {
    expect(robust.rows.length).toBe(36);
    for (const row of robust.rows.slice(0, 3))
      for (const scenario of DECISION_SCENARIOS) expect(row.costs[scenario.id]).toBeGreaterThan(0);
  });

  it('исключает стратегии, неисполнимые хотя бы в одном сценарии', () => {
    for (const row of robust.rows.filter((r) => !r.feasible_everywhere)) expect(row.max_regret).toBe(Number.POSITIVE_INFINITY);
    expect(robust.best_by_regret?.feasible_everywhere).toBe(true);
  });

  it('у лучшей по минимаксу стратегии сожаление не больше, чем у остальных пригодных', () => {
    const eligible = robust.rows.filter((r) => r.feasible_everywhere);
    for (const row of eligible) expect(robust.best_by_regret!.max_regret).toBeLessThanOrEqual(row.max_regret);
  });
});
