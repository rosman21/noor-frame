// Talking to the home server. The phone's key (from scanning a screen's QR code) is kept in
// localStorage and sent with every request. Errors carry a message meant for people.

const KEY = 'noor-companion';

export const session = {
  get() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } },
  set(d) { localStorage.setItem(KEY, JSON.stringify(d)); },
  clear() { localStorage.removeItem(KEY); },
};

export class SignedOut extends Error {}

export async function api(path, { method = 'GET', body } = {}) {
  const s = session.get();
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (s?.token) headers.authorization = 'Bearer ' + s.token;
  let res;
  try {
    res = await fetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: 'no-store' });
  } catch {
    throw new Error('Can’t reach the frame’s server. Is your phone on the home Wi-Fi?');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { session.clear(); throw new SignedOut(data.error || 'Signed out'); }
  if (!res.ok) throw new Error(data.error || `Something went wrong (HTTP ${res.status})`);
  return data;
}

export const get = (path) => api(path);
export const post = (path, body = {}) => api(path, { method: 'POST', body });

// Exchange the code from a screen's QR code for this phone's own key.
export async function claim(token, name) {
  const d = await post('/api/companion/claim', { token, name });
  session.set({ id: d.id, token: d.token, name: d.name });
  return d;
}

// A guess at what to call this phone, for the name field.
export function deviceGuess() {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  return 'Phone';
}
