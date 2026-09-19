import type { ReactNode } from 'react';

export function Card({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      <header className="card-head">
        <h3>{title}</h3>
        {subtitle && <p className="card-sub">{subtitle}</p>}
      </header>
      {children}
    </section>
  );
}

export function Stat({
  label,
  value,
  note,
  hero,
}: {
  label: string;
  value: string;
  note?: ReactNode;
  hero?: boolean;
}) {
  return (
    <div className={hero ? 'stat stat-accent' : 'stat'}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function DataTable({
  head,
  rows,
  caption = 'Таблица значений',
  open = false,
  numeric = false,
}: {
  head: string[];
  rows: ReactNode[][];
  caption?: string;
  open?: boolean;
  /** Колонки значений прижимаются вправо и получают одинаковую ширину. */
  numeric?: boolean;
}) {
  return (
    <details className={numeric ? 'table-view table-numeric' : 'table-view'} open={open}>
      <summary>{caption}</summary>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {head.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                {r.map((c, j) => (
                  <td key={j}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export const Status = ({ ok, okText = 'норма', badText = 'нарушение' }: { ok: boolean; okText?: string; badText?: string }) => (
  <span className={ok ? 'status-ok' : 'status-bad'}>
    <span className="dot" />
    {ok ? okText : badText}
  </span>
);
