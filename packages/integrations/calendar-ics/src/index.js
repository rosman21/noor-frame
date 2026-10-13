// Family calendars from iCal / ICS links (Apple, Google, Outlook…), one lane per calendar.
// Calendars come from frame.config.json and from phones (scan the QR code on the frame and
// paste links). Use "demo:family", "demo:me", "demo:spouse" or "demo:kid" as a link to try it
// without real calendars. Other integrations (e.g. travel) can add to events via the
// "events" hook.

import { defineIntegration, json } from '@noor-frame/core';
import { expandFeed, fetchFeed } from './ics.js';
import { demoIcs } from './demo.js';
import { makeSetup, effectiveCalendars, COLORS } from './setup.js';

export { expandFeed, validateFeed, icsUrl } from './ics.js';
export { demoIcs } from './demo.js';
export { effectiveCalendars, COLORS } from './setup.js';

export async function loadEvents(ctx, from, to) {
  const list = (await effectiveCalendars(ctx.config, ctx.store)).filter((c) => c.url);
  const loc = await ctx.location();
  const results = await Promise.all(list.map(async (cal) => {
    try {
      const demo = cal.url.match(/^demo:(\w+)$/);
      const text = demo ? demoIcs(demo[1], loc.timezone) : await ctx.remember(`ics-${cal.id}`, 5 * 60e3, () => fetchFeed(cal.url));
      return { id: cal.id, events: expandFeed(text, cal, from, to) };
    } catch (err) {
      return { id: cal.id, events: [], error: `${cal.name}: ${err.message}` };
    }
  }));
  const events = results.flatMap((r) => r.events);
  events.sort((a, b) => (a.start < b.start ? -1 : 1));
  // Let other integrations (travel times, …) add to the events.
  const extra = await ctx.runHook('events', { events, from, to });
  return {
    events,
    travelPending: extra.some((r) => r && r.travelPending),
    errors: results.filter((r) => r.error).map((r) => r.error)
      .concat(extra.flatMap((r) => (r && r.errors) || [])),
  };
}

const handleSetup = makeSetup();

export default defineIntegration({
  id: 'calendar-ics',
  name: 'Calendars',
  description: 'Family calendars from Apple, Google or Outlook share links, added from a phone.',
  // Calendars are a list rather than settings, so they are managed through the routes below.
  routes: {
    'GET /api/calendar': async (request, ctx) => {
      const url = new URL(request.url), now = Date.now();
      const from = new Date(url.searchParams.get('from') || now - 7 * 864e5);
      const to = new Date(url.searchParams.get('to') || now + 60 * 864e5);
      if (Number.isNaN(+from) || Number.isNaN(+to) || to - from > 400 * 864e5) return json({ error: 'from/to must be dates less than 400 days apart' }, 400);
      return json(await loadEvents(ctx, from, to));
    },
    // The simple phone page: a pairing code (QR from a screen) is enough to add calendars.
    'GET /api/setup': handleSetup,
    'POST /api/setup/calendar': handleSetup, // authorised by the pairing code itself
    'GET /api/calendars': handleSetup,
    'POST /api/calendars/add': { auth: 'device', handler: handleSetup }, // from the companion app
    'POST /api/calendars/update': { auth: 'device', handler: handleSetup },
    'POST /api/calendars/remove': { auth: 'device', handler: handleSetup },
  },
  publicConfig: async (ctx) => ({
    canAddCalendars: !!ctx.store,
    calendars: (await effectiveCalendars(ctx.config, ctx.store)).filter((c) => c.url)
      .map((c) => ({ id: c.id, name: c.name, color: c.color, family: !!c.family })),
    calendarColors: COLORS,
  }),
  features: ['calendar'],
  tools: [{
    name: 'get_calendar',
    description: "Family calendar events between two dates. Each event has title, start, end, allDay, location, the calendar (person) it belongs to, and travel time when known.",
    input_schema: {
      type: 'object',
      properties: { from: { type: 'string', description: 'ISO date or date-time' }, to: { type: 'string', description: 'ISO date or date-time' } },
      required: ['from', 'to'],
    },
    run: async ({ from, to }, ctx) => {
      const cals = Object.fromEntries((await effectiveCalendars(ctx.config, ctx.store)).map((c) => [c.id, c]));
      const { events } = await loadEvents(ctx, new Date(from), new Date(to));
      return events.slice(0, 200).map((e) => ({
        title: e.title, start: e.start, end: e.end, allDay: e.allDay, location: e.loc || undefined,
        calendar: cals[e.cal]?.name, family: !!cals[e.cal]?.family,
        travelMinutes: e.travel?.minutes ?? undefined,
      }));
    },
  }],
});
