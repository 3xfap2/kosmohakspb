/**
 * Трассировка результата: откуда взялось конкретное число.
 * Для каждого показателя года собирается цепочка «формула → входы → результат»
 * со ссылкой на правило организатора или на решение команды.
 */
import { CASE, sourceById } from './caseData';
import type { Evaluation } from './planner';
import type { YearRow } from './simulate';

export interface TraceStep {
  title: string;
  formula: string;
  inputs: { label: string; value: string }[];
  output: string;
  rule: string;
}

const f = (v: number, d = 1) => v.toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d });

export function explainYear(evaluation: Evaluation, year: number): TraceStep[] {
  const { result, plan } = evaluation;
  const y = result.years.find((r) => r.year === year) as YearRow;
  const finance = result.finance.find((r) => r.year === year)!;
  const sources = result.sources.filter((r) => r.year === year && (r.ordered_t > 0 || r.reserved_t_per_year > 0));
  const months = result.months.filter((m) => m.year === year);
  const demandRow = CASE.demand.find((d) => d.year === year)!;
  const storage = CASE.storage.find((s) => s.storage_id === y.storage_id)!;

  return [
    {
      title: 'Спрос года',
      formula: 'спрос сценария = спрос кейса × множитель сценария',
      inputs: [
        { label: 'базовый общий спрос, data/demand.csv', value: `${f(demandRow.base_total_t, 0)} т` },
        { label: 'из них критический', value: `${f(demandRow.base_critical_t, 0)} т` },
        { label: 'вариант спроса', value: result.demand_variant },
        { label: 'сценарий', value: result.scenario_id },
      ],
      output: `${f(y.total_demand_t)} т, критический ${f(y.critical_demand_t)} т`,
      rule: 'Критический спрос входит в общий и не прибавляется к нему повторно (V09)',
    },
    {
      title: 'Поставки по каналам',
      formula: 'фактическая поставка = заказ × доля поставки сценария',
      inputs: sources.map((s) => ({
        label: `${s.source_id} · ${s.name}`,
        value: `заказ ${f(s.ordered_t)} т → поставка ${f(s.delivered_t)} т`,
      })),
      output: `${f(y.delivered_t)} т валового поступления`,
      rule: 'Доли поставки стресса не умножаются на надёжность канала (V10)',
    },
    {
      title: 'Потери при хранении',
      formula: 'потери = валовое поступление × коэффициент режима хранилища',
      inputs: [
        { label: 'поступление', value: `${f(y.delivered_t)} т` },
        { label: `режим хранилища ${storage.storage_id}`, value: `${(storage.loss_rate_on_throughput * 100).toFixed(1)}%` },
      ],
      output: `${f(y.losses_t)} т`,
      rule: 'Потери начисляются один раз на оборот, повторно на остаток не начисляются (V06)',
    },
    {
      title: 'Материальный баланс',
      formula: 'запас на конец = запас на начало + поставка − потери − выдача',
      inputs: [
        { label: 'запас на начало', value: `${f(y.opening_t)} т` },
        { label: 'поставка', value: `${f(y.delivered_t)} т` },
        { label: 'потери', value: `${f(y.losses_t)} т` },
        { label: 'выдано потребителям', value: `${f(y.served_total_t)} т` },
      ],
      output: `${f(y.closing_t)} т, дефицит ${f(y.shortage_t)} т`,
      rule: 'Дефицит показывается отдельно, отрицательный запас не используется (V01, V02)',
    },
    {
      title: 'Обслуживание спроса',
      formula: 'уровень сервиса = выдано ÷ спрос',
      inputs: [
        { label: 'выдано всего', value: `${f(y.served_total_t)} т` },
        { label: 'выдано критическим', value: `${f(y.served_critical_t)} т` },
        { label: 'проверка по месяцам', value: `${months.length} шагов расчёта` },
      ],
      output: `общий ${(y.service_total * 100).toFixed(1)}%, критический ${(y.service_critical * 100).toFixed(1)}%`,
      rule: 'Критический спрос обслуживается первым внутри месяца',
    },
    {
      title: 'Платежи за топливо',
      formula: 'платёж = цена × max(заказ, доля take-or-pay × зарезервированный объём)',
      inputs: sources.map((s) => {
        const source = sourceById(s.source_id);
        return {
          label: `${s.name}: резерв ${f(s.reserved_t_per_year, 0)} т/год, take-or-pay ${(source.take_or_pay_share * 100).toFixed(0)}%`,
          value: `оплачено ${f(s.payable_t)} т × ${f(s.price_mln_per_t, 2)} = ${f(s.variable_payment_mln)} млн`,
        };
      }),
      output: `закупка ${f(finance.procurement_mln)} млн у.е.`,
      rule: 'Минимум take-or-pay уже внутри max(), вторым платежом не добавляется (V03, V04)',
    },
    {
      title: 'Расходы года',
      formula: 'итого = закупка + резервирование + хранение + постоянный OPEX + CAPEX',
      inputs: [
        { label: 'закупка', value: `${f(finance.procurement_mln)} млн` },
        { label: 'резервирование мощности', value: `${f(finance.reservation_mln)} млн` },
        { label: 'хранение по среднему запасу', value: `${f(finance.holding_mln)} млн` },
        { label: 'постоянный OPEX', value: `${f(finance.fixed_opex_mln)} млн` },
        { label: 'CAPEX', value: `${f(finance.capex_mln)} млн` },
      ],
      output: `${f(finance.total_mln)} млн у.е., приведённые ${f(finance.discounted_mln)} млн`,
      rule: `Ставка дисконтирования ${(plan.assumptions.discount_rate * 100).toFixed(0)}% — допущение команды, приведение к ${plan.assumptions.discount_t0} году`,
    },
    {
      title: 'Резерв 45 дней',
      formula: 'требуется = спрос года × 45 ÷ 365, проверяется запас на начало года',
      inputs: [
        { label: 'спрос года', value: `${f(y.total_demand_t)} т` },
        { label: 'запас на начало года', value: `${f(y.reserve_actual_t)} т` },
      ],
      output: `требуется ${f(y.reserve_required_t)} т, фактически ${f((y.reserve_actual_t / y.total_demand_t) * 365)} дней`,
      rule: 'Конвенция организатора: 365 дней в учебном году (V07)',
    },
  ];
}
