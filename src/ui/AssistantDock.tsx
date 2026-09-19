import { useEffect, useRef, useState } from 'react';
import { SUGGESTIONS, ask, type AssistantAnswer } from '../engine/assistant';
import {
  DEFAULT_LLM,
  loadLlmSettings,
  maskKey,
  rephraseWithLlm,
  saveLlmSettings,
  type LlmSettings,
} from '../engine/llm';
import type { Plan } from '../engine/plan';
import type { Evaluation } from '../engine/planner';
import type { DemandVariant } from '../engine/simulate';

interface Message {
  id: number;
  question: string;
  answer: AssistantAnswer;
  llmText: string | null;
  llmError: string | null;
  pending: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  plan: Plan;
  scenarioId: string;
  variant: DemandVariant;
  evaluation: Evaluation;
}

export function AssistantDock({ open, onClose, plan, scenarioId, variant, evaluation }: Props) {
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [llm, setLlm] = useState<LlmSettings | null>(() => loadLlmSettings());
  const [keyDraft, setKeyDraft] = useState('');
  const [modelDraft, setModelDraft] = useState(DEFAULT_LLM.model);
  const [endpointDraft, setEndpointDraft] = useState(DEFAULT_LLM.endpoint);
  const feedRef = useRef<HTMLDivElement>(null);
  const counter = useRef(0);

  useEffect(() => {
    feedRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [messages]);

  const run = async (question: string) => {
    const text = question.trim();
    if (!text) return;
    setInput('');

    const answer = ask(text, { plan, scenario_id: scenarioId, variant });
    const id = ++counter.current;
    const useLlm = Boolean(llm?.apiKey);

    setMessages((prev) => [{ id, question: text, answer, llmText: null, llmError: null, pending: useLlm }, ...prev].slice(0, 20));
    if (!useLlm) return;

    try {
      const llmText = await rephraseWithLlm(
        text,
        answer,
        {
          scenario_id: scenarioId,
          variant,
          discounted_cost_mln: evaluation.discounted_cost_mln,
          min_service_total: evaluation.min_service_total,
          feasible: evaluation.feasible,
          failed_constraints: evaluation.checks
            .filter((c) => !c.passed && c.role === 'hard')
            .map((c) => `${c.constraint_id}${c.year ? ` ${c.year}` : ''}`),
        },
        llm!,
      );
      setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, llmText, pending: false } : m)));
    } catch (error) {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, llmError: (error as Error).message, pending: false } : m)),
      );
    }
  };

  if (!open) return null;

  return (
    <aside className="dock" aria-label="Ассистент оператора">
      <header className="dock-head">
        <div>
          <b>Ассистент</b>
          <div className="muted small-text">
            {llm ? `модель ${llm.model} · числа из движка` : 'ответы считает движок, без внешних сервисов'}
          </div>
        </div>
        <div className="dock-head-actions">
          <button
            className="link-btn"
            onClick={() => {
              if (!settingsOpen && llm) {
                setModelDraft(llm.model);
                setEndpointDraft(llm.endpoint);
              }
              setSettingsOpen((v) => !v);
            }}
          >
            {settingsOpen ? 'скрыть настройки' : 'настройки'}
          </button>
          <button className="ghost" onClick={onClose} aria-label="Закрыть">
            ✕
          </button>
        </div>
      </header>

      {settingsOpen && (
        <div className="dock-settings">
          <p className="muted small-text">
            Ключ хранится только в этом браузере и в репозиторий не попадает. Без ключа ассистент работает на движке —
            это рабочий режим для проверки без интернета.
          </p>
          <label className="field">
            <span>Ключ OpenAI</span>
            <input
              type="password"
              value={keyDraft}
              placeholder={llm ? maskKey(llm.apiKey) : 'sk-…'}
              onChange={(e) => setKeyDraft(e.target.value)}
            />
          </label>
          <label className="field">
            <span>Модель</span>
            <input value={modelDraft} onChange={(e) => setModelDraft(e.target.value)} />
          </label>
          <label className="field">
            <span>Адрес API</span>
            <input value={endpointDraft} onChange={(e) => setEndpointDraft(e.target.value)} />
          </label>
          <p className="muted small-text">
            Подойдёт любой сервис с совместимым интерфейсом: шлюз-посредник, если регион блокируется, или локальная
            модель на своей машине.
          </p>
          <div className="buttons">
            <button
              className="primary"
              onClick={() => {
                const next: LlmSettings = {
                  model: modelDraft.trim() || DEFAULT_LLM.model,
                  endpoint: endpointDraft.trim() || DEFAULT_LLM.endpoint,
                  apiKey: keyDraft.trim() || llm?.apiKey || '',
                };
                if (!next.apiKey) return;
                saveLlmSettings(next);
                setLlm(next);
                setKeyDraft('');
                setSettingsOpen(false);
              }}
            >
              Сохранить
            </button>
            <button
              onClick={() => {
                saveLlmSettings(null);
                setLlm(null);
                setKeyDraft('');
              }}
              disabled={!llm}
            >
              Удалить ключ
            </button>
          </div>
        </div>
      )}

      <div className="dock-feed" ref={feedRef}>
        {messages.length === 0 && (
          <div className="dock-empty">
            <p className="muted small-text">
              Спросите что угодно про текущий план: диагностика, граница прочности, риски, цена адаптации, выбор
              стратегии или куда смотреть в контуре.
            </p>
            <div className="chips">
              {SUGGESTIONS.slice(0, 6).map((s) => (
                <button key={s} onClick={() => run(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <article className="dock-msg" key={m.id}>
            <div className="dock-q">{m.question}</div>

            {m.pending && <div className="muted small-text">Модель формулирует ответ…</div>}

            {m.llmText && <p className="dock-a">{m.llmText}</p>}

            {!m.llmText && !m.pending && (
              <>
                <b className="dock-title">{m.answer.title}</b>
                <ul className="dock-lines">
                  {m.answer.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </>
            )}

            {m.llmError && <div className="status-warn small-text">Модель недоступна: {m.llmError}. Ниже ответ движка.</div>}

            {(m.llmText || m.llmError) && (
              <details className="dock-trace">
                <summary>Показать расчёт</summary>
                <b className="dock-title">{m.answer.title}</b>
                <ul className="dock-lines">
                  {m.answer.lines.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
              </details>
            )}

            {m.answer.facts.length > 0 && (
              <div className="dock-facts">
                {m.answer.facts.map((f, i) => (
                  <div key={i}>
                    <span>{f.label}</span>
                    <b>{f.value}</b>
                  </div>
                ))}
              </div>
            )}

            <div className="dock-source">
              {m.llmText ? 'текст сформулирован моделью · ' : ''}
              числа из расчёта: {m.answer.source}
            </div>
          </article>
        ))}
      </div>

      <form
        className="dock-input"
        onSubmit={(e) => {
          e.preventDefault();
          void run(input);
        }}
      >
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Спросить про план…" />
        <button className="primary" type="submit">
          →
        </button>
      </form>
    </aside>
  );
}
