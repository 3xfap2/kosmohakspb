/**
 * Интересы сторон и многокритериальный выбор.
 *
 * Правила, которые здесь соблюдаются жёстко:
 *  - критерии, нормализация и происхождение весов раскрыты;
 *  - денежные показатели, объёмы и качественные предпочтения не складываются без
 *    нормализации к безразмерной шкале 0..1;
 *  - итоговую оценку нельзя улучшить снижением веса пострадавшей стороны:
 *    ограничение критического сервиса остаётся жёстким и исключает вариант
 *    независимо от весов.
 */
import type { Evaluation } from './planner';

export type Criterion = 'cost' | 'service' | 'flexibility' | 'capex' | 'resilience';

export const CRITERIA: { id: Criterion; label: string; direction: 'min' | 'max'; unit: string; meaning: string }[] = [
  { id: 'cost', label: 'Приведённые расходы', direction: 'min', unit: 'млн у.е.', meaning: 'стоимость обеспечения спроса за горизонт' },
  { id: 'service', label: 'Минимальный сервис', direction: 'max', unit: 'доля', meaning: 'худший год по обслуживанию общего спроса' },
  { id: 'flexibility', label: 'Гибкость', direction: 'max', unit: 'доля', meaning: 'доля объёма по каналам без обязательства take-or-pay' },
  { id: 'capex', label: 'CAPEX', direction: 'min', unit: 'млн у.е.', meaning: 'объём вложений, который нужно профинансировать' },
  { id: 'resilience', label: 'Запас на конец горизонта', direction: 'max', unit: 'дней', meaning: 'не позволяет доедать резерв к 2040 году' },
];

export interface StakeholderProfile {
  id: string;
  label: string;
  rationale: string;
  weights: Record<Criterion, number>;
}

export const PROFILES: StakeholderProfile[] = [
  {
    id: 'OPERATOR',
    label: 'Оператор узла',
    rationale: 'Отвечает за исполнимость плана и за расходы; ценит предсказуемость и возможность пересмотра.',
    weights: { cost: 0.35, service: 0.25, flexibility: 0.2, capex: 0.1, resilience: 0.1 },
  },
  {
    id: 'CRITICAL',
    label: 'Критические потребители',
    rationale: 'Государственные миссии: срыв недопустим, цена вторична.',
    weights: { cost: 0.1, service: 0.45, flexibility: 0.1, capex: 0.05, resilience: 0.3 },
  },
  {
    id: 'COMMERCIAL',
    label: 'Коммерческие потребители',
    rationale: 'Платят за тонну: важна цена и стабильность поставок.',
    weights: { cost: 0.5, service: 0.25, flexibility: 0.15, capex: 0.05, resilience: 0.05 },
  },
  {
    id: 'INVESTOR',
    label: 'Финансирующая сторона',
    rationale: 'Ограничивает вложения и не любит длинные необеспеченные проекты.',
    weights: { cost: 0.25, service: 0.15, flexibility: 0.1, capex: 0.45, resilience: 0.05 },
  },
  {
    id: 'SUPPLIER',
    label: 'Поставщики',
    rationale: 'Заинтересованы в законтрактованных объёмах: чем больше take-or-pay, тем предсказуемее загрузка.',
    weights: { cost: 0.15, service: 0.2, flexibility: 0.05, capex: 0.1, resilience: 0.5 },
  },
];

const valueOf = (e: Evaluation, criterion: Criterion): number => {
  switch (criterion) {
    case 'cost':
      return e.discounted_cost_mln;
    case 'service':
      return e.min_service_total;
    case 'flexibility':
      return e.flexibility_share;
    case 'capex':
      return e.capex_mln;
    case 'resilience':
      return e.end_horizon_reserve_days;
  }
};

