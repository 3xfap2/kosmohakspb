/**
 * Загрузка исходных данных кейса. Файлы data/*.csv и scenarios/*.yaml скопированы
 * из стартового репозитория организатора без изменений и читаются как есть:
 * ни одно значение CASE_INPUT не переписано руками.
 */
import { load } from 'js-yaml';
import demandCsv from '../../data/demand.csv?raw';
import sourcesCsv from '../../data/supply_sources.csv?raw';
import storageCsv from '../../data/storage_options.csv?raw';
import investmentsCsv from '../../data/investment_options.csv?raw';
import constraintsCsv from '../../data/constraints.csv?raw';
import baseYaml from '../../scenarios/base.yaml?raw';
import stressYaml from '../../scenarios/mandatory_stress.yaml?raw';
import { num, numOrNull, parseCsv } from './csv';
import type { CaseData, ConstraintRow, DemandRow, InvestmentOption, LeadTimeUnit, Scenario, StorageOption, SupplySource } from './types';

export const CASE: CaseData = {
  demand: parseCsv(demandCsv).map<DemandRow>((r) => ({
    year: num(r.year),
    base_total_t: num(r.base_total_t),
    base_critical_t: num(r.base_critical_t),
    low_total_t: num(r.low_total_t),
    high_total_t: num(r.high_total_t),
  })),
  sources: parseCsv(sourcesCsv).map<SupplySource>((r) => ({
    source_id: r.source_id,
    name: r.name,
    capacity_t_per_year: num(r.capacity_t_per_year),
    variable_cost_mln_per_t: num(r.variable_cost_mln_per_t),
    reservation_rate_mln_per_t_year_capacity: num(r.reservation_rate_mln_per_t_year_capacity),
    take_or_pay_share: num(r.take_or_pay_share),
    lead_time_min_value: num(r.lead_time_min_value),
    lead_time_max_value: num(r.lead_time_max_value),
    lead_time_unit: r.lead_time_unit as LeadTimeUnit,
    reliability_profile: r.reliability_profile,
    available_from_year: numOrNull(r.available_from_year),
    notes: r.notes,
  })),
  storage: parseCsv(storageCsv).map<StorageOption>((r) => ({
    storage_id: r.storage_id,
    name: r.name,
    capacity_t: num(r.capacity_t),
    loss_rate_on_throughput: num(r.loss_rate_on_throughput),
    holding_cost_mln_per_t_year: num(r.holding_cost_mln_per_t_year),
    capex_mln: num(r.capex_mln),
    fixed_opex_mln_per_year: num(r.fixed_opex_mln_per_year),
    available_from_year: num(r.available_from_year),
  })),
  investments: parseCsv(investmentsCsv).map<InvestmentOption>((r) => ({
    investment_id: r.investment_id,
    name: r.name,
    option_fee_mln: num(r.option_fee_mln),
    exercise_cost_mln: num(r.exercise_cost_mln),
    total_capex_mln: num(r.total_capex_mln),
    commissioning_rule: r.commissioning_rule,
    fixed_opex_mln_per_year: num(r.fixed_opex_mln_per_year),
    notes: r.notes,
  })),
  constraints: parseCsv(constraintsCsv).map<ConstraintRow>((r) => ({
    constraint_id: r.constraint_id,
    metric: r.metric,
    operator: r.operator as '>=' | '<=',
    value: num(r.value),
    unit: r.unit,
    period: r.period,
    scenario: r.scenario,
    severity: r.severity,
    description: r.description,
  })),
};

export const SCENARIOS: Record<string, Scenario> = {
  BASE: load(baseYaml) as Scenario,
  MANDATORY_STRESS: load(stressYaml) as Scenario,
};

/**
 * Расширение горизонта за 2040 год — исследовательский сценарий на копии набора.
 * Строки помечаются статусом TEAM_ASSUMPTION и не подменяют данные организатора:
 * обязательное решение кейса считается на исходных годах.
 */
const BASE_DEMAND = CASE.demand.slice();
let horizonExtension: DemandRow[] = [];

export interface HorizonExtension {
  to_year: number;
  /** Годовой рост спроса после 2040 года, доля. */
  demand_growth: number;
  /** Пояснение способа экстраполяции — попадает в выгрузку. */
  method_note: string;
}

export function setHorizonExtension(ext: HorizonExtension | null): void {
  if (!ext) {
    horizonExtension = [];
    CASE.demand = BASE_DEMAND.slice();
    return;
  }
  const last = BASE_DEMAND[BASE_DEMAND.length - 1];
  const rows: DemandRow[] = [];
  let total = last.base_total_t;
  const criticalShare = last.base_critical_t / last.base_total_t;
  const lowShare = last.low_total_t / last.base_total_t;
  const highShare = last.high_total_t / last.base_total_t;
  for (let year = last.year + 1; year <= ext.to_year; year++) {
    total = total * (1 + ext.demand_growth);
    rows.push({
      year,
      base_total_t: Math.round(total * 10) / 10,
      base_critical_t: Math.round(total * criticalShare * 10) / 10,
      low_total_t: Math.round(total * lowShare * 10) / 10,
      high_total_t: Math.round(total * highShare * 10) / 10,
    });
  }
  horizonExtension = rows;
  CASE.demand = [...BASE_DEMAND, ...rows];
}

export const getHorizonExtension = (): DemandRow[] => horizonExtension;

export const getYears = (): number[] => CASE.demand.map((d) => d.year);
export const getBaseYears = (): number[] => BASE_DEMAND.map((d) => d.year);

export const sourceById = (id: string): SupplySource => {
  const s = CASE.sources.find((x) => x.source_id === id);
  if (!s) throw new Error(`Неизвестный канал снабжения: ${id}`);
  return s;
};

export const sourceByName = (name: string): SupplySource | undefined =>
  CASE.sources.find((x) => x.name === name);

/** Множитель из сценария: карта «год → коэффициент», по умолчанию 1. */
export const yearFactor = (map: Record<string, number> | undefined, year: number, fallback = 1): number =>
  map?.[String(year)] ?? map?.default ?? fallback;

/** Множитель по каналу и году (цены, фактические доли поставки). */
export const sourceYearFactor = (
  map: Record<string, Record<string, number>> | undefined,
  sourceName: string,
  year: number,
  fallback = 1,
): number => {
  const byYear = map?.[sourceName];
  if (!byYear) return fallback;
  const v = byYear[String(year)];
  return v ?? fallback;
};

/** Перевод lead time в месяцы. Конвенция перевода — явное допущение команды (TEAM_ASSUMPTION). */
export const DAYS_PER_MONTH = 365 / 12;

export function leadTimeMonths(source: SupplySource, policy: 'min' | 'max' | 'mid' = 'max'): number {
  const value =
    policy === 'min'
      ? source.lead_time_min_value
      : policy === 'max'
        ? source.lead_time_max_value
        : (source.lead_time_min_value + source.lead_time_max_value) / 2;
  switch (source.lead_time_unit) {
    case 'month':
      return value;
    case 'week':
      return (value * 7) / DAYS_PER_MONTH;
    case 'day':
      return value / DAYS_PER_MONTH;
    case 'year':
      return value * 12;
  }
}
