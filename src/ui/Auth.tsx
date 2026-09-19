import { useState } from 'react';
import { register, signIn, signInAsGuest, type Account } from './session';

const ROLES = ['Оператор узла', 'Аналитик планирования', 'Финансирующая сторона', 'Эксперт жюри'];

export function Auth({ onDone, onBack }: { onDone: (account: Account) => void; onBack: () => void }) {
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState(ROLES[0]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const account = mode === 'in' ? await signIn(email, password) : await register(name, email, password, role);
      onDone(account);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-side">
        <div className="hero-glow" aria-hidden="true">
          <div className="sphere small" />
        </div>
        <div className="brand">
          <div className="mark">КК</div>
          <b>Космоконтур</b>
        </div>
        <h2>Рабочее место оператора топливного узла</h2>
        <p className="muted">
          Планы, контракты и стресс-тесты хранятся в браузере: сервера у прототипа нет, данные никуда не уходят.
        </p>
        <button className="ghost" onClick={onBack}>
          На главную
        </button>
      </div>

      <div className="auth-form">
        <div className="seg small">
          <button className={mode === 'in' ? 'active' : ''} onClick={() => setMode('in')}>
            Вход
          </button>
          <button className={mode === 'up' ? 'active' : ''} onClick={() => setMode('up')}>
            Регистрация
          </button>
        </div>

        <form onSubmit={submit}>
          {mode === 'up' && (
            <label className="field">
              <span>Имя</span>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Как к вам обращаться" />
            </label>
          )}

          <label className="field">
            <span>Почта</span>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="operator@kosmokontur" />
          </label>

          <label className="field">
            <span>Пароль</span>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="минимум шесть символов"
            />
          </label>

          {mode === 'up' && (
            <label className="field">
              <span>Роль</span>
              <select value={role} onChange={(e) => setRole(e.target.value)}>
                {ROLES.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
          )}

          {error && <p className="status-bad small-text">{error}</p>}

          <button className="primary" type="submit" disabled={busy}>
            {mode === 'in' ? 'Войти' : 'Создать доступ'}
          </button>
        </form>

        <div className="auth-guest">
          <button className="ghost" onClick={() => onDone(signInAsGuest())}>
            Войти как гость
          </button>
          <span className="muted small-text">Полный доступ ко всем расчётам без регистрации</span>
        </div>
      </div>
    </div>
  );
}
