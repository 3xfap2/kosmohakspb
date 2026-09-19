import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { DEFAULT_LLM, saveLlmSettings } from './engine/llm';
import { applyTheme, getTheme } from './ui/theme';
import './ui/styles.css';
import './ui/landing.css';

applyTheme(getTheme());

// Разовая передача ключа модели ссылкой вида #llm=...&model=...
// Ключ сразу уходит в локальное хранилище браузера, а адресная строка очищается,
// чтобы он не остался на виду и не попал в закладки.
(() => {
  const hash = window.location.hash;
  if (!hash.includes('llm=')) return;
  const params = new URLSearchParams(hash.slice(1));
  const apiKey = params.get('llm');
  if (!apiKey) return;
  saveLlmSettings({
    apiKey,
    model: params.get('model') ?? DEFAULT_LLM.model,
    endpoint: params.get('endpoint') ?? DEFAULT_LLM.endpoint,
  });
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
