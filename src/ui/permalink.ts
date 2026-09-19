// Состояние расчёта в ссылке: жюри открывает ровно то, что показывали на защите.

import type { Plan } from '../engine/plan';
import type { DemandVariant } from '../engine/simulate';

export interface SharedState {
  plan: Plan;
  scenario_id: string;
  variant: DemandVariant;
  tab: string;
}

const toBase64 = (text: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const fromBase64 = (encoded: string) => {
  const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(normalized);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
};

export function encodeState(state: SharedState): string {
  return toBase64(JSON.stringify(state));
}

export function decodeState(hash: string): SharedState | null {
  const raw = hash.replace(/^#?s=/, '');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(fromBase64(raw)) as SharedState;
    if (!parsed.plan?.decisions || !parsed.scenario_id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function shareLink(state: SharedState): string {
  const { origin, pathname } = window.location;
  return `${origin}${pathname}#s=${encodeState(state)}`;
}

export function readStateFromUrl(): SharedState | null {
  return decodeState(window.location.hash);
}
