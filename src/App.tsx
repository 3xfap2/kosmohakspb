import { useEffect, useMemo, useState } from 'react';
import { alerts } from './engine/alerts';
import { Mark } from './ui/Mark';
import { setHorizonExtension } from './engine/caseData';
import type { Plan } from './engine/plan';
import { evaluatePlan, searchStrategies } from './engine/planner';
import type { DemandVariant } from './engine/simulate';
import { Auth } from './ui/Auth';
import { AssistantDock } from './ui/AssistantDock';
import { CommandPalette, type Command } from './ui/CommandPalette';
import { Landing } from './ui/Landing';
import { clearHistory, loadHistory, newEntry, saveHistory, type HistoryEntry } from './ui/history';
import { readStateFromUrl, shareLink as buildShareLink } from './ui/permalink';
import { clearProgress, loadProgress, saveProgress, savedAgo } from './ui/progress';
import { currentAccount, signOut, type Account } from './ui/session';
import { THEMES, applyTheme, fmt, fmtPct, getTheme, useChartTheme, type ThemeId } from './ui/theme';
import type { PlanChange, TabProps } from './ui/tabProps';
import { ComplianceTab } from './ui/tabs/ComplianceTab';
import { ConstraintsTab } from './ui/tabs/ConstraintsTab';
import { ExportTab } from './ui/tabs/ExportTab';
import { GeopoliticsTab } from './ui/tabs/GeopoliticsTab';
import { Overview } from './ui/tabs/Overview';
import { PlanTab } from './ui/tabs/PlanTab';
import { RisksTab } from './ui/tabs/RisksTab';
import { ScenariosTab } from './ui/tabs/ScenariosTab';
import { StakeholdersTab } from './ui/tabs/StakeholdersTab';
import { StressLab } from './ui/tabs/StressLab';

const TABS = [
  { id: 'overview', label: 'Обзор', Component: Overview },
  { id: 'plan', label: 'План', Component: PlanTab },
  { id: 'constraints', label: 'Ограничения', Component: ConstraintsTab },
  { id: 'scenarios', label: 'Сценарии', Component: ScenariosTab },
  { id: 'stress', label: 'Стресс-лаб', Component: StressLab },
  { id: 'risks', label: 'Риски', Component: RisksTab },
  { id: 'stakeholders', label: 'Стороны', Component: StakeholdersTab },
  { id: 'geo', label: 'Геополитика', Component: GeopoliticsTab },
  { id: 'compliance', label: 'Соответствие', Component: ComplianceTab },
  { id: 'export', label: 'Данные', Component: ExportTab },
] as const;

type TabId = (typeof TABS)[number]['id'];

const SCENARIOS_UI = [
  { id: 'BASE', label: 'Стандартный' },
  { id: 'MANDATORY_STRESS', label: 'Стресс' },
];

const VARIANTS: { id: DemandVariant; label: string }[] = [
  { id: 'low', label: 'Низкий' },
  { id: 'base', label: 'Базовый' },
  { id: 'high', label: 'Высокий' },
];

