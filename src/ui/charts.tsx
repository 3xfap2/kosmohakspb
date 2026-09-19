import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from 'recharts';
import { CASE } from '../engine/caseData';
import type { SimulationResult } from '../engine/simulate';
import type { Evaluation } from '../engine/planner';
import type { SensitivityPoint } from '../engine/risks';
import { fmt, type ChartTheme } from './theme';

const H = 300;

function chrome(t: ChartTheme) {
  const tick = { fill: t.muted, fontSize: 12 };
  return {
    grid: <CartesianGrid vertical={false} stroke={t.grid} />,
    tooltip: {
      contentStyle: { background: t.surface, border: `1px solid ${t.grid}`, borderRadius: 8, color: t.text },
      itemStyle: { color: t.text },
      labelStyle: { color: t.text2 },
    },
    legend: {
      iconType: 'circle' as const,
      iconSize: 8,
      formatter: (v: string) => <span style={{ color: t.text2 }}>{v}</span>,
    },
    x: { tick, tickLine: false, axisLine: { stroke: t.axis } },
    y: { tick, tickLine: false, axisLine: false, width: 60 },
  };
}

/** Поставки по каналам и спрос года — одна шкала, тонны. */
export function SupplyChart({ result, t }: { result: SimulationResult; t: ChartTheme }) {
  const c = chrome(t);
  const data = result.years.map((y) => {
    const row: Record<string, number | string> = { year: y.year, Спрос: y.total_demand_t };
    for (const source of CASE.sources) {
      row[source.name] = result.sources.find((s) => s.year === y.year && s.source_id === source.source_id)?.delivered_t ?? 0;
    }
    return row;
  });
  const last = CASE.sources[CASE.sources.length - 1].name;

  return (
    <ResponsiveContainer width="100%" height={H}>
      <BarChart data={data} barSize={28}>
        {c.grid}
        <XAxis dataKey="year" {...c.x} />
        <YAxis {...c.y} tickFormatter={(v) => fmt(v)} />
        <Tooltip {...c.tooltip} formatter={(v) => `${fmt(Number(v), 1)} т`} cursor={{ fill: t.grid, opacity: 0.35 }} />
        <Legend {...c.legend} />
        {CASE.sources.map((s, i) => (
          <Bar
            key={s.source_id}
            dataKey={s.name}
            stackId="supply"
            fill={t.series[i % t.series.length]}
            stroke={t.surface}
            strokeWidth={2}
            radius={s.name === last ? [4, 4, 0, 0] : undefined}
            isAnimationActive={false}
          />
        ))}
        <Line dataKey="Спрос" stroke={t.text2} strokeWidth={2} dot={false} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Помесячный запас и требуемый 45-дневный резерв — тонны. */
export function InventoryChart({ result, t }: { result: SimulationResult; t: ChartTheme }) {
  const c = chrome(t);
  const data = result.months.map((m) => ({
    label: `${m.year}-${String(m.month).padStart(2, '0')}`,
    Запас: m.closing_t,
    'Резерв 45 дней': result.years.find((y) => y.year === m.year)!.reserve_required_t,
    Ёмкость: m.storage_capacity_t,
  }));

  return (
    <ResponsiveContainer width="100%" height={H}>
      <LineChart data={data} margin={{ top: 12, right: 16 }}>
        {c.grid}
        <XAxis dataKey="label" {...c.x} interval={11} />
        <YAxis {...c.y} tickFormatter={(v) => fmt(v)} />
        <Tooltip {...c.tooltip} formatter={(v) => `${fmt(Number(v), 1)} т`} />
        <Legend {...c.legend} />
        <Line dataKey="Запас" stroke={t.series[0]} strokeWidth={2} dot={false} isAnimationActive={false} />
        <Line dataKey="Резерв 45 дней" stroke={t.series[1]} strokeWidth={2} dot={false} strokeDasharray="6 4" isAnimationActive={false} />
        <Line dataKey="Ёмкость" stroke={t.muted} strokeWidth={2} dot={false} strokeDasharray="2 4" isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/** Стратегии: приведённые расходы против минимального уровня обслуживания. */
export function StrategyScatter({
  evaluations,
  current,
  t,
}: {
  evaluations: Evaluation[];
  current?: string;
  t: ChartTheme;
}) {
  const c = chrome(t);
  // По вертикали — доля гибких каналов, а не сервис: сервис у исполнимых стратегий
  // упирается в ограничение и почти всегда равен 100%, на такой оси точки сливаются
  // в одну линию. Фронт Парето строится как раз по паре «расходы — гибкость».
  const point = (e: Evaluation) => ({
    x: Math.round(e.discounted_cost_mln),
    y: Math.round(e.flexibility_share * 1000) / 10,
    label: e.label,
    service: Math.round(e.min_service_total * 1000) / 10,
  });
  const feasible = evaluations.filter((e) => e.feasible).map(point);
  const infeasible = evaluations.filter((e) => !e.feasible).map(point);
  const selected = evaluations.filter((e) => e.label === current).map(point);

  return (
    <ResponsiveContainer width="100%" height={H}>
      <ScatterChart margin={{ top: 12, right: 16 }}>
        {c.grid}
        {/* обе оси обрезаются по данным: от нуля весь разброс стратегий схлопывается в угол */}
        <XAxis
          type="number"
          dataKey="x"
          name="Приведённые расходы"
          unit=" млн"
          domain={['dataMin - 120', 'dataMax + 120']}
          {...c.x}
        />
        <YAxis type="number" dataKey="y" name="Доля гибких каналов" unit="%" domain={['dataMin - 2', 'dataMax + 2']} {...c.y} />
        <ZAxis range={[80, 80]} />
        <Tooltip
          {...c.tooltip}
          cursor={{ stroke: t.grid }}
          formatter={(v, n) => [`${fmt(Number(v), 1)}${n === 'Доля гибких каналов' ? '%' : ' млн у.е.'}`, String(n)]}
          labelFormatter={() => ''}
          content={({ payload }) => {
            const p = payload?.[0]?.payload as { label: string; x: number; y: number; service: number } | undefined;
            if (!p) return null;
            return (
              <div style={{ background: t.surface, border: `1px solid ${t.grid}`, borderRadius: 8, padding: 8, color: t.text }}>
                <div style={{ fontWeight: 600 }}>{p.label}</div>
                <div style={{ color: t.text2 }}>
                  {fmt(p.x)} млн у.е. · гибкие каналы {fmt(p.y, 1)}% · сервис {fmt(p.service, 1)}%
                </div>
              </div>
            );
          }}
        />
        <Legend {...c.legend} />
        <Scatter name="Исполнимые" data={feasible} fill={t.series[0]} stroke={t.surface} strokeWidth={2} isAnimationActive={false} />
        <Scatter name="Неисполнимые" data={infeasible} fill={t.series[1]} stroke={t.surface} strokeWidth={2} shape="triangle" isAnimationActive={false} />
        <Scatter name="Выбранная" data={selected} fill={t.series[3]} stroke={t.text} strokeWidth={2} shape="diamond" isAnimationActive={false} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

/**
 * Чувствительность. Расходы и сервис показаны отдельными графиками: это разные
 * величины с разными шкалами, а вторая ось на одном графике вводила бы в заблуждение.
 */
export function SensitivityChart({
  points,
  metric,
  t,
}: {
  points: SensitivityPoint[];
  metric: 'cost' | 'service';
  t: ChartTheme;
}) {
  const c = chrome(t);
  const isCost = metric === 'cost';
  const data = points.map((p) => ({
    factor: Math.round(p.factor * 100),
    value: isCost ? Math.round(p.total_cost_mln) : Math.round(p.min_service_total * 1000) / 10,
    feasible: p.feasible,
  }));
  const color = isCost ? t.series[0] : t.series[2];

  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data} margin={{ top: 12, right: 16 }}>
        {c.grid}
        <XAxis dataKey="factor" unit="%" {...c.x} />
        <YAxis {...c.y} domain={isCost ? undefined : [80, 101]} tickFormatter={(v) => fmt(v)} unit={isCost ? undefined : '%'} />
        <Tooltip
          {...c.tooltip}
          formatter={(v) => `${fmt(Number(v), isCost ? 0 : 1)}${isCost ? ' млн у.е.' : '%'}`}
          labelFormatter={(l) => `Параметр: ${l}% от исходного`}
        />
        {!isCost && (
          <ReferenceLine y={97} stroke={t.axis} label={{ value: 'требование 97%', position: 'insideBottomRight', fill: t.muted, fontSize: 12 }} />
        )}
        <Line
          name={isCost ? 'Расходы' : 'Минимальный сервис'}
          dataKey="value"
          stroke={color}
          strokeWidth={2}
          dot={{ r: 4, fill: color, stroke: t.surface, strokeWidth: 2 }}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
