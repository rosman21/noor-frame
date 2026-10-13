// The optional AI integration, against a fake Anthropic API (no network, no cost).
import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { makeMemoryStore } from '@noor-frame/core';
import { createHandler } from '../src/handler.js';

const realFetch = globalThis.fetch;
let claude;      // (body) => response JSON, set per test
let sent = [];   // requests that reached "Anthropic"

function aladhan(url) {
  const [, y, m] = url.pathname.match(/calendar\/(\d+)\/(\d+)/);
  const days = new Date(Date.UTC(+y, +m, 0)).getUTCDate();
  return { code: 200, data: Array.from({ length: days }, (_, i) => {
    const dd = String(i + 1).padStart(2, '0'), mm = String(m).padStart(2, '0'), t = (h) => `${y}-${mm}-${dd}T${h}:00-04:00`;
    return { timings: { Fajr: t('06:10'), Sunrise: t('07:28'), Dhuhr: t('13:04'), Asr: t('16:08'), Maghrib: t('18:39'), Isha: t('19:58') },
      date: { gregorian: { date: `${dd}-${mm}-${y}` }, hijri: { day: '1', month: { en: 'Jumada al-ula', ar: 'جمادى الأولى' }, year: '1448', holidays: [] } },
      meta: { method: { name: 'ISNA' } } };
  }) };
}

beforeEach(() => {
  sent = [];
  globalThis.fetch = async (input, init = {}) => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (url.host === 'api.anthropic.com') {
      const body = JSON.parse(await req.text());
      sent.push({ body, headers: Object.fromEntries(req.headers), path: url.pathname });
      const out = claude(body, req);
      return out instanceof Response ? out : ok(out);
    }
    if (url.host === 'geocoding-api.open-meteo.com') return ok({ results: [{ name: 'Toronto', admin1: 'Ontario', country: 'Canada', country_code: 'CA', latitude: 43.7, longitude: -79.4, timezone: 'America/Toronto' }] });
    if (url.host === 'api.open-meteo.com') return ok({ current: { temperature_2m: 16, apparent_temperature: 15, weather_code: 61, is_day: 1, relative_humidity_2m: 70, wind_speed_10m: 10 },
      hourly: { time: ['2026-10-12T00:00'], temperature_2m: [15], weather_code: [61], precipitation_probability: [80], is_day: [1] },
      daily: { time: ['2026-10-12'], weather_code: [61], temperature_2m_max: [18], temperature_2m_min: [11], precipitation_probability_max: [80] } });
    if (url.host === 'api.aladhan.com') return ok(aladhan(url));
    throw new Error('unexpected fetch ' + url);
  };
});
after(() => { globalThis.fetch = realFetch; });

const message = (content, extra = {}) => ({
  id: 'msg_' + Math.random().toString(36).slice(2), type: 'message', role: 'assistant', model: 'claude-opus-5-5',
  content, stop_reason: 'end_turn', stop_sequence: null,
  usage: { input_tokens: 2000, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, ...extra,
});

const CONFIG = {
  location: { city: 'Toronto', country: 'Canada' },
  integrations: { travel: false },
  calendars: [{ id: 'family', name: 'Family', color: '#111111', family: true, url: 'demo:family' }, { id: 'me', name: 'Me', color: '#2D5BFF', url: 'demo:me' }],
};
async function setup({ ai = true, key = 'sk-ant-api03-TESTKEY-abcd', settings = {} } = {}) {
  const handle = createHandler({ config: CONFIG, store: makeMemoryStore(), secretMaterial: 'y'.repeat(32), clientIp: () => '192.168.1.9', log: {} });
  const call = async (method, path, body, token) => {
    const headers = body ? { 'content-type': 'application/json' } : {};
    if (token) headers.authorization = 'Bearer ' + token;
    const r = await handle(new Request('http://frame.local' + path, { method, headers, body: body && JSON.stringify(body) }));
    return { status: r.status, body: await r.json() };
  };
  const token = (await call('POST', '/api/devices/register', {})).body.token;
  if (ai) await call('POST', '/api/integrations', { id: 'ai-claude', enabled: true }, token);
  if (ai && key) await call('POST', '/api/settings', { integration: 'ai-claude', values: { apiKey: key, ...settings } }, token);
  return { call, token };
}

test('AI is off by default: no routes, no flags', async () => {
  const { call } = await setup({ ai: false });
  assert.equal((await call('GET', '/api/ai/brief')).status, 404);
  const cfg = (await call('GET', '/api/config')).body;
  assert.equal('ai' in cfg, false);
  assert.equal(cfg.features.includes('ai'), false);
});

test('switched on without a key, it explains what to do', async () => {
  const { call } = await setup({ key: null });
  assert.deepEqual((await call('GET', '/api/config')).body.ai, { ready: false, brief: false, chat: false });
  const r = await call('GET', '/api/ai/brief');
  assert.equal(r.status, 409);
  assert.match(r.body.error, /API key/);
});

test('the daily brief: right request shape, real facts in, cached for the day', async () => {
  const { call } = await setup();
  claude = () => message([{ type: 'text', text: JSON.stringify({ headline: 'Rain later; Costco run soon.', items: [{ kind: 'travel', text: 'Leave by 10:20 for Costco.' }, { kind: 'prayer', text: 'Dhuhr is at 1:04 PM.' }] }) }]);
  const r = await call('GET', '/api/ai/brief');
  assert.equal(r.status, 200);
  assert.equal(r.body.headline, 'Rain later; Costco run soon.');
  assert.equal(r.body.items.length, 2);

  const { body, headers, path } = sent[0];
  assert.equal(path, '/v1/messages');
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.fallbacks, 'default');
  assert.match(headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.equal(headers['x-api-key'], 'sk-ant-api03-TESTKEY-abcd');
  assert.equal(body.output_config.effort, 'low');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.system[0].cache_control.type, 'ephemeral');
  assert.equal('thinking' in body, false, 'Opus 5.5 rejects disabling thinking; leave it out');
  assert.equal('tool_choice' in body, false);
  const prompt = body.messages[0].content;
  assert.match(prompt, /"Maghrib"/);
  assert.match(prompt, /Costco run/);
  assert.match(prompt, /America\/Toronto/);

  await call('GET', '/api/ai/brief');
  assert.equal(sent.length, 1, 'second screen gets the saved brief');
});

