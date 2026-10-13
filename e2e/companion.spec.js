// The phone companion, end to end: from scanning a screen's QR code to every settings page.
import { test, expect } from '@playwright/test';
import { reset, screen, pairCode, connectPhone, watchPage, toast } from './helpers.js';

let watch;
test.beforeEach(async ({ page, request }) => {
  await reset(request);
  watch = watchPage(page);
});
test.afterEach(async () => { await watch?.check(); });

test.describe('signing in', () => {
  test('without a code, the phone explains how to connect', async ({ page }) => {
    await page.goto('/companion/');
    await expect(page.getByRole('heading', { name: /on your phone/ })).toBeVisible();
    await expect(page.getByText('Open on phone')).toBeVisible();
  });

  test('scanning a screen’s code connects the phone and removes the code from the address', async ({ page, request }) => {
    await connectPhone(page, request, 'Kitchen phone');
    expect(page.url()).not.toContain('pair=');
    await expect(page.getByRole('heading', { name: /Toronto/ })).toBeVisible();
    // The phone stays signed in after a reload.
    await page.reload();
    await expect(page.getByText('Household', { exact: true })).toBeVisible();
  });

  test('an expired or made-up code says so', async ({ page }) => {
    await page.goto('/companion/?pair=' + '0'.repeat(32));
    await page.getByLabel('Name for this phone').fill('Phone');
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(toast(page)).toContainText('This QR code has expired');
  });

  test('a phone that is removed is signed out', async ({ page, request }) => {
    const { screen: s } = await connectPhone(page, request, 'Old phone');
    const { devices } = await (await request.get('/api/devices', { headers: { authorization: 'Bearer ' + s.token } })).json();
    const phone = devices.find((d) => d.name === 'Old phone');
    await request.post('/api/devices/remove', { headers: { authorization: 'Bearer ' + s.token }, data: { id: phone.id } });
    await page.reload();
    await expect(page.getByText('This phone was signed out')).toBeVisible();
  });
});

test.describe('household settings', () => {
  test.beforeEach(async ({ page, request }) => { await connectPhone(page, request); });

  test('the overview shows every settings group', async ({ page }) => {
    for (const name of ['Location', 'Prayer times', 'Athan & reminder', 'Ayah of the day', 'Weather', 'Screens']) {
      await expect(page.locator('a.row', { hasText: name }).first()).toBeVisible();
    }
    await expect(page.getByText('Optional features')).toBeVisible();
  });

  test('choosing a city saves it and offers the usual prayer method for that country', async ({ page }) => {
    await page.locator('a.row', { hasText: 'Location' }).click();
    await page.getByLabel('Town or ZIP code').fill('Birmingham');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('button', { name: /England/ }).click();
    await expect(page.getByRole('heading', { name: /Use .*\?/ })).toBeVisible();
    await page.getByRole('button', { name: 'Use it' }).click();
    await expect(page.getByRole('heading', { name: /Birmingham/ })).toBeVisible();
    await expect(page.locator('a.row', { hasText: 'Prayer times' })).toContainText('Moonsighting Committee');
  });

  test('a ZIP code finds the town, with the code beside it', async ({ page, request }) => {
    await page.goto('/companion/#/location');
    await page.getByLabel('Town or ZIP code').fill('12345');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('button', { name: /Springfield.*12345, Sangamon, Illinois/ }).click();
    // ISNA is already the usual US method, so nothing is asked.
    await expect(toast(page)).toContainText('Location set to Springfield');
    const cfg = await (await request.get('/api/config')).json();
    expect(cfg.location).toMatchObject({ name: 'Springfield', code: 'US', latitude: 39.8, longitude: -89.6, timezone: 'America/Chicago', source: 'search' });
  });

  test('a city search with no results says so', async ({ page }) => {
    await page.goto('/companion/#/location');
    await page.getByLabel('Town or ZIP code').fill('Nowhereville');
    await page.getByRole('button', { name: 'Search' }).click();
    await expect(page.getByText('No places called “Nowhereville”')).toBeVisible();
  });

  test('prayer settings save for every screen', async ({ page, request }) => {
    await page.locator('a.row', { hasText: 'Prayer times' }).click();
    await page.getByLabel('Calculation method').selectOption({ label: 'Muslim World League' });
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(toast(page)).toContainText('Saved for every screen');
    const cfg = await (await request.get('/api/config')).json();
    expect(cfg.prayer.method).toBe(3);
    await page.reload();
    await expect(page.getByLabel('Calculation method')).toHaveValue('3');
  });

  test('a number outside its range is refused with a clear message', async ({ page }) => {
    await page.locator('a.row', { hasText: 'Athan & reminder' }).click();
    const reminder = page.getByLabel(/Reminder/);
    await reminder.fill('999');
    // The browser's own check stops it first; the server would refuse it too.
    await page.getByRole('button', { name: 'Save' }).click();
    expect(await reminder.evaluate((el) => el.validity.valid)).toBe(false);
  });

  test('switching an optional feature off and on', async ({ page, request }) => {
    const travel = page.locator('[data-integration="travel"]');
    await expect(travel).toBeChecked();
    await travel.uncheck({ force: true });
    await expect(toast(page)).toContainText('Travel times off');
    expect((await (await request.get('/api/config')).json()).features).not.toContain('travel');
    await travel.check({ force: true });
    await expect(toast(page)).toContainText('Travel times on');
    expect((await (await request.get('/api/config')).json()).features).toContain('travel');
  });
});

