import { useMemo, useState } from 'react';
import { CASE } from '../../engine/caseData';
import { kpis } from '../../engine/kpi';
import { explainYear } from '../../engine/trace';
import type { SimulationResult } from '../../engine/simulate';
import { InventoryChart, SupplyChart } from '../charts';
import { fmt, fmtPct, fmtSigned } from '../theme';
import type { TabProps } from '../tabProps';
import { Card, DataTable, Stat } from '../ui';

/** Схема цепочки поставок с фактическими потоками выбранного плана. */
function SupplyFlow({ result }: { result: SimulationResult }) {
  const delivered = CASE.sources.map((s) => ({
    id: s.source_id,
    name: s.name,
    volume: result.sources.filter((r) => r.source_id === s.source_id).reduce((sum, r) => sum + r.delivered_t, 0),
  }));
  const max = Math.max(...delivered.map((d) => d.volume), 1);
  const totalServed = result.totals.served_total_t;
  const critical = result.years.reduce((s, y) => s + y.served_critical_t, 0);

  return (
    <div className="flow">
      <div className="flow-col">
        {delivered.map((d) => (
          <div className="flow-node" key={d.id}>
            <div className="flow-title">
              {d.id} · {d.name}
            </div>
            <div className="flow-val">{fmt(d.volume)} т</div>
            <div className="flow-bar" style={{ width: `${Math.max(4, (d.volume / max) * 100)}%` }} />
          </div>
        ))}
      </div>

      <div className="flow-node hub">
        <div className="flow-title">Топливный узел</div>
        <div className="flow-val">{fmt(result.years.at(-1)!.storage_capacity_t)} т ёмкость</div>
        <p className="muted small-text" style={{ marginTop: 10 }}>
          приём · хранение · выдача
          <br />
          потери за горизонт {fmt(result.years.reduce((s, y) => s + y.losses_t, 0), 1)} т
        </p>
      </div>

      <div className="flow-col">
        <div className="flow-node">
          <div className="flow-title">Критические миссии</div>
          <div className="flow-val">{fmt(critical)} т</div>
          <div className="flow-bar" style={{ width: `${(critical / totalServed) * 100}%` }} />
        </div>
        <div className="flow-node">
          <div className="flow-title">Коммерческие миссии</div>
          <div className="flow-val">{fmt(totalServed - critical)} т</div>
          <div className="flow-bar" style={{ width: `${((totalServed - critical) / totalServed) * 100}%` }} />
        </div>
        <div className="flow-node">
          <div className="flow-title">Дефицит</div>
          <div className="flow-val">{fmt(result.totals.shortage_total_t, 1)} т</div>
        </div>
      </div>
    </div>
  );
}

