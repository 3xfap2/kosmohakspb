// Типы исходных данных кейса. Поля повторяют колонки data/*.csv организатора
// (status всех величин там — CASE_INPUT, переименовывать их нельзя).

export type LeadTimeUnit = 'day' | 'week' | 'month' | 'year';

export interface SupplySource {
  source_id: string;
  name: string;
  capacity_t_per_year: number;
  variable_cost_mln_per_t: number;
  reservation_rate_mln_per_t_year_capacity: number;
  take_or_pay_share: number;
  lead_time_min_value: number;
  lead_time_max_value: number;
  lead_time_unit: LeadTimeUnit;
  reliability_profile: string;
  available_from_year: number | null;
  notes: string;
}

export interface DemandRow {
  year: number;
  base_total_t: number;
  base_critical_t: number;
  low_total_t: number;
  high_total_t: number;
}

export interface StorageOption {
  storage_id: string;
  name: string;
  capacity_t: number;
  loss_rate_on_throughput: number;
  holding_cost_mln_per_t_year: number;
  capex_mln: number;
  fixed_opex_mln_per_year: number;
  available_from_year: number;
}

export interface InvestmentOption {
  investment_id: string;
  name: string;
  option_fee_mln: number;
  exercise_cost_mln: number;
  total_capex_mln: number;
  commissioning_rule: string;
  fixed_opex_mln_per_year: number;
  notes: string;
}

export interface ConstraintRow {
  constraint_id: string;
  metric: string;
  operator: '>=' | '<=';
  value: number;
  unit: string;
  period: string;
  scenario: string;
  severity: string;
  description: string;
}

/** Сценарий организатора (scenarios/*.yaml). Множители по годам и каналам. */
export interface Scenario {
  scenario_id: string;
  label_ru?: string;
  status: string;
  demand_multiplier?: Record<string, number>;
  critical_demand_multiplier?: Record<string, number>;
  variable_price_multiplier?: Record<string, Record<string, number>>;
  /**
   * Расширение команды поверх формата организатора (схема допускает доп. поля):
   * множитель ставки платы за резервирование по каналу и году. Используется только
   * в исследовательских сценариях геополитического блока.
   */
  reservation_rate_multiplier?: Record<string, Record<string, number>>;
  actual_delivery_share?: Record<string, Record<string, number>>;
  loss_ceiling?: { enabled: boolean; from_year?: number; max_losses_divided_by_throughput?: number };
  notes?: string[];
}

export interface CaseData {
  demand: DemandRow[];
  sources: SupplySource[];
  storage: StorageOption[];
  investments: InvestmentOption[];
  constraints: ConstraintRow[];
}
