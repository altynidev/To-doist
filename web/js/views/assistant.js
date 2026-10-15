import { state, commit, refresh } from '../store.js';
import { $, esc, icon, fmtDate, WEEKDAYS, toast } from '../utils.js';
import { askPlan, applyPlan, planSize, planForModel, SECTIONS, DEFAULT_OLLAMA_MODEL } from '../ai.js';
import { PRIORITIES } from './todo.js';
import { CATEGORIES } from './goals.js';
import { hourLabel } from './schedule.js';

// The conversation lives in memory: it survives switching sections, not reloading the page.
let messages = []; // { role: 'user', content } | { role: 'assistant', plan, pick, added } | { role: 'error', content }
let busy = false;
let draft = '';

const EXAMPLES = [
  'Plan my week: gym 3 times, English every day for 30 min, and finish my project by Friday',
  'I want to read 12 books this year',
  'Help me build a calm morning routine',
  'I want to save money for a trip to Japan next summer',
];

const SECTION_TITLES = {
  goals: ['goals', 'Goals'], tasks: ['todo', 'Tasks'], schedule: ['calendar', 'Schedule'],
  habits: ['habits', 'Habits'], notes: ['notes', 'Notes'], vision: ['vision', 'Vision board'],
};

const dayList = (days) => (days.length === 7 ? 'Every day'
  : [1, 2, 3, 4, 5, 6, 0].filter((d) => days.includes(d)).map((d) => WEEKDAYS[d]).join(', '));

