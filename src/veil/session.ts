const KEY = "veilforge-account";

export type AccountSession = { token: string; address: string };

export function readSession(): AccountSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AccountSession;
    if (!parsed.token || !parsed.address) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(session: AccountSession): void {
  localStorage.setItem(KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(KEY);
}
