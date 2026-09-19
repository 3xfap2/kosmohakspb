// Учётные записи прототипа. Всё хранится в браузере: сервера у решения нет,
// а жюри должно иметь возможность войти без регистрации — для этого гостевой вход.

export interface Account {
  name: string;
  email: string;
  role: string;
}

const USERS_KEY = 'kk.users';
const SESSION_KEY = 'kk.session';

type StoredUser = Account & { hash: string };

const read = <T>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
};

const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // приватный режим браузера — просто работаем без сохранения
  }
};

async function hash(password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`kosmokontur:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function currentAccount(): Account | null {
  return read<Account | null>(SESSION_KEY, null);
}

export function signOut(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    /* noop */
  }
}

export function signInAsGuest(): Account {
  const guest: Account = { name: 'Гость', email: 'guest@local', role: 'Демо-доступ' };
  write(SESSION_KEY, guest);
  return guest;
}

export async function register(name: string, email: string, password: string, role: string): Promise<Account> {
  const users = read<StoredUser[]>(USERS_KEY, []);
  if (users.some((u) => u.email.toLowerCase() === email.toLowerCase()))
    throw new Error('Такая почта уже зарегистрирована');
  if (password.length < 6) throw new Error('Пароль короче шести символов');

  const account: Account = { name: name.trim() || 'Оператор', email: email.trim(), role };
  write(USERS_KEY, [...users, { ...account, hash: await hash(password) }]);
  write(SESSION_KEY, account);
  return account;
}

export async function signIn(email: string, password: string): Promise<Account> {
  const users = read<StoredUser[]>(USERS_KEY, []);
  const user = users.find((u) => u.email.toLowerCase() === email.trim().toLowerCase());
  if (!user) throw new Error('Пользователь не найден');
  if (user.hash !== (await hash(password))) throw new Error('Неверный пароль');

  const account: Account = { name: user.name, email: user.email, role: user.role };
  write(SESSION_KEY, account);
  return account;
}
