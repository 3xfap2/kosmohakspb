/**
 * Необязательный слой языковой модели.
 *
 * Правило одно: числа приходят из расчётного ядра, модель их только переформулирует.
 * В запрос уходит готовый результат расчёта, а не сырые данные кейса, и модели прямо
 * запрещено придумывать значения. Без ключа ассистент продолжает работать на движке.
 *
 * Ключ хранится только в браузере пользователя и в репозиторий не попадает.
 */
import type { AssistantAnswer } from './assistant';

export interface LlmSettings {
  apiKey: string;
  model: string;
  endpoint: string;
}

export const DEFAULT_LLM: Omit<LlmSettings, 'apiKey'> = {
  model: 'gpt-4o-mini',
  endpoint: 'https://api.openai.com/v1/chat/completions',
};

const SYSTEM_DATA = [
  'Ты — ассистент оператора орбитального топливного узла в прототипе «Космоконтур».',
  'Отвечай по-русски, деловым тоном, коротко: три–пять предложений без списков.',
  'Используй ТОЛЬКО числа и факты из блока DATA. Ничего не додумывай и не округляй иначе.',
  'Если в DATA нет ответа на вопрос, честно скажи об этом и предложи, какой расчёт запустить.',
  'Не давай рекомендаций и выводов, которых нет в DATA: никаких «стоит вкладываться» без сравнения вариантов в данных.',
  'Не называй себя языковой моделью и не извиняйся, просто отвечай по существу.',
].join(' ');

/** Для приветствий и вопросов о самом инструменте: разговорно и без чисел. */
const SYSTEM_CHAT = [
  'Ты — ассистент оператора орбитального топливного узла в прототипе «Космоконтур».',
  'Отвечай по-русски, дружелюбно и коротко: одно–три предложения.',
  'Это обычная реплика, а не запрос расчёта: НЕ приводи цифры, не пересказывай состояние плана и не отчитывайся о расходах.',
  'Если уместно, предложи один-два примера вопросов из блока DATA.',
  'Не называй себя языковой моделью.',
].join(' ');

export interface LlmContext {
  scenario_id: string;
  variant: string;
  discounted_cost_mln: number;
  min_service_total: number;
  feasible: boolean;
  failed_constraints: string[];
}

export async function rephraseWithLlm(
  question: string,
  answer: AssistantAnswer,
  context: LlmContext,
  settings: LlmSettings,
  signal?: AbortSignal,
): Promise<string> {
  const chat = answer.mode === 'chat';
  const data = chat
    ? { реплика_пользователя: question, что_умеет_ассистент: answer.lines }
    : {
        вопрос: question,
        результат_расчёта: {
          тема: answer.title,
          выводы: answer.lines,
          показатели: answer.facts,
          источник: answer.source,
        },
        текущее_состояние: {
          сценарий: context.scenario_id,
          вариант_спроса: context.variant,
          приведённые_расходы_млн: Math.round(context.discounted_cost_mln),
          минимальный_сервис: Number((context.min_service_total * 100).toFixed(1)),
          план_исполним: context.feasible,
          нарушения: context.failed_constraints.slice(0, 6),
        },
      };

  const response = await fetch(settings.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    signal,
    body: JSON.stringify({
      model: settings.model,
      temperature: chat ? 0.6 : 0.2,
      max_tokens: chat ? 160 : 400,
      messages: [
        { role: 'system', content: chat ? SYSTEM_CHAT : SYSTEM_DATA },
        { role: 'user', content: `DATA:\n${JSON.stringify(data, null, 1)}\n\nОтветь пользователю.` },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Модель ответила ошибкой ${response.status}. ${text.slice(0, 160)}`);
  }

  const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = json.choices?.[0]?.message?.content?.trim();
  if (!content) throw new Error('Модель вернула пустой ответ');
  return content;
}

const KEY_STORAGE = 'kk.llm';

export function loadLlmSettings(): LlmSettings | null {
  try {
    const raw = localStorage.getItem(KEY_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LlmSettings;
    return parsed.apiKey ? { ...DEFAULT_LLM, ...parsed } : null;
  } catch {
    return null;
  }
}

export function saveLlmSettings(settings: LlmSettings | null): void {
  try {
    if (settings) localStorage.setItem(KEY_STORAGE, JSON.stringify(settings));
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* приватный режим браузера */
  }
}

/** Ключ показываем только частично: полностью он нигде не отображается. */
export const maskKey = (key: string): string =>
  key.length <= 10 ? '••••' : `${key.slice(0, 5)}…${key.slice(-4)}`;
