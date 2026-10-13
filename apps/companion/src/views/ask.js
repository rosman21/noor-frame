// Ask the household assistant (AI). Answers come from the family's own calendar, prayer times,
// weather and ayah. The conversation stays on this phone (for this visit) and is sent with each
// question so follow-ups make sense.

import { get, post } from '../api.js';
import { page, esc, icon, toast, $ } from '../ui.js';

const KEY = 'noor-ask';
const TOOL_NAMES = { get_calendar: 'calendar', get_prayer_times: 'prayer times', get_weather: 'weather', get_ayah_of_the_day: 'ayah of the day' };
const EXAMPLES = ['When is Maghrib on Friday?', 'Who has something on tomorrow morning?', 'Do I need an umbrella today?', 'What is today’s ayah about?'];

const load = () => { try { return JSON.parse(sessionStorage.getItem(KEY) || '[]'); } catch { return []; } };
const save = (h) => sessionStorage.setItem(KEY, JSON.stringify(h.slice(-20)));

function bubble(m) {
  const used = m.tools?.length ? `<small class="used">Checked: ${m.tools.map((t) => TOOL_NAMES[t] || t).join(', ')}</small>` : '';
  return `<div class="msg msg--${m.role}"><p>${esc(m.content).replace(/\n/g, '<br>')}</p>${used}</div>`;
}

export async function askPage(app) {
  const cfg = await get('/api/config');
  if (!cfg.ai?.chat) {
    app.innerHTML = page({ back: '#/', label: 'AI assistant', title: 'Not set up yet', body: `
      <p class="lead">Switch on the AI assistant and add an Anthropic API key to ask questions here.</p>
      <a class="btn btn--solid btn--wide" href="#/section/ai-claude">${icon('settings', 20)}AI settings</a>` });
    return;
  }
  const history = load();
  app.innerHTML = page({
    back: '#/', label: 'AI assistant', title: 'Ask <i>the frame</i>',
    body: `
      <div class="chat" id="chat">${history.length ? history.map(bubble).join('') :
        `<div class="examples"><p class="muted">Ask about your family’s day. For example:</p>${EXAMPLES.map((q) => `<button class="chip" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>`}</div>
      <form class="ask" id="ask">
        <textarea name="q" rows="2" placeholder="Ask a question…" enterkeyhint="send" required></textarea>
        <button class="btn btn--solid" type="submit" aria-label="Send">${icon('right', 22)}</button>
      </form>
      <p class="foot" id="usage"></p>
      <p class="foot">Answers are written by AI (Claude) from your household’s data. For religious rulings, ask a qualified scholar.
        ${history.length ? '<button class="link-btn" id="clear">Start over</button>' : ''}</p>`,
  });

  const showUsage = () => get('/api/ai/usage').then((u) => {
    $('#usage').textContent = `Today: ${u.cents.toFixed(1)}¢ of your ${u.limitCents}¢ limit · ${u.calls} ${u.calls === 1 ? 'request' : 'requests'}`;
  }).catch(() => {});
  showUsage();

  const form = $('#ask'), chatEl = $('#chat');
  async function send(q) {
    q = q.trim();
    if (!q) return;
    history.push({ role: 'user', content: q });
    save(history);
    chatEl.innerHTML = history.map(bubble).join('') + '<div class="msg msg--assistant msg--wait"><p>Thinking…</p></div>';
    form.q.value = '';
    form.querySelector('button').disabled = true;
    chatEl.lastElementChild.scrollIntoView({ block: 'end', behavior: 'smooth' });
    try {
      const r = await post('/api/ai/chat', { messages: history.map(({ role, content }) => ({ role, content })) });
      history.push({ role: 'assistant', content: r.answer, tools: r.tools });
    } catch (err) {
      history.pop(); // let them try the same question again
      toast(err.message, { error: true, ms: 5000 });
      form.q.value = q;
    }
    save(history);
    chatEl.innerHTML = history.map(bubble).join('');
    form.querySelector('button').disabled = false;
    chatEl.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
    showUsage();
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); send(form.q.value); });
  form.q.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(form.q.value); } });
  for (const b of chatEl.querySelectorAll('[data-q]')) b.addEventListener('click', () => send(b.dataset.q));
  $('#clear')?.addEventListener('click', () => { sessionStorage.removeItem(KEY); askPage(app); });
}