test.describe('Google Maps key', () => {
  test.beforeEach(async ({ page, request }) => {
    await connectPhone(page, request);
    await page.goto('/companion/#/section/travel');
  });

  test('a pasted key is saved, shown only by its last 4 characters, and never sent back', async ({ page, request }) => {
    const key = 'AIzaSyTESTKEY-1234567890-abcd';
    await page.getByLabel(/Google Maps API key/).fill(key);
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(toast(page)).toContainText('Saved for every screen');
    await expect(page.getByText('Saved · ends in')).toContainText('abcd');
    expect(await page.content()).not.toContain('AIzaSy');
    // Screens and the settings API never see it either.
    expect(JSON.stringify(await (await request.get('/api/config')).json())).not.toContain('AIzaSy');
  });

  test('the daily lookup limit is set here', async ({ page }) => {
    await expect(page.getByLabel('Google lookups per day')).toHaveValue('100');
    await page.getByLabel('Google lookups per day').fill('25');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(toast(page)).toContainText('Saved for every screen');
    await page.reload();
    await expect(page.getByLabel('Google lookups per day')).toHaveValue('25');
  });

  test('saving checks the address and routes, and a suggested address is one tap away', async ({ page, request }) => {
    await page.getByLabel('Home address').fill('100 Queen Street West, Toronto');
    await page.getByLabel(/Google Maps API key/).fill('AIzaSyTESTKEY-check-5555');
    await page.getByRole('button', { name: 'Save' }).click();
    const results = page.locator('#checkResults');
    await expect(results).toContainText('Google suggests a correction');
    await expect(results).toContainText('100 Queen St W, Toronto, ON M5H 2N2, Canada');
    await expect(results).toContainText('Routes work');

    await results.getByRole('button', { name: 'Use this address' }).click();
    await expect(page.getByLabel('Home address')).toHaveValue('100 Queen St W, Toronto, ON M5H 2N2, Canada');
    await expect(page.locator('#checkResults')).toContainText('Home address confirmed');
  });

  test('typing the home address offers Google suggestions once a key is saved', async ({ page }) => {
    await page.getByLabel(/Google Maps API key/).fill('AIzaSyTESTKEY-places-7777');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.locator('#checkResults')).toContainText('No home address');
    await page.getByLabel('Home address').pressSequentially('100 Queen', { delay: 30 });
    const option = page.getByRole('option', { name: '100 Queen St W, Toronto, ON, Canada' });
    await expect(option).toBeVisible();
    await expect(page.getByText('Suggestions from Google')).toBeVisible();
    await option.click();
    await expect(page.getByLabel('Home address')).toHaveValue('100 Queen St W, Toronto, ON, Canada');
    await expect(page.locator('.suggest').getByRole('option')).toHaveCount(0);
  });

  test('without a key, typing the address says suggestions need one', async ({ page }) => {
    await page.getByLabel('Home address').pressSequentially('100 Queen', { delay: 30 });
    await expect(page.getByText('Add a Google Maps key for address suggestions.')).toBeVisible();
  });

  test('without a key, the check explains that trips are free estimates', async ({ page }) => {
    await page.getByRole('button', { name: 'Check address and routes' }).click();
    await expect(page.locator('#checkResults')).toContainText('No Google Maps key');
  });

  test('a saved key can be removed', async ({ page }) => {
    await page.getByLabel(/Google Maps API key/).fill('AIzaSyTESTKEY-remove-me-9876');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Saved · ends in')).toBeVisible();
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Remove key' }).click();
    await expect(toast(page)).toContainText('Key removed');
    await expect(page.getByText('Not set')).toBeVisible();
  });
});

