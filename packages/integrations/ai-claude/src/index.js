// Optional AI for the household, using Claude (Anthropic). Off until someone switches it on and
// adds an API key in the companion app. When on:
//  - a short daily brief on the screens (what needs doing today, prayer times to plan around…)
//  - questions from a phone in the companion app ("When is Maghrib on Friday?", "Who's busy at 6?")
// Answers come from the household's own data through the other integrations' tools.

import { defineIntegration, json } from '@noor-frame/core';
import { makeBrief, chat, usageToday, localDate, AiError } from './claude.js';

export { PRICES, SYSTEM, costCents } from './claude.js';

const MODELS = [
  { value: 'claude-opus-5-5', label: 'Claude Opus 5.5 (best answers)' },
  { value: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (fast, lower cost)' },
  { value: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fastest, lowest cost)' },
];

const fail = (err) => (err instanceof AiError ? json({ error: err.message }, err.status) : Promise.reject(err));

// One brief per household day, made the first time a screen asks for it and then kept.
const making = new Map();
async function briefFor(ctx, { fresh = false } = {}) {
  const s = await ctx.settings('ai');
  const tz = (await ctx.location()).timezone;
  const key = 'ai:brief:' + localDate(tz) + ':' + s.briefLanguage;
  if (!fresh) {
    const saved = ctx.store && (await ctx.store.get(key));
    if (saved) return saved;
  }
  if (!making.has(key)) {
    making.set(key, makeBrief(s, ctx).then(async (b) => {
      if (ctx.store) await ctx.store.put(key, b, 2 * 86400);
      return b;
    }).finally(() => making.delete(key)));
  }
  return making.get(key);
}

export default defineIntegration({
  id: 'ai-claude',
  name: 'AI assistant',
  description: 'A daily brief on the screens, and answers to questions from your phone, using Claude. Needs an Anthropic API key; you pay Anthropic for what it uses.',
  section: 'ai',
  optional: true,
  enabledByDefault: false,
  settings: [
    { key: 'apiKey', type: 'secret', label: 'Anthropic API key', help: 'Create one at console.anthropic.com → API keys. It is stored encrypted on your server and never sent to screens.' },
    { key: 'model', type: 'select', label: 'Model', default: 'claude-opus-5-5', options: MODELS },
    { key: 'dailyLimitCents', type: 'number', label: 'Daily spending limit (US cents)', default: 50, min: 0, max: 5000, help: 'AI stops for the day once this is reached. A brief costs about 1–3 cents; a question about the same.' },
    { key: 'brief', type: 'boolean', label: 'Daily brief on the screens', default: true },
    { key: 'briefLanguage', type: 'select', label: 'Brief language', default: 'en', options: [
      { value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }, { value: 'ur', label: 'اردو' }, { value: 'fr', label: 'Français' },
      { value: 'tr', label: 'Türkçe' }, { value: 'id', label: 'Bahasa Indonesia' }, { value: 'ms', label: 'Bahasa Melayu' },
    ] },
    { key: 'chat', type: 'boolean', label: 'Questions from the companion app', default: true },
    { key: 'effort', type: 'select', label: 'Thinking effort', default: 'low', advanced: true, options: [
      { value: 'low', label: 'Low (quick, cheapest)' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High (slower, costs more)' },
    ], help: 'How hard Claude thinks before answering. Low is plenty for briefs and everyday questions.' },
  ],
  routes: {
    // The brief only contains what screens can already see (calendar, prayer times, weather).
    'GET /api/ai/brief': async (request, ctx) => {
      const s = await ctx.settings('ai');
      if (!s.brief) return json({ error: 'The daily brief is switched off.' }, 404);
      return briefFor(ctx).then((b) => json(b), fail);
    },
    'POST /api/ai/brief/refresh': { auth: 'device', handler: async (request, ctx) => briefFor(ctx, { fresh: true }).then((b) => json(b), fail) },
    'POST /api/ai/chat': { auth: 'device', handler: async (request, ctx) => {
      const s = await ctx.settings('ai');
      if (!s.chat) return json({ error: 'Questions are switched off in the AI settings.' }, 404);
      const body = await request.json().catch(() => ({}));
      const history = (Array.isArray(body.messages) ? body.messages : [])
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
      if (history.at(-1)?.role !== 'user') return json({ error: 'Ask a question first.' }, 400);
      return chat(s, ctx, history).then((r) => json(r), fail);
    } },
    'GET /api/ai/usage': { auth: 'device', handler: async (request, ctx) => {
      const s = await ctx.settings('ai');
      return json(await usageToday(ctx, (await ctx.location()).timezone, s.dailyLimitCents));
    } },
  },
  // What screens need to know (never the key itself).
  publicConfig: async (ctx) => {
    const s = await ctx.settings('ai');
    const ready = !!s.apiKey;
    return { ai: { ready, brief: ready && !!s.brief, chat: ready && !!s.chat } };
  },
  features: ['ai'],
});
