import { useMemo, useState } from 'react';
import { CASE } from '../../engine/caseData';
import { GEO_PRESETS, assessGeoEvent, type GeoEvent } from '../../engine/geopolitics';
import { toCsv } from '../../engine/exportData';
import { download } from '../download';
import { fmt, fmtPct, fmtSigned } from '../theme';
import type { TabProps } from '../tabProps';
import { Card, DataTable } from '../ui';

const COMPONENTS = [
  { id: 'variable_price', label: 'Цена доставки в узел' },
  { id: 'reservation_rate', label: 'Плата за резервирование' },
  { id: 'delivery_share', label: 'Фактическая поставка канала' },
] as const;

export function GeopoliticsTab({ plan, scenarioId, variant }: TabProps) {
  const [presetId, setPresetId] = useState(GEO_PRESETS[0].event_id);
  const [draft, setDraft] = useState<GeoEvent>(GEO_PRESETS[0]);

  const impact = useMemo(() => assessGeoEvent(plan, scenarioId, draft, { variant }), [plan, scenarioId, draft, variant]);

  const usePreset = (id: string) => {
    const preset = GEO_PRESETS.find((p) => p.event_id === id)!;
    setPresetId(id);
    setDraft(preset);
  };

  const patch = (change: Partial<GeoEvent>) => setDraft((prev) => ({ ...prev, ...change }));

  const toggleSource = (source_id: string) =>
    patch({
      affected_source_ids: draft.affected_source_ids.includes(source_id)
        ? draft.affected_source_ids.filter((x) => x !== source_id)
        : [...draft.affected_source_ids, source_id],
    });

  const exportRows = () =>
    download(
      `geo_${draft.event_id}_${scenarioId}.csv`,
      toCsv([
        {
          scenario_id: scenarioId,
          event_id: draft.event_id,
          component: draft.component,
          sources: draft.affected_source_ids.join(' '),
          from_year: draft.from_year,
          to_year: draft.to_year,
          magnitude: draft.magnitude,
          basis: draft.basis,
          cost_before_mln: Math.round(impact.before.total_cost_mln),
          cost_after_mln: Math.round(impact.after.total_cost_mln),
          delta_cost_mln: Math.round(impact.delta_cost_mln),
          service_before: impact.before.min_service_total,
          service_after: impact.after.min_service_total,
          shortage_after_t: Math.round(impact.after.shortage_total_t * 10) / 10,
          skipped_years: impact.skipped_years.join(' '),
        },
      ]),
    );

  return (
    <>
      <Card
        title="Конструктор события"
        subtitle="Задаём условное событие: что меняется, у каких каналов, когда и насколько. Это сценарная проработка, а не прогноз политики, поэтому вероятность не выдумывается — указывается основание."
      >
        <div className="seg small" style={{ marginBottom: 16 }}>
          {GEO_PRESETS.map((p) => (
            <button key={p.event_id} className={p.event_id === presetId ? 'active' : ''} onClick={() => usePreset(p.event_id)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="two-col">
          <div>
            <h4>Затронутые каналы</h4>
            <div className="buttons">
              {CASE.sources.map((s) => (
                <button
                  key={s.source_id}
                  className={draft.affected_source_ids.includes(s.source_id) ? 'primary' : ''}
                  onClick={() => toggleSource(s.source_id)}
                >
                  {s.source_id} · {s.name}
                </button>
              ))}
            </div>

            <h4 style={{ marginTop: 18 }}>Что меняется</h4>
            <div className="seg small">
              {COMPONENTS.map((c) => (
                <button key={c.id} className={draft.component === c.id ? 'active' : ''} onClick={() => patch({ component: c.id })}>
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <h4>Период и величина</h4>
            <div className="console" style={{ marginBottom: 12 }}>
              <label className="inline">
                с
                <input
                  type="number"
                  min={2035}
                  max={2040}
                  value={draft.from_year}
                  onChange={(e) => patch({ from_year: Number(e.target.value) })}
                />
              </label>
              <label className="inline">
                по
                <input
                  type="number"
                  min={2035}
                  max={2040}
                  value={draft.to_year}
                  onChange={(e) => patch({ to_year: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="inline" style={{ display: 'flex' }}>
              Величина изменения
              <input
                type="range"
                min={5}
                max={90}
                step={5}
                value={Math.round(draft.magnitude * 100)}
                onChange={(e) => patch({ magnitude: Number(e.target.value) / 100 })}
                style={{ flex: 1 }}
              />
              <b>{fmtPct(draft.magnitude)}</b>
            </label>
            {draft.range && (
              <p className="muted small-text">
                Обоснованный диапазон: {fmtPct(draft.range[0])} – {fmtPct(draft.range[1])}. Расходы внутри диапазона:{' '}
                {fmt(impact.range_costs!.low)} – {fmt(impact.range_costs!.high)} млн у.е.
              </p>
            )}
            <p className="muted small-text">{draft.basis}</p>
            <label className="inline">
              <input
                type="checkbox"
                checked={draft.stack_with_mandatory_stress}
                onChange={(e) => patch({ stack_with_mandatory_stress: e.target.checked })}
              />
              Начислять поверх обязательного стресса в те же годы
            </label>
          </div>
        </div>
      </Card>

      <Card title="Причинная цепочка" subtitle="От условия до решения оператора, с числами на каждом шаге">
        <ul className="chain">
          {impact.chain.map((step) => (
            <li key={step.step}>
              <span className="chain-step">{step.step}</span>
              <span>{step.value}</span>
            </li>
          ))}
        </ul>
        {impact.skipped_years.length > 0 && (
          <p className="muted small-text">
            Годы {impact.skipped_years.join(', ')} пропущены: обязательный стресс уже меняет эту составляющую, и один и
            тот же ценовой эффект не начисляется дважды.
          </p>
        )}
      </Card>

      <Card title="До и после" subtitle="Одни и те же решения оператора в исходных условиях и при событии">
        <div className="stats">
          <div className="stat">
            <div className="stat-label">Расходы</div>
            <div className="stat-value">{fmtSigned(impact.delta_cost_mln)} млн</div>
            <div className="stat-note">
              {fmt(impact.before.total_cost_mln)} → {fmt(impact.after.total_cost_mln)}
            </div>
          </div>
          <div className="stat">
            <div className="stat-label">Приведённые расходы</div>
            <div className="stat-value">{fmtSigned(impact.delta_discounted_mln)} млн</div>
          </div>
          <div className="stat">
            <div className="stat-label">Минимальный сервис</div>
            <div className="stat-value">{fmtPct(impact.after.min_service_total, 1)}</div>
            <div className="stat-note">было {fmtPct(impact.before.min_service_total, 1)}</div>
          </div>
          <div className="stat">
            <div className="stat-label">Дефицит</div>
            <div className="stat-value">{fmt(impact.after.shortage_total_t, 1)} т</div>
            <div className="stat-note">{fmtSigned(impact.delta_shortage_t, 1)} т к исходному</div>
          </div>
        </div>

        <DataTable
          head={['Год', 'Расходы до', 'Расходы после', 'Разница', 'Сервис до', 'Сервис после']}
          rows={impact.before.result.finance.map((f, i) => {
            const after = impact.after.result.finance[i];
            const yb = impact.before.result.years[i];
            const ya = impact.after.result.years[i];
            return [
              f.year,
              fmt(f.total_mln, 1),
              fmt(after.total_mln, 1),
              fmtSigned(after.total_mln - f.total_mln, 1),
              fmtPct(yb.service_total, 1),
              fmtPct(ya.service_total, 1),
            ];
          })}
        />

        <div className="buttons" style={{ marginTop: 16 }}>
          <button onClick={exportRows}>Выгрузить событие и результат, CSV</button>
          <button onClick={() => usePreset(presetId)}>Вернуть исходные цены</button>
        </div>
      </Card>
    </>
  );
}
