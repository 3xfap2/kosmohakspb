import { useMemo, useState } from 'react';
import { CASE, getYears } from '../../engine/caseData';
import { contractsForPlan, sourceLabel, totalOverpay } from '../../engine/contracts';
import { buildPlan, enumerateStrategies } from '../../engine/planner';
import type { Plan } from '../../engine/plan';
import { fmt, fmtPct } from '../theme';
import type { TabProps } from '../tabProps';
import { Card, DataTable } from '../ui';

export function PlanTab({ plan, setPlan, scenarioId, variant, evaluation, strategies, notify }: TabProps) {
  const [mode, setMode] = useState<'orders' | 'reservations'>('orders');
  const years = getYears();
  const contracts = useMemo(() => contractsForPlan(plan, evaluation), [plan, evaluation]);
  const overpay = totalOverpay(contracts);

  const cell = (source_id: string, year: number): number => {
    const list = mode === 'orders' ? plan.decisions.supply_orders : plan.decisions.capacity_reservations;
    const row = list.find((r) => r.source_id === source_id && r.year === year);
    if (!row) return 0;
    return mode === 'orders' ? (row as { volume_t: number }).volume_t : (row as { capacity_t_per_year: number }).capacity_t_per_year;
  };

  const setCell = (source_id: string, year: number, value: number) => {
    if (Number.isNaN(value) || value < 0) {
      notify('Объём не может быть отрицательным');
      return;
    }
    setPlan((prev) => {
      const next: Plan = structuredClone(prev);
      const list = mode === 'orders' ? next.decisions.supply_orders : next.decisions.capacity_reservations;
      const idx = list.findIndex((r) => r.source_id === source_id && r.year === year);
      const record = mode === 'orders' ? { source_id, year, volume_t: value } : { source_id, year, capacity_t_per_year: value };
      if (idx >= 0) list[idx] = record as never;
      else list.push(record as never);
      next.plan_id = prev.plan_id.endsWith('*') ? prev.plan_id : `${prev.plan_id}*`;
      return next;
    }, {
      action: mode === 'orders' ? 'Изменение заказа' : 'Изменение резервирования',
      detail: `${sourceLabel(source_id)}, ${year} год → ${value} т`,
    });
  };

  const setInvestment = (investment_id: string, year: number | null) => {
    setPlan((prev) => {
      const next: Plan = structuredClone(prev);
      next.decisions.investments = next.decisions.investments.filter((i) => i.investment_id !== investment_id);
      if (year !== null)
        next.decisions.investments.push(
          investment_id === 'EARTH_NEW' ? { investment_id, decision_year: year, exercise_year: year } : { investment_id, decision_year: year },
        );
      next.plan_id = prev.plan_id.endsWith('*') ? prev.plan_id : `${prev.plan_id}*`;
      return next;
    }, {
      action: year === null ? 'Отказ от инвестиции' : 'Инвестиционное решение',
      detail: `${investment_id}${year === null ? '' : `, финансирование в ${year} году`}`,
    });
  };

  const applyStrategy = (label: string) => {
    const strategy = enumerateStrategies().find((s) => s.label === label);
    if (!strategy) return;
    setPlan(buildPlan(strategy, { scenario_id: scenarioId, variant }), {
      action: 'Автосборка плана',
      detail: `Стратегия «${label}», сценарий ${scenarioId}`,
    });
    notify(`План пересобран под стратегию «${label}»`);
  };

  return (
    <>
      <Card
        title="Решения по снабжению"
        subtitle="Заказ, фактическая поставка и выданный объём — разные величины. Резерв мощности даёт право на поставку, но не является запасом."
      >
        <div className="console" style={{ marginBottom: 18 }}>
          <div className="seg small">
            <button className={mode === 'orders' ? 'active' : ''} onClick={() => setMode('orders')}>
              Заказы
            </button>
            <button className={mode === 'reservations' ? 'active' : ''} onClick={() => setMode('reservations')}>
              Резервирование
            </button>
          </div>
          <span className="spacer" />
          <label className="inline">
            Собрать автоматически:
            <select value="" onChange={(e) => e.target.value && applyStrategy(e.target.value)}>
              <option value="">выбрать стратегию</option>
              {strategies.map((s) => (
                <option key={s.label} value={s.label}>
                  {s.label} · {fmt(s.discounted_cost_mln)} млн · {s.feasible ? 'исполнима' : 'с нарушениями'}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="table-scroll">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Год</th>
                {CASE.sources.map((s) => (
                  <th key={s.source_id} className="num">
                    {s.source_id} · {s.name}
                    <div className="muted small-text">до {fmt(s.capacity_t_per_year)} т/год</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {years.map((year) => (
                <tr key={year}>
                  <td className="nowrap">{year}</td>
                  {CASE.sources.map((s) => (
                    <td key={s.source_id} className="num">
                      <input
                        type="number"
                        min={0}
                        step={0.1}
                        value={cell(s.source_id, year)}
                        aria-label={`${s.name}, ${year}`}
                        onChange={(e) => setCell(s.source_id, year, e.target.valueAsNumber)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Инвестиции" subtitle="Год — момент финансирования. У Earth-New 90 млн стоит право и 270 млн реализация, вместе 360.">
        <div className="two-col">
          {CASE.investments.map((option) => {
            const current = plan.decisions.investments.find((i) => i.investment_id === option.investment_id);
            return (
              <div className="invest" key={option.investment_id}>
                <div>
                  <b>{option.name}</b>
                  <div className="muted small-text">
                    CAPEX {fmt(option.total_capex_mln)} млн · OPEX {fmt(option.fixed_opex_mln_per_year)} млн/год
                  </div>
                </div>
                <select
                  value={current ? String(current.decision_year) : ''}
                  onChange={(e) => setInvestment(option.investment_id, e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">не финансируем</option>
                  {getYears().map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        title="Договоры по каналам"
        subtitle="Условия кейса и предложения команды помечены раздельно: ответственность, порядок оплаты и правила пересмотра организатором не заданы"
      >
        <div className="stats" style={{ marginBottom: 18 }}>
          <div className="stat">
            <div className="stat-label">Оплачено сверх полученного</div>
            <div className="stat-value">{fmt(overpay.tons, 1)} т</div>
            <div className="stat-note">{fmt(overpay.mln, 1)} млн у.е. — цена обязательств take-or-pay и недопоставок</div>
          </div>
        </div>

        <div className="contract-grid">
          {contracts.map((c) => (
            <article className="contract" key={c.source_id}>
              <header>
                <div>
                  <b>{c.name}</b>
                  <div className="muted small-text">{c.counterparty}</div>
                </div>
                <span className="muted small-text">{c.years}</span>
              </header>

              <div className="contract-nums">
                <div>
                  <span className="stat-label">Заказано</span>
                  <b>{fmt(c.contracted_volume_t, 1)} т</b>
                </div>
                <div>
                  <span className="stat-label">Поставлено</span>
                  <b>{fmt(c.delivered_t, 1)} т</b>
                </div>
                <div>
                  <span className="stat-label">Оплачено</span>
                  <b>{fmt(c.paid_volume_t, 1)} т</b>
                </div>
                <div>
                  <span className="stat-label">Платежи</span>
                  <b>{fmt(c.procurement_mln + c.reservation_mln, 1)} млн</b>
                </div>
              </div>

              <dl className="contract-terms">
                {c.terms.map((t) => (
                  <div key={t.label}>
                    <dt>
                      {t.label}
                      <span className={t.status === 'CASE_INPUT' ? 'tag case' : 'tag team'}>
                        {t.status === 'CASE_INPUT' ? 'кейс' : 'команда'}
                      </span>
                    </dt>
                    <dd>{t.value}</dd>
                  </div>
                ))}
              </dl>
            </article>
          ))}
        </div>
      </Card>

      <Card title="Условия каналов" subtitle="Исходные данные кейса, статус CASE_INPUT">
        <DataTable
          open
          caption="Параметры каналов"
          head={['Канал', 'Мощность', 'Цена, млн/т', 'Резерв', 'Take-or-pay', 'Lead time', 'Надёжность', 'Доступен']}
          rows={CASE.sources.map((s) => [
            `${s.source_id} · ${s.name}`,
            `${fmt(s.capacity_t_per_year)} т/год`,
            fmt(s.variable_cost_mln_per_t, 2),
            fmt(s.reservation_rate_mln_per_t_year_capacity, 2),
            fmtPct(s.take_or_pay_share),
            `${s.lead_time_min_value}–${s.lead_time_max_value} ${s.lead_time_unit}`,
            s.reliability_profile,
            s.available_from_year ?? 'после опциона',
          ])}
        />
      </Card>

      <Card title="Допущения команды" subtitle="Их можно оспорить, поэтому они вынесены отдельно от данных кейса">
        <ul className="insights">
          <li>Ставка дисконтирования {fmtPct(plan.assumptions.discount_rate)}, приведение к {plan.assumptions.discount_t0} году.</li>
          <li>
            Из диапазонов сроков берём верхнюю границу: Earth-New готов через 24 месяца, а не через 18. Консервативно, зато
            план не зависит от лучшего исхода.
          </li>
          <li>Базовым считается канал, дающий {fmtPct(plan.assumptions.emergency_base_share)} и больше поставки года.</li>
          <li>Заказ по каналу с платой за резервирование не превышает зарезервированную мощность.</li>
          <li>Внутри года спрос и поставки распределены равномерно.</li>
          <li>
            Приёмная способность узла {plan.assumptions.intake_capacity_t_per_month} т/мес: узел принимает транспорт по
            одному, полный цикл приёма — стыковка, захолаживание магистралей, перекачка, отстой, расстыковка и подготовка
            порта — занимает пять суток, значит шесть циклов в месяц по 7,5 т. Организатор скорость приёма не задаёт,
            поэтому величина целиком наша; вывод мы строим не на ней, а на том, сколько приёма требует сам план.
          </li>
        </ul>
      </Card>
    </>
  );
}
