// The phone companion. Opened from a QR code on any screen (Settings → Open on phone), which
// signs this phone in. Pages are addressed with the URL hash (#/calendars, #/section/prayer-aladhan…).

import { session, claim, deviceGuess, SignedOut } from './api.js';
import { $, esc, icon, toast, busy } from './ui.js';
import { homePage } from './views/home.js';
import { locationPage } from './views/location.js';
import { sectionPage } from './views/section.js';
import { calendarsPage, addCalendarPage, calendarPage } from './views/calendars.js';
import { devicesPage } from './views/devices.js';
import { askPage } from './views/ask.js';

const ROUTES = [
  [/^#?\/?$/, homePage],
  [/^#\/location$/, locationPage],
  [/^#\/section\/([\w-]+)$/, sectionPage],
  [/^#\/calendars$/, calendarsPage],
  [/^#\/calendars\/add$/, addCalendarPage],
  [/^#\/calendars\/([\w-]+)$/, calendarPage],
  [/^#\/devices$/, devicesPage],
  [/^#\/ask$/, askPage],
];

const app = $('#app');

async function render() {
  if (!session.get()) return signedOutPage();
  const hash = location.hash || '#/';
  const [re, view] = ROUTES.find(([r]) => r.test(hash)) || ROUTES[0];
  const args = hash.match(re).slice(1);
  try {
    await view(app, ...args);
    window.scrollTo(0, 0);
  } catch (err) {
    if (err instanceof SignedOut) return signedOutPage('This phone was signed out. Scan the code on a screen again.');
    app.innerHTML = `<div class="empty"><h1 class="serif">Can’t load this</h1><p>${esc(err.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
  }
}

function signedOutPage(note) {
  app.innerHTML = `<div class="welcome">
    <div class="logo">${icon('moonstar', 34)}</div>
    <h1 class="serif">noor-frame <i>on your phone</i></h1>
    <p>Change settings, add calendars and manage your screens from here.</p>
    ${note ? `<p class="note">${esc(note)}</p>` : ''}
    <ol class="steps">
      <li>On the frame, open <b>Settings</b>.</li>
      <li>Tap <b>Open on phone</b> under “This frame”.</li>
      <li>Point your phone’s camera at the code.</li>
    </ol>
  </div>`;
}

// Opened from a QR code: ?pair=<code>. Ask what to call this phone, then sign in.
function claimPage(code) {
  app.innerHTML = `<div class="welcome">
    <div class="logo">${icon('moonstar', 34)}</div>
    <h1 class="serif">Connect <i>this phone</i></h1>
    <p>This phone will be able to change the household’s settings, calendars and screens.</p>
    <form class="card form" id="claim">
      <label class="field"><span>Name for this phone</span>
        <input name="name" maxlength="40" value="${esc(deviceGuess())}" autocomplete="off" required></label>
      <button class="btn btn--solid" type="submit">${icon('check', 20)}Connect</button>
    </form>
  </div>`;
  $('#claim').addEventListener('submit', (e) => {
    e.preventDefault();
    busy(e.submitter || $('#claim button'), async () => {
      const d = await claim(code, e.target.name.value.trim());
      // Drop the code from the address bar so it isn't reused from history.
      history.replaceState(null, '', location.pathname + (location.hash || '#/'));
      toast(`Connected as ${d.name}`);
      render();
    }).catch(() => {});
  });
}

const code = new URLSearchParams(location.search).get('pair');
// Remembered for this visit, so calendars added from the frame's "Add calendar" code show up on
// that frame's screen as they're added.
if (code) sessionStorage.setItem('noor-pair', code);
if (code && !session.get()) claimPage(code);
else {
  if (code) history.replaceState(null, '', location.pathname + (location.hash || '#/'));
  render();
}
addEventListener('hashchange', render);
