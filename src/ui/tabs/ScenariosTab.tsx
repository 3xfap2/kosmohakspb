import { useMemo } from 'react';
import { evaluatePlan, paretoFront } from '../../engine/planner';
import { DECISION_SCENARIOS, robustAnalysis } from '../../engine/robust';
import { StrategyScatter } from '../charts';
import { fmt, fmtPct } from '../theme';
import type { TabProps } from '../tabProps';
import { Card, DataTable } from '../ui';

export function ScenariosTab({ plan, scenarioId, variant, evaluation, strategies, t }: TabProps) {
  const otherId = scenarioId === 'BASE' ? 'MANDATORY_STRESS' : 'BASE';
  const other = useMemo(() => evaluatePlan(plan, { scenario_id: otherId, variant }), [plan, otherId, variant]);
  const front = useMemo(() => paretoFront(strategies.filter((e) => e.feasible)), [strategies]);
  const robust = useMemo(() => robustAnalysis(), []);
  const feasible = strategies.filter((e) => e.feasible).length;
  const current = strategies.find((s) => s.plan.plan_id === plan.plan_id)?.label;

  const label = (id: string) => (id === 'BASE' ? 'Стандартный' : 'Обязательный стресс');

  // Значение, которое не проходит ограничение, подсвечивается: в этой таблице
  // и лежит главный вывод — один и тот же план в двух сценариях ведёт себя по-разному.
  const flag = (text: string, ok: boolean) => (ok ? text : <b className="v-bad">{text}</b>);

  return (
    <>
      <Card title="Один план, два сценария" subtitle="Решения не меняются, меняются условия — это и показывает устойчивость плана">
        <DataTable
          open
          numeric
          caption="Сравнение"
          head={['Показатель', label(scenarioId), label(otherId)]}
          rows={[
            ['Расходы, млн у.е.', fmt(evaluation.total_cost_mln), fmt(other.total_cost_mln)],
            ['Приведённые расходы', fmt(evaluation.discounted_cost_mln), fmt(other.discounted_cost_mln)],
            [
              'Минимальный сервис',
              flag(fmtPct(evaluation.min_service_total, 1), evaluation.min_service_total >= 0.97),
              flag(fmtPct(other.min_service_total, 1), other.min_service_total >= 0.97),
            ],
            [
              'Критический сервис',
              flag(fmtPct(evaluation.min_service_critical, 1), evaluation.min_service_critical >= 0.99),
              flag(fmtPct(other.min_service_critical, 1), other.min_service_critical >= 0.99),
            ],
            [
              'Дефицит, т',
              flag(fmt(evaluation.shortage_total_t, 1), evaluation.shortage_total_t === 0),
              flag(fmt(other.shortage_total_t, 1), other.shortage_total_t === 0),
            ],
            [
              'Запас на конец 2040, дней',
              flag(fmt(evaluation.end_horizon_reserve_days), evaluation.end_horizon_reserve_days >= 45),
              flag(fmt(other.end_horizon_reserve_days), other.end_horizon_reserve_days >= 45),
            ],
            [
              'Итог',
              flag(evaluation.feasible ? 'исполним' : 'нарушения', evaluation.feasible),
              flag(other.feasible ? 'исполним' : 'нарушения', other.feasible),
            ],
          ]}
        />
        {!other.feasible && (
          <p className="muted small-text">
            В сценарии «{label(otherId)}» этот план ломается: {other.checks.filter((c) => !c.passed && c.role === 'hard').slice(0, 3).map((c) => `${c.constraint_id}${c.year ? ` ${c.year}` : ''}`).join(', ') || other.violations[0]?.code}. Объёмы заказа
            фиксируются заранее, поэтому одним планом оба сценария не закрыть — разными должны быть объёмы, а инвестиции
            могут совпадать.
          </p>
        )}
      </Card>

      <Card
        title="Перебор стратегий"
        subtitle={`${strategies.length} вариантов инвестиционных решений на одной базе данных, исполнимы ${feasible}. По горизонтали — приведённые расходы, по вертикали — доля гибких каналов в поставках: дешевле обычно значит жёстче. Треугольники — планы с нарушениями.`}
      >
        <StrategyScatter evaluations={strategies} current={current} t={t} />
        <DataTable
          head={['Стратегия', 'Исполнима', 'Приведённые', 'Итого', 'CAPEX', 'Мин. сервис', 'Дефицит', 'Запас 2040', 'Парето']}
          rows={strategies.map((s) => [
            s.label,
            s.feasible ? 'да' : 'нет',
            fmt(s.discounted_cost_mln),
            fmt(s.total_cost_mln),
            fmt(s.capex_mln),
            fmtPct(s.min_service_total, 1),
            fmt(s.shortage_total_t, 1),
            fmt(s.end_horizon_reserve_days),
            front.includes(s) ? 'да' : '',
          ])}
        />
      </Card>

      <Card
        title="Робастный выбор по минимаксу сожалений"
        subtitle="Инвестиции выбираются заранее и одни на все условия, объёмы подстраиваются под сценарий. Сожаление — насколько стратегия дороже лучшей в этом же сценарии."
      >
        {robust.best_by_regret && robust.cheapest_in_base && (
          <div className="stats" style={{ marginBottom: 18 }}>
            <div className="stat">
              <div className="stat-label">Робастный выбор</div>
              <div className="stat-value" style={{ fontSize: 20 }}>
                {robust.best_by_regret.strategy}
              </div>
              <div className="stat-note">максимальное сожаление {fmt(robust.best_by_regret.max_regret)} млн у.е.</div>
            </div>
            <div className="stat">
              <div className="stat-label">Дешевле всего в стандартном сценарии</div>
              <div className="stat-value" style={{ fontSize: 20 }}>
                {robust.cheapest_in_base.strategy}
              </div>
              <div className="stat-note">
                но исполнима во всех сценариях: {robust.cheapest_in_base.feasible_everywhere ? 'да' : 'нет'}
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Плата за устойчивость</div>
              <div className="stat-value">{fmt(robust.price_of_robustness_mln)} млн</div>
              <div className="stat-note">разница в приведённых расходах стандартного сценария</div>
            </div>
          </div>
        )}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Стратегия</th>
                {DECISION_SCENARIOS.map((s) => (
                  <th key={s.id} className="num">
                    {s.label}
                  </th>
                ))}
                <th className="num">Макс. сожаление</th>
                <th>Во всех сценариях</th>
              </tr>
            </thead>
            <tbody>
              {robust.rows.slice(0, 12).map((row) => (
                <tr key={row.strategy}>
                  <td>{row.strategy}</td>
                  {DECISION_SCENARIOS.map((s) => (
                    <td key={s.id} className="num">
                      {row.feasible[s.id] ? fmt(row.costs[s.id]) : '—'}
                      <div className="muted small-text">
                        {row.feasible[s.id] ? `+${fmt(row.regrets[s.id])}` : 'нарушения'}
                      </div>
                    </td>
                  ))}
                  <td className="num">{row.feasible_everywhere ? fmt(row.max_regret) : '—'}</td>
                  <td className={row.feasible_everywhere ? 'status-ok' : 'status-bad'}>
                    <span className="dot" />
                    {row.feasible_everywhere ? 'исполнима' : 'нет'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small-text">
          Сценарии решения: стандартный, обязательный стресс, низкий и высокий спрос. Стратегия, нарушающая ограничения
          хотя бы в одном из них, из выбора исключается — дешевизна не компенсирует невыполнимость.
        </p>
      </Card>
    </>
  );
}
