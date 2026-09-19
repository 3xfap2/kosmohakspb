import { useMemo, useState } from 'react';
import { CASE, SCENARIOS, getYears } from '../../engine/caseData';
import { buildExportEnvelope, comparisonCsv, kpiCsv, parsePlanJson, planJson, toCsv } from '../../engine/exportData';
import { emptyPlan, orderFor, type Plan } from '../../engine/plan';
import { evaluatePlan } from '../../engine/planner';
import { assessRisk, defaultRiskRegister } from '../../engine/risks';
import { download } from '../download';
import { historyCsv } from '../history';
import { clearProgress, loadProgress, savedAgo } from '../progress';
import { fmt, fmtPct, fmtSigned } from '../theme';
import type { TabProps } from '../tabProps';
import { Card } from '../ui';

export function ExportTab({
  plan,
  setPlan,
  scenarioId,
  variant,
  evaluation,
  strategies,
  notify,
  history,
  restore,
  shareLink,
}: TabProps) {
  const { result, checks } = evaluation;
  const [slots, setSlots] = useState<{ A: Plan | null; B: Plan | null }>({ A: null, B: null });

  const risks = useMemo(
    () => defaultRiskRegister().map((r) => assessRisk(plan, scenarioId, r, variant)),
    [plan, scenarioId, variant],
  );

  const diff = useMemo(() => {
    if (!slots.A || !slots.B) return null;
    const a = evaluatePlan(slots.A, { scenario_id: scenarioId, variant, label: 'План А' });
    const b = evaluatePlan(slots.B, { scenario_id: scenarioId, variant, label: 'План Б' });
    const rows = getYears().flatMap((year) =>
      CASE.sources
        .map((s) => ({
          year,
          source: `${s.source_id} · ${s.name}`,
          a: orderFor(slots.A!, s.source_id, year),
          b: orderFor(slots.B!, s.source_id, year),
        }))
        .filter((r) => Math.abs(r.a - r.b) > 1e-9),
    );
    return { a, b, rows };
  }, [slots, scenarioId, variant]);

  const rows = (data: unknown) => data as unknown as Record<string, unknown>[];

  return (
    <>
      <Card
        title="Сохранение работы"
        subtitle="План, сценарий и открытый раздел сохраняются в браузере автоматически: после перезагрузки или потери связи разбор продолжается с того же места"
      >
        <p className="muted small-text">
          Последнее сохранение: {savedAgo(loadProgress()) ?? 'ещё не было'}. Ничего никуда не отправляется — данные
          остаются в браузере.
        </p>
        <div className="buttons" style={{ marginTop: 12 }}>
          <button
            onClick={() => {
              clearProgress();
              notify('Сохранённая работа удалена. Обновите страницу, чтобы начать с плана по умолчанию');
            }}
          >
            Очистить сохранённое
          </button>
        </div>
      </Card>

      <Card title="Ссылка на расчёт" subtitle="Состояние плана, сценария и варианта спроса кодируется в адресе: проверяющий откроет ровно то, что вы показывали">
        <div className="buttons">
          <button
            className="primary"
            onClick={async () => {
              const link = shareLink();
              try {
                await navigator.clipboard.writeText(link);
                notify('Ссылка на текущий расчёт скопирована в буфер обмена');
              } catch {
                window.prompt('Скопируйте ссылку на расчёт', link);
              }
            }}
          >
            Скопировать ссылку на расчёт
          </button>
          <button onClick={() => window.print()}>Печать отчёта или PDF</button>
        </div>
      </Card>

      <Card title="Выгрузка результатов" subtitle="Структура конверта повторяет схему организатора, числа совпадают с тем, что на экране">
        <div className="buttons">
          <button onClick={() => download(`kpi_${result.scenario_id}_${result.plan_id}.csv`, kpiCsv(evaluation))}>
            KPI по годам
          </button>
          <button onClick={() => download(`balance_${result.scenario_id}.csv`, toCsv(rows(result.years)))}>
            Материальный баланс
          </button>
          <button onClick={() => download(`sources_${result.scenario_id}.csv`, toCsv(rows(result.sources)))}>
            План по каналам
          </button>
          <button onClick={() => download(`inventory_${result.scenario_id}.csv`, toCsv(rows(result.months)))}>
            Запас по месяцам
          </button>
          <button onClick={() => download(`checks_${result.scenario_id}.csv`, toCsv(rows(checks)))}>
            Проверки ограничений
          </button>
          <button onClick={() => download(`strategies_${scenarioId}.csv`, comparisonCsv(strategies))}>
            Сравнение стратегий
          </button>
          <button
            className="primary"
            onClick={() =>
              download(
                `export_${result.scenario_id}_${result.plan_id}.json`,
                JSON.stringify(buildExportEnvelope(evaluation, risks), null, 2),
                'application/json',
              )
            }
          >
            Полный конверт, JSON
          </button>
        </div>
      </Card>

      <Card title="Планы" subtitle="План сохраняется в формате схемы организатора и открывается обратно без потери результата">
        <div className="buttons">
          <button onClick={() => download(`plan_${plan.plan_id}.json`, planJson(plan), 'application/json')}>
            Сохранить план
          </button>
          <label className="file-button">
            Открыть план
            <input
              type="file"
              accept="application/json"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                try {
                  const loaded = parsePlanJson(await file.text());
                  setPlan(loaded, { action: 'Загрузка плана', detail: `Файл ${file.name}` });
                  notify(`План «${loaded.plan_id}» загружен, расчёт пересобран`);
                } catch (error) {
                  notify(`Не удалось открыть файл: ${(error as Error).message}`);
                }
                e.target.value = '';
              }}
            />
          </label>
          <button onClick={() => setPlan(emptyPlan('empty', scenarioId), { action: 'Очистка плана', detail: 'Все решения сброшены' })}>
            Очистить план
          </button>
        </div>
      </Card>

      <Card title="Сравнение двух планов" subtitle="Запомните два варианта и посмотрите, чем именно они отличаются по годам и каналам">
        <div className="buttons" style={{ marginBottom: 16 }}>
          <button onClick={() => setSlots((s) => ({ ...s, A: structuredClone(plan) }))}>Запомнить как план А</button>
          <button onClick={() => setSlots((s) => ({ ...s, B: structuredClone(plan) }))}>Запомнить как план Б</button>
          <button onClick={() => setSlots({ A: null, B: null })} disabled={!slots.A && !slots.B}>
            Очистить
          </button>
          <span className="muted small-text" style={{ alignSelf: 'center' }}>
            А: {slots.A?.plan_id ?? 'не задан'} · Б: {slots.B?.plan_id ?? 'не задан'}
          </span>
        </div>

        {!diff ? (
          <p className="muted">Запомните оба плана, чтобы увидеть разницу.</p>
        ) : (
          <>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Показатель</th>
                    <th className="num">План А</th>
                    <th className="num">План Б</th>
                    <th className="num">Разница</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Приведённые расходы, млн</td>
                    <td className="num">{fmt(diff.a.discounted_cost_mln)}</td>
                    <td className="num">{fmt(diff.b.discounted_cost_mln)}</td>
                    <td className="num">{fmtSigned(diff.b.discounted_cost_mln - diff.a.discounted_cost_mln)}</td>
                  </tr>
                  <tr>
                    <td>CAPEX, млн</td>
                    <td className="num">{fmt(diff.a.capex_mln)}</td>
                    <td className="num">{fmt(diff.b.capex_mln)}</td>
                    <td className="num">{fmtSigned(diff.b.capex_mln - diff.a.capex_mln)}</td>
                  </tr>
                  <tr>
                    <td>Минимальный сервис</td>
                    <td className="num">{fmtPct(diff.a.min_service_total, 1)}</td>
                    <td className="num">{fmtPct(diff.b.min_service_total, 1)}</td>
                    <td className="num">{fmtSigned((diff.b.min_service_total - diff.a.min_service_total) * 100, 1)} п.п.</td>
                  </tr>
                  <tr>
                    <td>Дефицит, т</td>
                    <td className="num">{fmt(diff.a.shortage_total_t, 1)}</td>
                    <td className="num">{fmt(diff.b.shortage_total_t, 1)}</td>
                    <td className="num">{fmtSigned(diff.b.shortage_total_t - diff.a.shortage_total_t, 1)}</td>
                  </tr>
                  <tr>
                    <td>Исполнимость</td>
                    <td className="num">{diff.a.feasible ? 'да' : 'нет'}</td>
                    <td className="num">{diff.b.feasible ? 'да' : 'нет'}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </div>

            {diff.rows.length > 0 && (
              <div className="table-scroll" style={{ marginTop: 16 }}>
                <table>
                  <thead>
                    <tr>
                      <th>Год</th>
                      <th>Канал</th>
                      <th className="num">План А, т</th>
                      <th className="num">План Б, т</th>
                      <th className="num">Разница</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.rows.map((r, i) => (
                      <tr key={i}>
                        <td>{r.year}</td>
                        <td>{r.source}</td>
                        <td className="num">{fmt(r.a, 1)}</td>
                        <td className="num">{fmt(r.b, 1)}</td>
                        <td className="num">{fmtSigned(r.b - r.a, 1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Card>

      <Card
        title="Журнал решений"
        subtitle="Каждое изменение плана записывается: что сделали, когда и какой результат был до этого. Любой шаг можно откатить."
      >
        {history.length === 0 ? (
          <p className="muted">Пока ничего не меняли. Отредактируйте план — и здесь появится история.</p>
        ) : (
          <>
            <div className="buttons" style={{ marginBottom: 14 }}>
              <button onClick={() => download('decision_log.csv', historyCsv(history))}>Выгрузить журнал, CSV</button>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Действие</th>
                    <th>Подробности</th>
                    <th>Сценарий</th>
                    <th className="num">Расходы до</th>
                    <th className="num">Сервис до</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {history.map((entry) => (
                    <tr key={entry.id}>
                      <td className="nowrap muted">{entry.at}</td>
                      <td>{entry.action}</td>
                      <td className="small-text">{entry.detail}</td>
                      <td className="muted small-text">{entry.scenario_id}</td>
                      <td className="num">{fmt(entry.metrics.cost)}</td>
                      <td className="num">{fmtPct(entry.metrics.service, 1)}</td>
                      <td>
                        <button className="link-btn" onClick={() => restore(entry)}>
                          откатить
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Card>

      <Card title="Откуда берутся данные">
        <ul className="insights">
          <li>
            Спрос, каналы, хранилище, инвестиции и ограничения — набор организатора со статусом CASE_INPUT. Значения не
            переписаны в коде: файлы читаются как есть.
          </li>
          <li>Сценарии: {Object.values(SCENARIOS).map((s) => `${s.scenario_id} (${s.status})`).join(', ')}.</li>
          <li>Решения плана и допущения команды помечены отдельно и видны на вкладке «План».</li>
          <li>Контрольные примеры организатора V01–V10 прогоняются автотестами при каждой сборке.</li>
        </ul>
      </Card>
    </>
  );
}
