/**
 * Договорная обвязка каналов.
 *
 * Мощности, цены, lead time и take-or-pay — данные организатора (CASE_INPUT).
 * Ответственность сторон, правила пересмотра и порядок оплаты кейсом не заданы:
 * это предложение команды (TEAM_ASSUMPTION), оно помечено отдельно и не влияет
 * на контрольный расчёт — только на описание сделки и на исследовательские сценарии.
 */
import { CASE, sourceById } from './caseData';
import type { Evaluation } from './planner';
import { reservationFor, type Plan } from './plan';

export interface ContractTerm {
  label: string;
  value: string;
  status: 'CASE_INPUT' | 'TEAM_ASSUMPTION';
}

export interface ContractCard {
  source_id: string;
  counterparty: string;
  name: string;
  years: string;
  contracted_volume_t: number;
  delivered_t: number;
  paid_volume_t: number;
  /** Оплачено сверх фактически отобранного: цена обязательства take-or-pay. */
  overpaid_t: number;
  overpaid_mln: number;
  procurement_mln: number;
  reservation_mln: number;
  reserved_capacity_t: number;
  /** Насколько плотно используется зарезервированная мощность. */
  reservation_use: number;
  terms: ContractTerm[];
}

const COUNTERPARTIES: Record<string, string> = {
  A: 'Долгосрочный наземно-орбитальный оператор',
  B: 'Оператор гибких запусков',
  C: 'Новый поставщик наземно-орбитальной доставки',
  D: 'Оператор лунного производства',
  E: 'Оператор аварийных и спотовых поставок',
};

/** Предложение команды по ответственности сторон. В расчёт не входит. */
const LIABILITY: Record<string, string> = {
  A: 'Неустойка 15% стоимости недопоставленного объёма плюс приоритет допоставки в следующем квартале',
  B: 'Неустойка 10% стоимости недопоставленного объёма, компенсация разницы цены при замещении',
  C: 'Гарантия ввода мощности: при срыве срока возврат платы за право (90 млн у.е.)',
  D: 'Оплата по факту приёмки с 2039 года, до этого — по заказу с компенсацией 20% при поставке ниже 70% плана',
  E: 'Штраф за срыв срока активации 25% стоимости партии: канал существует ради скорости',
};

const REVISION: Record<string, string> = {
  A: 'Пересмотр объёма не чаще раза в год, уведомление за 12 месяцев, снижение не более 20% от законтрактованного',
  B: 'Объём подтверждается за 4 месяца до поставки, снижение без штрафа',
  C: 'Опцион исполняется до конца 2036 года, после ввода действует take-or-pay 50%',
  D: 'Объём пересматривается по факту выхода производства на мощность, шаг пересмотра — год',
  E: 'Мощность резервируется на год, объём вызывается по требованию в пределах резерва',
};

export function contractsForPlan(plan: Plan, evaluation: Evaluation): ContractCard[] {
  const rows = evaluation.result.sources;

  return CASE.sources.map((source) => {
    const mine = rows.filter((r) => r.source_id === source.source_id);
    const ordered = mine.reduce((s, r) => s + r.ordered_t, 0);
    const delivered = mine.reduce((s, r) => s + r.delivered_t, 0);
    const paid = mine.reduce((s, r) => s + r.payable_t, 0);
    const procurement = mine.reduce((s, r) => s + r.variable_payment_mln, 0);
    const reservation = mine.reduce((s, r) => s + r.reservation_payment_mln, 0);
    const activeYears = mine.filter((r) => r.ordered_t > 0 || r.reserved_t_per_year > 0).map((r) => r.year);
    const reservedTotal = evaluation.result.years.reduce(
      (s, y) => s + reservationFor(plan, source.source_id, y.year),
      0,
    );
    const overpaid = Math.max(0, paid - delivered);

    return {
      source_id: source.source_id,
      counterparty: COUNTERPARTIES[source.source_id] ?? 'Поставщик',
      name: source.name,
      years: activeYears.length ? `${activeYears[0]}–${activeYears.at(-1)}` : 'не используется',
      contracted_volume_t: ordered,
      delivered_t: delivered,
      paid_volume_t: paid,
      overpaid_t: overpaid,
      overpaid_mln: overpaid * (procurement / Math.max(paid, 1e-9)),
      procurement_mln: procurement,
      reservation_mln: reservation,
      reserved_capacity_t: reservedTotal,
      reservation_use: reservedTotal > 0 ? ordered / reservedTotal : 0,
      terms: [
        { label: 'Мощность канала', value: `${source.capacity_t_per_year} т/год`, status: 'CASE_INPUT' },
        { label: 'Цена доставки в узел', value: `${source.variable_cost_mln_per_t} млн у.е./т`, status: 'CASE_INPUT' },
        {
          label: 'Плата за резервирование',
          value: source.reservation_rate_mln_per_t_year_capacity
            ? `${source.reservation_rate_mln_per_t_year_capacity} млн у.е. за т/год мощности`
            : 'не предусмотрена',
          status: 'CASE_INPUT',
        },
        {
          label: 'Take-or-pay',
          value: source.take_or_pay_share ? `${Math.round(source.take_or_pay_share * 100)}% зарезервированного объёма` : 'нет',
          status: 'CASE_INPUT',
        },
        {
          label: 'Срок поставки',
          value: `${source.lead_time_min_value}–${source.lead_time_max_value} ${source.lead_time_unit}`,
          status: 'CASE_INPUT',
        },
        {
          label: 'Порядок оплаты',
          value: `Платёж = цена × max(заказ, ${Math.round(source.take_or_pay_share * 100)}% резерва). Недопоставка платёж не возвращает`,
          status: 'CASE_INPUT',
        },
        { label: 'Ответственность поставщика', value: LIABILITY[source.source_id], status: 'TEAM_ASSUMPTION' },
        { label: 'Правила пересмотра', value: REVISION[source.source_id], status: 'TEAM_ASSUMPTION' },
      ],
    };
  });
}

/** Сколько всего оплачено сверх фактически полученного объёма по всем каналам. */
export const totalOverpay = (cards: ContractCard[]) => ({
  tons: cards.reduce((s, c) => s + c.overpaid_t, 0),
  mln: cards.reduce((s, c) => s + c.overpaid_mln, 0),
});

export const sourceLabel = (id: string) => `${id} · ${sourceById(id).name}`;
