// Shared steps for the browser tests.
import { expect } from '@playwright/test';

// A fresh household: no saved settings, calendars, keys or devices.
export async function reset(request) {
  await request.post('/__test/reset');
}

// A screen on the home network registers (and is approved automatically, like a real frame).
export async function screen(request, { from } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (from) headers['x-test-ip'] = from;
  const r = await request.post('/api/devices/register', { headers, data: { kind: 'screen' } });
  expect(r.ok()).toBeTruthy();
  return r.json();
}

// What a screen's "Open on phone" QR code holds: a one-time pairing code.
export async function pairCode(request, screenToken) {
  const r = await request.post('/api/pair', { headers: { authorization: 'Bearer ' + screenToken } });
  expect(r.ok()).toBeTruthy();
  return (await r.json()).token;
}

// Scan a screen's QR code and connect this phone, the way a person would.
export async function connectPhone(page, request, name = 'Test phone') {
  const s = await screen(request);
  const code = await pairCode(request, s.token);
  await page.goto(`/companion/?pair=${code}`);
  await page.getByLabel('Name for this phone').fill(name);
  await page.getByRole('button', { name: 'Connect' }).click();
  // The overview's label (the Connect page also says "household’s settings").
  await expect(page.getByText('Household', { exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/pair=/);
  return { screen: s, code };
}

// Fail a test on any error the page logs, and on pages wider than the phone.
export function watchPage(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  // HTTP errors the test expects (an expired code, a signed-out phone) are logged by the browser
  // as "Failed to load resource"; the tests check those responses themselves.
  page.on('console', (m) => { if (m.type() === 'error' && !/^Failed to load resource/.test(m.text())) errors.push(m.text()); });
  return {
    errors,
    async check() {
      expect(errors, 'no errors in the page').toEqual([]);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overflow, 'no sideways scrolling').toBeLessThanOrEqual(0);
    },
  };
}

export const toast = (page) => page.locator('#toast');
