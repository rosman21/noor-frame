// Reading calendar feeds that are odd, huge or written to cause trouble.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { expandFeed, validateFeed, LIMITS } from '../src/ics.js';

const realFetch = globalThis.fetch;
after(() => { globalThis.fetch = realFetch; });

const feed = (events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', ...events.flat(), 'END:VCALENDAR'].join('\r\n');
const event = (uid, start, extra = []) => ['BEGIN:VEVENT', `UID:${uid}`, 'SUMMARY:Practice', `DTSTART:${start}`, `DTEND:${start.replace(/T(\d\d)/, (m, h) => 'T' + String(+h + 1).padStart(2, '0'))}`, ...extra, 'END:VEVENT'];
const FROM = new Date('2026-10-01T00:00:00Z'), TO = new Date('2026-10-31T00:00:00Z');

test('event ids never carry the feed’s own UID', () => {
  const hostile = '"><img src=x onerror=alert(1)>\'';
  const [a] = expandFeed(feed([event(hostile, '20261012T150000Z')]), { id: 'school' }, FROM, TO);
  assert.match(a.id, /^school:[0-9a-f]{16}:2026-10-12T15:00:00\.000Z$/);
  // The same UID always gives the same id, and different UIDs different ones.
  const [b] = expandFeed(feed([event(hostile, '20261012T150000Z')]), { id: 'school' }, FROM, TO);
  const [c] = expandFeed(feed([event('other@x', '20261012T150000Z')]), { id: 'school' }, FROM, TO);
  assert.equal(a.id, b.id);
  assert.notEqual(a.id, c.id);
});

test('a feed that repeats endlessly is cut off', () => {
  // Every minute, forever: far more than a month's window should ever hold.
  const every = expandFeed(feed([event('tick@x', '20261001T000000Z', ['RRULE:FREQ=MINUTELY'])]), { id: 'x' }, FROM, TO);
  assert.equal(every.length, LIMITS.events);
  // Repeats that never reach the window stop counting too.
  const old = expandFeed(feed([event('old@x', '19000101T000000Z', ['RRULE:FREQ=HOURLY'])]), { id: 'x' }, FROM, TO);
  assert.equal(old.length, 0);
});

test('a calendar link that sends too much is refused', async () => {
  const chunk = new TextEncoder().encode('BEGIN:VCALENDAR\r\n' + 'X'.repeat(1e6));
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(c) { c.enqueue(chunk); },
  }), { status: 200, headers: { 'content-type': 'text/calendar' } });
  await assert.rejects(validateFeed('https://cal.example/huge.ics'), /larger than 10 MB/);
  globalThis.fetch = async () => new Response('BEGIN:VCALENDAR', { headers: { 'content-length': String(LIMITS.bytes + 1) } });
  await assert.rejects(validateFeed('webcal://cal.example/huge.ics'), /larger than 10 MB/);
});
