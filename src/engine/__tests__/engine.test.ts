/**
 * Проверки движка на исходных данных кейса: загрузка CASE_INPUT, материальный баланс,
 * take-or-pay, применение обязательного стресса, ограничения и заведомо недопустимый план.
 */
import { describe, expect, it } from 'vitest';
import { CASE, SCENARIOS } from '../caseData';
import { checkConstraints, planViolations } from '../constraints';
import { emptyPlan, type Plan } from '../plan';
import { searchStrategies } from '../planner';
import { availabilityFraction, demandFor, simulate } from '../simulate';
import type { Scenario } from '../types';
import { getYears } from '../caseData';

function planWith(over: (p: Plan) => void, scenario = 'BASE'): Plan {
  const plan = emptyPlan('test', scenario);
  over(plan);
  return plan;
}

describe('Исходные данные кейса', () => {
  it('читаются из файлов организатора без правок', () => {
    expect(CASE.demand).toHaveLength(6);
    expect(CASE.demand[0]).toMatchObject({ year: 2035, base_total_t: 100, base_critical_t: 80 });
    expect(CASE.sources.map((s) => s.source_id)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(CASE.sources.find((s) => s.source_id === 'A')).toMatchObject({
      capacity_t_per_year: 190,
      variable_cost_mln_per_t: 6.2,
      take_or_pay_share: 0.7,
    });
    expect(CASE.sources.find((s) => s.source_id === 'E')).toMatchObject({ lead_time_min_value: 6, lead_time_unit: 'week' });
    expect(CASE.constraints).toHaveLength(7);
    expect(SCENARIOS.MANDATORY_STRESS.demand_multiplier?.['2038']).toBe(1.15);
  });

  it('критический спрос вложен в общий во всех вариантах', () => {
    for (const variant of ['base', 'low', 'high'] as const) {
      for (const year of [2035, 2038, 2040]) {
        const d = demandFor(year, SCENARIOS.BASE, variant);
        expect(d.critical_t).toBeLessThanOrEqual(d.total_t);
      }
    }
  });
});

describe('Материальный баланс', () => {
  const plan = planWith((p) => {
    p.decisions.inventory_policy = { opening_inventory_t: 20, opening_source_id: 'A', delivery_profile: 'even' };
    for (const row of CASE.demand) {
      p.decisions.supply_orders.push({ source_id: 'A', year: row.year, volume_t: Math.min(row.base_total_t, 190) });
      p.decisions.capacity_reservations.push({ source_id: 'A', year: row.year, capacity_t_per_year: 190 });
    }
  });
  const result = simulate(plan);

  it('сходится помесячно: I_end = I_start + delivered − losses − served', () => {
    for (const m of result.months) {
      expect(m.closing_t).toBeCloseTo(m.opening_t + m.delivered_t - m.losses_t - m.served_total_t, 9);
      expect(m.closing_t).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('потери начисляются один раз на валовое поступление', () => {
    const y = result.years[0];
    expect(y.losses_t).toBeCloseTo(y.delivered_t * 0.045, 9);
  });

  it('обслуженный объём не превышает спрос', () => {
    for (const y of result.years) {
      expect(y.served_total_t).toBeLessThanOrEqual(y.total_demand_t + 1e-9);
      expect(y.service_total).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});

describe('Платежи', () => {
  it('take-or-pay: платим за max(заказ, 70% резерва), без второго начисления', () => {
    const plan = planWith((p) => {
      p.decisions.supply_orders.push({ source_id: 'A', year: 2035, volume_t: 100 });
      p.decisions.capacity_reservations.push({ source_id: 'A', year: 2035, capacity_t_per_year: 190 });
    });
    const row = simulate(plan).sources.find((s) => s.year === 2035 && s.source_id === 'A')!;
    expect(row.payable_t).toBeCloseTo(133, 9); // max(100, 0.7 × 190)
    expect(row.variable_payment_mln).toBeCloseTo(133 * 6.2, 6);
    expect(row.reservation_payment_mln).toBeCloseTo(190 * 0.45, 9);
  });
});

describe('Обязательный стрессовый сценарий', () => {
  const build = (scenario: string) =>
    planWith((p) => {
      p.decisions.investments.push({ investment_id: 'LUNAR_ISRU', decision_year: 2037 });
      p.decisions.supply_orders.push({ source_id: 'A', year: 2038, volume_t: 150 });
      p.decisions.supply_orders.push({ source_id: 'D', year: 2038, volume_t: 100 });
    }, scenario);

  it('спрос 2038 выше базового на 15%, а до 2038 не меняется', () => {
    expect(demandFor(2037, SCENARIOS.MANDATORY_STRESS, 'base').total_t).toBeCloseTo(190, 9);
    expect(demandFor(2038, SCENARIOS.MANDATORY_STRESS, 'base').total_t).toBeCloseTo(250 * 1.15, 9);
  });

  it('фактическая поставка ISRU 55% от плана и не умножается на надёжность 0,78', () => {
    const row = simulate(build('MANDATORY_STRESS')).sources.find((s) => s.year === 2038 && s.source_id === 'D')!;
    expect(row.delivered_t).toBeCloseTo(55, 9);
    expect(row.payable_t).toBeCloseTo(100, 9); // платим за заказ: недопоставка не возвращает платёж
  });

  it('цена Earth-Core в 2038 выше на 25%, а тариф резервирования не меняется', () => {
    const stress = simulate(build('MANDATORY_STRESS')).sources.find((s) => s.year === 2038 && s.source_id === 'A')!;
    const base = simulate(build('BASE')).sources.find((s) => s.year === 2038 && s.source_id === 'A')!;
    expect(stress.price_mln_per_t).toBeCloseTo(6.2 * 1.25, 9);
    expect(base.price_mln_per_t).toBeCloseTo(6.2, 9);
  });
});

describe('Ограничения', () => {
  it('пустой план нарушает требования сервиса', () => {
    const plan = emptyPlan('empty', 'BASE');
    const checks = checkConstraints(simulate(plan), plan);
    const service = checks.filter((c) => c.constraint_id === 'BASE_TOTAL_SERVICE');
    expect(service).toHaveLength(6);
    expect(service.every((c) => !c.passed)).toBe(true);
  });

  it('ловит превышение мощности канала и недоступный канал', () => {
    const plan = planWith((p) => {
      p.decisions.capacity_reservations.push({ source_id: 'A', year: 2035, capacity_t_per_year: 250 });
      p.decisions.supply_orders.push({ source_id: 'D', year: 2035, volume_t: 50 });
    });
    const codes = planViolations(simulate(plan), plan).map((v) => v.code);
    expect(codes).toContain('CAPACITY_EXCEEDED');
    expect(codes).toContain('CHANNEL_NOT_AVAILABLE');
  });

  it('ловит позднее финансирование ISRU и переполнение хранилища', () => {
    const plan = planWith((p) => {
      p.decisions.investments.push({ investment_id: 'LUNAR_ISRU', decision_year: 2039 });
      p.decisions.supply_orders.push({ source_id: 'A', year: 2035, volume_t: 190 });
      p.decisions.inventory_policy.opening_inventory_t = 60;
    });
    const codes = planViolations(simulate(plan), plan).map((v) => v.code);
    expect(codes).toContain('ISRU_FINANCING_LATE');
    expect(codes).toContain('STORAGE_OVERFLOW');
  });

  it('отрицательный объём заказа отвергается с понятным кодом', () => {
    const plan = planWith((p) => {
      p.decisions.supply_orders.push({ source_id: 'A', year: 2035, volume_t: -10 });
    });
    const violation = planViolations(simulate(plan), plan).find((v) => v.code === 'INVALID_INPUT');
    expect(violation).toBeDefined();
    expect(violation!.message).toContain('Отрицательный объём');
  });

  it('заказ сверх зарезервированной мощности нарушает правило команды', () => {
    const plan = planWith((p) => {
      p.decisions.supply_orders.push({ source_id: 'A', year: 2035, volume_t: 120 });
      p.decisions.capacity_reservations.push({ source_id: 'A', year: 2035, capacity_t_per_year: 80 });
    });
    const codes = planViolations(simulate(plan), plan).map((v) => v.code);
    expect(codes).toContain('TEAM_RULE_RESERVATION');
  });

  it('лимит CAPEX 2037 проверяется по накопленной сумме', () => {
    const plan = planWith((p) => {
      p.decisions.investments.push({ investment_id: 'LUNAR_ISRU', decision_year: 2036 });
      p.decisions.investments.push({ investment_id: 'ZBO', decision_year: 2036 });
      p.decisions.investments.push({ investment_id: 'EARTH_NEW', decision_year: 2035, exercise_year: 2036 });
    });
    const capex2037 = checkConstraints(simulate(plan), plan).find((c) => c.constraint_id === 'CAPEX_2037')!;
    expect(capex2037.actual).toBeCloseTo(1250 + 180 + 360, 9);
    expect(capex2037.passed).toBe(true);
  });
});

describe('Область действия ограничений сценария', () => {
  it('требования сервиса остаются жёсткими в производном сценарии', () => {
    const best = searchStrategies({ scenario_id: 'BASE' })[0];
    const base = SCENARIOS['BASE'];
    const derived: Scenario = JSON.parse(JSON.stringify(base));
    derived.scenario_id = 'BASE+SENSisru0.5';
    derived.actual_delivery_share = { 'Lunar-ISRU': Object.fromEntries(getYears().map((y) => [String(y), 0.5])) };
    SCENARIOS[derived.scenario_id] = derived;

    const result = simulate(best.plan, { scenario_id: derived.scenario_id });
    const checks = checkConstraints(result, best.plan);
    delete SCENARIOS[derived.scenario_id];

    const service = checks.filter((c) => c.constraint_id.endsWith('_SERVICE'));
    expect(service.length).toBeGreaterThan(0);
    // роль обязана остаться жёсткой: иначе граница прочности считается без учёта сервиса
    for (const c of service) expect(c.role).toBe('hard');
    expect(service.some((c) => !c.passed)).toBe(true);
  });
});

describe('Срок поставки лунного канала', () => {
  const best = searchStrategies({ scenario_id: 'BASE' })[0];

  it('в первый рабочий год доступна не вся мощность', () => {
    const fraction = availabilityFraction(best.plan, 'D', 2038);
    expect(fraction).toBeLessThan(1);
    expect(fraction).toBeCloseTo(10 / 12, 3);
  });

  it('со второго года канал доступен полностью', () => {
    expect(availabilityFraction(best.plan, 'D', 2039)).toBe(1);
  });
});

describe('Физика склада', () => {
  it('запас никогда не превышает активную ёмкость', () => {
    const best = searchStrategies({ scenario_id: 'BASE' })[0];
    for (const m of best.result.months) expect(m.closing_t).toBeLessThanOrEqual(m.storage_capacity_t + 1e-6);
  });

  it('месячный баланс сходится с учётом излишка', () => {
    const best = searchStrategies({ scenario_id: 'BASE' })[0];
    for (const m of best.result.months) {
      const expected = m.opening_t + m.delivered_t - m.losses_t - m.served_total_t - m.overflow_t;
      expect(m.closing_t).toBeCloseTo(expected, 6);
    }
  });
});

describe('Начальный запас подготовительного периода', () => {
  it('оплачивается с резервированием мощности и несёт потери', () => {
    const withStock = planWith((p) => {
      p.decisions.inventory_policy.opening_inventory_t = 20;
      p.decisions.inventory_policy.opening_source_id = 'A';
    });
    const withoutStock = planWith((p) => {
      p.decisions.inventory_policy.opening_inventory_t = 0;
      p.decisions.inventory_policy.opening_source_id = 'A';
    });
    const a = simulate(withStock, { scenario_id: 'BASE' });
    const b = simulate(withoutStock, { scenario_id: 'BASE' });
    const first = (r: typeof a) => r.finance[0];

    // закупка дороже цены тонны: заложены потери на поступлении
    expect(first(a).procurement_mln).toBeGreaterThan(first(b).procurement_mln + 20 * 6.2);
    // резервирование мощности подготовительного периода начислено
    expect(first(a).reservation_mln).toBeGreaterThan(first(b).reservation_mln);
  });
});
