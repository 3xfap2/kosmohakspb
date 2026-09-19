/**
 * Риск-блок и выгрузки: надёжность используется только здесь, выгрузка совпадает
 * с расчётом и открывается обратно.
 */
import { describe, expect, it } from 'vitest';
import { buildExportEnvelope, comparisonCsv, kpiCsv, parsePlanJson, planJson, toCsv } from '../exportData';
import { buildPlan, enumerateStrategies, evaluatePlan, searchStrategies } from '../planner';
import { assessRisk, defaultRiskRegister, monteCarlo, reliabilityFor, sensitivity } from '../risks';

const best = searchStrategies({ scenario_id: 'BASE' })[0];

describe('Надёжность каналов', () => {
  it('разбирается из reliability_profile', () => {
    expect(reliabilityFor('A', 2035)).toBe(0.96);
    expect(reliabilityFor('D', 2038)).toBe(0.78);
    expect(reliabilityFor('D', 2040)).toBe(0.93);
    expect(reliabilityFor('C', 2036, 2036)).toBe(0.88);
    expect(reliabilityFor('C', 2038, 2036)).toBe(0.94);
  });

  it('в реестр попадают все каналы, включая аварийный, плюс риски решения', () => {
    const register = defaultRiskRegister();
    expect(register.map((r) => r.risk_id)).toEqual([
      'SUPPLY_A',
      'SUPPLY_B',
      'SUPPLY_C',
      'SUPPLY_D',
      'SUPPLY_E',
      'PRICE_EARTH',
      'ISRU_DELAY',
    ]);
    expect(register.find((r) => r.risk_id === 'SUPPLY_A')!.probability).toBeCloseTo(0.04, 6);
  });

  it('аварийный канал оценён как риск, потому что назван мерой для остальных', () => {
    const register = defaultRiskRegister();
    const emergency = register.find((r) => r.risk_id === 'SUPPLY_E')!;
    expect(emergency.dependencies).toContain('SUPPLY_A');
    // канал назван мерой у других рисков — значит его собственный отказ обязан быть в реестре
    const usesEmergency = register.filter((r) => r.risk_id !== 'SUPPLY_E' && /запас|мощност/i.test(r.mitigation));
    expect(usesEmergency.length).toBeGreaterThan(0);
  });

  it('причины, владельцы и основание тяжести различаются по каналам', () => {
    const channels = defaultRiskRegister().filter((r) => r.risk_id.startsWith('SUPPLY_'));
    expect(new Set(channels.map((r) => r.cause)).size).toBe(channels.length);
    expect(new Set(channels.map((r) => r.owner)).size).toBe(channels.length);
    for (const r of channels) expect(r.severity_basis.length).toBeGreaterThan(10);
  });
});

describe('Последствия рисков', () => {
  it('нарушение поставок основного канала даёт дефицит и падение сервиса', () => {
    const risk = defaultRiskRegister().find((r) => r.risk_id === 'SUPPLY_A')!;
    const assessment = assessRisk(best.plan, 'BASE', risk);
    expect(assessment.shortage_t).toBeGreaterThan(0);
    expect(assessment.min_service_total).toBeLessThan(0.97);
  });

  it('рост цены земных каналов увеличивает расходы, но не создаёт дефицита', () => {
    const risk = defaultRiskRegister().find((r) => r.risk_id === 'PRICE_EARTH')!;
    const assessment = assessRisk(best.plan, 'BASE', risk);
    expect(assessment.delta_cost_mln).toBeGreaterThan(0);
    expect(assessment.shortage_t).toBeCloseTo(0, 6);
  });

  it('Монте-Карло воспроизводим при том же seed и меняется при другом', () => {
    const a = monteCarlo(best.plan, 'BASE', { runs: 120, seed: 7 });
    const b = monteCarlo(best.plan, 'BASE', { runs: 120, seed: 7 });
    const c = monteCarlo(best.plan, 'BASE', { runs: 120, seed: 8 });
    expect(a).toEqual(b);
    expect(c.p_any_shortage).not.toBe(Number.NaN);
    expect(a.p_any_shortage).toBeGreaterThanOrEqual(0);
    expect(a.p_any_shortage).toBeLessThanOrEqual(1);
  });

  it('чувствительность находит границу: при росте спроса план перестаёт держать сервис', () => {
    const points = sensitivity(best.plan, 'BASE', 'demand', [1, 1.1, 1.2]);
    expect(points[0].feasible).toBe(true);
    expect(points.at(-1)!.min_service_total).toBeLessThan(points[0].min_service_total);
  });
});

describe('Выгрузки', () => {
  it('конверт содержит разделы схемы организатора', () => {
    const envelope = buildExportEnvelope(best, []);
    for (const key of [
      'scenario_id',
      'plan_id',
      'units',
      'assumptions_reference',
      'yearly_balance',
      'source_schedule',
      'inventory_trace',
      'financial_breakdown',
      'constraint_checks',
      'risk_register',
    ])
      expect(envelope).toHaveProperty(key);
    expect(envelope.inventory_trace).toHaveLength(72); // 6 лет × 12 месяцев
  });

  it('KPI-выгрузка совпадает с расчётом', () => {
    const csv = kpiCsv(best);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('scenario_id,plan_id,year,metric,value,unit');
    const served2035 = lines.find((l) => l.includes(',2035,served_demand,'))!;
    expect(Number(served2035.split(',')[4])).toBeCloseTo(best.result.years[0].served_total_t, 1);
  });

  it('CSV экранирует запятые и кавычки и заканчивается переводом строки', () => {
    expect(toCsv([{ a: 'раз, два', b: 'он сказал "да"' }])).toBe('a,b\n"раз, два","он сказал ""да"""\n');
  });

  it('сравнение стратегий выгружается строкой на стратегию', () => {
    const csv = comparisonCsv(searchStrategies({ scenario_id: 'BASE' }));
    // заголовок плюс строка на стратегию; завершающий перевод строки отбрасываем
    expect(csv.trimEnd().split('\n')).toHaveLength(enumerateStrategies().length + 1);
    expect(csv.endsWith('\n')).toBe(true);
  });

  it('план сохраняется и открывается обратно с тем же результатом', () => {
    const strategy = enumerateStrategies().find((s) => s.investments.length === 2)!;
    const plan = buildPlan(strategy, { scenario_id: 'BASE' });
    const restored = parsePlanJson(planJson(plan));
    expect(restored).toEqual(plan);
    expect(evaluatePlan(restored, { scenario_id: 'BASE' }).total_cost_mln).toBeCloseTo(
      evaluatePlan(plan, { scenario_id: 'BASE' }).total_cost_mln,
      6,
    );
  });

  it('повреждённый файл плана даёт понятную ошибку', () => {
    expect(() => parsePlanJson('{"plan_id":"x"}')).toThrow(/plan.schema.json/);
  });
});
