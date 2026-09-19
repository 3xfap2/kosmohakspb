/**
 * Риск-блок. Отделён от контрольного расчёта: в BASE поставки детерминированы,
 * а надёжность каналов используется только здесь и с явно раскрытым смыслом.
 *
 * Интерпретация команды (TEAM_ASSUMPTION): reliability_profile канала — вероятность
 * года без нарушения поставок. Событие риска моделируется как снижение фактической
 * доли поставки канала в этом году на заданную тяжесть severity.
 * Это не умножение плановых объёмов на коэффициент надёжности в контрольном расчёте.
 */
import { CASE, SCENARIOS, getYears, sourceById } from './caseData';
import { checkConstraints, failedConstraintList, isFeasible, planViolations } from './constraints';
import type { Plan } from './plan';
import { availabilityFraction, simulate, type DemandVariant } from './simulate';
import type { Scenario } from './types';

/** Разбор поля reliability_profile: "constant:0.96", "2038:0.78;2039:0.90", "first_operating_year:0.88;later:0.94". */
export function reliabilityFor(source_id: string, year: number, firstOperatingYear?: number): number {
  const profile = sourceById(source_id).reliability_profile;
  const parts = profile.split(';').map((p) => p.trim());
  let later: number | undefined;
  let first: number | undefined;
  for (const part of parts) {
    const [key, value] = part.split(':');
    const v = Number(value);
    if (key === 'constant') return v;
    if (key === 'later') later = v;
    else if (key === 'first_operating_year') first = v;
    else if (Number(key) === year) return v;
  }
  if (first !== undefined && firstOperatingYear !== undefined)
    return year <= firstOperatingYear ? first : (later ?? first);
  return later ?? first ?? 1;
}

export interface RiskEvent {
  risk_id: string;
  event: string;
  cause: string;
  affected_parameter: string;
  source_id?: string;
  years: number[];
  /** Вероятность наступления в год; основание раскрывается в probability_basis. */
  probability: number;
  probability_basis: string;
  /** Насколько падает фактическая доля поставки канала (или растёт цена) при событии. */
  severity: number;
  /** Откуда взята тяжесть события — требование ТЗ наравне с основанием вероятности. */
  severity_basis: string;
  owner: string;
  mitigation: string;
  /** Риски, с которыми событие связано: срабатывание одного меняет условия другого. */
  dependencies: string[];
}

/**
 * Профиль риска канала. Причина, владелец и мера отличаются по природе канала:
 * единый текст на все каналы неверен по существу — у лунного производства нет
 * «отказа носителя», а аварийный канал сам является мерой для остальных.
 */
interface ChannelRisk {
  cause: string;
  owner: string;
  mitigation: string;
  severity: number;
  severity_basis: string;
  dependencies: string[];
}

const CHANNEL_RISK: Record<string, ChannelRisk> = {
  A: {
    cause: 'Отказ носителя, авария на старте, приостановка полётов типа после происшествия',
    owner: 'Оператор узла совместно с поставщиком Earth-Core',
    mitigation: 'Перенос объёма на Earth-Flex в пределах свободной мощности, физический запас узла',
    severity: 0.3,
    severity_basis: 'Приостановка полётов типа на квартал: теряется примерно треть годового объёма канала',
    dependencies: ['SUPPLY_B', 'PRICE_EARTH'],
  },
  B: {
    cause: 'Срыв попутного слота, переуступка места, сдвиг графика пусковой кампании',
    owner: 'Оператор узла совместно с поставщиком Earth-Flex',
    mitigation: 'Ранний заказ слотов, перенос объёма на Earth-Core, физический запас узла',
    severity: 0.3,
    severity_basis: 'Потеря одного-двух слотов из сезонной программы канала',
    dependencies: ['SUPPLY_A'],
  },
  C: {
    cause: 'Новый поставщик: сдвиг сертификации, недобор надёжности первого рабочего года',
    owner: 'Оператор узла совместно с новым поставщиком',
    mitigation: 'Опцион исполняется заранее, объём первого года ограничен, дублирование земными каналами',
    severity: 0.3,
    severity_basis: 'Надёжность первого рабочего года 0,88 против 0,94 далее — разница заложена в тяжесть',
    dependencies: ['SUPPLY_A', 'SUPPLY_B'],
  },
  D: {
    cause: 'Отказ оборудования добычи и переработки, деградация производительности, простой энергоснабжения базы',
    owner: 'Оператор лунного производства',
    mitigation: 'Физический запас узла, замещение земными каналами, ремонтный резерв мощности',
    severity: 0.3,
    severity_basis: 'Профиль надёжности по годам 0,78 / 0,90 / 0,93 из data/supply_sources.csv',
    dependencies: ['ISRU_DELAY', 'SUPPLY_A'],
  },
  E: {
    cause: 'Аварийный канал занят другим заказчиком, ограничение по числу пусков, отказ в приоритете',
    owner: 'Оператор узла',
    mitigation: 'Резервирование мощности заранее; при отказе меры остаётся только физический запас',
    severity: 0.3,
    severity_basis: 'Оценка команды: канал малой ёмкости, конкуренция за него в кризис возрастает',
    dependencies: ['SUPPLY_A', 'SUPPLY_B', 'SUPPLY_C', 'SUPPLY_D'],
  },
};

