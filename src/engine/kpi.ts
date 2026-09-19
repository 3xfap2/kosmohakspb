/**
 * KPI надёжности и экономики: формула, цель, факт и способ контроля.
 * Цели, у которых нет источника в условиях кейса, помечены как решение команды.
 */
import { contractsForPlan, totalOverpay } from './contracts';
import type { Evaluation } from './planner';
import type { MonteCarloResult } from './risks';

export type KpiStatus = 'ok' | 'watch' | 'bad';

export interface Kpi {
  id: string;
  label: string;
  formula: string;
  unit: string;
  actual: number;
  target: string;
  status: KpiStatus;
  control: string;
  source: 'CASE_INPUT' | 'TEAM_TARGET';
}

const state = (ok: boolean, watch = false): KpiStatus => (ok ? (watch ? 'watch' : 'ok') : 'bad');

export function kpis(evaluation: Evaluation, mc?: MonteCarloResult): Kpi[] {
  const { result } = evaluation;
  const years = result.years;
  const emergency = result.sources.filter((s) => s.source_id === 'E').reduce((sum, s) => sum + s.delivered_t, 0);
  const delivered = result.sources.reduce((sum, s) => sum + s.delivered_t, 0);
  const overpay = totalOverpay(contractsForPlan(evaluation.plan, evaluation));
  const worstReserveDays = Math.min(
    ...years.map((y) => (y.total_demand_t > 0 ? (y.reserve_actual_t / y.total_demand_t) * 365 : 0)),
  );
  const lossShare = years.reduce((s, y) => s + y.losses_t, 0) / Math.max(delivered, 1e-9);

  const list: Kpi[] = [
    {
      id: 'SERVICE_TOTAL',
      label: 'Обслуживание общего спроса',
      formula: 'min по годам (обслужено ÷ спрос)',
      unit: 'доля',
      actual: evaluation.min_service_total,
      target: '≥ 0,97',
      status: state(evaluation.min_service_total >= 0.97),
      control: 'Проверяется в контуре по каждому году, нарушение выводится с годом и величиной',
      source: 'CASE_INPUT',
    },
    {
      id: 'SERVICE_CRITICAL',
      label: 'Обслуживание критического спроса',
      formula: 'min по годам (обслужено критич. ÷ критич. спрос)',
      unit: 'доля',
      actual: evaluation.min_service_critical,
      target: '≥ 0,99',
      status: state(evaluation.min_service_critical >= 0.99),
      control: 'Критический спрос обслуживается первым внутри месяца',
      source: 'CASE_INPUT',
    },
    {
      id: 'LCOP',
      label: 'Стоимость тонны обслуженного спроса',
      formula: '(закупка + резервирование + хранение + OPEX + CAPEX) ÷ обслуженный объём',
      unit: 'млн у.е./т',
      actual: result.totals.cost_per_served_t,
      target: '≤ 8,0 — ориентир команды',
      status: state(result.totals.cost_per_served_t <= 8, result.totals.cost_per_served_t > 7.5),
      control: 'Пересчитывается при любом изменении плана, сравнивается между стратегиями',
      source: 'TEAM_TARGET',
    },
    {
      id: 'RESERVE_DAYS',
      label: 'Резерв на начало года',
      formula: 'запас на начало года ÷ (спрос года ÷ 365)',
      unit: 'дней',
      actual: worstReserveDays,
      target: '≥ 45',
      status: state(worstReserveDays >= 45, worstReserveDays < 50),
      control: 'Проверка на начало каждого года, внутри года контролируется неотрицательность запаса',
      source: 'CASE_INPUT',
    },
    {
      id: 'END_RESERVE',
      label: 'Запас на конец горизонта',
      formula: 'запас на 31.12.2040 ÷ (спрос 2040 ÷ 365)',
      unit: 'дней',
      actual: result.totals.end_horizon_reserve_days,
      target: '≥ 45 — решение команды',
      status: state(result.totals.end_horizon_reserve_days >= 45, result.totals.end_horizon_reserve_days < 50),
      control: 'Не позволяет проходить проверки за счёт опустошения узла к концу горизонта',
      source: 'TEAM_TARGET',
    },
    {
      id: 'EMERGENCY_SHARE',
      label: 'Доля аварийного канала в поставках',
      formula: 'объём Emergency ÷ общий объём поставок',
      unit: 'доля',
      actual: delivered > 0 ? emergency / delivered : 0,
      target: '≤ 0,20 — решение команды',
      status: state(delivered > 0 ? emergency / delivered <= 0.2 : true),
      control: 'Отдельно проверяется ограничение кейса: не базовый канал более двух лет подряд',
      source: 'TEAM_TARGET',
    },
    {
      id: 'TOP_OVERPAY',
      label: 'Оплачено сверх полученного',
      formula: 'Σ (оплаченный объём − фактическая поставка) по каналам',
      unit: 'т',
      actual: overpay.tons,
      target: '→ 0',
      status: state(overpay.tons <= 1, overpay.tons > 0),
      control: 'Показывает цену обязательств take-or-pay и недопоставок: резервировать больше, чем отбираем, невыгодно',
      source: 'TEAM_TARGET',
    },
    {
      id: 'LOSS_SHARE',
      label: 'Потери к обороту',
      formula: 'Σ потерь ÷ Σ валового поступления',
      unit: 'доля',
      actual: lossShare,
      target: '≤ 0,045 — ориентир команды по базовому хранилищу; предел кейса один: ≤ 0,02 в стрессе',
      status: state(lossShare <= 0.045, lossShare > 0.02),
      control: 'Определяется режимом хранилища; в стрессе ограничение жёстче и требует модернизации',
      source: 'CASE_INPUT',
    },
    {
      id: 'CAPEX_LIMIT',
      label: 'CAPEX к лимиту 2040 года',
      formula: 'накопленный CAPEX ÷ 2800',
      unit: 'доля',
      actual: result.totals.capex_mln / 2800,
      target: '≤ 1,0',
      status: state(result.totals.capex_mln <= 2800, result.totals.capex_mln > 2200),
      control: 'Отдельно контролируется промежуточный лимит 1800 млн у.е. до конца 2037 года',
      source: 'CASE_INPUT',
    },
  ];

  if (mc)
    list.push({
      id: 'SHORTAGE_PROB',
      label: 'Вероятность дефицита за горизонт',
      formula: 'доля прогонов Монте-Карло с дефицитом',
      unit: 'доля',
      actual: mc.p_any_shortage,
      target: '≤ 0,20 — решение команды',
      status: state(mc.p_any_shortage <= 0.2, mc.p_any_shortage > 0.1),
      control: `Прогонов ${mc.runs}, seed ${mc.seed}; отказы каналов считаются независимыми`,
      source: 'TEAM_TARGET',
    });

  return list;
}
