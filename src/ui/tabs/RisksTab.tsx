import { useMemo, useState } from 'react';
import { assessRisk, defaultRiskRegister, monteCarlo } from '../../engine/risks';
import { fmt, fmtPct, fmtSigned } from '../theme';
import type { TabProps } from '../tabProps';
import { Card } from '../ui';

export function RisksTab({ plan, scenarioId, variant }: TabProps) {
  const [runs, setRuns] = useState(500);
  const [seed, setSeed] = useState(42);
  const [severity, setSeverity] = useState(0.3);

  const risks = useMemo(
    () => defaultRiskRegister().map((r) => assessRisk(plan, scenarioId, r, variant)),
    [plan, scenarioId, variant],
  );
  const mc = useMemo(
    () => monteCarlo(plan, scenarioId, { runs, seed, severity, variant }),
    [plan, scenarioId, runs, seed, severity, variant],
  );

  const worst = [...risks].sort((a, b) => b.shortage_t - a.shortage_t)[0];

  return (
    <>
      <Card
        title="Реестр рисков"
        subtitle="Последствия считает тот же движок: событие накладывается на сценарий, план пересчитывается, разница и есть ущерб"
      >
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Риск</th>
                <th>Параметр</th>
                <th className="num">Вероятность</th>
                <th>Основание</th>
                <th className="num">Δ расходов</th>
                <th className="num">Дефицит</th>
                <th className="num">Сервис</th>
                <th>Мера и остаток</th>
              </tr>
            </thead>
            <tbody>
              {risks.map((r) => (
                <tr key={r.risk.risk_id}>
                  <td>
                    <b>{r.risk.risk_id}</b>
                    <div className="muted small-text">{r.risk.event}</div>
                    <div className="muted small-text">{r.risk.cause}</div>
                    {r.risk.dependencies.length > 0 && (
                      <div className="muted small-text">связан с: {r.risk.dependencies.join(', ')}</div>
                    )}
                  </td>
                  <td className="muted small-text">{r.risk.affected_parameter}</td>
                  <td className="num">{fmtPct(r.risk.probability, 1)}</td>
                  <td className="muted small-text">
                    {r.risk.probability_basis}
                    <div>тяжесть {r.risk.severity}: {r.risk.severity_basis}</div>
                  </td>
                  <td className="num">{fmtSigned(r.delta_cost_mln, 1)}</td>
                  <td className="num">{fmt(r.shortage_t, 1)} т</td>
                  <td className="num">{fmtPct(r.min_service_total, 1)}</td>
                  <td className="small-text">
                    {r.unused_channel ? 'Канал не используется планом. ' : `${r.risk.mitigation}. `}
                    <span className="muted">{r.residual_note}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small-text">
          Отрицательная Δ расходов у срывов поставки — не экономия: платёж за заказанный объём не возвращается, падают
          только расходы на хранение меньшего запаса. Ущерб здесь — дефицит и сервис.
        </p>
      </Card>

      <Card
        title="Монте-Карло по отказам каналов"
        subtitle="Вероятность отказа в год равна единице минус надёжность канала. Отказы считаем независимыми — это допущение, а не факт."
      >
        <div className="console" style={{ marginBottom: 18 }}>
          <label className="inline">
            Прогонов
            <input type="number" min={50} max={3000} step={50} value={runs} onChange={(e) => setRuns(Number(e.target.value))} />
          </label>
          <label className="inline">
            Seed
            <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value))} />
          </label>
          <label className="inline">
            Тяжесть отказа
            <input
              type="range"
              min={10}
              max={90}
              step={5}
              value={severity * 100}
              onChange={(e) => setSeverity(Number(e.target.value) / 100)}
            />
            {fmtPct(severity)}
          </label>
        </div>

        <div className="stats">
          <div className="stat">
            <div className="stat-label">Вероятность дефицита</div>
            <div className="stat-value">{fmtPct(mc.p_any_shortage, 1)}</div>
            <div className="stat-note">
              прогонов {mc.runs}, seed {mc.seed}, точность ±{fmt(1.96 * mc.p_any_shortage_se * 100, 1)} п.п.
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Сервис ниже 97%</div>
            <div className="stat-value">{fmtPct(mc.p_service_below_target, 1)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Средний дефицит</div>
            <div className="stat-value">{fmt(mc.mean_shortage_t, 1)} т</div>
            <div className="stat-note">95-й процентиль {fmt(mc.p95_shortage_t, 1)} т</div>
          </div>
          <div className="stat">
            <div className="stat-label">Средние расходы</div>
            <div className="stat-value">{fmt(mc.mean_total_cost_mln)} млн</div>
          </div>
        </div>

        <p className="muted small-text">
          Частота в модельных прогонах не равна вероятности реального события: она следует из принятых распределений.
          Самый тяжёлый риск по последствиям — {worst.risk.risk_id}, до {fmt(worst.shortage_t, 1)} т недопоставки.
        </p>
      </Card>
    </>
  );
}
