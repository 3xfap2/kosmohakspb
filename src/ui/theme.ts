// Три темы оформления. Палитры графиков проверены валидатором на фоне карточек
// каждой темы: контраст к поверхности и различимость при дальтонизме.

import { useEffect, useState } from 'react';

export type ThemeId = 'contour' | 'midnight' | 'paper';

export const THEMES: { id: ThemeId; label: string; note: string }[] = [
  { id: 'contour', label: 'Контур', note: 'глубокий бирюзовый, центр управления' },
  { id: 'midnight', label: 'Полночь', note: 'графит с тёплым акцентом, строгий финансовый вид' },
  { id: 'paper', label: 'Бумага', note: 'светлая редакторская, для проектора и печати' },
];

const CHART_THEMES = {
  contour: {
    surface: '#101b1e',
    plane: '#0c1417',
    text: '#ffffff',
    text2: '#c3ced0',
    muted: '#8a9a9d',
    grid: '#1e3034',
    axis: '#2b4247',
    mint: '#8ce8e4',
    ok: '#7ef0d0',
    bad: '#ff9270',
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'],
  },
  midnight: {
    surface: '#16161a',
    plane: '#0b0b0d',
    text: '#f7f6f4',
    text2: '#b9b7b2',
    muted: '#85837d',
    grid: '#2a2a30',
    axis: '#3a3a42',
    mint: '#ffc98a',
    ok: '#6fd4a0',
    bad: '#ff8b6b',
    series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181'],
  },
  paper: {
    surface: '#fbfaf8',
    plane: '#efece6',
    text: '#12130f',
    text2: '#4a4c45',
    muted: '#7c7f74',
    grid: '#e3e0d8',
    axis: '#c9c5bb',
    mint: '#0f5f57',
    ok: '#0a7d55',
    bad: '#c1462b',
    series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4'],
  },
} as const;

export type ChartTheme = (typeof CHART_THEMES)['contour'];

const STORAGE_KEY = 'kk.theme';
const EVENT = 'kk-theme-change';

export function getTheme(): ThemeId {
  try {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeId | null;
    if (saved && saved in CHART_THEMES) return saved;
  } catch {
    /* приватный режим браузера */
  }
  return 'contour';
}

export function applyTheme(id: ThemeId): void {
  document.documentElement.dataset.theme = id;
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* noop */
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}

export function useChartTheme(): ChartTheme {
  const [id, setId] = useState<ThemeId>(() => getTheme());

  useEffect(() => {
    const onChange = (e: Event) => setId((e as CustomEvent<ThemeId>).detail);
    window.addEventListener(EVENT, onChange);
    return () => window.removeEventListener(EVENT, onChange);
  }, []);

  return CHART_THEMES[id] as ChartTheme;
}

const nf = (digits: number) =>
  new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const fmt = (v: number, digits = 0) => nf(digits).format(v);
export const fmtPct = (v: number, digits = 0) => `${fmt(v * 100, digits)}%`;
export const fmtSigned = (v: number, digits = 0) => `${v > 0 ? '+' : ''}${fmt(v, digits)}`;
