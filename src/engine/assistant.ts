/**
 * Ассистент оператора.
 *
 * Разбирает запрос на естественном языке, определяет намерение и ЗАПУСКАЕТ расчёт
 * в движке. Числа берутся только из результата расчёта: ассистент их не придумывает
 * и не пересказывает. Каждый ответ содержит ссылку на источник — модуль или правило,
 * по которому он получен.
 */
import { getBaseYears, sourceById } from './caseData';
import { evaluatePlan, searchStrategies } from './planner';
import { PROFILES, scoreByProfile } from './mcda';
import { assessRisk, defaultRiskRegister, monteCarlo, sensitivity } from './risks';
import { adaptationAnalysis, reverseStress } from './stressLab';
import { GEO_PRESETS, assessGeoEvent } from './geopolitics';
import type { Plan } from './plan';
import type { DemandVariant } from './simulate';

export interface AssistantContext {
  plan: Plan;
  scenario_id: string;
  variant: DemandVariant;
}

export interface AssistantAnswer {
  intent: string;
  title: string;
  lines: string[];
  facts: { label: string; value: string }[];
  source: string;
  /**
   * 'data' — ответ по расчёту, числа обязательны.
   * 'chat' — приветствие и навигация: отвечать разговорно, без чисел.
   * 'explain' — объяснение понятия кейса по справочнику.
   */
  mode?: 'data' | 'chat' | 'explain';
}

