/**
 * Тревоги: что в текущем плане требует внимания прямо сейчас.
 * Собираются из нарушений ограничений, показателей в красной зоне и близости к порогам.
 */
import { kpis } from './kpi';
import type { Evaluation } from './planner';

export interface Alert {
  id: string;
  level: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  /** Раздел контура, где это видно. */
  where: string;
}

export function alerts(evaluation: Evaluation): Alert[] {
  const out: Alert[] = [];
  const { checks, violations, result } = evaluation;

  for (const c of checks.filter((x) => !x.passed && x.role === 'hard')) {
    out.push({
      id: `${c.constraint_id}-${c.year ?? 'all'}`,
      level: 'critical',
      title: `${c.constraint_id}${c.year ? `, ${c.year} год` : ''}`,
      detail: `${c.metric}: факт ${c.actual.toFixed(3)}, требуется ${c.operator} ${c.threshold}`,
      where: 'Ограничения',
    });
  }

  for (const v of violations.slice(0, 6)) {
    out.push({ id: `${v.code}-${v.year ?? ''}`, level: 'critical', title: v.code, detail: v.message, where: 'Ограничения' });
  }

  for (const k of kpis(evaluation)) {
    if (k.status === 'bad')
      out.push({
        id: `kpi-${k.id}`,
        level: 'warning',
        title: `KPI: ${k.label}`,
        detail: `${k.actual.toFixed(3)} при цели ${k.target}`,
        where: 'Обзор',
      });
  }

  // близость к пределам: предупреждаем заранее
  const capexShare = result.totals.capex_mln / 2800;
  if (capexShare > 0.8 && capexShare <= 1)
    out.push({
      id: 'capex-near',
      level: 'warning',
      title: 'CAPEX близок к лимиту 2040 года',
      detail: `${Math.round(result.totals.capex_mln)} млн у.е. из 2 800, свободно ${Math.round(2800 - result.totals.capex_mln)} млн`,
      where: 'План',
    });

  const tightYear = result.years.find((y) => {
    const days = (y.reserve_actual_t / y.total_demand_t) * 365;
    return days >= 45 && days < 47;
  });
  if (tightYear)
    out.push({
      id: 'reserve-tight',
      level: 'info',
      title: 'Резерв держится впритык',
      detail: `${tightYear.year} год: ${((tightYear.reserve_actual_t / tightYear.total_demand_t) * 365).toFixed(1)} дня при нормативе 45`,
      where: 'Обзор',
    });

  const emergency = result.sources.filter((s) => s.source_id === 'E').reduce((sum, s) => sum + s.delivered_t, 0);
  if (emergency > 0)
    out.push({
      id: 'emergency-used',
      level: 'warning',
      title: 'Аварийный канал используется в плановом снабжении',
      detail: `${emergency.toFixed(1)} т за горизонт; по условиям кейса он не может быть базовым каналом более двух лет подряд`,
      where: 'План',
    });

  return out;
}