test.describe('calendars', () => {
  test.beforeEach(async ({ page, request }) => { await connectPhone(page, request); });

  test('adding a calendar by link shows it on the frame', async ({ page, request }) => {
    await page.goto('/companion/#/calendars/add');
    await page.getByLabel(/Calendar link/).fill('https://cal.example/school.ics');
    await page.getByLabel(/Name on the frame/).fill('Yusuf');
    await page.getByRole('button', { name: 'Add to frame' }).click();
    await expect(page.locator('.done')).toContainText('Yusuf');
    await expect(toast(page)).toContainText('Added Yusuf');
    const { calendars } = await (await request.get('/api/calendars')).json();
    expect(calendars.map((c) => c.name)).toContain('Yusuf');
  });

  test('several links at once, and a bad link is explained', async ({ page }) => {
    await page.goto('/companion/#/calendars/add');
    await page.getByLabel(/Calendar link/).fill('https://cal.example/work.ics\nhttps://cal.example/notcal.ics');
    await page.getByRole('button', { name: 'Add to frame' }).click();
    await expect(page.locator('.done .added')).toHaveCount(1);
    await expect(page.locator('.done .error')).toHaveCount(1);
  });

  test('a calendar’s colour and family setting can be changed, and it can be removed', async ({ page }) => {
    await page.goto('/companion/#/calendars/add');
    await page.getByLabel(/Calendar link/).fill('https://cal.example/school.ics');
    await page.getByLabel(/Name on the frame/).fill('School');
    await page.getByRole('button', { name: 'Add to frame' }).click();
    await expect(toast(page)).toContainText('Added School');

    await page.goto('/companion/#/calendars');
    await page.getByRole('link', { name: /School/ }).click();
    await page.locator('.swatches label').nth(2).click();
    await expect(toast(page)).toContainText('Colour changed');
    await page.locator('#family').check({ force: true });
    await expect(toast(page)).toContainText('Saved');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'Remove School' }).click();
    await expect(toast(page)).toContainText('School removed');
    await expect(page.getByRole('link', { name: /School/ })).toHaveCount(0);
  });

  test('a calendar from the settings file can be hidden but not removed', async ({ page }) => {
    await page.goto('/companion/#/calendars');
    await page.getByRole('link', { name: /Family/ }).click();
    await expect(page.getByRole('button', { name: /Remove/ })).toHaveCount(0);
    await page.locator('#shown').uncheck({ force: true });
    await expect(toast(page)).toContainText('Hidden');
  });
});

test.describe('screens and phones', () => {
  test('a screen outside the home waits for approval and can be approved, renamed and removed', async ({ page, request }) => {
    await connectPhone(page, request, 'My phone');
    await screen(request, { from: '203.0.113.9' });
    await page.reload();
    await expect(page.locator('a.row', { hasText: 'Devices' })).toContainText('1 waiting for approval');
    await page.goto('/companion/#/devices');
    await expect(page.getByText('Waiting for approval')).toBeVisible();
    await page.getByRole('button', { name: 'Approve' }).click();
    await expect(toast(page)).toContainText('approved');
    await expect(page.getByText('Waiting for approval')).toHaveCount(0);

    const row = page.locator('.row--device').filter({ hasNotText: 'this phone' }).last();
    page.once('dialog', (d) => d.accept('Hall screen'));
    await row.getByRole('button', { name: 'Rename' }).click();
    await expect(page.getByText('Hall screen')).toBeVisible();

    page.once('dialog', (d) => d.accept());
    await page.locator('.row--device', { hasText: 'Hall screen' }).getByRole('button', { name: 'Remove' }).click();
    await expect(toast(page)).toContainText('Hall screen removed');
  });

  test('this phone is marked and can’t remove itself', async ({ page, request }) => {
    await connectPhone(page, request, 'My phone');
    await page.goto('/companion/#/devices');
    const me = page.locator('.row--device', { hasText: 'this phone' });
    await expect(me).toBeVisible();
    await expect(me.getByRole('button', { name: 'Remove' })).toHaveCount(0);
  });
});

