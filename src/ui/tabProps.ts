import type { Plan } from '../engine/plan';
import type { Evaluation } from '../engine/planner';
import type { DemandVariant } from '../engine/simulate';
import type { HistoryEntry } from './history';
import type { ChartTheme } from './theme';

export interface PlanChange {
  action: string;
  detail: string;
}

export interface TabProps {
  plan: Plan;
  /** Второй аргумент попадает в журнал решений. */
  setPlan: (updater: Plan | ((prev: Plan) => Plan), change?: PlanChange) => void;
  scenarioId: string;
  setScenarioId: (id: string) => void;
  variant: DemandVariant;
  evaluation: Evaluation;
  strategies: Evaluation[];
  t: ChartTheme;
  notify: (message: string) => void;
  horizonTo: number | null;
  setHorizonTo: (year: number | null) => void;
  history: HistoryEntry[];
  restore: (entry: HistoryEntry) => void;
  shareLink: () => string;
  goTo: (tab: string) => void;
}
