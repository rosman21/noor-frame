// Talking to Claude for the household: the daily brief and questions from a phone.
//
// - Facts come from the other integrations (calendar, prayer times, weather, ayah): the brief is
//   given them up front; chat calls them as tools. Claude never invents times or Quran text.
// - Every call is priced and counted against a daily limit, so a household can't be surprised
//   by a bill. The limit is checked before each call, including each step of a chat.
// - Requests opt into server-side fallback: if a request is declined, Anthropic retries it on
//   another model instead of failing.

import Anthropic from '@anthropic-ai/sdk';

// $ per million tokens (input, output). Used to estimate spend for the daily limit.
export const PRICES = {
  'claude-opus-5-5': [4, 20],
  'claude-sonnet-5-5': [2, 10],
  'claude-haiku-5-5': [0.1, 0.5],
};
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// Stable across requests, so it is cached (the household-specific details go in the messages).
export const SYSTEM = `You are the assistant on noor-frame, a Muslim family's home dashboard. It shows prayer times, the athan, an ayah of the day, the family's calendars, travel times and the weather.

Ground rules:
- Use the tools for anything about this household: calendar events, prayer times, weather and today's ayah. Never guess a time, date or event.
- Never write Quran text, in Arabic or in translation, from memory. Quote only what the get_ayah_of_the_day tool returns, exactly, with its reference.
- Don't give religious rulings (fatwas), and don't declare something halal or haram for someone's particular situation. For those questions, kindly suggest asking a qualified scholar or their local imam. Widely known general information is fine.
- Don't quote hadith wording unless you're certain of it and can name the collection; otherwise describe the teaching in general terms.
- Be warm, brief and practical. Write plain sentences without markdown headings, tables or bullet symbols.
- Use the household's time zone and a 12-hour or 24-hour clock as the question does.`;

export class AiError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

function client(apiKey) {
  if (!apiKey) throw new AiError('Add your Anthropic API key in the companion app (Optional features → AI) first.', 409);
  // fetch is looked up per call, so tests (and Cloudflare) can provide their own.
  return new Anthropic({ apiKey, fetch: (...args) => globalThis.fetch(...args), maxRetries: 2 });
}

// ------------------------------------------------------------ dates in the household's time zone
export function localDate(tz, d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function localNow(tz, d = new Date()) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: tz, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(d);
}

// ------------------------------------------------------------ spending
// Cost in US cents for one response, from its usage (cached reads are cheaper, cache writes dearer).
export function costCents(model, usage) {
  const [inP, outP] = PRICES[model] || PRICES['claude-opus-5-5'];
  const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) * 1.25 + (usage.cache_read_input_tokens || 0) * 0.1;
  return ((input * inP) + (usage.output_tokens || 0) * outP) / 1e6 * 100;
}

async function spentToday(ctx, tz) {
  return (ctx.store && (await ctx.store.get('ai:spend:' + localDate(tz)))) || { cents: 0, calls: 0 };
}
async function record(ctx, tz, model, usage) {
  if (!ctx.store) return;
  const key = 'ai:spend:' + localDate(tz);
  const s = await spentToday(ctx, tz);
  s.cents = Math.round((s.cents + costCents(model, usage)) * 1000) / 1000;
  s.calls += 1;
  await ctx.store.put(key, s, 3 * 86400);
}
async function checkBudget(ctx, tz, limitCents) {
  const s = await spentToday(ctx, tz);
  if (s.cents >= limitCents) {
    throw new AiError(`Today’s AI limit ($${(limitCents / 100).toFixed(2)}) is used up. It resets at midnight, or raise it in the companion app.`, 429);
  }
}
export async function usageToday(ctx, tz, limitCents) {
  const s = await spentToday(ctx, tz);
  return { date: localDate(tz), cents: s.cents, calls: s.calls, limitCents };
}

