// Журнал решений оператора: что менялось, когда и к чему это привело.
// Нужен для прослеживаемости: любой шаг можно посмотреть и откатить.
// Журнал переживает перезагрузку страницы — иначе история теряется там,
// где она нужнее всего: при проверке чужим человеком.

import type { Plan } from '../engine/plan';

export interface HistoryEntry {
  id: number;
  at: string;
  action: string;
  detail: string;
  scenario_id: string;
  /** Снимок плана до изменения — по нему выполняется откат. */
  before: Plan;
  metrics: { cost: number; service: number; feasible: boolean };
}

const KEY = 'kk.history';
const LIMIT = 25;

let counter = 0;

export const newEntry = (
  action: string,
  detail: string,
  scenario_id: string,
  before: Plan,
  metrics: HistoryEntry['metrics'],
): HistoryEntry => ({
  id: ++counter,
  at: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  action,
  detail,
  scenario_id,
  before: structuredClone(before),
  metrics,
});

export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    if (!Array.isArray(parsed)) return [];
    counter = parsed.reduce((max, e) => Math.max(max, e.id ?? 0), 0);
    return parsed.filter((e) => e.before?.decisions);
  } catch {
    return [];
  }
}

export function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries.slice(0, LIMIT)));
  } catch {
    // переполнение хранилища или приватный режим — журнал остаётся только в сессии
  }
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

export const historyCsv = (entries: HistoryEntry[]): string => {
  const head = 'time,action,detail,scenario,cost_before_mln,service_before,feasible_before';
  const lines = entries.map((e) =>
    [
      e.at,
      e.action,
      `"${e.detail.replace(/"/g, '""')}"`,
      e.scenario_id,
      Math.round(e.metrics.cost),
      e.metrics.service.toFixed(4),
      e.metrics.feasible,
    ].join(','),
  );
  return [head, ...lines].join('\n');
};