function itemHtml(section, x) {
  switch (section) {
    case 'goals': return `<strong>${CATEGORIES[x.category].emoji} ${esc(x.title)}</strong>
      <span>${[x.deadline && `by ${fmtDate(x.deadline)}`, x.milestones.length && `${x.milestones.length} milestones`].filter(Boolean).join(' · ')}</span>
      ${x.milestones.length ? `<ul>${x.milestones.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : ''}`;
    case 'tasks': return `<strong>${esc(x.title)}</strong>
      <span>${[x.due && fmtDate(x.due), x.priority < 4 && PRIORITIES[x.priority].label, x.notes && esc(x.notes)].filter(Boolean).join(' · ')}</span>`;
    case 'schedule': return `<strong>${esc(x.title)}</strong>
      <span>${dayList(x.days)} · ${hourLabel(x.start)}–${hourLabel(x.start + x.hours)} · ${x.weekly ? 'every week' : 'this week only'}</span>`;
    case 'habits': return `<strong>${esc(x.emoji)} ${esc(x.name)}</strong>
      <span>${dayList(x.days)}${x.goal ? ` · for “${esc(x.goal)}”` : ''}</span>`;
    case 'notes': return `<strong>${esc(x.title || 'Note')}</strong><span class="clip">${esc(x.body.split('\n')[0])}</span>`;
    case 'vision': return `<strong>“${esc(x.text)}”</strong>`;
  }
  return '';
}

function planHtml(m, mi) {
  const { plan, pick, added } = m;
  const count = SECTIONS.reduce((n, k) => n + pick[k].length, 0);
  return `
    <div class="ai-plan" data-msg="${mi}">
      ${SECTIONS.filter((k) => plan[k].length).map((k) => `
        <div class="ai-section">
          <h3>${icon(SECTION_TITLES[k][0], 16)} ${SECTION_TITLES[k][1]}</h3>
          ${plan[k].map((x, i) => `
            <label class="ai-item">
              <input type="checkbox" data-sec="${k}" data-i="${i}" ${pick[k].includes(i) ? 'checked' : ''} ${added ? 'disabled' : ''}>
              <div>${itemHtml(k, x)}</div>
            </label>`).join('')}
        </div>`).join('')}
      <div class="ai-plan-foot">
        ${added
          ? `<span class="ai-added">${icon('check', 16)} Added ${added} item${added > 1 ? 's' : ''}</span>`
          : `<button class="btn primary" data-act="apply" data-msg="${mi}" ${count ? '' : 'disabled'}>${icon('plus', 16)} Add ${count} selected</button>
             <span class="muted small">Untick anything you don't want, or ask me to change it.</span>`}
      </div>
    </div>`;
}

function messageHtml(m, mi) {
  if (m.role === 'user') return `<div class="ai-msg user"><div class="bubble">${esc(m.content)}</div></div>`;
  if (m.role === 'error') return `<div class="ai-msg error"><div class="bubble">${icon('x', 16)} ${esc(m.content)}</div></div>`;
  return `
    <div class="ai-msg assistant">
      <div class="ai-avatar">${icon('sparkle', 16)}</div>
      <div class="ai-body">
        ${m.plan.reply ? `<p class="bubble">${esc(m.plan.reply)}</p>`
          : planSize(m.plan) ? '' : '<p class="bubble">I couldn\'t make a plan from that. Could you say it another way, with a bit more detail?</p>'}
        ${planSize(m.plan) ? planHtml(m, mi) : ''}
      </div>
    </div>`;
}

function providerLabel() {
  const ai = state.settings.ai;
  return ai.provider === 'gemini'
    ? `Google Gemini${ai.geminiModel ? ` · ${ai.geminiModel}` : ''}`
    : `On this computer · ${ai.ollamaModel || DEFAULT_OLLAMA_MODEL}`;
}

export function render(root) {
  root.innerHTML = `
    <div class="page narrow ai-page">
      <header class="page-head">
        <div>
          <h1>Assistant</h1>
          <p class="muted">Tell me an idea, a wish or a plan, and I'll turn it into goals, tasks, schedule blocks and habits.</p>
        </div>
        <div class="head-actions">
          ${messages.length ? `<button class="btn ghost" data-act="new">${icon('plus', 16)} New chat</button>` : ''}
        </div>
      </header>

      <div class="ai-chat" id="chat">
        ${messages.length ? messages.map(messageHtml).join('') : `
          <div class="ai-empty">
            <div class="ai-avatar big">${icon('sparkle', 26)}</div>
            <p>Try one of these, or write your own:</p>
            <div class="ai-examples">${EXAMPLES.map((e) => `<button class="chip-btn" data-example="${esc(e)}">${esc(e)}</button>`).join('')}</div>
          </div>`}
        ${busy ? `<div class="ai-msg assistant"><div class="ai-avatar">${icon('sparkle', 16)}</div>
          <div class="bubble ai-thinking"><span></span><span></span><span></span>
          <em>${state.settings.ai.provider === 'ollama' ? 'Thinking… a local model can take up to a minute' : 'Thinking…'}</em></div></div>` : ''}
      </div>

      <form class="ai-input card" id="ask">
        <textarea name="q" rows="2" placeholder="e.g. I want to get fit before summer" ${busy ? 'disabled' : ''}>${esc(draft)}</textarea>
        <div class="ai-input-foot">
          <a href="#/settings" class="muted small">${icon('settings', 13)} ${esc(providerLabel())}</a>
          <button class="btn primary" ${busy ? 'disabled' : ''}>${icon('send', 16)} Send</button>
        </div>
      </form>
    </div>`;

  const form = $('#ask', root);
  const box = form.q;
  box.addEventListener('input', () => { draft = box.value; });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = box.value.trim();
    if (q && !busy) send(q);
  });

  root.addEventListener('click', (e) => {
    const example = e.target.closest('[data-example]')?.dataset.example;
    if (example && !busy) send(example);
    const act = e.target.closest('[data-act]');
    if (act?.dataset.act === 'new') { messages = []; refresh(); }
    if (act?.dataset.act === 'apply') {
      const m = messages[act.dataset.msg];
      m.added = applyPlan(m.plan, m.pick);
      commit();
      toast(`Added ${m.added} item${m.added > 1 ? 's' : ''} to To-doist`);
    }
  });

  root.addEventListener('change', (e) => {
    const cb = e.target.closest('input[data-sec]');
    if (!cb) return;
    const m = messages[cb.closest('[data-msg]').dataset.msg];
    const list = m.pick[cb.dataset.sec];
    const i = +cb.dataset.i;
    m.pick[cb.dataset.sec] = cb.checked ? [...list, i] : list.filter((x) => x !== i);
    const count = SECTIONS.reduce((n, k) => n + m.pick[k].length, 0);
    const btn = cb.closest('.ai-plan').querySelector('[data-act=apply]');
    btn.disabled = !count;
    btn.lastChild.textContent = ` Add ${count} selected`;
  });

  const chat = $('#chat', root);
  requestAnimationFrame(() => {
    const last = chat.lastElementChild;
    if (messages.length && last) last.scrollIntoView({ block: busy ? 'end' : 'start' });
    if (!busy && !matchMedia('(hover: none)').matches) box.focus();
  });
}

// Small models copy a plan back unchanged when asked in a chat, but follow one clear message well:
// so a follow-up is sent as "earlier requests + current plan + the change".
function requestFor(q) {
  const lastPlan = messages.findLast((m) => m.role === 'assistant' && planSize(m.plan) && !m.added);
  if (!lastPlan) return q;
  const earlier = messages.slice(0, messages.indexOf(lastPlan)).filter((m) => m.role === 'user').map((m) => `- ${m.content}`);
  return `My earlier request:\n${earlier.join('\n')}\n\nYour current plan:\n${planForModel(lastPlan.plan)}\n\n`
    + `Change it like this: ${q}\n\nReturn the complete updated plan. Make exactly this change, keep everything else the same.`;
}

async function send(q) {
  messages.push({ role: 'user', content: q });
  draft = '';
  busy = true;
  refresh();
  try {
    const plan = await askPlan([{ role: 'user', content: requestFor(q) }]);
    const pick = Object.fromEntries(SECTIONS.map((k) => [k, plan[k].map((_, i) => i)]));
    messages.push({ role: 'assistant', plan, pick, added: 0 });
  } catch (err) {
    messages.push({ role: 'error', content: err instanceof SyntaxError ? 'The AI sent an answer I could not read. Please try again.' : err.message });
  }
  busy = false;
  refresh();
}