/**
 * Базовый реестр: события выводятся из параметров каналов, а не выдуманы.
 * Аварийный канал включён наравне с остальными: он назван мерой для четырёх
 * других рисков, поэтому его собственный отказ обязан быть оценён — иначе
 * остаточный риск считается по мере, надёжность которой не проверена.
 */
export function defaultRiskRegister(): RiskEvent[] {
  const risks: RiskEvent[] = CASE.sources.map((s) => {
    const years = getYears().filter((y) => (s.available_from_year ?? getYears()[0]) <= y);
    const worstReliability = Math.min(...years.map((y) => reliabilityFor(s.source_id, y, years[0])), 1);
    // Профиль известных каналов кейса; для канала, добавленного через данные,
    // берётся нейтральный — иначе расширение набора роняло бы реестр.
    const profile = CHANNEL_RISK[s.source_id] ?? {
      cause: 'Нарушение графика поставок канала: отказ оборудования, срыв слота, приостановка операций',
      owner: `Оператор узла совместно с поставщиком ${s.name}`,
      mitigation: 'Перенос объёма на другие каналы в пределах свободной мощности, физический запас узла',
      severity: 0.3,
      severity_basis: `Профиль надёжности канала из data/supply_sources.csv: ${s.reliability_profile}`,
      dependencies: [],
    };
    return {
      risk_id: `SUPPLY_${s.source_id}`,
      event: `Нарушение поставок канала ${s.name}`,
      cause: profile.cause,
      affected_parameter: 'actual_delivery_share',
      source_id: s.source_id,
      years,
      probability: Math.round((1 - worstReliability) * 1000) / 1000,
      probability_basis: `reliability_profile канала из data/supply_sources.csv: ${s.reliability_profile}`,
      severity: profile.severity,
      severity_basis: profile.severity_basis,
      owner: profile.owner,
      mitigation: profile.mitigation,
      dependencies: profile.dependencies,
    };
  });

  risks.push({
    risk_id: 'PRICE_EARTH',
    event: 'Рост переменной цены земных каналов',
    cause: 'Удорожание запуска, логистики, страхования',
    affected_parameter: 'variable_price_multiplier',
    years: getYears().filter((y) => y >= 2037),
    probability: 0.3,
    probability_basis: 'Сценарное допущение команды; величина шока соответствует масштабу +25% из обязательного стресса',
    severity: 0.25,
    severity_basis: 'Масштаб взят из обязательного стресса: +25% к переменной цене земных каналов',
    owner: 'Оператор узла',
    mitigation: 'Долгосрочный контракт с фиксацией цены, диверсификация каналов',
    dependencies: ['SUPPLY_A', 'SUPPLY_B'],
  });

  // Риск решения, а не канала: срыв срока ввода лунного производства.
  // Моделируется полной недоступностью канала в первый рабочий год.
  risks.push({
    risk_id: 'ISRU_DELAY',
    event: 'Срыв срока ввода лунного производства',
    cause: 'Задержка строительства, испытаний и ввода в эксплуатацию',
    affected_parameter: 'actual_delivery_share',
    source_id: 'D',
    years: [2038],
    probability: 0.25,
    probability_basis: 'Допущение команды: первый ввод производственного комплекса вне Земли, статистики графиков нет',
    severity: 1,
    severity_basis: 'Сдвиг на год: в первый рабочий год канал не поставляет ничего',
    owner: 'Оператор лунного производства совместно с финансирующей стороной',
    mitigation: 'Резервирование земной мощности на 2038 год, решение о доборе объёма до 2037 года',
    dependencies: ['SUPPLY_D'],
  });

  return risks;
}

/** Накладывает событие риска поверх сценария, не меняя исходный объект. */
export function applyRisk(scenario: Scenario, risk: RiskEvent, years = risk.years): Scenario {
  const next: Scenario = JSON.parse(JSON.stringify(scenario));
  if (risk.affected_parameter === 'actual_delivery_share' && risk.source_id) {
    const name = sourceById(risk.source_id).name;
    next.actual_delivery_share = next.actual_delivery_share ?? {};
    const current = next.actual_delivery_share[name] ?? {};
    for (const y of years) current[String(y)] = (current[String(y)] ?? 1) * (1 - risk.severity);
    next.actual_delivery_share[name] = current;
  }
  if (risk.affected_parameter === 'variable_price_multiplier') {
    next.variable_price_multiplier = next.variable_price_multiplier ?? {};
    for (const source of CASE.sources.filter((s) => s.source_id === 'A' || s.source_id === 'B')) {
      const current = next.variable_price_multiplier[source.name] ?? {};
      for (const y of years) current[String(y)] = (current[String(y)] ?? 1) * (1 + risk.severity);
      next.variable_price_multiplier[source.name] = current;
    }
  }
  next.scenario_id = `${scenario.scenario_id}+${risk.risk_id}`;
  return next;
}

