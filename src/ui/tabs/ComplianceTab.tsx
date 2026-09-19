import { useMemo } from 'react';
import { complianceMap } from '../../engine/compliance';
import { toCsv } from '../../engine/exportData';
import { download } from '../download';
import type { TabProps } from '../tabProps';
import { Card } from '../ui';

export function ComplianceTab({ evaluation }: TabProps) {
  const rows = useMemo(() => complianceMap(evaluation), [evaluation]);
  const groups = [...new Set(rows.map((r) => r.group))];

  return (
    <>
      <Card
        title="Где что смотреть"
        subtitle="Карта соответствия критериям кейса: пункт проверки, раздел контура и доказательство, которое можно открыть прямо сейчас. Оценку выставляет жюри, поэтому самооценки выполнения здесь нет."
      >
        <div className="buttons" style={{ marginBottom: 18 }}>
          <button
            onClick={() =>
              download(
                'compliance_map.csv',
                toCsv(rows as unknown as Record<string, unknown>[]),
              )
            }
          >
            Выгрузить карту, CSV
          </button>
        </div>

        {groups.map((group) => (
          <div key={group} style={{ marginBottom: 22 }}>
            <div className="lp-kicker" style={{ marginBottom: 12 }}>
              {group}
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>№</th>
                    <th>Что проверяет жюри</th>
                    <th>Балл</th>
                    <th>Где в решении</th>
                    <th>Доказательство</th>
                  </tr>
                </thead>
                <tbody>
                  {rows
                    .filter((r) => r.group === group)
                    .map((r) => (
                      <tr key={r.id}>
                        <td className="nowrap">{r.id}</td>
                        <td>{r.criterion}</td>
                        <td className="nowrap muted">{r.points}</td>
                        <td className="small-text">{r.where}</td>
                        <td className="small-text muted">{r.evidence}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </Card>
    </>
  );
}