export default function App() {
  const t = useChartTheme();
  const [themeId, setThemeId] = useState<ThemeId>(() => getTheme());

  useEffect(() => {
    applyTheme(themeId);
  }, [themeId]);
  // приоритет: состояние из ссылки → сохранённый прогресс → план по умолчанию
  const restored = useMemo(() => {
    const fromUrl = readStateFromUrl();
    if (fromUrl) return { source: 'link' as const, state: fromUrl };
    const saved = loadProgress();
    return saved ? { source: 'saved' as const, state: saved } : null;
  }, []);
  const shared = restored?.state ?? null;
  const restoredNote = restored
    ? restored.source === 'link'
      ? 'Расчёт восстановлен по ссылке'
      : `Работа восстановлена: сохранено ${savedAgo(loadProgress())}`
    : null;
  const [account, setAccount] = useState<Account | null>(() => currentAccount());
  const [screen, setScreen] = useState<'landing' | 'auth' | 'app'>(() => {
    if (readStateFromUrl() && currentAccount()) return 'app';
    return currentAccount() ? 'app' : 'landing';
  });

  const [tab, setTab] = useState<TabId>((shared?.tab as TabId) ?? 'overview');
  const [scenarioId, setScenarioId] = useState(shared?.scenario_id ?? 'BASE');
  const [variant, setVariant] = useState<DemandVariant>(shared?.variant ?? 'base');
  const [plan, setPlanState] = useState<Plan>(() => shared?.plan ?? searchStrategies({ scenario_id: 'BASE' })[0].plan);
  const [note, setNote] = useState<string | null>(restoredNote);
  const [horizonTo, setHorizonTo] = useState<number | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);

  // Ctrl+J открывает и закрывает ассистента с любого экрана
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'j' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        setDockOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Горизонт расширяем во время рендера, до расчётов ниже. В useEffect это выполнялось
  // уже после коммита, поэтому useMemo успевал посчитать на старом наборе лет и
  // таблицы отставали на один шаг: при переходе к 2045 показывались числа для 2043.
  useMemo(() => {
    setHorizonExtension(
      horizonTo
        ? { to_year: horizonTo, demand_growth: 0.12, method_note: 'постоянный годовой темп роста спроса после 2040 года' }
        : null,
    );
  }, [horizonTo]);

  // автосохранение: работа и журнал решений не теряются при перезагрузке
  useEffect(() => {
    saveProgress({ plan, scenario_id: scenarioId, variant, tab });
  }, [plan, scenarioId, variant, tab]);

  useEffect(() => {
    saveHistory(history);
  }, [history]);

  const key = `${scenarioId}|${variant}|${horizonTo ?? 'base'}`;
  const strategies = useMemo(() => searchStrategies({ scenario_id: scenarioId, variant }), [key]);
  const evaluation = useMemo(() => evaluatePlan(plan, { scenario_id: scenarioId, variant }), [plan, key]);
  const activeAlerts = useMemo(() => alerts(evaluation), [evaluation]);

  // Переход из тревоги в раздел: панель закрываем и подводим взгляд к содержимому,
  // иначе клик по разделу, который уже открыт, выглядит как «кнопка не работает».
  const openSection = (label: string) => {
    setTab(TABS.find((x) => x.label === label)?.id ?? 'overview');
    setAlertsOpen(false);
    requestAnimationFrame(() => document.querySelector('main.stack')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const setPlan: TabProps['setPlan'] = (updater, change?: PlanChange) => {
    setPlanState((prev) => {
      const next = typeof updater === 'function' ? (updater as (p: Plan) => Plan)(prev) : updater;
      if (change)
        setHistory((h) =>
          [
            newEntry(change.action, change.detail, scenarioId, prev, {
              cost: evaluation.discounted_cost_mln,
              service: evaluation.min_service_total,
              feasible: evaluation.feasible,
            }),
            ...h,
          ].slice(0, 40),
        );
      return next;
    });
  };

  // ассистент доступен на любом экране, включая посадочную страницу
  const assistant = (
    <>
      <AssistantDock
        open={dockOpen}
        onClose={() => setDockOpen(false)}
        plan={plan}
        scenarioId={scenarioId}
        variant={variant}
        evaluation={evaluation}
      />
      {!dockOpen && (
        <button className="fab" onClick={() => setDockOpen(true)} title="Ассистент · Ctrl+J" aria-label="Открыть ассистента">
          <span className="fab-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M21 12a8 8 0 0 1-8 8H7l-4 3v-5.5A8 8 0 1 1 21 12z" strokeLinejoin="round" />
              <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
              <circle cx="13" cy="12" r="1" fill="currentColor" stroke="none" />
              <circle cx="17" cy="12" r="1" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span className="fab-label">Ассистент</span>
        </button>
      )}
    </>
  );

  if (!account || screen !== 'app') {
    if (screen === 'auth' && !account)
      return (
        <>
          <Auth onDone={(a) => { setAccount(a); setScreen('app'); }} onBack={() => setScreen('landing')} />
          {assistant}
        </>
      );
    if (screen === 'auth' && account) setScreen('app');
    return (
      <>
        <Landing onEnter={() => setScreen(account ? 'app' : 'auth')} />
        {assistant}
      </>
    );
  }

  const props: TabProps = {
    plan,
    setPlan,
    scenarioId,
    setScenarioId,
    variant,
    evaluation,
    strategies,
    t,
    notify: setNote,
    horizonTo,
    setHorizonTo,
    history,
    restore: (entry) => {
      setPlanState(entry.before);
      setNote(`Откат: «${entry.action}» от ${entry.at}`);
    },
    shareLink: () => buildShareLink({ plan, scenario_id: scenarioId, variant, tab }),
    goTo: (next) => setTab(next as TabId),
  };

  const commands: Command[] = [
    ...TABS.map((x) => ({ id: `tab-${x.id}`, title: `Открыть: ${x.label}`, hint: 'раздел', run: () => setTab(x.id) })),
    ...SCENARIOS_UI.map((s) => ({
      id: `scenario-${s.id}`,
      title: `Сценарий: ${s.label}`,
      hint: 'пересчитать план',
      run: () => setScenarioId(s.id),
    })),
    ...VARIANTS.map((v) => ({
      id: `variant-${v.id}`,
      title: `Спрос: ${v.label}`,
      hint: 'вариант спроса',
      run: () => setVariant(v.id),
    })),
    {
      id: 'share',
      title: 'Скопировать ссылку на расчёт',
      hint: 'состояние в адресе',
      run: async () => {
        const link = buildShareLink({ plan, scenario_id: scenarioId, variant, tab });
        try {
          await navigator.clipboard.writeText(link);
          setNote('Ссылка на текущий расчёт скопирована');
        } catch {
          window.prompt('Скопируйте ссылку на расчёт', link);
        }
      },
    },
    ...THEMES.map((theme) => ({
      id: `theme-${theme.id}`,
      title: `Тема: ${theme.label}`,
      hint: theme.note,
      run: () => setThemeId(theme.id),
    })),
    { id: 'print', title: 'Печать отчёта или PDF', hint: 'текущий раздел', run: () => window.print() },
    { id: 'home', title: 'На главную', hint: 'посадочная страница', run: () => setScreen('landing') },
    {
      id: 'reset-progress',
      title: 'Сбросить сохранённую работу',
      hint: 'вернуться к плану по умолчанию',
      run: () => {
        clearProgress();
        clearHistory();
        setHistory([]);
        setPlanState(searchStrategies({ scenario_id: scenarioId })[0].plan);
        setNote('Сохранённая работа сброшена, загружен план по умолчанию');
      },
    },
    { id: 'alerts', title: 'Показать тревоги', hint: `${activeAlerts.length} шт`, run: () => setAlertsOpen(true) },
    { id: 'assistant', title: 'Открыть ассистента', hint: 'Ctrl+J · вопрос по текущему плану', run: () => setDockOpen(true) },
  ];

  const Active = TABS.find((x) => x.id === tab)!.Component;
  const criticalCount = activeAlerts.filter((a) => a.level === 'critical').length;

  return (
    <div className={dockOpen ? 'app app-docked' : 'app'}>
      <CommandPalette commands={commands} />
      {assistant}

      <header className="top">
        <button className="brand brand-btn" onClick={() => setScreen('landing')} title="На главную">
          <Mark />
          <div>
            <p className="eyebrow">КосмоХакатон 2026 · экономика космоса</p>
            <h1>Космоконтур</h1>
            <p className="lead">Поставки, запасы и инвестиции орбитального топливного узла на 2035–2040 годы.</p>
          </div>
        </button>

        <div className="top-right">
          <div className="account">
            <div className="theme-switch" role="group" aria-label="Тема оформления">
              {THEMES.map((theme) => (
                <button
                  key={theme.id}
                  className={themeId === theme.id ? 'active' : ''}
                  title={theme.note}
                  onClick={() => setThemeId(theme.id)}
                >
                  {theme.label}
                </button>
              ))}
            </div>
            <button className="ghost" onClick={() => setScreen('landing')}>
              На главную
            </button>
            <span className="muted small-text">{account.role}</span>
            <b>{account.name}</b>
            <button
              className="ghost"
              onClick={() => {
                signOut();
                setAccount(null);
                setScreen('landing');
              }}
            >
              Выйти
            </button>
          </div>
          <nav className="tabs" role="tablist">
            {TABS.map((x) => (
              <button
                key={x.id}
                role="tab"
                aria-selected={tab === x.id}
                className={tab === x.id ? 'active' : ''}
                onClick={() => setTab(x.id)}
              >
                {x.label}
              </button>
            ))}
          </nav>
        </div>
      </header>

      <div className="console">
        <div className="seg" role="group" aria-label="Сценарий">
          {SCENARIOS_UI.map((s) => (
            <button key={s.id} className={scenarioId === s.id ? 'active' : ''} onClick={() => setScenarioId(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <div className="seg" role="group" aria-label="Вариант спроса">
          {VARIANTS.map((v) => (
            <button key={v.id} className={variant === v.id ? 'active' : ''} onClick={() => setVariant(v.id)}>
              {v.label}
            </button>
          ))}
        </div>

        <span className="spacer" />

        <button className="pill quiet" onClick={() => setDockOpen((v) => !v)} title="Ctrl+J">
          Ассистент
        </button>
        <button className="pill quiet" onClick={() => setAlertsOpen((v) => !v)}>
          Тревоги&nbsp;<b>{activeAlerts.length}</b>
          {criticalCount > 0 && <span className="dot bad" />}
        </button>
        <span className="pill">
          Сервис&nbsp;<b>{fmtPct(evaluation.min_service_total, 1)}</b>
        </span>
        <span className="pill">
          Расходы&nbsp;<b>{fmt(evaluation.discounted_cost_mln)}</b>&nbsp;млн
        </span>
        <span className={evaluation.feasible ? 'pill ok' : 'pill bad'}>
          <span className="dot" />
          {evaluation.feasible ? 'план исполним' : `нарушений: ${criticalCount}`}
        </span>
      </div>

      {alertsOpen && (
        <div className="alerts">
          <div className="alerts-head">
            <b>Требует внимания</b>
            <div className="alerts-actions">
              <button
                className="ghost"
                onClick={() => {
                  const best = searchStrategies({ scenario_id: scenarioId, variant }).find((e) => e.feasible);
                  if (!best) {
                    setNote('Исполнимый план для этих условий не найден');
                    return;
                  }
                  setPlan(best.plan, { action: 'Сборка исполнимого плана', detail: `Стратегия «${best.label}»` });
                  setNote(`Собран исполнимый план: ${best.label}`);
                }}
              >
                Собрать исполнимый план
              </button>
              <button
                className="ghost"
                onClick={() => {
                  clearProgress();
                  clearHistory();
                  setHistory([]);
                  setPlanState(searchStrategies({ scenario_id: scenarioId })[0].plan);
                  setNote('Сохранённая работа сброшена, загружен план по умолчанию');
                }}
              >
                Сбросить сохранённое
              </button>
              <button className="ghost" onClick={() => setAlertsOpen(false)}>
                Скрыть
              </button>
            </div>
          </div>
          {activeAlerts.length === 0 ? (
            <p className="muted">Всё в норме: обязательные ограничения выполнены, показатели в целевых значениях.</p>
          ) : (
            <ul>
              {activeAlerts.map((a) => (
                <li key={a.id} className={a.level}>
                  <div>
                    <b>{a.title}</b>
                    <div className="muted small-text">{a.detail}</div>
                  </div>
                  <button className="link-btn" onClick={() => openSection(a.where)} title={`Перейти в раздел «${a.where}»`}>
                    {a.where}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {horizonTo && (
        <div className="banner">
          <b>Исследовательский режим.</b> Горизонт продлён до {horizonTo} года на копии набора: спрос после 2040-го задан
          допущением команды, ограничения кейса на эти годы не переносятся.
          <button className="ghost" onClick={() => setHorizonTo(null)}>
            Вернуть 2035–2040
          </button>
        </div>
      )}

      {note && <p className="muted small-text note-line">{note}</p>}

      <main className="stack">
        <Active {...props} />
      </main>

      <footer className="app-footer">
        <span className="muted small-text">
          Ctrl+K — команды и разделы · данные кейса читаются из набора организатора · расчёт идёт в браузере
        </span>
      </footer>
    </div>
  );
}