export interface RiskAssessment {
  risk: RiskEvent;
  /** Канал не используется текущим планом: риск существует, но последствий для плана нет. */
  unused_channel: boolean;
  delta_cost_mln: number;
  shortage_t: number;
  min_service_total: number;
  constraint_breaks: string[];
  residual_note: string;
}

/** Количественная оценка последствий: пересчёт того же плана с наложенным событием. */
export function assessRisk(
  plan: Plan,
  scenario_id: string,
  risk: RiskEvent,
  variant: DemandVariant = 'base',
): RiskAssessment {
  const baseScenario = SCENARIOS[scenario_id];
  const baseline = simulate(plan, { scenario_id, variant });

  const scenarioWithRisk = applyRisk(baseScenario, risk);
  SCENARIOS[scenarioWithRisk.scenario_id] = scenarioWithRisk;
  const stressed = simulate(plan, { scenario_id: scenarioWithRisk.scenario_id, variant });
  const checks = checkConstraints(stressed, plan).map((c) => ({
    ...c,
    // проверки сервиса для производного сценария остаются ориентиром базового
    scenario_scope: c.scenario_scope,
  }));
  delete SCENARIOS[scenarioWithRisk.scenario_id];

  const usedVolume = risk.source_id
    ? baseline.sources.filter((s) => s.source_id === risk.source_id).reduce((sum, s) => sum + s.delivered_t, 0)
    : Number.POSITIVE_INFINITY;

  return {
    risk,
    unused_channel: usedVolume <= 1e-9,
    delta_cost_mln: stressed.totals.total_cost_mln - baseline.totals.total_cost_mln,
    shortage_t: stressed.totals.shortage_total_t,
    min_service_total: Math.min(...stressed.years.map((y) => y.service_total)),
    constraint_breaks: checks.filter((c) => !c.passed).map((c) => `${c.constraint_id}${c.year ? ` ${c.year}` : ''}`),
    residual_note:
      usedVolume <= 1e-9
        ? 'Канал не используется текущим планом: последствий нет, но при включении канала в план риск станет значимым'
        : stressed.totals.shortage_total_t > 0
          ? 'Остаточный риск: часть спроса не обслуживается, требуется аварийный канал или больший запас'
          : 'Остаточный риск покрыт запасом и резервом мощности',
  };
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MonteCarloResult {
  runs: number;
  seed: number;
  severity: number;
  p_any_shortage: number;
  p_service_below_target: number;
  mean_shortage_t: number;
  p95_shortage_t: number;
  mean_total_cost_mln: number;
  /** Стандартная ошибка оценки вероятности дефицита: sqrt(p(1-p)/n). */
  p_any_shortage_se: number;
  /** Границы 95% доверительного интервала для вероятности дефицита. */
  p_any_shortage_ci: [number, number];
}

/**
 * Монте-Карло по независимым отказам каналов.
 * Вероятность отказа канала в год = 1 − reliability (интерпретация раскрыта выше),
 * тяжесть severity — доля снижения поставки. Зависимости между каналами не вводятся:
 * это явное допущение, а не установленный факт.
 */
/**
 * Первый рабочий год канала именно в этом плане. Для Earth-New он определяется
 * годом исполнения опциона и подготовкой, для лунного — вводом в эксплуатацию.
 * Брать начало горизонта нельзя: повышенный риск первого года нового поставщика
 * тогда достаётся 2035 году, в котором канал ещё не работает.
 */
function firstOperatingYear(plan: Plan, source_id: string): number {
  const years = getYears();
  return years.find((y) => availabilityFraction(plan, source_id, y) > 0) ?? years[0];
}

export function monteCarlo(
  plan: Plan,
  scenario_id: string,
  opts: { runs?: number; seed?: number; severity?: number; variant?: DemandVariant } = {},
): MonteCarloResult {
  const runs = opts.runs ?? 500;
  const seed = opts.seed ?? 42;
  const severity = opts.severity ?? 0.3;
  const variant = opts.variant ?? 'base';
  const rng = mulberry32(seed);
  const base = SCENARIOS[scenario_id];

  const shortages: number[] = [];
  let costSum = 0;
  let anyShortage = 0;
  let serviceBelow = 0;

  for (let run = 0; run < runs; run++) {
    const scenario: Scenario = JSON.parse(JSON.stringify(base));
    scenario.scenario_id = `${scenario_id}+MC${run}`;
    scenario.actual_delivery_share = scenario.actual_delivery_share ?? {};

    for (const source of CASE.sources) {
      const years = getYears().filter((y) => availabilityFraction(plan, source.source_id, y) > 0);
      const first = firstOperatingYear(plan, source.source_id);
      const current = scenario.actual_delivery_share[source.name] ?? {};
      for (const year of years) {
        const p = 1 - reliabilityFor(source.source_id, year, first);
        if (rng() < p) current[String(year)] = (current[String(year)] ?? 1) * (1 - severity);
      }
      if (Object.keys(current).length) scenario.actual_delivery_share[source.name] = current;
    }

    SCENARIOS[scenario.scenario_id] = scenario;
    const result = simulate(plan, { scenario_id: scenario.scenario_id, variant });
    delete SCENARIOS[scenario.scenario_id];

    const shortage = result.totals.shortage_total_t;
    shortages.push(shortage);
    costSum += result.totals.total_cost_mln;
    if (shortage > 1e-6) anyShortage++;
    if (Math.min(...result.years.map((y) => y.service_total)) < 0.97) serviceBelow++;
  }

  shortages.sort((a, b) => a - b);
  // Оценка точности требуется постановкой наравне с числом прогонов и seed:
  // без неё нельзя сказать, различимы ли вероятности двух сценариев.
  const p = anyShortage / runs;
  const se = Math.sqrt((p * (1 - p)) / runs);
  return {
    runs,
    seed,
    severity,
    p_any_shortage: p,
    p_any_shortage_se: se,
    p_any_shortage_ci: [Math.max(0, p - 1.96 * se), Math.min(1, p + 1.96 * se)],
    p_service_below_target: serviceBelow / runs,
    mean_shortage_t: shortages.reduce((s, v) => s + v, 0) / runs,
    p95_shortage_t: shortages[Math.min(runs - 1, Math.floor(runs * 0.95))],
    mean_total_cost_mln: costSum / runs,
  };
}

/** Анализ чувствительности: как меняются расходы и сервис при сдвиге параметра. */
export interface SensitivityPoint {
  factor: number;
  total_cost_mln: number;
  min_service_total: number;
  feasible: boolean;
  /** Что именно нарушено: иначе «меньше спрос → дороже и неисполнимо» выглядит как ошибка. */
  failed_constraints: string;
}

export function sensitivity(
  plan: Plan,
  scenario_id: string,
  parameter: 'demand' | 'price_earth' | 'isru_delivery',
  factors: number[] = [0.9, 0.95, 1, 1.05, 1.1, 1.2],
): SensitivityPoint[] {
  const base = SCENARIOS[scenario_id];
  return factors.map((factor) => {
    const scenario: Scenario = JSON.parse(JSON.stringify(base));
    scenario.scenario_id = `${scenario_id}+SENS${parameter}${factor}`;
    if (parameter === 'demand') {
      scenario.demand_multiplier = scenario.demand_multiplier ?? {};
      scenario.critical_demand_multiplier = scenario.critical_demand_multiplier ?? {};
      for (const y of getYears()) {
        scenario.demand_multiplier[String(y)] = (scenario.demand_multiplier[String(y)] ?? 1) * factor;
        scenario.critical_demand_multiplier[String(y)] = (scenario.critical_demand_multiplier[String(y)] ?? 1) * factor;
      }
    }
    if (parameter === 'price_earth') {
      scenario.variable_price_multiplier = scenario.variable_price_multiplier ?? {};
      for (const name of ['Earth-Core', 'Earth-Flex']) {
        const current = scenario.variable_price_multiplier[name] ?? {};
        for (const y of getYears()) current[String(y)] = (current[String(y)] ?? 1) * factor;
        scenario.variable_price_multiplier[name] = current;
      }
    }
    if (parameter === 'isru_delivery') {
      scenario.actual_delivery_share = scenario.actual_delivery_share ?? {};
      const current = scenario.actual_delivery_share['Lunar-ISRU'] ?? {};
      for (const y of getYears()) current[String(y)] = Math.min(1, (current[String(y)] ?? 1) * factor);
      scenario.actual_delivery_share['Lunar-ISRU'] = current;
    }

    SCENARIOS[scenario.scenario_id] = scenario;
    const result = simulate(plan, { scenario_id: scenario.scenario_id });
    const checks = checkConstraints(result, plan);
    const violations = planViolations(result, plan);
    delete SCENARIOS[scenario.scenario_id];

    return {
      factor,
      total_cost_mln: result.totals.total_cost_mln,
      min_service_total: Math.min(...result.years.map((y) => y.service_total)),
      feasible: isFeasible(checks, violations),
      failed_constraints: failedConstraintList(checks, violations),
    };
  });
}