/** Мин-макс нормализация к шкале 0..1 с учётом направления критерия. */
export function normalizeValues(evaluations: Evaluation[], criterion: Criterion): Map<string, number> {
  const direction = CRITERIA.find((c) => c.id === criterion)!.direction;
  const values = evaluations.map((e) => valueOf(e, criterion));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const out = new Map<string, number>();
  evaluations.forEach((e, i) => {
    const raw = span < 1e-12 ? 1 : (values[i] - min) / span;
    out.set(e.label, direction === 'max' ? raw : 1 - raw);
  });
  return out;
}

export interface McdaRow {
  label: string;
  evaluation: Evaluation;
  score: number;
  normalized: Record<Criterion, number>;
  raw: Record<Criterion, number>;
  excluded_reason: string | null;
}

/**
 * Оценка стратегий по профилю интересов.
 * Варианты, нарушающие критический сервис или другие жёсткие ограничения, исключаются
 * до взвешивания: веса не могут «отменить» обязательство перед критическими миссиями.
 */
export function scoreByProfile(evaluations: Evaluation[], profile: StakeholderProfile): McdaRow[] {
  const normalized = new Map<Criterion, Map<string, number>>();
  for (const c of CRITERIA) normalized.set(c.id, normalizeValues(evaluations, c.id));

  return evaluations
    .map((e) => {
      const norm = {} as Record<Criterion, number>;
      const raw = {} as Record<Criterion, number>;
      let score = 0;
      for (const c of CRITERIA) {
        norm[c.id] = normalized.get(c.id)!.get(e.label) ?? 0;
        raw[c.id] = valueOf(e, c.id);
        score += norm[c.id] * profile.weights[c.id];
      }
      const excluded = !e.feasible
        ? e.min_service_critical < 0.99
          ? 'нарушено обязательство перед критическими потребителями (сервис ниже 99%)'
          : 'нарушены жёсткие ограничения кейса'
        : null;
      return { label: e.label, evaluation: e, score: excluded ? 0 : score, normalized: norm, raw, excluded_reason: excluded };
    })
    .sort((a, b) => Number(!!a.excluded_reason) - Number(!!b.excluded_reason) || b.score - a.score);
}

export interface ProfileComparison {
  profile: StakeholderProfile;
  top: McdaRow;
  runnerUp: McdaRow | null;
  gap: number;
}

/** Что выбирает каждая сторона на одном и том же наборе альтернатив. */
export function compareProfiles(evaluations: Evaluation[]): ProfileComparison[] {
  return PROFILES.map((profile) => {
    const ranked = scoreByProfile(evaluations, profile).filter((r) => !r.excluded_reason);
    return {
      profile,
      top: ranked[0],
      runnerUp: ranked[1] ?? null,
      gap: ranked[1] ? ranked[0].score - ranked[1].score : 0,
    };
  });
}

export interface WeightSensitivityRow {
  criterion: Criterion;
  label: string;
  delta: number;
  new_top: string;
  changed: boolean;
}

/**
 * Чувствительность выбора к весам: каждый вес поочерёдно сдвигается на delta
 * с перенормировкой остальных. Показывает, держится ли решение или зависит от весов.
 */
export function weightSensitivity(
  evaluations: Evaluation[],
  profile: StakeholderProfile,
  delta = 0.15,
): WeightSensitivityRow[] {
  const baseTop = scoreByProfile(evaluations, profile).filter((r) => !r.excluded_reason)[0]?.label ?? '—';
  const rows: WeightSensitivityRow[] = [];

  for (const c of CRITERIA) {
    for (const sign of [1, -1]) {
      const shifted = { ...profile.weights };
      shifted[c.id] = Math.max(0, Math.min(1, shifted[c.id] + sign * delta));
      const sum = Object.values(shifted).reduce((s, v) => s + v, 0);
      for (const key of Object.keys(shifted) as Criterion[]) shifted[key] = shifted[key] / sum;
      const top =
        scoreByProfile(evaluations, { ...profile, weights: shifted }).filter((r) => !r.excluded_reason)[0]?.label ?? '—';
      rows.push({
        criterion: c.id,
        label: c.label,
        delta: sign * delta,
        new_top: top,
        changed: top !== baseTop,
      });
    }
  }
  return rows;
}
