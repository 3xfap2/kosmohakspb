import { useEffect, useMemo, useState } from 'react';

export interface Command {
  id: string;
  title: string;
  hint?: string;
  run: () => void;
}

/** Быстрый доступ ко всему контуру: Ctrl+K или «/». Нужен, чтобы демонстрация шла без поиска мышью. */
export function CommandPalette({ commands }: { commands: Command[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName);
      if ((e.key === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery('');
        setCursor(0);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const found = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? commands.filter((c) => `${c.title} ${c.hint ?? ''}`.toLowerCase().includes(q)) : commands;
    return list.slice(0, 9);
  }, [commands, query]);

  if (!open) return null;

  return (
    <div className="palette-backdrop" onClick={() => setOpen(false)}>
      <div className="palette" onClick={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder="Команда или раздел: сценарий, риски, ссылка, выгрузка…"
          onChange={(e) => {
            setQuery(e.target.value);
            setCursor(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, found.length - 1));
            if (e.key === 'ArrowUp') setCursor((c) => Math.max(c - 1, 0));
            if (e.key === 'Enter' && found[cursor]) {
              found[cursor].run();
              setOpen(false);
            }
          }}
        />
        <ul>
          {found.map((c, i) => (
            <li key={c.id} className={i === cursor ? 'active' : ''}>
              <button
                onMouseEnter={() => setCursor(i)}
                onClick={() => {
                  c.run();
                  setOpen(false);
                }}
              >
                <span>{c.title}</span>
                {c.hint && <em>{c.hint}</em>}
              </button>
            </li>
          ))}
          {found.length === 0 && <li className="muted empty">Ничего не нашлось</li>}
        </ul>
        <footer>
          <span>↑↓ выбрать · Enter выполнить · Esc закрыть</span>
        </footer>
      </div>
    </div>
  );
}
