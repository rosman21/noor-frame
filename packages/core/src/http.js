// Fetch-style helpers shared by the server and every integration. Everything here uses only
// web-standard APIs (fetch, Request, Response), so it runs on Node 20+ and Cloudflare Workers.

export const USER_AGENT = 'noor-frame/0.1 (self-hosted family dashboard)';

export function json(data, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    },
  });
}

export function html(body, status = 200) {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

export async function getJson(url, { timeoutMs = 15000, headers = {} } = {}) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT, ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

export async function getText(url, { timeoutMs = 20000 } = {}) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function randomToken(bytes = 16) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
