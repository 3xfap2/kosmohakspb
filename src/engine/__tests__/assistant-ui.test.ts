/**
 * Ассистент, тревоги, трассировка и карта соответствия.
 * Проверяем, что ответы приходят из расчёта, а не из текста, и что разбор числа
 * сходится с самим расчётом.
 */
import { describe, expect, it } from 'vitest';
import { alerts } from '../alerts';
import { ask, SUGGESTIONS } from '../assistant';
import { complianceMap } from '../compliance';
import { maskKey } from '../llm';
import { emptyPlan } from '../plan';
import { evaluatePlan, searchStrategies } from '../planner';
import { explainYear } from '../trace';

const best = searchStrategies({ scenario_id: 'BASE' })[0];
const ctx = { plan: best.plan, scenario_id: 'BASE', variant: 'base' as const };

describe('Ассистент: распознавание вопросов', () => {
  const cases: [string, string][] = [
    ['привет', 'greeting'],
    ['спасибо', 'greeting'],
    ['что ты умеешь?', 'greeting'],
    ['что такое take-or-pay?', 'glossary'],
    ['что значит ZBO', 'glossary'],
    ['что такое дельта-v?', 'glossary_miss'],
    ['сколько стоит тонна', 'economics'],
    ['какие у нас расходы?', 'economics'],
    ['почему план не проходит?', 'diagnose'],
    ['что сломает план раньше всего?', 'reverse_stress'],
    ['что будет, если спрос вырастет на 10%?', 'sensitivity'],
    ['сколько стоит адаптация, если узнаем в 2038?', 'adaptation'],
    ['стоит ли вкладываться в ISRU?', 'investment'],
    ['какая стратегия лучшая?', 'strategy'],
    ['что если сорвётся Earth-Core?', 'risk'],
    ['насколько рискован план?', 'risk_overall'],
    ['что даст рост цен из-за торговых ограничений?', 'geopolitics'],
    ['где посмотреть проверки ограничений?', 'navigation'],
  ];

  for (const [question, intent] of cases)
    it(`«${question}» → ${intent}`, () => {
      expect(ask(question, ctx).intent).toBe(intent);
    });

  it('все подсказки распознаются и не уходят в общий ответ', () => {
    for (const suggestion of SUGGESTIONS) expect(ask(suggestion, ctx).intent).not.toBe('fallback');
  });

  it('у каждого ответа есть источник расчёта', () => {
    for (const [question] of cases) expect(ask(question, ctx).source.length).toBeGreaterThan(5);
  });
});

describe('Ассистент: числа берутся из расчёта', () => {
  it('экономика повторяет стоимость тонны из модели', () => {
    const answer = ask('сколько стоит тонна', ctx);
    const expected = best.result.totals.cost_per_served_t.toFixed(2).replace('.', ',');
    expect(answer.lines.join(' ')).toContain(expected);
  });

  it('диагностика ломаного плана перечисляет нарушения', () => {
    const broken = emptyPlan('broken', 'BASE');
    const answer = ask('почему план не проходит?', { ...ctx, plan: broken });
    expect(answer.title).toMatch(/Нарушени/);
    // показываются первые нарушения с годом и фактом; у пустого плана это требования сервиса
    expect(answer.lines.join(' ')).toMatch(/BASE_(CRITICAL|TOTAL)_SERVICE за 20\d\d: факт/);
  });

  it('приветствие отвечает разговорным режимом без чисел', () => {
    const answer = ask('привет', ctx);
    expect(answer.mode).toBe('chat');
    expect(answer.lines.join(' ')).not.toMatch(/\d{3,}/);
  });

  it('объяснение термина помечено режимом explain', () => {
    expect(ask('что такое take-or-pay?', ctx).mode).toBe('explain');
  });
});

describe('Тревоги', () => {
  it('у исполнимого плана нет критических тревог', () => {
    expect(alerts(best).filter((a) => a.level === 'critical')).toHaveLength(0);
  });

  it('пустой план даёт критические тревоги со ссылкой на раздел', () => {
    const plan = emptyPlan('empty', 'BASE');
    const list = alerts(evaluatePlan(plan, { scenario_id: 'BASE' }));
    const critical = list.filter((a) => a.level === 'critical');
    expect(critical.length).toBeGreaterThan(0);
    for (const alert of list) expect(alert.where.length).toBeGreaterThan(2);
  });
});

describe('Трассировка числа', () => {
  const steps = explainYear(best, 2035);

  it('раскрывает все блоки расчёта года', () => {
    expect(steps.length).toBeGreaterThanOrEqual(8);
    for (const step of steps) {
      expect(step.formula.length).toBeGreaterThan(5);
      expect(step.rule.length).toBeGreaterThan(5);
      expect(step.output.length).toBeGreaterThan(0);
    }
  });

  it('материальный баланс в разборе сходится с расчётом', () => {
    const year = best.result.years[0];
    const balance = steps.find((s) => s.title === 'Материальный баланс')!;
    expect(balance.output).toContain(year.closing_t.toFixed(1).replace('.', ','));
  });
});

describe('Карта соответствия критериям', () => {
  const rows = complianceMap(best);

  it('покрывает все критерии кейса и бонус', () => {
    expect(rows).toHaveLength(21);
    expect(rows.filter((r) => r.id === 'BONUS')).toHaveLength(1);
  });

  it('у каждого пункта указан раздел и доказательство', () => {
    for (const row of rows) {
      expect(row.where.length).toBeGreaterThan(5);
      expect(row.evidence.length).toBeGreaterThan(5);
    }
  });
});

describe('Настройки модели', () => {
  it('ключ показывается только частично', () => {
    const masked = maskKey('sk-proj-1234567890abcdef');
    expect(masked).not.toContain('1234567890');
    expect(masked.startsWith('sk-pr')).toBe(true);
    expect(maskKey('short')).toBe('••••');
  });
});
