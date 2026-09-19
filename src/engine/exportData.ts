/**
 * Выгрузки. Конверт результата повторяет schemas/export.schema.json организатора:
 * scenario_id, plan_id, units, assumptions_reference, yearly_balance, source_schedule,
 * inventory_trace, financial_breakdown, constraint_checks, risk_register.
 * План сохраняется по schemas/plan.schema.json и открывается обратно.
 */
import type { Evaluation } from './planner';
import type { RiskAssessment } from './risks';
import type { Plan } from './plan';

export const UNITS = {
  volume: 't',
  money: 'mln_units',
  price: 'mln_units_per_t',
  service: 'share',
  reserve: 'days',
} as const;

export function buildExportEnvelope(evaluation: Evaluation, risks: RiskAssessment[] = []) {
  const { result, plan, checks, violations } = evaluation;
  return {
    scenario_id: result.scenario_id,
    plan_id: result.plan_id,
    demand_variant: result.demand_variant,
    units: UNITS,
    assumptions_reference: {
      status_note: 'CASE_INPUT — данные организатора; TEAM_DECISION — решения плана; TEAM_ASSUMPTION — допущения команды',
      team_assumptions: plan.assumptions,
      data_source: 'data/*.csv и scenarios/*.yaml из стартового репозитория организатора',
      calculation_rules: 'docs/CALCULATION_RULES.md; контрольные примеры V01–V10 в validation/',
    },
    yearly_balance: result.years,
    source_schedule: result.sources,
    inventory_trace: result.months,
    financial_breakdown: result.finance,
    constraint_checks: checks,
    plan_violations: violations,
    risk_register: risks.map((r) => ({
      risk_id: r.risk.risk_id,
      event: r.risk.event,
      cause: r.risk.cause,
      affected_parameter: r.risk.affected_parameter,
      period: r.risk.years,
      probability: r.risk.probability,
      probability_basis: r.risk.probability_basis,
      severity: r.risk.severity,
      delta_cost_mln: r.delta_cost_mln,
      shortage_t: r.shortage_t,
      min_service_total: r.min_service_total,
      constraint_breaks: r.constraint_breaks,
      owner: r.risk.owner,
      mitigation: r.risk.mitigation,
      residual: r.residual_note,
    })),
    totals: result.totals,
  };
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const header = Object.keys(rows[0]);
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // завершающий перевод строки: часть инструментов импорта спотыкается на его отсутствии
  return [header.join(','), ...rows.map((r) => header.map((h) => cell(r[h])).join(','))].join('\n') + '\n';
}

/** Длинный формат KPI по образцу examples/example_export_structure.csv. */
export function kpiCsv(evaluation: Evaluation): string {
  const { result } = evaluation;
  const rows: Record<string, unknown>[] = [];
  const push = (year: number | '', metric: string, value: number, unit: string) =>
    rows.push({ scenario_id: result.scenario_id, plan_id: result.plan_id, year, metric, value: round(value), unit });

  for (const y of result.years) {
    push(y.year, 'total_demand', y.total_demand_t, UNITS.volume);
    push(y.year, 'critical_demand', y.critical_demand_t, UNITS.volume);
    push(y.year, 'delivered', y.delivered_t, UNITS.volume);
    push(y.year, 'losses', y.losses_t, UNITS.volume);
    push(y.year, 'served_demand', y.served_total_t, UNITS.volume);
    push(y.year, 'shortage', y.shortage_t, UNITS.volume);
    push(y.year, 'closing_inventory', y.closing_t, UNITS.volume);
    push(y.year, 'total_service_level', y.service_total, UNITS.service);
    push(y.year, 'critical_service_level', y.service_critical, UNITS.service);
    push(y.year, 'reserve_required', y.reserve_required_t, UNITS.volume);
  }
  for (const f of result.finance) {
    push(f.year, 'procurement', f.procurement_mln, UNITS.money);
    push(f.year, 'reservation', f.reservation_mln, UNITS.money);
    push(f.year, 'holding', f.holding_mln, UNITS.money);
    push(f.year, 'fixed_opex', f.fixed_opex_mln, UNITS.money);
    push(f.year, 'capex', f.capex_mln, UNITS.money);
    push(f.year, 'total_cost', f.total_mln, UNITS.money);
    push(f.year, 'discounted_cost', f.discounted_mln, UNITS.money);
  }
  push('', 'total_cost_horizon', result.totals.total_cost_mln, UNITS.money);
  push('', 'discounted_cost_horizon', result.totals.discounted_cost_mln, UNITS.money);
  push('', 'capex_horizon', result.totals.capex_mln, UNITS.money);
  push('', 'cost_per_served_t', result.totals.cost_per_served_t, UNITS.price);
  push('', 'end_horizon_reserve_days', result.totals.end_horizon_reserve_days, UNITS.reserve);
  return toCsv(rows);
}

export function comparisonCsv(evaluations: Evaluation[]): string {
  return toCsv(
    evaluations.map((e) => ({
      scenario_id: e.result.scenario_id,
      strategy: e.label,
      plan_id: e.plan.plan_id,
      feasible: e.feasible,
      discounted_cost_mln: round(e.discounted_cost_mln),
      total_cost_mln: round(e.total_cost_mln),
      capex_mln: round(e.capex_mln),
      min_service_total: round(e.min_service_total, 4),
      min_service_critical: round(e.min_service_critical, 4),
      shortage_total_t: round(e.shortage_total_t),
      end_horizon_reserve_days: round(e.end_horizon_reserve_days, 1),
      flexibility_share: round(e.flexibility_share, 3),
      required_intake_t_per_month: round(e.required_intake_t_per_month, 1),
      failed_constraints: e.checks
        .filter((c) => !c.passed && c.role === 'hard')
        .map((c) => `${c.constraint_id}${c.year ? `:${c.year}` : ''}`)
        .join(' '),
    })),
  );
}

export const planJson = (plan: Plan): string => JSON.stringify(plan, null, 2);

export function parsePlanJson(text: string): Plan {
  const parsed = JSON.parse(text) as Plan;
  if (!parsed.plan_id || !parsed.scenario_id || !parsed.decisions)
    throw new Error('Файл не соответствует schemas/plan.schema.json: нужны plan_id, scenario_id и decisions');
  return parsed;
}

const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;