const f = (v: number, d = 0) => v.toLocaleString('ru-RU', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (v: number, d = 1) => `${f(v * 100, d)}%`;

const has = (text: string, ...words: string[]) => words.some((w) => text.includes(w));

/** Вытаскивает число процентов из фразы: «спрос +12%», «на 15 процентов». */
function extractPercent(text: string): number | null {
  const m = text.match(/(\d+(?:[.,]\d+)?)\s*(?:%|процент)/);
  return m ? Number(m[1].replace(',', '.')) / 100 : null;
}

function extractYear(text: string): number | null {
  const m = text.match(/20(3[5-9]|4[0-5])/);
  return m ? Number(m[0]) : null;
}


/** Справочник понятий кейса: определения берутся из условий организатора, а не из общих знаний. */
const GLOSSARY: { keys: string[]; term: string; text: string }[] = [
  {
    keys: ['take-or-pay', 'take or pay', 'бери или плати'],
    term: 'Take-or-pay',
    text: 'Обязательство оплатить минимальный объём, даже если отобрали меньше. Платёж считается как цена × max(заказ, доля take-or-pay × зарезервированный объём). У Earth-Core доля 70%, у Earth-New 50% после ввода, у остальных каналов её нет. Минимум уже внутри max, вторым платежом он не начисляется.',
  },
  {
    keys: ['резервирован', 'capacity reservation', 'резерв мощност'],
    term: 'Резервирование мощности',
    text: 'Отдельная годовая плата за право на будущую поставку: тариф × зарезервированная мощность × доля года. Это право на поставку, а не топливо в узле: резерв мощности и физический запас никогда не складываются.',
  },
  {
    keys: ['lead time', 'срок постав', 'время постав'],
    term: 'Lead time',
    text: 'Срок от решения до доступности поставки. В кейсе: Earth-Core 12 месяцев, Earth-Flex 4 месяца, Earth-New 18–24 месяца после реализации опциона, Lunar-ISRU 1–2 месяца после ввода, Emergency 6 недель. Из-за этих сроков реакция на ухудшение условий возможна не сразу.',
  },
  {
    keys: ['reserve_45d', '45-дневн', '45 дней', 'сорокапятидневн'],
    term: 'RESERVE_45D — 45-дневный резерв',
    text: 'Требование кейса: на начало каждого года в узле должен быть запас, эквивалентный 45 дням спроса. Считается как годовой спрос × 45 ÷ 365. Проверяется по каждому году, нарушение выводится с годом и величиной.',
  },
  {
    keys: ['zbo', 'модернизац хранилищ'],
    term: 'ZBO-модернизация',
    text: 'Опция улучшения хранилища с 2036 года: ёмкость растёт с 70 до 120 т, потери падают с 4,5% до 1,2% от оборота, CAPEX 180 млн у.е. и дополнительный OPEX 12 млн в год. Коэффициент потерь здесь учебный, а не характеристика реальной технологии. В стрессе ZBO обязательна: там предел потерь 2%.',
  },
  {
    keys: ['isru', 'лунное производ', 'лунный источник'],
    term: 'Lunar-ISRU',
    text: 'Лунный источник топлива с доставкой в узел. Доступен с 2038 года при условии, что CAPEX 1 250 млн у.е. профинансирован до 2038-го. Самая дешёвая тонна — 3,0 млн у.е., но надёжность в первый год 0,78, а в обязательном стрессе фактическая поставка падает до 55% и 75% плана.',
  },
  {
    keys: ['emergency', 'аварийный канал', 'аварийная постав'],
    term: 'Emergency',
    text: 'Аварийный или спотовый канал: мощность 80 т/год, цена 13,8 млн у.е. за тонну, срок активации 6 недель. Самый быстрый и самый дорогой. По условиям кейса он не может быть базовым каналом снабжения более двух лет подряд.',
  },
  {
    keys: ['storage_overflow', 'переполнен'],
    term: 'STORAGE_OVERFLOW',
    text: 'Код нарушения: запас превысил ёмкость хранилища. Возникает, когда заказано больше, чем узел способен принять и выдать. Год и величину превышения видно на вкладке «Ограничения».',
  },
  {
    keys: ['capacity_exceeded', 'превышение мощност'],
    term: 'CAPACITY_EXCEEDED',
    text: 'Код нарушения: зарезервировано или заказано больше, чем позволяет годовая мощность канала.',
  },
  {
    keys: ['team_rule_reservation'],
    term: 'TEAM_RULE_RESERVATION',
    text: 'Правило команды, а не кейса: заказ по каналу с платой за резервирование не должен превышать зарезервированную мощность. Иначе резервирование теряет смысл как право на поставку.',
  },
  {
    keys: ['приведённ', 'приведенн', 'дисконт'],
    term: 'Приведённые расходы',
    text: 'Разновременные расходы, приведённые к 2035 году по реальной ставке 7% годовых. Ставка — допущение команды, организатор её не задаёт, и она одинакова для всех сравниваемых вариантов.',
  },
  {
    keys: ['потер', 'throughput', 'оборот'],
    term: 'Потери и оборот',
    text: 'Потери считаются один раз от валового поступления за период: поступление × коэффициент режима хранилища, 4,5% до модернизации и 1,2% после. Повторно на остаток те же потери не начисляются.',
  },
  {
    keys: ['минимакс', 'сожален', 'робаст'],
    term: 'Минимакс сожалений',
    text: 'Способ выбрать инвестиции, не угадывая сценарий. Сожаление — насколько стратегия дороже лучшей в том же сценарии. Выбирается вариант с наименьшим максимальным сожалением; стратегии, нарушающие ограничения хотя бы в одном сценарии, исключаются.',
  },
  {
    keys: ['парето'],
    term: 'Фронт Парето',
    text: 'Набор стратегий, которые нельзя улучшить по одному критерию, не ухудшив другой. Сравнение идёт по приведённым расходам, минимальному сервису и доле объёма без обязательств take-or-pay.',
  },
  {
    keys: ['монте', 'monte'],
    term: 'Монте-Карло',
    text: 'Вероятностная проверка: в каждом прогоне каналы случайно отказывают с вероятностью «единица минус надёжность», поставка падает на заданную тяжесть. Отказы считаются независимыми — это допущение команды. Число прогонов и seed раскрыты, результат воспроизводим.',
  },
  {
    keys: ['mcda', 'весов', 'профил интерес'],
    term: 'MCDA — многокритериальный выбор',
    text: 'Оценка стратегий глазами разных сторон: пять критериев нормализуются в шкалу 0..1 и складываются с раскрытыми весами профиля. Вариант, нарушающий критический сервис, исключается при любых весах.',
  },
  {
    keys: ['критическ спрос', 'критический спрос'],
    term: 'Критический спрос',
    text: 'Часть общего спроса, которая обслуживается в первую очередь: государственные миссии. Он входит в общий спрос и не прибавляется к нему повторно. Требования кейса: не менее 99% критического и не менее 97% общего спроса.',
  },
];

/** Куда смотреть в контуре: используется для навигационных вопросов «где посмотреть…». */
const SECTIONS: { tab: string; keywords: string[]; what: string }[] = [
  { tab: 'Обзор', keywords: ['баланс', 'запас', 'спрос', 'kpi', 'показател', 'цепочк', 'потер', 'сервис', 'расход'], what: 'материальный баланс по годам, запас по месяцам, KPI и цепочка поставок' },
  { tab: 'План', keywords: ['заказ', 'резервирован', 'договор', 'контракт', 'инвестиц', 'take-or-pay', 'канал'], what: 'редактирование заказов и резервирования, инвестиции и договорные условия по каналам' },
  { tab: 'Ограничения', keywords: ['ограничен', 'наруш', 'проверк', 'лимит', 'capex', 'резерв 45', 'сервис 97'], what: 'проверки кейса с годом, фактом, порогом и причиной нарушения' },
  { tab: 'Сценарии', keywords: ['сценар', 'стратег', 'парето', 'сравнен', 'сожален', 'робаст'], what: 'сравнение сценариев, перебор стратегий и робастный выбор по минимаксу сожалений' },
  { tab: 'Стресс-лаб', keywords: ['стресс', 'чувствительн', 'граница', 'прочност', 'адаптац', 'горизонт', '2041', 'перспектив'], what: 'граница прочности, цена адаптации, чувствительность и расчёт за 2040 год' },
  { tab: 'Риски', keywords: ['риск', 'монте', 'вероятност', 'отказ', 'надёжн', 'надежн'], what: 'реестр рисков с последствиями и Монте-Карло с фиксированным seed' },
  { tab: 'Стороны', keywords: ['сторон', 'интерес', 'вес', 'mcda', 'профил', 'стейкхолд'], what: 'интересы участников, веса критериев и устойчивость выбора' },
  { tab: 'Геополитика', keywords: ['геополит', 'событи', 'санкц', 'торгов', 'страхов'], what: 'конструктор условного события и причинная цепочка до расходов оператора' },
  { tab: 'Соответствие', keywords: ['критери', 'жюри', 'соответств', 'баллы', 'где что'], what: 'карта критериев кейса: что проверяет жюри и где это в решении' },
  { tab: 'Данные', keywords: ['выгруз', 'csv', 'json', 'экспорт', 'сохран', 'журнал', 'ссылк', 'печат'], what: 'выгрузки, ссылка на расчёт, сравнение планов и журнал решений' },
];

export const SUGGESTIONS = [
  'Почему план не проходит?',
  'Что сломает план раньше всего?',
  'Что будет, если спрос вырастет на 10%?',
  'Сколько стоит адаптация, если узнаем в 2038?',
  'Какая стратегия лучшая?',
  'Что выберет финансирующая сторона?',
  'Что если сорвётся Earth-Core?',
  'Насколько рискован план?',
  'Что даст рост цен из-за торговых ограничений?',
  'Где посмотреть проверки ограничений?',
];

export function ask(question: string, ctx: AssistantContext): AssistantAnswer {
  const q = question.toLowerCase().trim();
  const { plan, scenario_id, variant } = ctx;
  const evaluation = evaluatePlan(plan, { scenario_id, variant });

  // 0. Приветствие и вопрос о возможностях
  const smalltalk =
    // без : в JS граница слова не работает с кириллицей
    /^(привет|здравствуй|здравствуйте|хай|hi|hello|добрый день|добрый вечер|доброе утро|ку|спасибо|благодарю|че|чё|чо|ок|окей|ага|ты кто|кто ты|как дела|как ты)/.test(q) ||
    has(q, 'что умеешь', 'что ты умеешь', 'чем поможешь', 'как пользоваться', 'помощь', 'справка');

  if (smalltalk && !has(q, 'план', 'сценар', 'риск', 'расход')) {
    return {
      intent: 'greeting',
      title: 'Спросите про текущий план',
      lines: [
        'Считаю по вашему плану и показываю, каким модулем получен ответ. Вот что умею:',
        'Диагностика: почему план не проходит и что именно нарушено.',
        'Прочность: что сломает план раньше всего и при каком отклонении условий.',
        'Риски: последствия срыва конкретного канала и общая вероятность дефицита.',
        'Решения: стоит ли вкладываться в ISRU, ZBO или Earth-New, что выберет конкретная сторона.',
        'Навигация: где в контуре смотреть нужный расчёт.',
      ],
      facts: [
        { label: 'Сценарий', value: scenario_id },
        { label: 'Горизонт', value: `${getBaseYears()[0]}–${getBaseYears().at(-1)}` },
      ],
      source: 'ассистент работает поверх расчётного ядра',
      mode: 'chat',
    };
  }

  // 1. Диагностика текущего плана
  if (has(q, 'почему', 'не проход', 'наруш', 'что не так', 'ошибк')) {
    const failed = evaluation.checks.filter((c) => !c.passed && c.role === 'hard');
    const violations = evaluation.violations;
    if (!failed.length && !violations.length)
      return {
        intent: 'diagnose',
        title: 'План проходит все обязательные проверки',
        lines: [
          `Минимальный сервис ${pct(evaluation.min_service_total)}, критический ${pct(evaluation.min_service_critical)}.`,
          `Приведённые расходы ${f(evaluation.discounted_cost_mln)} млн у.е., CAPEX ${f(evaluation.capex_mln)} млн.`,
        ],
        facts: [
          { label: 'Проверок пройдено', value: `${evaluation.checks.filter((c) => c.passed).length} из ${evaluation.checks.length}` },
          { label: 'Запас на конец горизонта', value: `${f(evaluation.end_horizon_reserve_days)} дней` },
        ],
        source: 'constraints.ts — проверка по data/constraints.csv',
      };

    return {
      intent: 'diagnose',
      title: `Нарушений: ${failed.length + violations.length}`,
      lines: [
        ...failed.slice(0, 5).map((c) => `${c.constraint_id}${c.year ? ` за ${c.year}` : ''}: факт ${f(c.actual, 3)}, требуется ${c.operator} ${c.threshold}.`),
        ...violations.slice(0, 4).map((v) => v.message),
      ],
      facts: [
        { label: 'Минимальный сервис', value: pct(evaluation.min_service_total) },
        { label: 'Дефицит за горизонт', value: `${f(evaluation.shortage_total_t, 1)} т` },
      ],
      source: 'constraints.ts — идентификаторы и пороги из набора организатора',
    };
  }

  // 1.2. Справочник понятий кейса
  const asksMeaning = has(q, 'что такое', 'что значит', 'что означает', 'объясни', 'расшифруй', 'значение');
  const term = GLOSSARY.find((g) => g.keys.some((k) => q.includes(k)));
  if (term && (asksMeaning || q.split(' ').length <= 4)) {
    return {
      intent: 'glossary',
      title: term.term,
      lines: [term.text],
      facts: [],
      source: 'справочник понятий кейса',
      mode: 'explain',
    };
  }
  if (asksMeaning && !term) {
    return {
      intent: 'glossary_miss',
      title: 'Такого понятия в кейсе нет',
      lines: [
        'В условиях кейса этого термина нет, поэтому объяснить его данными расчёта не могу.',
        'Могу рассказать про take-or-pay, резервирование мощности, lead time, 45-дневный резерв, ZBO, Lunar-ISRU, коды нарушений, минимакс сожалений или Монте-Карло.',
      ],
      facts: [],
      source: 'справочник понятий кейса',
      mode: 'explain',
    };
  }

  // 1.5. Экономика: сколько стоит план и тонна
  const asksMoney = has(q, 'сколько стоит', 'стоимост', 'цена тонны', 'во сколько обой', 'расход', 'бюджет', 'capex', 'opex', 'сколько денег');
  // «стоит ли вкладываться» и «сколько стоит адаптация» — это другие намерения, они ниже
  if (asksMoney && !has(q, 'стоит ли', 'вкладыва', 'окупа', 'адаптац', 'узнаем', 'успеем')) {
    const totals = evaluation.result.totals;
    const finance = evaluation.result.finance;
    const sum = (pick: (row: (typeof finance)[number]) => number) => finance.reduce((acc, row) => acc + pick(row), 0);
    const share = (value: number) => pct(value / totals.total_cost_mln, 0);

    return {
      intent: 'economics',
      title: 'Во что обходится план',
      lines: [
        `Расходы за горизонт ${f(totals.total_cost_mln)} млн у.е., приведённые ${f(totals.discounted_cost_mln)} млн.`,
        `Тонна фактически обслуженного спроса стоит ${f(totals.cost_per_served_t, 2)} млн у.е. с учётом всех вложений.`,
        `Структура: закупка ${share(sum((r) => r.procurement_mln))}, CAPEX ${share(sum((r) => r.capex_mln))}, резервирование ${share(sum((r) => r.reservation_mln))}, постоянный OPEX ${share(sum((r) => r.fixed_opex_mln))}, хранение ${share(sum((r) => r.holding_mln))}.`,
      ],
      facts: [
        { label: 'Закупка топлива', value: `${f(sum((r) => r.procurement_mln))} млн` },
        { label: 'CAPEX', value: `${f(totals.capex_mln)} млн` },
        { label: 'Резервирование мощности', value: `${f(sum((r) => r.reservation_mln))} млн` },
        { label: 'Хранение', value: `${f(sum((r) => r.holding_mln))} млн` },
      ],
      source: 'simulate.ts — платежи по правилам кейса, take-or-pay внутри max()',
    };
  }

  // 2. Граница прочности
  if (has(q, 'сломает', 'граница', 'прочност', 'обратный стресс', 'при каких')) {
    const rs = reverseStress(plan, scenario_id, { variant });
    const nearest = rs.nearest_break;
    return {
      intent: 'reverse_stress',
      title: 'Граница прочности плана',
      lines: [
        rs.thresholds.demand_only
          ? `Рост спроса на ${f((rs.thresholds.demand_only - 1) * 100)}% уже ломает план.`
          : 'Рост спроса в проверенном диапазоне план не ломает.',
        rs.thresholds.isru_only
          ? `Падение поставки ISRU на ${f((1 - rs.thresholds.isru_only) * 100)}% выводит план за ограничения.`
          : 'Недопоставка ISRU сама по себе план не ломает.',
        nearest
          ? `Ближайшее сочетание: спрос ${f(nearest.demand_factor * 100)}%, цена ${f(nearest.price_factor * 100)}%, ISRU ${f(nearest.isru_share_factor * 100)}%. Нарушается ${nearest.failed.slice(0, 2).join(', ')}.`
          : 'В проверенной сетке сочетаний план держится.',
      ],
      facts: [
        { label: 'Проверено сочетаний', value: String(rs.grid.length) },
        { label: 'Из них ломают план', value: String(rs.grid.filter((g) => !g.feasible).length) },
      ],
      source: 'stressLab.ts — обратный стресс-тест',
    };
  }

  // 3. Чувствительность к спросу или цене
  if (has(q, 'спрос вырас', 'вырастет спрос', 'если спрос', 'цены вырас', 'подорожа')) {
    const param = has(q, 'цен', 'подорожа') ? 'price_earth' : 'demand';
    const delta = extractPercent(q) ?? 0.1;
    const points = sensitivity(plan, scenario_id, param, [1, 1 + delta]);
    const after = points[1];
    return {
      intent: 'sensitivity',
      title: param === 'demand' ? `Спрос выше на ${f(delta * 100)}%` : `Цена земных каналов выше на ${f(delta * 100)}%`,
      lines: [
        `Расходы: ${f(points[0].total_cost_mln)} → ${f(after.total_cost_mln)} млн у.е.`,
        `Минимальный сервис: ${pct(points[0].min_service_total)} → ${pct(after.min_service_total)}.`,
        after.feasible ? 'План продолжает выполнять ограничения.' : 'План перестаёт выполнять ограничения кейса.',
      ],
      facts: [
        { label: 'Изменение расходов', value: `${f(after.total_cost_mln - points[0].total_cost_mln, 1)} млн` },
        { label: 'Итог', value: after.feasible ? 'держит' : 'ломается' },
      ],
      source: 'risks.ts — анализ чувствительности',
    };
  }

  // 4. Адаптация
  if (has(q, 'адаптац', 'успеем', 'узнаем', 'среагир', 'что делать если')) {
    const learnYear = extractYear(q) ?? 2038;
    const { baseline, options } = adaptationAnalysis(plan, { scenario_id, learn_year: learnYear, variant });
    const best = options.filter((o) => o.added_volume_t > 0).sort((a, b) => a.shortage_after_t - b.shortage_after_t)[0];
    return {
      intent: 'adaptation',
      title: `Реакция, если ухудшение видно в начале ${learnYear} года`,
      lines: [
        `Ничего не менять: дефицит ${f(baseline.shortage_after_t, 1)} т, сервис ${pct(baseline.service_after)}.`,
        best
          ? `${best.label}: реакция с ${best.first_effective_year} года, добираем ${f(best.added_volume_t, 1)} т, расходы ${f(best.delta_cost_mln, 1)} млн, дефицит падает до ${f(best.shortage_after_t, 1)} т.`
          : 'Свободной мощности у каналов не осталось: быстро исправить план нечем.',
        'Earth-Core реагирует только со следующего года — у него срок поставки 12 месяцев.',
      ],
      facts: options.map((o) => ({
        label: o.label,
        value: `с ${o.first_effective_year ?? '—'} · ${f(o.delta_cost_mln, 1)} млн`,
      })),
      source: 'stressLab.ts — анализ адаптации с учётом lead time',
    };
  }

  // 5. Выбор стратегии, в том числе глазами стороны
  if (has(q, 'стратег', 'лучш', 'выбер', 'что выбрать', 'сторона', 'инвестор', 'потребител')) {
    const ranked = searchStrategies({ scenario_id, variant });
    const profile = PROFILES.find((p) => q.includes(p.label.toLowerCase().split(' ')[0]));
    if (profile) {
      const scored = scoreByProfile(ranked.slice(0, 16), profile).filter((r) => !r.excluded_reason);
      return {
        intent: 'mcda',
        title: `Выбор стороны «${profile.label}»`,
        lines: [
          profile.rationale,
          `Предпочтение: ${scored[0].label} (оценка ${f(scored[0].score, 3)}).`,
          scored[1] ? `Следующий вариант: ${scored[1].label}, отрыв ${f(scored[0].score - scored[1].score, 3)}.` : '',
        ].filter(Boolean),
        facts: [
          { label: 'Приведённые расходы', value: `${f(scored[0].raw.cost)} млн` },
          { label: 'Минимальный сервис', value: pct(scored[0].raw.service) },
          { label: 'CAPEX', value: `${f(scored[0].raw.capex)} млн` },
        ],
        source: 'mcda.ts — веса профиля раскрыты на вкладке «Стороны»',
      };
    }
    const best = ranked.find((e) => e.feasible) ?? ranked[0];
    return {
      intent: 'strategy',
      title: `Лучшая стратегия сценария: ${best.label}`,
      lines: [
        `Приведённые расходы ${f(best.discounted_cost_mln)} млн у.е., CAPEX ${f(best.capex_mln)} млн.`,
        `Минимальный сервис ${pct(best.min_service_total)}, дефицит ${f(best.shortage_total_t, 1)} т.`,
        `Исполнимых стратегий: ${ranked.filter((e) => e.feasible).length} из ${ranked.length}.`,
      ],
      facts: [
        { label: 'Запас на конец 2040', value: `${f(best.end_horizon_reserve_days)} дней` },
        { label: 'Гибкость плана', value: pct(best.flexibility_share, 0) },
      ],
      source: 'planner.ts — перебор стратегий на единой базе данных',
    };
  }

  // 6. Стоит ли вкладываться в конкретную инвестицию
  if (has(q, 'стоит ли', 'вкладыва', 'нужен ли', 'нужна ли', 'выгодн', 'окупа')) {
    const targets: { id: string; label: string; words: string[] }[] = [
      { id: 'LUNAR_ISRU', label: 'Lunar-ISRU', words: ['isru', 'лунн', 'луна'] },
      { id: 'ZBO', label: 'ZBO-модернизация', words: ['zbo', 'модерниз', 'хранилищ', 'потер'] },
      { id: 'EARTH_NEW', label: 'Earth-New', words: ['earth-new', 'earth new', 'новый поставщик', 'нового поставщика'] },
    ];
    const target = targets.find((t) => t.words.some((w) => q.includes(w)));
    if (target) {
      const ranked = searchStrategies({ scenario_id, variant });
      const withIt = ranked.find((e) => e.feasible && e.plan.decisions.investments.some((i) => i.investment_id === target.id));
      const without = ranked.find((e) => e.feasible && !e.plan.decisions.investments.some((i) => i.investment_id === target.id));

      if (withIt && without) {
        const diff = withIt.discounted_cost_mln - without.discounted_cost_mln;
        return {
          intent: 'investment',
          title: `${target.label}: сравнение лучших планов с ней и без неё`,
          lines: [
            `С ${target.label}: ${withIt.label}, приведённые расходы ${f(withIt.discounted_cost_mln)} млн, CAPEX ${f(withIt.capex_mln)} млн, сервис ${pct(withIt.min_service_total)}.`,
            `Без неё: ${without.label}, приведённые расходы ${f(without.discounted_cost_mln)} млн, CAPEX ${f(without.capex_mln)} млн, сервис ${pct(without.min_service_total)}.`,
            diff < 0
              ? `В сценарии ${scenario_id} вариант с ${target.label} дешевле на ${f(-diff)} млн приведённых расходов.`
              : `В сценарии ${scenario_id} вариант с ${target.label} дороже на ${f(diff)} млн приведённых расходов.`,
          ],
          facts: [
            { label: 'Разница расходов', value: `${f(diff)} млн у.е.` },
            { label: 'Разница CAPEX', value: `${f(withIt.capex_mln - without.capex_mln)} млн у.е.` },
          ],
          source: 'planner.ts — перебор стратегий на единой базе данных',
        };
      }

      return {
        intent: 'investment',
        title: `${target.label}: сравнение невозможно`,
        lines: [
          withIt
            ? `Все исполнимые стратегии сценария ${scenario_id} включают ${target.label}: без неё план ограничения не проходит.`
            : `Ни одна исполнимая стратегия сценария ${scenario_id} не использует ${target.label}.`,
        ],
        facts: [{ label: 'Исполнимых стратегий', value: String(searchStrategies({ scenario_id, variant }).filter((e) => e.feasible).length) }],
        source: 'planner.ts — перебор стратегий',
      };
    }
  }

  // 7. Конкретный риск канала
  if (has(q, 'сорв', 'откаж', 'риск', 'авари')) {
    const register = defaultRiskRegister();
    const named = register.find((r) => r.source_id && q.includes(sourceById(r.source_id).name.toLowerCase()));
    if (named) {
      const a = assessRisk(plan, scenario_id, named, variant);
      return {
        intent: 'risk',
        title: named.event,
        lines: [
          `Вероятность ${pct(named.probability)} в год, основание: ${named.probability_basis}`,
          a.unused_channel
            ? 'Этот канал текущим планом не используется, поэтому последствий для плана нет.'
            : `Дефицит ${f(a.shortage_t, 1)} т, минимальный сервис падает до ${pct(a.min_service_total)}.`,
          `Мера: ${named.mitigation}.`,
        ],
        facts: [
          { label: 'Δ расходов', value: `${f(a.delta_cost_mln, 1)} млн` },
          { label: 'Остаточный риск', value: a.residual_note },
        ],
        source: 'risks.ts — последствия считаются пересчётом плана',
      };
    }
    const mc = monteCarlo(plan, scenario_id, { runs: 400, seed: 42, variant });
    return {
      intent: 'risk_overall',
      title: 'Насколько рискован план',
      lines: [
        `Вероятность дефицита за горизонт ${pct(mc.p_any_shortage)} при ${mc.runs} прогонах, seed ${mc.seed}.`,
        `Сервис опускается ниже 97% в ${pct(mc.p_service_below_target)} прогонов.`,
        `Средний дефицит ${f(mc.mean_shortage_t, 1)} т, 95-й процентиль ${f(mc.p95_shortage_t, 1)} т.`,
      ],
      facts: [
        { label: 'Средние расходы', value: `${f(mc.mean_total_cost_mln)} млн` },
        { label: 'Допущение', value: 'отказы каналов независимы' },
      ],
      source: 'risks.ts — Монте-Карло, вероятность отказа = 1 − надёжность канала',
    };
  }

  // 8. Геополитика
  if (has(q, 'геополит', 'торгов', 'ограничен на постав', 'санкц', 'цены из-за')) {
    const event = GEO_PRESETS[0];
    const impact = assessGeoEvent(plan, scenario_id, event, { variant });
    return {
      intent: 'geopolitics',
      title: event.label,
      lines: [
        `${event.description}`,
        `Расходы: ${f(impact.before.total_cost_mln)} → ${f(impact.after.total_cost_mln)} млн у.е.`,
        impact.skipped_years.length
          ? `Годы ${impact.skipped_years.join(', ')} пропущены: обязательный стресс уже поднимает цену, повторно не начисляем.`
          : 'Событие наложено на все годы периода.',
      ],
      facts: [
        { label: 'Δ расходов', value: `${f(impact.delta_cost_mln, 1)} млн` },
        { label: 'Диапазон оценки', value: impact.range_costs ? `${f(impact.range_costs.low)} – ${f(impact.range_costs.high)} млн` : '—' },
      ],
      source: 'geopolitics.ts — исследовательский сценарий на копии набора',
    };
  }

  // 9. Навигация по контуру: «где посмотреть…»
  if (has(q, 'где ', 'куда смотреть', 'в каком раздел', 'как найти', 'покажи раздел', 'открой раздел')) {
    const scored = SECTIONS.map((section) => ({
      section,
      hits: section.keywords.filter((k) => q.includes(k)).length,
    })).sort((a, b) => b.hits - a.hits);

    const best = scored[0].hits > 0 ? scored[0].section : null;
    return {
      intent: 'navigation',
      title: best ? `Раздел «${best.tab}»` : 'Куда смотреть в контуре',
      lines: best
        ? [`Там ${best.what}.`, 'Быстрый переход: Ctrl+K и название раздела.']
        : [
            'Уточните, что именно нужно. Разделы контура:',
            ...SECTIONS.slice(0, 6).map((s) => `${s.tab} — ${s.what}.`),
          ],
      facts: best ? [{ label: 'Раздел', value: best.tab }] : [],
      source: 'навигация по разделам контура',
      mode: 'chat',
    };
  }

  // 10. Сравнение сценариев по умолчанию
  const otherId = scenario_id === 'BASE' ? 'MANDATORY_STRESS' : 'BASE';
  const other = evaluatePlan(plan, { scenario_id: otherId, variant });
  const reasons = [
    ...evaluation.checks.filter((c) => !c.passed && c.role === 'hard').map((c) => `${c.constraint_id}${c.year ? ` ${c.year}` : ''}`),
    ...new Set(evaluation.violations.map((v) => v.code)),
  ].slice(0, 4);

  return {
    intent: 'fallback',
    title: 'Коротко о текущем плане',
    lines: [
      `Расходы ${f(evaluation.total_cost_mln)} млн у.е., приведённые ${f(evaluation.discounted_cost_mln)} млн.`,
      evaluation.feasible
        ? `Минимальный сервис ${pct(evaluation.min_service_total)}, план проходит все обязательные ограничения.`
        : `Минимальный сервис ${pct(evaluation.min_service_total)}, но план не проходит: ${reasons.join(', ')}. Спросите «почему план не проходит», чтобы увидеть детали.`,
      `В сценарии ${otherId === 'BASE' ? 'стандартном' : 'стрессовом'} этот же план: сервис ${pct(other.min_service_total)}, ${other.feasible ? 'проходит' : 'не проходит'}.`,
      `Спросите иначе — например: ${SUGGESTIONS.slice(0, 3).join(' · ')}`,
    ],
    facts: [
      { label: 'Горизонт', value: `${getBaseYears()[0]}–${getBaseYears().at(-1)}` },
      { label: 'Сценарий', value: scenario_id },
    ],
    source: 'planner.ts — пересчёт плана в обоих сценариях',
  };
}
