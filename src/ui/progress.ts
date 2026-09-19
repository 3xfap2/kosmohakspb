// Автосохранение работы: план, сценарий, вариант спроса и открытый раздел.
// Нужно, чтобы перезагрузка страницы или потеря связи не обнуляли разбор,
// который человек уже сделал.

import type { Plan } from '../engine/plan';
import type { DemandVariant } from '../engine/simulate';

export interface Progress {
  plan: Plan;
  scenario_id: string;
  variant: DemandVariant;
  tab: string;
  saved_at: string;
}

const KEY = 'kk.progress';

export function saveProgress(state: Omit<Progress, 'saved_at'>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...state, saved_at: new Date().toISOString() }));
  } catch {
    // приватный режим или переполнение хранилища — работаем без сохранения
  }
}

export function loadProgress(): Progress | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Progress;
    return parsed.plan?.decisions && parsed.scenario_id ? parsed : null;
  } catch {
    return null;
  }
}

export function clearProgress(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}

export function savedAgo(progress: Progress | null): string | null {
  if (!progress?.saved_at) return null;
  const diffMin = Math.round((Date.now() - new Date(progress.saved_at).getTime()) / 60000);
  if (diffMin < 1) return 'только что';
  if (diffMin < 60) return `${diffMin} мин назад`;
  const hours = Math.round(diffMin / 60);
  return hours < 24 ? `${hours} ч назад` : new Date(progress.saved_at).toLocaleDateString('ru-RU');
}
