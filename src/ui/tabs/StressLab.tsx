import { useMemo, useState } from 'react';
import { getBaseYears } from '../../engine/caseData';
import { sensitivity } from '../../engine/risks';
import { adaptationAnalysis, decisionDeadline, reverseStress } from '../../engine/stressLab';
import { SensitivityChart } from '../charts';
import { fmt, fmtPct, fmtSigned } from '../theme';
import type { TabProps } from '../tabProps';
import { Card, DataTable, Stat, Status } from '../ui';

const PARAMS = [
  { id: 'demand', label: 'Спрос' },
  { id: 'price_earth', label: 'Цена земных каналов' },
  { id: 'isru_delivery', label: 'Поставка ISRU' },
] as const;

export function StressLab({ plan, scenarioId, variant, t, horizonTo, setHorizonTo }: TabProps) {
  const [param, setParam] = useState<(typeof PARAMS)[number]['id']>('demand');
  const [learnYear, setLearnYear] = useState(2038);

  const sens = useMemo(() => sensitivity(plan, scenarioId, param), [plan, scenarioId, param]);
  const reverse = useMemo(() => reverseStress(plan, scenarioId, { variant }), [plan, scenarioId, variant]);
  const adaptation = useMemo(
    () => adaptationAnalysis(plan, { scenario_id: scenarioId, learn_year: learnYear, variant }),
    [plan, scenarioId, learnYear, variant],
  );
  const deadline = useMemo(
    () => decisionDeadline(plan, { scenario_id: scenarioId, variant }),
    [plan, scenarioId, variant],
  );

  const pct = (v: number | null) => (v === null ? 'не найден в диапазоне' : `${fmt((v - 1) * 100, 0)}%`);

  return (
    <>
      <Card
        title="Граница прочности плана"
        subtitle="Обратный стресс-тест: ищем не «плохой сценарий», а минимальное отклонение условий, при котором план перестаёт выполнять ограничения"
      >
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Рост спроса</div>
            <div className="stat-value">{pct(reverse.thresholds.demand_only)}</div>
            <div className="stat-note">при таком росте план ломается</div>
          </div>
          <div className="stat">
            <div className="stat-label">Рост цены земных каналов</div>
            <div className="stat-value">{pct(reverse.thresholds.price_only)}</div>
            <div className="stat-note">цена сама по себе редко ломает сервис</div>
          </div>
          <div className="stat">
            <div className="stat-label">Падение поставки ISRU</div>
            <div className="stat-value">
              {reverse.thresholds.isru_only === null ? 'не ломает' : `${fmt((1 - reverse.thresholds.isru_only) * 100)}%`}
            </div>
            <div className="stat-note">доля недопоставки лунного канала</div>
          </div>
        </div>

        {reverse.nearest_break && (
          <p className="muted" style={{ marginTop: 16 }}>
            Ближайшее сочетание условий, ломающее план: спрос {fmt(reverse.nearest_break.demand_factor * 100)}%, цена{' '}
            {fmt(reverse.nearest_break.price_factor * 100)}%, поставка ISRU{' '}
            {fmt(reverse.nearest_break.isru_share_factor * 100)}% от плана. Нарушается{' '}
            {reverse.nearest_break.failed.slice(0, 3).join(', ')}.
          </p>
        )}

        <DataTable
          head={['Спрос', 'Цена', 'ISRU', 'Мин. сервис', 'Дефицит, т', 'Расходы, млн', 'Итог']}
          rows={reverse.grid.map((p) => [
            `${fmt(p.demand_factor * 100)}%`,
            `${fmt(p.price_factor * 100)}%`,
            `${fmt(p.isru_share_factor * 100)}%`,
            fmtPct(p.min_service_total, 1),
            fmt(p.shortage_t, 1),
            fmt(p.total_cost_mln),
            p.feasible ? 'держит' : p.failed.slice(0, 2).join(', '),
          ])}
        />
      </Card>

      <Card
        title="Цена адаптации"
        subtitle="Условия ухудшились, и оператор узнал об этом не заранее. Что он успеет сделать, зависит от сроков поставки каналов."
      >
        <div className="console" style={{ marginBottom: 18 }}>
          <label className="inline">
            Узнали об ухудшении в начале
            <select value={learnYear} onChange={(e) => setLearnYear(Number(e.target.value))}>
              {getBaseYears().map((y) => (
                <option key={y} value={y}>
                  {y} года
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Вариант</th>
                <th>Реакция возможна с</th>
                <th className="num">Добрано, т</th>
                <th className="num">Δ расходов, млн</th>
                <th className="num">Дефицит после</th>
                <th className="num">Сервис после</th>
                <th>Итог</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <b>{adaptation.baseline.label}</b>
                  <div className="muted small-text">{adaptation.baseline.note}</div>
                </td>
                <td>—</td>
                <td className="num">0</td>
                <td className="num">0</td>
                <td className="num">{fmt(adaptation.baseline.shortage_after_t, 1)}</td>
                <td className="num">{fmtPct(adaptation.baseline.service_after, 1)}</td>
                <td>
                  <Status ok={adaptation.baseline.feasible} okText="держит" badText="не держит" />
                </td>
              </tr>
              {adaptation.options.map((o) => (
                <tr key={o.option_id}>
                  <td>
                    <b>{o.label}</b>
                    <div className="muted small-text">{o.note}</div>
                  </td>
                  <td>{o.first_effective_year ?? '—'}</td>
                  <td className="num">{fmt(o.added_volume_t, 1)}</td>
                  <td className="num">{fmtSigned(o.delta_cost_mln, 1)}</td>
                  <td className="num">{fmt(o.shortage_after_t, 1)}</td>
                  <td className="num">{fmtPct(o.service_after, 1)}</td>
                  <td>
                    <Status ok={o.feasible} okText="держит" badText="не держит" />
                    {!o.feasible && o.failed_constraints && (
                      <div className="muted small-text">{o.failed_constraints}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title="Дедлайн решения"
        subtitle="Тот же расчёт адаптации прогнан по всем годам горизонта: до какого момента ухудшение ещё можно отыграть и чем именно"
      >
        {deadline.baseline_shortage_t <= 1e-6 ? (
          <p className="muted">
            В этих условиях план дефицита не даёт, отыгрывать нечего. Дедлайн имеет смысл смотреть в сценарии, где план
            ломается, — переключите сценарий на «Стресс».
          </p>
        ) : (
          <>
            <div className="stats" style={{ marginBottom: 18 }}>
              <Stat
                label="Дефицит без реакции"
                value={`${fmt(deadline.baseline_shortage_t, 1)} т`}
                note="если ничего не менять"
              />
              <Stat
                label="Штатными каналами"
                value={deadline.last_regular_year ? `до ${deadline.last_regular_year} года` : 'не закрывается'}
                note="Earth-Core и Earth-Flex: сроки поставки и свободная мощность"
              />
              <Stat
                label="С аварийным каналом"
                value={deadline.last_any_year ? `до ${deadline.last_any_year} года` : 'не закрывается'}
                note="последний год, когда выдача ещё закрывается полностью"
                hero
              />
              <Stat
                label="Остаётся исполнимым"
                value={deadline.last_feasible_year ? `до ${deadline.last_feasible_year} года` : 'ни в один год'}
                note="закрыть выдачу и пройти все ограничения — разные вещи"
              />
            </div>

            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Узнали в начале</th>
                    <th>Штатные каналы</th>
                    <th>Любой канал</th>
                    <th>Чем закрывается дешевле всего</th>
                    <th className="num">Цена, млн</th>
                    <th>Проходит ограничения</th>
                    <th className="num">Остаток дефицита, т</th>
                  </tr>
                </thead>
                <tbody>
                  {deadline.rows.map((r) => (
                    <tr key={r.learn_year}>
                      <td>{r.learn_year} года</td>
                      <td>
                        <Status ok={r.closes_regular} okText="закрывают" badText="не закрывают" />
                      </td>
                      <td>
                        <Status ok={r.closes_any} okText="закрывает" badText="не закрывает" />
                      </td>
                      <td>{r.cheapest_label ?? '—'}</td>
                      <td className="num">{r.cheapest_cost_mln === null ? '—' : fmt(r.cheapest_cost_mln, 0)}</td>
                      <td>
                        {r.cheapest_label === null ? (
                          '—'
                        ) : r.cheapest_feasible ? (
                          <Status ok okText="да" />
                        ) : (
                          <span className="status-bad" title={r.cheapest_blocking}>
                            <span className="dot" />
                            нет: {r.cheapest_blocking}
                          </span>
                        )}
                      </td>
                      <td className="num">{r.residual_shortage_t <= 1e-6 ? '0,0' : <b className="v-bad">{fmt(r.residual_shortage_t, 1)}</b>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="muted small-text">
              Точка невозврата — это не срок поставки сам по себе, а комбинация срока и свободной мощности канала: к
              последним годам горизонта добирать объём уже некуда, поэтому дефицит остаётся при любом решении. Отдельно
              смотрите колонку «проходит ограничения»: аварийный канал успевает закрыть выдачу, но не восстанавливает
              45-дневный резерв, поэтому такой план закрывает спрос и всё равно остаётся неисполнимым по кейсу.
            </p>
          </>
        )}
      </Card>

      <Card title="Чувствительность" subtitle="Параметр сдвигается, решения плана остаются прежними">
        <div className="seg small">
          {PARAMS.map((p) => (
            <button key={p.id} className={param === p.id ? 'active' : ''} onClick={() => setParam(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="two-col">
          <div>
            <h4>Расходы за горизонт, млн у.е.</h4>
            <SensitivityChart points={sens} metric="cost" t={t} />
          </div>
          <div>
            <h4>Минимальный сервис</h4>
            <SensitivityChart points={sens} metric="service" t={t} />
          </div>
        </div>
        <p className="muted small-text">
          Расходы слабо реагируют на спрос: объёмы уже заказаны, а недопоставка не возвращает платёж. Реагирует сервис,
          он и задаёт границу применимости плана.
        </p>
      </Card>

      <Card
        title="Расчёт за пределами 2040 года"
        subtitle="Исследовательский сценарий на копии набора: спрос после 2040-го продлевается постоянным темпом 12% в год, ограничения кейса на эти годы не переносятся"
      >
        <div className="buttons">
          {[2043, 2045].map((y) => (
            <button key={y} className={horizonTo === y ? 'primary' : ''} onClick={() => setHorizonTo(y)}>
              Продлить до {y}
            </button>
          ))}
          <button onClick={() => setHorizonTo(null)} disabled={!horizonTo}>
            Вернуть 2035–2040
          </button>
        </div>
        <p className="muted small-text" style={{ marginTop: 12 }}>
          {horizonTo
            ? `Горизонт расширен до ${horizonTo} года. План под новые годы объёмов не содержит, поэтому дефицит там показывает, сколько мощности придётся законтрактовать заранее.`
            : 'Горизонт стандартный. Расширение показывает, хватает ли выбранных мощностей после 2040 года.'}
        </p>
      </Card>
    </>
  );
}
