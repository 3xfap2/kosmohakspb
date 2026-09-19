import { fmt } from '../theme';
import type { TabProps } from '../tabProps';
import { Card, Status } from '../ui';

export function ConstraintsTab({ evaluation }: TabProps) {
  const { checks, violations } = evaluation;
  const hard = checks.filter((c) => c.role === 'hard');
  const reference = checks.filter((c) => c.role === 'reference');
  const failedHard = hard.filter((c) => !c.passed);

  return (
    <>
      <div className="stats">
        <div className="stat">
          <div className="stat-label">Обязательные проверки</div>
          <div className="stat-value">
            {hard.length - failedHard.length}/{hard.length}
          </div>
          <div className="stat-note">пороги и идентификаторы берутся из набора организатора</div>
        </div>
        <div className="stat">
          <div className="stat-label">Нарушения плана</div>
          <div className="stat-value">{violations.length}</div>
          <div className="stat-note">мощности, ёмкость, доступность каналов</div>
        </div>
        <div className="stat">
          <div className="stat-label">Ориентиры устойчивости</div>
          <div className="stat-value">{reference.filter((c) => c.passed).length}/{reference.length || 0}</div>
          <div className="stat-note">требования сервиса заданы для стандартного сценария</div>
        </div>
      </div>

      <Card title="Проверка ограничений" subtitle="Статус подписан словом, чтобы результат читался и без цвета">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Ограничение</th>
                <th>Год</th>
                <th>Метрика</th>
                <th className="num">Факт</th>
                <th className="num">Порог</th>
                <th>Область</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((c, i) => (
                <tr key={`${c.constraint_id}-${c.year}-${i}`}>
                  <td className="nowrap">{c.constraint_id}</td>
                  <td>{c.year ?? '—'}</td>
                  <td className="muted small-text">{c.metric}</td>
                  <td className="num">
                    {fmt(c.actual, c.unit === 'share' ? 4 : 1)} {c.unit}
                  </td>
                  <td className="num nowrap">
                    {c.operator} {fmt(c.threshold, c.unit === 'share' ? 2 : 0)}
                  </td>
                  <td className="muted small-text">{c.role === 'hard' ? 'обязательное' : 'ориентир'}</td>
                  <td>
                    <Status ok={c.passed} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Нарушения плана" subtitle="Каждое с годом, величиной и причиной — этого достаточно, чтобы понять, что чинить">
        {violations.length === 0 ? (
          <p className="muted">Нарушений нет: мощности, ёмкость и сроки ввода соблюдены.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Код</th>
                  <th>Год</th>
                  <th className="num">Факт</th>
                  <th className="num">Предел</th>
                  <th>Что произошло</th>
                </tr>
              </thead>
              <tbody>
                {violations.map((v, i) => (
                  <tr key={i}>
                    <td className="nowrap">{v.code}</td>
                    <td>{v.year ?? '—'}</td>
                    <td className="num">{fmt(v.actual, 1)}</td>
                    <td className="num">{fmt(v.limit, 1)}</td>
                    <td>{v.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
