// Reading iCal / ICS calendar feeds (Apple, Google, Outlook and anything else that publishes
// one) and expanding them into plain events, including repeating events and edited occurrences.

import ICAL from 'ical.js';
import { getText } from '@noor-frame/core';

// Limits that keep one strange or hostile feed from tying up the server: the download size, the
// repeats worked out across a whole feed, and the events kept from it.
export const LIMITS = { bytes: 10e6, repeats: 50000, events: 5000 };
export const fetchFeed = (url) => getText(icsUrl(url), { maxBytes: LIMITS.bytes });

// webcal:// is just https:// for calendar apps.
export function icsUrl(u) { return u.trim().replace(/^webcal:\/\//i, 'https://'); }

// A short fingerprint of an event's UID. Feeds choose their own UIDs, so they never go into an
// event id (which ends up in the dashboard's HTML) as they are.
function fingerprint(s) {
  let a = 0x811c9dc5, b = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

export function expandFeed(text, cal, from, to) {
  const root = new ICAL.Component(ICAL.parse(text));
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz);

  // Group by UID: the master (with RRULE) plus any edited single occurrences (RECURRENCE-ID).
  const byUid = new Map();
  for (const c of root.getAllSubcomponents('vevent')) {
    const uid = c.getFirstPropertyValue('uid') || Math.random().toString(36).slice(2);
    if (!byUid.has(uid)) byUid.set(uid, { master: null, exceptions: [] });
    const g = byUid.get(uid);
    if (c.hasProperty('recurrence-id')) g.exceptions.push(c); else g.master = c;
  }

  const fromT = ICAL.Time.fromJSDate(from, true);
  const toT = ICAL.Time.fromJSDate(to, true);
  const out = [];
  let repeats = 0;

  function push(uid, start, end, ev) {
    if (!start || out.length >= LIMITS.events) return;
    const allDay = start.isDate;
    if (!end) { end = start.clone(); if (allDay) end.adjust(1, 0, 0, 0); }
    const s = allDay ? start.toString().slice(0, 10) : start.toJSDate().toISOString();
    const e = allDay ? end.toString().slice(0, 10) : end.toJSDate().toISOString();
    if ((ev.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return;
    out.push({
      id: `${cal.id}:${fingerprint(String(uid))}:${s}`,
      cal: cal.id,
      title: ev.summary || '(No title)',
      start: s, end: e, allDay,
      loc: ev.location || '',
      notes: (ev.description || '').slice(0, 500),
    });
  }

  for (const [uid, g] of byUid) {
    if (!g.master) {
      // Edited occurrences whose master is missing: show them as plain events.
      for (const x of g.exceptions) { const ev = new ICAL.Event(x); push(uid, ev.startDate, ev.endDate, ev); }
      continue;
    }
    const ev = new ICAL.Event(g.master);
    for (const x of g.exceptions) ev.relateException(x);

    if (!ev.isRecurring()) {
      const endsAfter = ev.endDate ? ev.endDate.compare(fromT) > 0 : ev.startDate.compare(fromT) >= 0;
      if (endsAfter && ev.startDate.compare(toT) < 0) push(uid, ev.startDate, ev.endDate, ev);
      continue;
    }
    const it = ev.iterator();
    let next;
    while (repeats++ < LIMITS.repeats && (next = it.next())) {
      if (next.compare(toT) >= 0) break;
      const occ = ev.getOccurrenceDetails(next);
      if (occ.endDate.compare(fromT) <= 0) continue;
      push(uid, occ.startDate, occ.endDate, occ.item);
    }
  }
  return out;
}

// Checks a link pasted on a phone: is it a calendar, what is it called, how busy is it?
export async function validateFeed(url, fetchText = fetchFeed) {
  const text = await fetchText(url);
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not a calendar');
  const name = (text.match(/^X-WR-CALNAME:(.*)$/im) || [])[1];
  const now = new Date(), events = expandFeed(text, { id: 'check' }, now, new Date(+now + 30 * 864e5));
  return { name: name ? name.trim().replace(/\\,/g, ',').slice(0, 30) : '', upcoming: events.length };
}