test('questions from a phone use the household tools, then answer', async () => {
  const { call, token } = await setup();
  let step = 0;
  claude = (body) => {
    step++;
    if (step === 1) return message([
      { type: 'thinking', thinking: '', signature: 'sig-1' },
      { type: 'tool_use', id: 'toolu_1', name: 'get_prayer_times', input: { date: '2026-10-16' } },
    ], { stop_reason: 'tool_use' });
    // The second request carries the whole first turn back unchanged, plus the tool result.
    assert.deepEqual(body.messages[1].content[0], { type: 'thinking', thinking: '', signature: 'sig-1' });
    const result = body.messages[2].content[0];
    assert.equal(result.type, 'tool_result');
    assert.match(result.content, /"Maghrib":"2026-10-16T22:39:00.000Z"/);
    return message([{ type: 'text', text: 'Maghrib on Friday is at 6:39 PM.' }]);
  };
  assert.equal((await call('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'When is Maghrib on Friday?' }] })).status, 401, 'phones need a key');
  const r = await call('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'When is Maghrib on Friday?' }] }, token);
  assert.equal(r.status, 200);
  assert.equal(r.body.answer, 'Maghrib on Friday is at 6:39 PM.');
  assert.deepEqual(r.body.tools, ['get_prayer_times']);
  const first = sent[0].body;
  assert.ok(first.tools.some((t) => t.name === 'get_calendar') && first.tools.some((t) => t.name === 'get_ayah_of_the_day'));
  assert.match(first.messages[0].content, /Now: .*America\/Toronto/);
});

test('the daily limit stops spending, with a clear reason', async () => {
  const { call, token } = await setup({ settings: { dailyLimitCents: 1 } });
  claude = () => message([{ type: 'text', text: 'Hello.' }], { usage: { input_tokens: 4000, output_tokens: 400 } }); // ≈ 2.4¢ on Opus
  assert.equal((await call('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'Hi' }] }, token)).status, 200);
  const r = await call('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'Hi again' }] }, token);
  assert.equal(r.status, 429);
  assert.match(r.body.error, /limit \(\$0\.01\) is used up/);
  assert.equal(sent.length, 1, 'no call is made once the limit is reached');
  const u = (await call('GET', '/api/ai/usage', null, token)).body;
  assert.ok(u.cents > 2 && u.cents < 3);
});

test('without storage, the daily limit still holds and the brief is kept', async () => {
  // A key in frame.config.json and nowhere to save anything.
  const serverWith = (ai) => {
    const handle = createHandler({ config: { ...CONFIG, integrations: { 'ai-claude': true }, ai: { apiKey: 'sk-ant-api03-TESTKEY-abcd', dailyLimitCents: 1, ...ai } }, store: null, log: {} });
    return async (path) => { const r = await handle(new Request('http://frame.local' + path)); return { status: r.status, body: await r.json() }; };
  };
  claude = () => message([{ type: 'text', text: JSON.stringify({ headline: 'A calm day.', items: [] }) }], { usage: { input_tokens: 4000, output_tokens: 400 } }); // ≈ 2.4¢
  const get = serverWith({});
  assert.equal((await get('/api/ai/brief')).status, 200);
  assert.equal((await get('/api/ai/brief')).status, 200);
  assert.equal(sent.length, 1, 'the second screen gets the same brief');
  // A brief in another language is a new call, and today's spending already passed the limit.
  const other = await serverWith({ briefLanguage: 'fr' })('/api/ai/brief');
  assert.equal(other.status, 429);
  assert.equal(sent.length, 1);
});

test('a declined request and a rejected key come back as plain messages', async () => {
  const { call, token } = await setup();
  claude = () => message([], { stop_reason: 'refusal', stop_details: { type: 'refusal', category: null, explanation: '' } });
  assert.equal((await call('POST', '/api/ai/chat', { messages: [{ role: 'user', content: '…' }] }, token)).body.answer, 'Sorry, I can’t help with that one.');
  claude = () => new Response(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }), { status: 401, headers: { 'content-type': 'application/json' } });
  const r = await call('POST', '/api/ai/chat', { messages: [{ role: 'user', content: 'Hi' }] }, token);
  assert.equal(r.status, 409);
  assert.match(r.body.error, /didn’t accept the API key/);
});

test('the key never reaches screens or the settings page', async () => {
  const { call, token } = await setup();
  const everything = JSON.stringify([(await call('GET', '/api/config')).body, (await call('GET', '/api/settings', null, token)).body]);
  assert.equal(everything.includes('TESTKEY'), false);
  assert.match(everything, /"last4":"abcd"/);
  assert.deepEqual((await call('GET', '/api/config')).body.ai, { ready: true, brief: true, chat: true });
});
