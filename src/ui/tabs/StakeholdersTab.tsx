import { useMemo, useState } from 'react';
import { CRITERIA, PROFILES, compareProfiles, scoreByProfile, weightSensitivity } from '../../engine/mcda';
import { fmt, fmtPct } from '../theme';
import type { TabProps } from '../tabProps';
import { Card, DataTable } from '../ui';

export function StakeholdersTab({ strategies }: TabProps) {
  const [profileId, setProfileId] = useState(PROFILES[0].id);
  const profile = PROFILES.find((p) => p.id === profileId)!;
  // Весь перебор, а не первые 16 по расходам: иначе из сравнения выпадает вариант
  // «Без инвестиций» — тот самый, что важен профилю с максимальным весом CAPEX.
  const pool = strategies;

  const ranked = useMemo(() => scoreByProfile(pool, profile), [pool, profile]);
  const comparison = useMemo(() => compareProfiles(pool), [pool]);
  const sensitivityRows = useMemo(() => weightSensitivity(pool, profile), [pool, profile]);
  const changes = sensitivityRows.filter((r) => r.changed);

  return (
    <>
      <Card
        title="Кто чего хочет"
        subtitle="Веса заданы явно и раскрыты. Нельзя улучшить итоговую оценку, снизив вес пострадавшей стороны: провал критического сервиса исключает вариант при любых весах."
      >
        <div className="seg small" style={{ marginBottom: 16 }}>
          {PROFILES.map((p) => (
            <button key={p.id} className={p.id === profileId ? 'active' : ''} onClick={() => setProfileId(p.id)}>
              {p.label}
            </button>
          ))}
        </div>

        <p className="muted">{profile.rationale}</p>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Критерий</th>
                <th>Смысл</th>
                <th>Направление</th>
                <th className="num">Вес</th>
              </tr>
            </thead>
            <tbody>
              {CRITERIA.map((c) => (
                <tr key={c.id}>
                  <td>{c.label}</td>
                  <td className="muted small-text">{c.meaning}</td>
                  <td className="muted small-text">{c.direction === 'min' ? 'меньше — лучше' : 'больше — лучше'}</td>
                  <td className="num">{fmtPct(profile.weights[c.id])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title={`Ранжирование глазами стороны «${profile.label}»`} subtitle="Значения нормализованы в 0..1, свёртка линейная, исключённые варианты показаны отдельно">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Стратегия</th>
                <th className="num">Оценка</th>
                <th className="num">Расходы</th>
                <th className="num">Сервис</th>
                <th className="num">Гибкость</th>
                <th className="num">CAPEX</th>
                <th className="num">Запас 2040</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="num">{row.excluded_reason ? '—' : fmt(row.score, 3)}</td>
                  <td className="num">{fmt(row.raw.cost)}</td>
                  <td className="num">{fmtPct(row.raw.service, 1)}</td>
                  <td className="num">{fmtPct(row.raw.flexibility, 0)}</td>
                  <td className="num">{fmt(row.raw.capex)}</td>
                  <td className="num">{fmt(row.raw.resilience)}</td>
                  <td className="small-text">{row.excluded_reason ? <span className="status-bad">{row.excluded_reason}</span> : 'участвует'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Где стороны расходятся" subtitle="Один и тот же набор альтернатив глазами разных участников">
        <DataTable
          open
          caption="Выбор по профилям"
          head={['Сторона', 'Предпочитает', 'Следующий вариант', 'Отрыв']}
          rows={comparison.map((c) => [
            c.profile.label,
            c.top?.label ?? '—',
            c.runnerUp?.label ?? '—',
            c.gap ? fmt(c.gap, 3) : '—',
          ])}
        />
        <p className="muted small-text">
          Совпадение выбора у разных сторон означает, что конфликт интересов в этом наборе не критичен. Расхождение
          показывает, за чей счёт достигается экономия.
        </p>
      </Card>

      <Card title="Насколько выбор держится за веса" subtitle="Каждый вес сдвигается на 15 процентных пунктов с перенормировкой остальных">
        {changes.length === 0 ? (
          <p className="muted">
            Ни один сдвиг весов не меняет лидера: выбор устойчив и не является следствием подобранных коэффициентов.
          </p>
        ) : (
          <DataTable
            open
            caption="Сдвиги, меняющие лидера"
            head={['Критерий', 'Сдвиг веса', 'Новый лидер']}
            rows={changes.map((r) => [r.label, `${r.delta > 0 ? '+' : ''}${fmt(r.delta * 100)} п.п.`, r.new_top])}
          />
        )}
      </Card>
    </>
  );
}
