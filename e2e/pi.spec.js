// A Raspberry Pi wall screen: the dashboard through the kiosk helper, and the same on-screen Wi-Fi
// setup as the Android frames, with a phone option for screens without a keyboard.
import { test, expect } from '@playwright/test';

// A Pi runs Chromium; the iPhone (WebKit) project skips these.
test.skip(({ browserName }) => browserName !== 'chromium', 'Raspberry Pi screens run Chromium');
test.use({ baseURL: 'http://localhost:8798', viewport: { width: 1280, height: 800 }, hasTouch: true, isMobile: false });
test.beforeEach(async ({ request }) => { await request.post('http://localhost:8790/__test/reset'); });

test('the dashboard comes through the helper, and Settings → Wi-Fi opens the on-screen setup', async ({ page, request }) => {
  await page.goto('/?kiosk=pi#settings');
  await expect(page.getByText('Can change household settings')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-act="wifi"]').click();
  await expect(page).toHaveURL(/\/kiosk\/setup\?reason=settings/);
  await expect(page.getByRole('heading', { name: 'Wi-Fi' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Use your phone instead' })).toBeVisible();
});

test('the server address can be changed on the screen, and is kept', async ({ page, request }) => {
  await page.goto('/kiosk/setup?reason=offline');
  await expect(page.locator('#serverUrl')).toHaveText('http://127.0.0.1:8790');
  await page.getByRole('button', { name: 'Change' }).click();
  await page.locator('#sheetInput').evaluate((el) => { el.value = 'localhost:8790'; });
  await page.locator('#kb').getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/\?kiosk=pi/);
  expect((await (await request.get('/kiosk/status')).json()).server).toBe('http://localhost:8790');
  // Put it back for the other tests.
  await request.post('/kiosk/server', { data: { url: 'http://127.0.0.1:8790' } });
});

test('a touch screen offers Wi-Fi on the screen when it isn’t connected', async ({ page }) => {
  await page.goto('/kiosk/connecting');
  await expect(page.getByRole('button', { name: 'Choose Wi-Fi on this screen' })).toBeVisible();
  await page.getByRole('button', { name: 'Choose Wi-Fi on this screen' }).click();
  await expect(page).toHaveURL(/\/kiosk\/setup\?reason=offline/);
});