test.describe('with the screens', () => {
  test('a change on the phone shows on a screen within seconds', async ({ page, request, browser }) => {
    await connectPhone(page, request);
    const frame = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await frame.goto('/');
    await expect(frame.locator('.h-prayers')).toBeVisible({ timeout: 15000 });

    await page.goto('/companion/#/location');
    await page.getByLabel('Town or ZIP code').fill('Kuala Lumpur');
    await page.getByRole('button', { name: 'Search' }).click();
    await page.getByRole('button', { name: /Kuala Lumpur/ }).click();
    await page.getByRole('button', { name: 'Keep current' }).or(page.getByRole('link', { name: 'Keep current' })).click();

    await expect(frame.locator('.ps-loc')).toHaveText(/Kuala Lumpur/i, { timeout: 20000 });
    await frame.close();
  });

  test('a screen finds its town by ZIP code with Noor’s keyboard', async ({ browser, request }) => {
    const frame = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await frame.goto('/#settings');
    await expect(frame.getByText('Can change household settings')).toBeVisible({ timeout: 15000 });
    await frame.getByRole('button', { name: 'Town or ZIP' }).click();
    const keys = frame.locator('.loc-kb');
    await expect(keys).toBeVisible();
    await keys.getByRole('button', { name: '123' }).click();
    for (const k of '12345') await keys.getByRole('button', { name: k, exact: true }).click();
    await expect(frame.locator('.loc-q')).toHaveText('12345');
    const rows = frame.locator('.loc-results .pk-row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1)).toContainText('12345, Sangamon, Illinois, United States');
    // Done hides the keyboard so more places fit; the field brings it back.
    await keys.getByRole('button', { name: 'Done' }).click();
    await expect(keys).toBeHidden();
    await frame.locator('.loc-field').click();
    await expect(keys).toBeVisible();
    await rows.filter({ hasText: 'Springfield' }).click();
    await expect(frame.locator('.set-place')).toHaveText('Springfield');
    await expect.poll(async () => (await (await request.get('/api/config')).json()).location.source).toBe('search');
    await frame.close();
  });

  test('the frame’s “Open on phone” code connects a phone, and the frame says so', async ({ page, browser }) => {
    const frame = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await frame.goto('/#settings');
    await expect(frame.getByText('Can change household settings')).toBeVisible({ timeout: 15000 });
    const paired = frame.waitForResponse((r) => r.url().endsWith('/api/pair') && r.request().method() === 'POST');
    await frame.getByRole('button', { name: /Open on phone/ }).click();
    const { token } = await (await paired).json();
    await expect(frame.getByText('Waiting for your phone…')).toBeVisible();
    // The address in the code, as the frame shows it under the QR code.
    await expect(frame.locator('.add-cal-url')).toContainText('/companion/?pair=' + token.slice(0, 6));

    await page.goto('/companion/?pair=' + token);
    await page.getByLabel('Name for this phone').fill('Mum’s phone');
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByText('Household', { exact: true })).toBeVisible();
    await expect(frame.locator('#addCalStatus')).toContainText('Connected: Mum’s phone', { timeout: 10000 });
    await frame.close();
  });

  test('a calendar added from the frame’s “Add calendar” code shows on that frame', async ({ page, browser }) => {
    const frame = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await frame.goto('/#settings');
    await expect(frame.getByText('Can change household settings')).toBeVisible({ timeout: 15000 });
    const paired = frame.waitForResponse((r) => r.url().endsWith('/api/pair') && r.request().method() === 'POST');
    await frame.getByRole('button', { name: 'Add calendar' }).click();
    const { token } = await (await paired).json();

    await page.goto('/companion/?pair=' + token + '#/calendars/add');
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByRole('heading', { name: /Add calendars/ })).toBeVisible();
    await page.getByLabel(/Calendar link/).fill('https://cal.example/school.ics');
    await page.getByLabel(/Name on the frame/).fill('Yusuf');
    await page.getByRole('button', { name: 'Add to frame' }).click();
    await expect(frame.locator('#addCalStatus')).toContainText('Added: Yusuf', { timeout: 10000 });
    await frame.close();
  });

  test('the screen showing the code learns which phone connected', async ({ page, request }) => {
    const s = await screen(request);
    const code = await pairCode(request, s.token);
    await page.goto(`/companion/?pair=${code}`);
    await page.getByRole('button', { name: 'Connect' }).click();
    await expect(page.getByText('Household', { exact: true })).toBeVisible();
    const status = await (await request.get('/api/pair/status?token=' + code)).json();
    expect(status.phones.length).toBe(1);
  });
});
