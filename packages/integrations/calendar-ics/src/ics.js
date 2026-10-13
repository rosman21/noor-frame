// Reading iCal / ICS calendar feeds (Apple, Google, Outlook and anything else that publishes
// one) and expanding them into plain events, including repeating events and edited occurrences.

import ICAL from 'ical.js';
import { getText } from '@noor-frame/core';

// webcal:// is just https:// for calendar apps.
export function icsUrl(u) { return u.trim().replace(/^webcal:\/\//i, 'https://'); }

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

  function push(uid, start, end, ev) {
    if (!start) return;
    const allDay = start.isDate;
    if (!end) { end = start.clone(); if (allDay) end.adjust(1, 0, 0, 0); }
    const s = allDay ? start.toString().slice(0, 10) : start.toJSDate().toISOString();
    const e = allDay ? end.toString().slice(0, 10) : end.toJSDate().toISOString();
    if ((ev.component.getFirstPropertyValue('status') || '').toUpperCase() === 'CANCELLED') return;
    out.push({
      id: `${cal.id}:${uid}:${s}`,
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
    let next, guard = 0;
    while ((next = it.next()) && guard++ < 20000) {
      if (next.compare(toT) >= 0) break;
      const occ = ev.getOccurrenceDetails(next);
      if (occ.endDate.compare(fromT) <= 0) continue;
      push(uid, occ.startDate, occ.endDate, occ.item);
    }
  }
  return out;
}

// Checks a link pasted on a phone: is it a calendar, what is it called, how busy is it?
export async function validateFeed(url, fetchText = getText) {
  const text = await fetchText(icsUrl(url));
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('not a calendar');
  const name = (text.match(/^X-WR-CALNAME:(.*)$/im) || [])[1];
  const now = new Date(), events = expandFeed(text, { id: 'check' }, now, new Date(+now + 30 * 864e5));
  return { name: name ? name.trim().replace(/\\,/g, ',').slice(0, 30) : '', upcoming: events.length };
}
