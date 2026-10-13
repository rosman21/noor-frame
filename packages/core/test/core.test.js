import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  defineIntegration, makeRegistry, makeMemoryStore, makeFileStore, makeSecrets, makeCache, makeContext, builtins, json,
} from '../src/index.js';

const SECRET = 'test-secret-material-0123456789';

const fakeAi = defineIntegration({
  id: 'fake-ai', name: 'Fake AI', section: 'fakeAi', optional: true, enabledByDefault: false,
  settings: [
    { key: 'apiKey', type: 'secret', label: 'API key' },
    { key: 'model', type: 'select', default: 'small', options: [{ value: 'small', label: 'Small' }, { value: 'big', label: 'Big' }] },
    { key: 'limit', type: 'number', default: 25, min: 0, max: 500 },
  ],
  routes: { 'POST /api/ai/brief': async (req, ctx) => json({ key: (await ctx.settings('fakeAi')).apiKey }) },
  publicConfig: async () => ({ ai: { on: true } }),
  features: ['brief-card'],
  tools: [{ name: 'noop', description: 'x', input_schema: { type: 'object' }, run: async () => 1 }],
});
const weatherish = defineIntegration({
  id: 'weatherish', name: 'Weatherish', section: 'weather',
  settings: [{ key: 'units', type: 'select', default: 'celsius', options: [{ value: 'celsius' }, { value: 'fahrenheit' }] }],
  routes: { 'GET /api/weather': async () => json({ ok: 1 }), 'GET /api/wx/*': async () => json({ prefix: 1 }) },
  features: ['weather'],
});

function setup({ config = {} } = {}) {
  const store = makeMemoryStore();
  const secrets = makeSecrets(store, SECRET);
  const registry = makeRegistry({ integrations: [...builtins, weatherish, fakeAi], config, store, secrets });
  return { store, secrets, registry };
}
const req = (method, p) => new Request('http://frame.local' + p, { method });

test('defineIntegration rejects bad definitions', () => {
  assert.throws(() => defineIntegration({ id: 'Bad Id', name: 'x' }), /kebab-case/);
  assert.throws(() => defineIntegration({ id: 'x', name: 'x', settings: [{ key: 'a', type: 'colour' }] }), /type/);
  assert.throws(() => defineIntegration({ id: 'x', name: 'x', routes: { '/api/x': () => {} } }), /GET \/api/);
});

test('a disabled optional integration adds no routes, features, config or tools', async () => {
  const { registry } = setup();
  assert.equal(await registry.isEnabled('fake-ai'), false);
  assert.equal(await registry.route(req('POST', '/api/ai/brief')), null);
  assert.deepEqual(await registry.features(), ['weather']);
  assert.equal((await registry.tools()).length, 0);
  const ctx = makeContext({ registry, remember: makeCache() });
  assert.equal('ai' in (await registry.publicConfig({ ...ctx, location: async () => ({}) })), false);
});