// One request to Claude, with fallback, pricing and friendly errors.
async function ask(settings, ctx, tz, params) {
  await checkBudget(ctx, tz, settings.dailyLimitCents);
  const { output_config: extraOutput, ...rest } = params;
  let res;
  try {
    res = await client(settings.apiKey).beta.messages.create({
      model: settings.model,
      max_tokens: 16000,
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      betas: [FALLBACK_BETA],
      fallbacks: 'default',
      ...rest,
      output_config: { effort: settings.effort, ...extraOutput },
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new AiError('Anthropic didn’t accept the API key. Check it in the companion app.', 409);
    if (err instanceof Anthropic.PermissionDeniedError) throw new AiError('This API key isn’t allowed to use that model.', 409);
    if (err instanceof Anthropic.RateLimitError) throw new AiError('Claude is busy right now. Try again in a minute.', 429);
    if (err instanceof Anthropic.BadRequestError) throw new AiError('Claude couldn’t take that request: ' + err.message, 400);
    if (err instanceof Anthropic.APIConnectionError) throw new AiError('Can’t reach Anthropic. Is the server online?', 502);
    if (err instanceof Anthropic.APIError) throw new AiError(`Anthropic returned an error (${err.status}). Try again shortly.`, 502);
    throw err;
  }
  // Priced at the model that actually answered (a fallback may have run).
  await record(ctx, tz, res.model in PRICES ? res.model : settings.model, res.usage);
  return res;
}

const textOf = (res) => res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();

// ------------------------------------------------------------ tools from the other integrations
async function toolbox(ctx) {
  const tools = await ctx.registry.tools();
  return {
    defs: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
    async run(name, input) {
      const t = tools.find((x) => x.name === name);
      if (!t) return { error: `No tool called ${name}` };
      try { return await t.run(input || {}, ctx); }
      catch (err) { return { error: err.message }; }
    },
  };
}
const tool = async (box, name, input) => box.run(name, input);

// ------------------------------------------------------------ the daily brief
const BRIEF_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string', description: 'One short sentence: the shape of the day.' },
    items: {
      type: 'array',
      description: 'Three to five things worth knowing today, most useful first.',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['prayer', 'calendar', 'travel', 'weather', 'family', 'reminder'] },
          text: { type: 'string', description: 'One sentence.' },
        },
        required: ['kind', 'text'],
        additionalProperties: false,
      },
    },
  },
  required: ['headline', 'items'],
  additionalProperties: false,
};

const LANGUAGE = { en: 'English', ar: 'Arabic', ur: 'Urdu', fr: 'French', tr: 'Turkish', id: 'Indonesian', ms: 'Malay' };

export async function makeBrief(settings, ctx) {
  const loc = await ctx.location();
  const tz = loc.timezone;
  const today = localDate(tz);
  const box = await toolbox(ctx);
  const tomorrow = localDate(tz, new Date(Date.now() + 864e5));
  // Gather the facts first; one request then writes the brief from them.
  const [prayer, weather, calendar] = await Promise.all([
    tool(box, 'get_prayer_times', { date: today }),
    tool(box, 'get_weather', {}),
    tool(box, 'get_calendar', { from: today + 'T00:00:00', to: tomorrow + 'T12:00:00' }),
  ]);
  const facts = { now: localNow(tz), timezone: tz, place: [loc.name, loc.region].filter(Boolean).join(', '), prayer, weather, calendar };
  const res = await ask(settings, ctx, tz, {
    output_config: { format: { type: 'json_schema', schema: BRIEF_SCHEMA } },
    messages: [{
      role: 'user',
      content: `Write today's brief for the family's wall screen in ${LANGUAGE[settings.briefLanguage] || 'English'}. Use only these facts:\n\n${JSON.stringify(facts)}\n\n` +
        'Mention anything that needs action (leaving times, early starts, clashes between family members, rain), prayer times worth planning around today, and Jumu‘ah on Fridays. Skip events that are over. Keep each item to one short sentence.',
    }],
  });
  if (res.stop_reason === 'refusal') throw new AiError('Claude declined to write today’s brief.', 502);
  let brief;
  try { brief = JSON.parse(textOf(res)); } catch { throw new AiError('Claude’s brief came back in the wrong shape. It will try again later.', 502); }
  return { date: today, headline: brief.headline, items: brief.items.slice(0, 5), model: res.model, at: Date.now() };
}

// ------------------------------------------------------------ questions from a phone
const MAX_STEPS = 6;

export async function chat(settings, ctx, history) {
  const loc = await ctx.location();
  const tz = loc.timezone;
  const box = await toolbox(ctx);
  // The phone keeps the conversation as plain text; the latest question gets the current time.
  const messages = history.map((m, i) => ({
    role: m.role,
    content: i === history.length - 1 ? `(Now: ${localNow(tz)}, ${tz}. Home: ${[loc.name, loc.region].filter(Boolean).join(', ')}.)\n\n${m.content}` : m.content,
  }));
  const used = new Set();
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await ask(settings, ctx, tz, { tools: box.defs, messages });
    if (res.stop_reason === 'refusal') return { answer: 'Sorry, I can’t help with that one.', tools: [...used] };
    if (res.stop_reason !== 'tool_use') return { answer: textOf(res) || 'I don’t have an answer for that.', tools: [...used] };
    // Keep the whole assistant turn (thinking included) so the next step continues it unchanged.
    messages.push({ role: 'assistant', content: res.content });
    const calls = res.content.filter((b) => b.type === 'tool_use');
    const results = await Promise.all(calls.map(async (c) => {
      used.add(c.name);
      const out = await box.run(c.name, c.input);
      return { type: 'tool_result', tool_use_id: c.id, content: JSON.stringify(out), is_error: !!out?.error };
    }));
    messages.push({ role: 'user', content: results });
  }
  return { answer: 'That took too many steps. Try asking a simpler question.', tools: [...used] };
}