export function Overview({ evaluation, plan, strategies, t }: TabProps) {
  const { result } = evaluation;
  const totals = result.totals;
  const indicators = useMemo(() => kpis(evaluation), [evaluation]);
  const [traceYear, setTraceYear] = useState<number | null>(null);
  const trace = useMemo(() => (traceYear ? explainYear(evaluation, traceYear) : null), [evaluation, traceYear]);
  const worstYear = [...result.years].sort((a, b) => a.service_total - b.service_total)[0];
  // База для сравнения — стратегия «ничего не строим»: она уже есть в переборе,
  // и разница с ней показывает, что именно дали инвестиционные решения.
  const noInvest = strategies.find((e) => e.plan.decisions.investments.length === 0);
  const emergencyUsed = result.sources.filter((s) => s.source_id === 'E').reduce((sum, s) => sum + s.delivered_t, 0);

  return (
    <>
      <div className="stats">
        <Stat
          hero
          label="Приведённые расходы"
          value={`${fmt(totals.discounted_cost_mln)} млн`}
          note={`всего за горизонт ${fmt(totals.total_cost_mln)} млн у.е.`}
        />
        <Stat label="Тонна обслуженного спроса" value={`${fmt(totals.cost_per_served_t, 2)} млн`} note="полная стоимость с учётом CAPEX" />
        <Stat
          label="Сервис в худшем году"
          value={fmtPct(evaluation.min_service_total, 1)}
          note={`${worstYear.year} год · критический ${fmtPct(evaluation.min_service_critical, 1)}`}
        />
        <Stat label="CAPEX" value={`${fmt(totals.capex_mln)} млн`} note="лимиты 1800 до 2037 и 2800 до 2040" />
        <Stat label="Запас на конец горизонта" value={`${fmt(totals.end_horizon_reserve_days)} дней`} note="норматив 45 дней на начало года" />
        <Stat
          label="Требуемый приём узла"
          value={`${fmt(evaluation.required_intake_t_per_month, 1)} т/мес`}
          note={`пиковый месяц плана при допущении ${plan.assumptions.intake_capacity_t_per_month} т/мес — запас ${fmtPct(
            1 - evaluation.required_intake_t_per_month / plan.assumptions.intake_capacity_t_per_month,
            0,
          )}`}
        />
      </div>

      {noInvest && noInvest.plan.plan_id !== plan.plan_id && (
        <Card
          title="Что дали инвестиционные решения"
          subtitle="Тот же спрос и те же ограничения, но без модернизации хранения и без собственного производства. Это нижняя граница, с которой честно сравнивать выбранный план."
        >
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Показатель</th>
                  <th className="num">Без инвестиций</th>
                  <th className="num">Выбранный план</th>
                  <th className="num">Разница</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Приведённые расходы, млн у.е.</td>
                  <td className="num">{fmt(noInvest.discounted_cost_mln)}</td>
                  <td className="num">{fmt(totals.discounted_cost_mln)}</td>
                  <td className="num">{fmtSigned(totals.discounted_cost_mln - noInvest.discounted_cost_mln)}</td>
                </tr>
                <tr>
                  <td>Полные расходы, млн у.е.</td>
                  <td className="num">{fmt(noInvest.total_cost_mln)}</td>
                  <td className="num">{fmt(totals.total_cost_mln)}</td>
                  <td className="num">{fmtSigned(totals.total_cost_mln - noInvest.total_cost_mln)}</td>
                </tr>
                <tr>
                  <td>CAPEX, млн у.е.</td>
                  <td className="num">{fmt(noInvest.capex_mln)}</td>
                  <td className="num">{fmt(totals.capex_mln)}</td>
                  <td className="num">{fmtSigned(totals.capex_mln - noInvest.capex_mln)}</td>
                </tr>
                <tr>
                  <td>Тонна обслуженного спроса, млн у.е.</td>
                  <td className="num">{fmt(noInvest.result.totals.cost_per_served_t, 2)}</td>
                  <td className="num">{fmt(totals.cost_per_served_t, 2)}</td>
                  <td className="num">{fmtSigned(totals.cost_per_served_t - noInvest.result.totals.cost_per_served_t, 2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Цепочка поставок" subtitle="Объёмы за горизонт по выбранному плану: откуда топливо приходит, где хранится и кому уходит">
        <SupplyFlow result={result} />
      </Card>

      <Card
        title="Поставки по каналам и спрос"
        subtitle="Столбцы — фактически поступивший объём, линия — спрос сценария, т/год. Нажмите на год в таблице, чтобы увидеть, откуда взялось каждое число."
      >
        <SupplyChart result={result} t={t} />

        <div className="table-scroll" style={{ marginTop: 16 }}>
          <table>
            <thead>
              <tr>
                <th>Год</th>
                <th className="num">Спрос</th>
                <th className="num">Критич.</th>
                <th className="num">Поставка</th>
                <th className="num">Потери</th>
                <th className="num">Обслужено</th>
                <th className="num">Дефицит</th>
                <th className="num">Запас</th>
                <th className="num">Сервис</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {result.years.map((y) => (
                <tr key={y.year} className={traceYear === y.year ? 'row-active' : ''}>
                  <td className="nowrap">{y.year}</td>
                  <td className="num">{fmt(y.total_demand_t, 1)}</td>
                  <td className="num">{fmt(y.critical_demand_t, 1)}</td>
                  <td className="num">{fmt(y.delivered_t, 1)}</td>
                  <td className="num">{fmt(y.losses_t, 1)}</td>
                  <td className="num">{fmt(y.served_total_t, 1)}</td>
                  <td className="num">{fmt(y.shortage_t, 1)}</td>
                  <td className="num">{fmt(y.closing_t, 1)}</td>
                  <td className="num">{fmtPct(y.service_total, 1)}</td>
                  <td>
                    <button className="link-btn" onClick={() => setTraceYear(traceYear === y.year ? null : y.year)}>
                      {traceYear === y.year ? 'скрыть' : 'разобрать'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {trace && (
          <div className="trace">
            <div className="trace-head">
              <b>Как получены числа {traceYear} года</b>
              <button className="ghost" onClick={() => setTraceYear(null)}>
                Закрыть
              </button>
            </div>
            {trace.map((step) => (
              <div className="trace-step" key={step.title}>
                <div className="trace-title">{step.title}</div>
                <code>{step.formula}</code>
                <ul>
                  {step.inputs.map((input, i) => (
                    <li key={i}>
                      <span className="muted">{input.label}</span>
                      <b>{input.value}</b>
                    </li>
                  ))}
                </ul>
                <div className="trace-out">
                  = {step.output}
                  <div className="muted small-text">{step.rule}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Запас в узле по месяцам" subtitle="Шаг расчёта — месяц, поэтому виден внутригодовой провал и переполнение, т">
        <InventoryChart result={result} t={t} />
      </Card>

      <Card
        title="KPI надёжности и экономики"
        subtitle="Каждый показатель с формулой, целью и способом контроля. Цели, не заданные кейсом, помечены как решение команды."
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Показатель</th>
                <th>Формула</th>
                <th className="num">Факт</th>
                <th>Цель</th>
                <th>Статус</th>
                <th>Контроль</th>
              </tr>
            </thead>
            <tbody>
              {indicators.map((k) => (
                <tr key={k.id}>
                  <td>
                    <b>{k.label}</b>
                    <div className="muted small-text">{k.source === 'CASE_INPUT' ? 'условие кейса' : 'цель команды'}</div>
                  </td>
                  <td className="muted small-text">{k.formula}</td>
                  <td className="num">
                    {k.unit === 'доля' ? fmtPct(k.actual, 1) : fmt(k.actual, k.actual < 100 ? 2 : 0)}
                    {k.unit !== 'доля' && k.unit !== 'т' ? '' : k.unit === 'т' ? ' т' : ''}
                  </td>
                  <td className="nowrap">{k.target}</td>
                  <td>
                    <span className={k.status === 'ok' ? 'status-ok' : k.status === 'watch' ? 'status-warn' : 'status-bad'}>
                      <span className="dot" />
                      {k.status === 'ok' ? 'норма' : k.status === 'watch' ? 'под наблюдением' : 'нарушение'}
                    </span>
                  </td>
                  <td className="muted small-text">{k.control}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Что важно в этом плане">
        <ul className="insights">
          <li>
            Худший год по обслуживанию — <b>{worstYear.year}</b>: {fmtPct(worstYear.service_total, 1)} общего спроса
            {worstYear.shortage_t > 0 ? `, недопоставлено ${fmt(worstYear.shortage_t, 1)} т` : ', дефицита нет'}.
          </li>
          <li>
            Закупка забирает{' '}
            <b>{fmtPct(result.finance.reduce((s, f) => s + f.procurement_mln, 0) / totals.total_cost_mln, 0)}</b> всех
            расходов, CAPEX — {fmtPct(totals.capex_mln / totals.total_cost_mln, 0)}. Экономить на цене тонны важнее, чем
            на вложениях.
          </li>
          <li>
            Emergency в плановом снабжении: <b>{emergencyUsed > 0.1 ? `${fmt(emergencyUsed, 1)} т` : 'не используется'}</b>. По
            условиям кейса он не может быть базовым каналом более двух лет подряд.
          </li>
          <li>
            Запас на конец 2040 года — <b>{fmt(totals.end_horizon_reserve_days)} дней</b>. Показатель отслеживает планы,
            которые формально проходят проверку резерва, но заканчивают горизонт пустым узлом.
          </li>
        </ul>
      </Card>
    </>
  );
}
