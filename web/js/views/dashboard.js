import { state, commit } from '../store.js';
import { $, esc, icon, uid, today, parseKey, timeAgo } from '../utils.js';
import { taskRow, handleTaskClick, openTaskModal, sortTasks } from './todo.js';
import { goalProgress, deadlineLabel, CATEGORIES } from './goals.js';
import { isScheduled, isDone, toggleHabit, currentStreak } from './habits.js';
import { selectNote } from './notes.js';
import { entriesFor, hourLabel, isEntryDone, toggleEntryDone } from './schedule.js';

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Good night';
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

/** The same vision card all day, a different one tomorrow. */
function visionOfTheDay() {
  const items = state.vision.items;
  if (!items.length) return null;
  const n = [...today()].reduce((s, c) => s * 31 + c.charCodeAt(0), 7);
  return items[Math.abs(n) % items.length];
}

export function render(root) {
  const t = today();
  const name = state.settings.name?.trim();
  const openTasks = state.todo.tasks.filter((x) => !x.done);
  const focus = sortTasks(openTasks.filter((x) => x.due && x.due <= t));
  const doneToday = state.todo.tasks.filter((x) => x.done && x.doneAt && new Date(x.doneAt).toDateString() === new Date().toDateString()).length;

  const habits = state.habits.items.filter((h) => !h.archived && isScheduled(h, t));
  const habitsDone = habits.filter((h) => isDone(h, t)).length;

  const goals = state.goals.items.filter((g) => g.status === 'active')
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));
  const avgGoal = goals.length ? Math.round(goals.reduce((s, g) => s + goalProgress(g), 0) / goals.length) : 0;

  const notes = [...state.notes.items].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 4);
  const vision = visionOfTheDay();
  const plan = entriesFor(t);

  root.innerHTML = `
    <div class="page dashboard">
      <header class="hero">
        <p class="hero-date">${parseKey(t).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1>${greeting()}${name ? `, ${esc(name)}` : ''}.</h1>
        <p class="muted">${focus.length ? `You have ${focus.length} task${focus.length === 1 ? '' : 's'} for today` : 'Your day is clear'}${habits.length ? ` and ${habits.length - habitsDone} habit${habits.length - habitsDone === 1 ? '' : 's'} to check off` : ''}.</p>
      </header>

      <div class="tiles">
        <a class="tile" href="#/todo"><span class="tile-icon" style="--c:#bf6a45">${icon('todo', 20)}</span>
          <div><strong>${focus.length}</strong><span>tasks for today · ${doneToday} done</span></div></a>
        <a class="tile" href="#/habits"><span class="tile-icon" style="--c:#7f9f73">${icon('habits', 20)}</span>
          <div><strong>${habitsDone}/${habits.length}</strong><span>habits done today</span></div></a>
        <a class="tile" href="#/goals"><span class="tile-icon" style="--c:#d4a24c">${icon('goals', 20)}</span>
          <div><strong>${goals.length ? avgGoal + '%' : '—'}</strong><span>${goals.length} active goal${goals.length === 1 ? '' : 's'}</span></div></a>
        <a class="tile" href="#/notes"><span class="tile-icon" style="--c:#6e90ab">${icon('notes', 20)}</span>
          <div><strong>${state.notes.items.length}</strong><span>notes</span></div></a>
      </div>

      <div class="dash-grid">
        <section class="card dash-tasks">
          <div class="card-head">
            <h2>${icon('sun', 18)} Today's focus</h2>
            <button class="btn ghost sm" data-act="add-task">${icon('plus', 15)} Add</button>
          </div>
          <div class="task-list">
            ${focus.slice(0, 8).map((task) => taskRow(task, { showList: true })).join('') || `<p class="muted pad">Nothing due today. <a href="#/todo">Plan something →</a></p>`}
          </div>
          ${focus.length > 8 ? `<a class="card-link" href="#/todo">See all ${focus.length} →</a>` : ''}
        </section>

        <section class="card dash-schedule">
          <div class="card-head">
            <h2>${icon('calendar', 18)} Today's schedule</h2>
            <a class="card-link" href="#/schedule">Week →</a>
          </div>
          ${plan.length ? `
            <div class="agenda">
              ${plan.map((e) => {
                const now = new Date().getHours();
                const when = now >= e.hour + e.duration ? 'past' : now >= e.hour ? 'now' : '';
                return `
                  <a class="agenda-item ${when} ${isEntryDone(e, t) ? 'done' : ''}" href="#/schedule" style="--c:${e.color}">
                    <button class="sch-check" data-entry="${e.id}" title="Mark as done">${icon('check', 13)}</button>
                    <span class="agenda-time">${hourLabel(e.hour)}–${hourLabel(e.hour + e.duration)}</span>
                    <span class="agenda-text">${esc(e.text)}</span>
                    ${when === 'now' ? '<span class="chip accent">Now</span>' : ''}
                  </a>`;
              }).join('')}
            </div>` : `<p class="muted pad">Nothing planned for today. <a href="#/schedule">Plan your day →</a></p>`}
        </section>

        <section class="card dash-habits">
          <div class="card-head">
            <h2>${icon('habits', 18)} Habits</h2>
            <a class="card-link" href="#/habits">Open →</a>
          </div>
          ${habits.length ? `
            <div class="habit-checks">
              ${habits.map((h) => `
                <button class="habit-check ${isDone(h, t) ? 'done' : ''}" data-habit="${h.id}" style="--hc:${h.color}">
                  <span class="habit-emoji">${esc(h.emoji)}</span>
                  <span class="habit-check-name">${esc(h.name)}</span>
                  <span class="muted small">🔥${currentStreak(h)}</span>
                  <span class="habit-tick">${icon('check', 15)}</span>
                </button>`).join('')}
            </div>` : `<p class="muted pad">No habits scheduled today. <a href="#/habits">Create one →</a></p>`}
        </section>

        <section class="card dash-vision">
          ${vision ? `
            <a href="#/vision" class="vision-day ${vision.type}" ${vision.type === 'quote' ? `style="--c:${vision.color}"` : ''}>
              ${vision.type === 'image'
                ? `<img src="${esc(vision.src)}" alt="">${vision.caption ? `<span class="vision-day-caption">${esc(vision.caption)}</span>` : ''}`
                : `<blockquote>${esc(vision.text)}</blockquote>${vision.caption ? `<cite>— ${esc(vision.caption)}</cite>` : ''}`}
              <span class="vision-day-label">${icon('vision', 14)} Vision of the day</span>
            </a>` : `
            <a href="#/vision" class="vision-day placeholder">
              <blockquote>“A goal without a vision is just a wish.”</blockquote>
              <span class="vision-day-label">${icon('vision', 14)} Build your vision board →</span>
            </a>`}
        </section>

        <section class="card dash-goals">
          <div class="card-head">
            <h2>${icon('goals', 18)} Goals in progress</h2>
            <a class="card-link" href="#/goals">All goals →</a>
          </div>
          ${goals.length ? goals.slice(0, 5).map((g) => `
            <a class="mini-goal" href="#/goals" style="--gc:${(CATEGORIES[g.category] || CATEGORIES.Other).color}">
              <div class="mini-goal-top">
                <span>${(CATEGORIES[g.category] || CATEGORIES.Other).emoji} ${esc(g.title)}</span>
                <span class="muted small">${deadlineLabel(g)}</span>
              </div>
              <div class="goal-progress"><div class="bar"><div style="width:${goalProgress(g)}%"></div></div><strong>${goalProgress(g)}%</strong></div>
            </a>`).join('') : `<p class="muted pad">No active goals. <a href="#/goals">Set one →</a></p>`}
        </section>

        <section class="card dash-notes">
          <div class="card-head">
            <h2>${icon('notes', 18)} Notes</h2>
            <a class="card-link" href="#/notes">All notes →</a>
          </div>
          <form class="quick-note" id="quick-note">
            <textarea name="body" rows="2" placeholder="Quick capture — an idea, a thought… (Ctrl+Enter to save)"></textarea>
            <button class="btn primary sm">Save note</button>
          </form>
          ${notes.map((n) => `
            <button class="mini-note" data-note="${n.id}">
              <strong>${esc(n.title || 'Untitled')}</strong>
              <span class="muted small">${timeAgo(n.updatedAt)}</span>
            </button>`).join('')}
        </section>
      </div>
    </div>`;

  root.addEventListener('click', (e) => {
    if (handleTaskClick(e)) return;
    if (e.target.closest('[data-act="add-task"]')) return openTaskModal(null, { due: t });
    const entryCheck = e.target.closest('[data-entry]');
    if (entryCheck) {
      e.preventDefault(); // the check sits inside a link to the schedule
      toggleEntryDone(state.schedule.items.find((x) => x.id === entryCheck.dataset.entry), t);
      return commit();
    }
    const habitBtn = e.target.closest('[data-habit]');
    if (habitBtn) {
      toggleHabit(state.habits.items.find((h) => h.id === habitBtn.dataset.habit), t);
      return commit();
    }
    const noteBtn = e.target.closest('[data-note]');
    if (noteBtn) { selectNote(noteBtn.dataset.note); location.hash = '#/notes'; }
  });

  const form = $('#quick-note', root);
  const save = () => {
    const body = form.body.value.trim();
    if (!body) return;
    const [first, ...rest] = body.split('\n');
    const short = first.length <= 60 && rest.length;
    state.notes.items.unshift({
      id: uid(), title: short ? first : '', body: short ? rest.join('\n').trim() : body,
      color: '', pinned: false, folderId: null, createdAt: Date.now(), updatedAt: Date.now(),
    });
    commit();
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); save(); });
  form.body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save(); });
}
