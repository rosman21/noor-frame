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

// maxBytes stops reading a reply that is bigger than anything sensible (a huge or endless file).
export async function getText(url, { timeoutMs = 20000, maxBytes = 0 } = {}) {
  const res = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!maxBytes || !res.body) return res.text();
  const tooBig = () => new Error(`larger than ${Math.round(maxBytes / 1e6)} MB`);
  if (Number(res.headers.get('content-length')) > maxBytes) { res.body.cancel().catch(() => {}); throw tooBig(); }
  const reader = res.body.getReader(), parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { reader.cancel().catch(() => {}); throw tooBig(); }
    parts.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return new TextDecoder().decode(all);
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function randomToken(bytes = 16) {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}
