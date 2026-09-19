/**
 * Робастный выбор по минимаксу сожалений.
 *
 * Инвестиционное решение принимается заранее и одно на все условия, а объёмы поставок
 * подстраиваются под сценарий. Поэтому для каждой стратегии план строится отдельно
 * в каждом сценарии, а сравниваются приведённые расходы.
 *
 * Сожаление = расходы стратегии в сценарии минус лучшие расходы в этом же сценарии.
 * Стратегия, нарушающая ограничения хотя бы в одном сценарии, из выбора исключается:
 * дешевизна не компенсирует невыполнимость.
 */
import { buildPlan, enumerateStrategies, evaluatePlan } from './planner';
import type { DemandVariant } from './simulate';

export interface DecisionScenario {
  id: string;
  label: string;
  scenario_id: string;
  variant: DemandVariant;
}

export const DECISION_SCENARIOS: DecisionScenario[] = [
  { id: 'BASE', label: 'Стандартный', scenario_id: 'BASE', variant: 'base' },
  { id: 'STRESS', label: 'Обязательный стресс', scenario_id: 'MANDATORY_STRESS', variant: 'base' },
  { id: 'LOW', label: 'Низкий спрос', scenario_id: 'BASE', variant: 'low' },
  { id: 'HIGH', label: 'Высокий спрос', scenario_id: 'BASE', variant: 'high' },
];

export interface RegretRow {
  strategy: string;
  costs: Record<string, number>;
  feasible: Record<string, boolean>;
  regrets: Record<string, number>;
  max_regret: number;
  feasible_everywhere: boolean;
}

export interface RobustResult {
  rows: RegretRow[];
  best_by_regret: RegretRow | null;
  cheapest_in_base: RegretRow | null;
  /** Во сколько обходится робастный выбор относительно лучшего плана стандартного сценария. */
  price_of_robustness_mln: number;
}

export function robustAnalysis(): RobustResult {
  const strategies = enumerateStrategies();
  const raw = strategies.map((strategy) => {
    const costs: Record<string, number> = {};
    const feasible: Record<string, boolean> = {};

    for (const scenario of DECISION_SCENARIOS) {
      const plan = buildPlan(strategy, { scenario_id: scenario.scenario_id, variant: scenario.variant });
      const evaluation = evaluatePlan(plan, { scenario_id: scenario.scenario_id, variant: scenario.variant });
      costs[scenario.id] = evaluation.discounted_cost_mln;
      feasible[scenario.id] = evaluation.feasible;
    }
    return { strategy: strategy.label, costs, feasible };
  });

  // лучший результат в каждом сценарии считаем только по исполнимым планам
  const bestPerScenario: Record<string, number> = {};
  for (const scenario of DECISION_SCENARIOS) {
    const values = raw.filter((r) => r.feasible[scenario.id]).map((r) => r.costs[scenario.id]);
    bestPerScenario[scenario.id] = values.length ? Math.min(...values) : Number.NaN;
  }

  const rows: RegretRow[] = raw.map((r) => {
    const regrets: Record<string, number> = {};
    for (const scenario of DECISION_SCENARIOS)
      regrets[scenario.id] = r.feasible[scenario.id] ? r.costs[scenario.id] - bestPerScenario[scenario.id] : Number.POSITIVE_INFINITY;

    const feasibleEverywhere = DECISION_SCENARIOS.every((s) => r.feasible[s.id]);
    return {
      ...r,
      regrets,
      feasible_everywhere: feasibleEverywhere,
      max_regret: feasibleEverywhere ? Math.max(...DECISION_SCENARIOS.map((s) => regrets[s.id])) : Number.POSITIVE_INFINITY,
    };
  });

  const eligible = rows.filter((r) => r.feasible_everywhere).sort((a, b) => a.max_regret - b.max_regret);
  const best = eligible[0] ?? null;
  const cheapest = [...rows].filter((r) => r.feasible.BASE).sort((a, b) => a.costs.BASE - b.costs.BASE)[0] ?? null;

  return {
    rows: rows.sort((a, b) => a.max_regret - b.max_regret || a.costs.BASE - b.costs.BASE),
    best_by_regret: best,
    cheapest_in_base: cheapest,
    price_of_robustness_mln: best && cheapest ? best.costs.BASE - cheapest.costs.BASE : 0,
  };
}