test('enabling it wires everything up; core integrations cannot be switched off', async () => {
  const { registry } = setup();
  await registry.setEnabled('fake-ai', true);
  assert.ok(await registry.route(req('POST', '/api/ai/brief')));
  assert.deepEqual((await registry.features()).sort(), ['brief-card', 'weather']);
  assert.equal((await registry.tools())[0].integration, 'fake-ai');
  await assert.rejects(registry.setEnabled('weatherish', false), /can't be switched off/);
});

test('frame.config.json can turn an optional integration on; saved choice wins', async () => {
  const { registry } = setup({ config: { integrations: { 'fake-ai': true } } });
  assert.equal(await registry.isEnabled('fake-ai'), true);
  await registry.setEnabled('fake-ai', false);
  assert.equal(await registry.isEnabled('fake-ai'), false);
});

test('routes match by method; exact paths beat prefixes', async () => {
  const { registry } = setup();
  assert.ok(await registry.route(req('GET', '/api/weather')));
  assert.equal(await registry.route(req('POST', '/api/weather')), null);
  assert.ok(await registry.route(req('GET', '/api/wx/anything')));
});

test('settings layer: defaults < config file < saved < request overrides', async () => {
  const { registry } = setup({ config: { weather: { units: 'fahrenheit' } } });
  assert.equal((await registry.settingsFor('weather')).units, 'fahrenheit');
  await registry.saveSettings('weatherish', { units: 'celsius' });
  assert.equal((await registry.settingsFor('weather')).units, 'celsius');
  assert.equal((await registry.settingsFor('weather', { overrides: { weather: { units: 'fahrenheit' } } })).units, 'fahrenheit');
  assert.equal((await registry.settingsFor('fakeAi')).limit, 25);
});

test('saveSettings validates against the schema', async () => {
  const { registry } = setup();
  await assert.rejects(registry.saveSettings('fake-ai', { model: 'huge' }), /isn't one of the choices/);
  await assert.rejects(registry.saveSettings('fake-ai', { limit: 9999 }), /at most 500/);
  await assert.rejects(registry.saveSettings('fake-ai', { colour: 'red' }), /no setting "colour"/);
  await registry.saveSettings('fake-ai', { limit: '40' });
  assert.equal((await registry.settingsFor('fakeAi')).limit, 40);
});

test('secrets are encrypted at rest, usable on the server, and never described in full', async () => {
  const { registry, store } = setup();
  await registry.setEnabled('fake-ai', true);
  await registry.saveSettings('fake-ai', { apiKey: 'sk-live-ABCDEFGH1234' });

  const raw = JSON.stringify(await store.get('secret:fake-ai:apiKey'));
  assert.equal(raw.includes('sk-live'), false, 'plaintext must not be stored');

  // Without withSecrets (what the frame or companion would see) the key is absent.
  assert.equal('apiKey' in (await registry.settingsFor('fakeAi')), false);
  const ai = (await registry.describe()).find((i) => i.id === 'fake-ai');
  assert.deepEqual(ai.settings.find((s) => s.key === 'apiKey').value.last4, '1234');
  assert.equal(JSON.stringify(ai).includes('ABCDEFGH'), false);

  // The route (server side) can use it.
  const hit = await registry.route(req('POST', '/api/ai/brief'));
  const ctx = makeContext({ request: req('POST', '/api/ai/brief'), registry, remember: makeCache() });
  assert.equal((await (await hit.handler(ctx.request, ctx)).json()).key, 'sk-live-ABCDEFGH1234');

  // An empty value removes it.
  await registry.saveSettings('fake-ai', { apiKey: '' });
  assert.equal((await registry.describe()).find((i) => i.id === 'fake-ai').settings[0].value.set, false);
});

test('secrets fail to decrypt with a different FRAME_SECRET', async () => {
  const store = makeMemoryStore();
  await makeSecrets(store, SECRET).set('x', 'k', 'hello');
  await assert.rejects(makeSecrets(store, 'another-secret-material-xyz').get('x', 'k'));
  assert.throws(() => makeSecrets(store, 'short'), /16 characters/);
});

test('cache shares in-flight work and expires', async () => {
  let t = 0, calls = 0;
  const remember = makeCache({ now: () => t });
  const slow = () => new Promise((r) => setTimeout(() => r(++calls), 5));
  const [a, b] = await Promise.all([remember('k', 100, slow), remember('k', 100, slow)]);
  assert.equal(a, 1); assert.equal(b, 1); assert.equal(calls, 1);
  t = 150;
  assert.equal(await remember('k', 100, slow), 2);
});

test('file store persists, expires and is private to the owner', async () => {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'noor-'));
  const file = path.join(dir, 'data', 'frame.json');
  const s = makeFileStore(file, fs);
  await s.put('a', { x: 1 });
  await s.put('gone', 1, -1);
  assert.deepEqual(await makeFileStore(file, fs).get('a'), { x: 1 });
  assert.equal(await s.get('gone'), null);
  assert.equal(fs.statSync(file).mode & 0o077, 0, 'file should not be readable by other users');
});

test('home-network addresses are recognised; public and missing ones are not', async () => {
  const { isPrivateAddress, makeDevices } = await import('../src/index.js');
  for (const ip of ['192.168.1.5', '::ffff:10.0.0.7', '172.16.4.1', '172.31.255.1', '127.0.0.1', '::1', 'fd12::1', 'fe80::1']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '203.0.113.9', '::ffff:1.1.1.1', '2001:db8::1', '', null, undefined]) assert.equal(isPrivateAddress(ip), false, String(ip));

  const devices = makeDevices(makeMemoryStore());
  const d = await devices.register({ name: 'Hall', approved: true });
  assert.equal((await devices.verify(d.token)).name, 'Hall');
  assert.equal(await devices.verify(d.token.replace(/.$/, (c) => (c === '0' ? '1' : '0'))), null);
  assert.equal(await devices.verify('not-a-key'), null);
});
