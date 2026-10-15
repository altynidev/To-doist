import { state, commit, refresh } from '../store.js';
import {
  $, $$, esc, icon, uid, today, addDays, parseKey, dateKey, fmtDate, WEEKDAYS,
  modal, confirmDialog, toast, colorPicker,
} from '../utils.js';

const EMOJIS = ['💧', '📚', '🏃', '🧘', '🥗', '💤', '✍️', '🎸', '🧹', '💊', '🙏', '🌅', '📵', '💪', '🧠', '🚶', '🍎', '💰', '🗣️', '🎨'];
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

let weekOffset = 0;
let showArchived = false;

// ---- Habit logic (also used by goals and the dashboard) ----

export const isScheduled = (h, key) => h.days.includes(parseKey(key).getDay());
export const isDone = (h, key) => !!h.log[key];

export function toggleHabit(h, key = today()) {
  if (h.log[key]) delete h.log[key];
  else h.log[key] = true;
}

function startKey(h) {
  const keys = Object.keys(h.log).sort();
  const created = dateKey(new Date(h.createdAt));
  return keys[0] && keys[0] < created ? keys[0] : created;
}

/** Consecutive scheduled days completed, counting back from today (today doesn't break it yet). */
export function currentStreak(h) {
  const t = today();
  const start = startKey(h);
  let key = isScheduled(h, t) && !isDone(h, t) ? addDays(t, -1) : t;
  let streak = 0;
  while (key >= start) {
    if (isDone(h, key)) streak++;
    else if (isScheduled(h, key)) break;
    key = addDays(key, -1);
  }
  return streak;
}

export function bestStreak(h) {
  const t = today();
  let best = 0;
  let run = 0;
  for (let key = startKey(h); key <= t; key = addDays(key, 1)) {
    if (isDone(h, key)) best = Math.max(best, ++run);
    else if (isScheduled(h, key) && key !== t) run = 0;
  }
  return best;
}

/** Completion rate over the last `days` days (only counting scheduled days since the habit started). */
export function completionRate(h, days = 30) {
  const t = today();
  const start = startKey(h);
  let scheduled = 0;
  let done = 0;
  for (let i = 0; i < days; i++) {
    const key = addDays(t, -i);
    if (key < start) break;
    if (!isScheduled(h, key)) continue;
    if (key === t && !isDone(h, key)) continue; // today isn't over yet
    scheduled++;
    if (isDone(h, key)) done++;
  }
  return scheduled ? Math.round((done / scheduled) * 100) : 0;
}

function scheduleLabel(days) {
  if (days.length === 7) return 'Every day';
  const set = days.join();
  if ([1, 2, 3, 4, 5].every((d) => days.includes(d)) && days.length === 5) return 'Weekdays';
  if (set === '0,6' || set === '6,0') return 'Weekends';
  return WEEK_ORDER.filter((d) => days.includes(d)).map((d) => WEEKDAYS[d]).join(', ');
}

// ---- Modals ----

function openHabitModal(habit = null) {
  const h = habit || { name: '', emoji: '💧', color: '#7f9f73', days: [0, 1, 2, 3, 4, 5, 6], goalId: '' };
  const goals = state.goals.items.filter((g) => g.status === 'active' || g.id === h.goalId);
  modal({
    title: habit ? 'Edit habit' : 'New habit',
    wide: true,
    submitLabel: habit ? 'Save' : 'Create habit',
    body: `
      <div class="field-row emoji-row">
        <label class="field emoji-field"><span>Icon</span><input name="emoji" value="${esc(h.emoji)}" maxlength="4"></label>
        <label class="field"><span>Habit</span><input name="name" value="${esc(h.name)}" required autofocus placeholder="e.g. Drink 2L of water"></label>
      </div>
      <div class="emoji-suggest">${EMOJIS.map((e) => `<button type="button" data-emoji="${e}">${e}</button>`).join('')}</div>
      <div class="field"><span>Repeat on</span>
        <div class="weekday-picker">
          ${WEEK_ORDER.map((d) => `<label><input type="checkbox" name="day" value="${d}" ${h.days.includes(d) ? 'checked' : ''}><span>${WEEKDAYS[d]}</span></label>`).join('')}
        </div>
        <div class="presets">
          <button type="button" class="link" data-preset="0,1,2,3,4,5,6">Every day</button>
          <button type="button" class="link" data-preset="1,2,3,4,5">Weekdays</button>
          <button type="button" class="link" data-preset="0,6">Weekends</button>
        </div>
      </div>
      <div class="field"><span>Color</span>${colorPicker('color', h.color)}</div>
      <label class="field"><span>Supports goal (optional)</span><select name="goalId">
        <option value="">— None —</option>
        ${goals.map((g) => `<option value="${g.id}" ${g.id === h.goalId ? 'selected' : ''}>${esc(g.title)}</option>`).join('')}
      </select></label>`,
    onMount: (dlg) => {
      dlg.addEventListener('click', (e) => {
        const emoji = e.target.closest('[data-emoji]')?.dataset.emoji;
        if (emoji) dlg.querySelector('input[name=emoji]').value = emoji;
        const preset = e.target.closest('[data-preset]')?.dataset.preset;
        if (preset) {
          const days = preset.split(',');
          $$('input[name=day]', dlg).forEach((c) => (c.checked = days.includes(c.value)));
        }
      });
    },
    onSubmit: (v, form) => {
      const days = $$('input[name=day]:checked', form).map((c) => +c.value);
      if (!v.name.trim()) return false;
      if (!days.length) { toast('Pick at least one day'); return false; }
      const fields = { name: v.name.trim(), emoji: v.emoji.trim() || '✅', color: v.color, days, goalId: v.goalId };
      if (habit) Object.assign(habit, fields);
      else state.habits.items.push({ id: uid(), ...fields, archived: false, createdAt: Date.now(), log: {} });
      commit();
    },
  });
}

function heatmap(h) {
  const t = today();
  const weeks = 26;
  // Start on the Monday `weeks` weeks ago.
  const offset = (parseKey(t).getDay() + 6) % 7;
  const start = addDays(t, -offset - (weeks - 1) * 7);
  const cols = [];
  for (let w = 0; w < weeks; w++) {
    const cells = [];
    for (let d = 0; d < 7; d++) {
      const key = addDays(start, w * 7 + d);
      const cls = key > t ? 'future' : isDone(h, key) ? 'done' : isScheduled(h, key) ? 'missed' : 'off';
      cells.push(`<button type="button" class="hm-cell ${cls}" data-key="${key}" title="${fmtDate(key, { weekday: 'short' })}" ${key > t ? 'disabled' : ''}></button>`);
    }
    cols.push(`<div class="hm-col">${cells.join('')}</div>`);
  }
  return `<div class="heatmap" style="--hc:${h.color}"><div class="hm-days">${WEEK_ORDER.map((d, i) => `<span>${i % 2 === 0 ? WEEKDAYS[d] : ''}</span>`).join('')}</div>${cols.join('')}</div>`;
}

function openHabitDetail(h) {
  const goal = state.goals.items.find((g) => g.id === h.goalId);
  const stats = () => `
    <div class="stat"><strong>🔥 ${currentStreak(h)}</strong><span>Current streak</span></div>
    <div class="stat"><strong>🏆 ${bestStreak(h)}</strong><span>Best streak</span></div>
    <div class="stat"><strong>${completionRate(h)}%</strong><span>Last 30 days</span></div>
    <div class="stat"><strong>${Object.keys(h.log).length}</strong><span>Total check-ins</span></div>`;
  const { dlg, close } = modal({
    title: `${h.emoji} ${h.name}`,
    wide: true,
    body: `
      <p class="muted">${scheduleLabel(h.days)}${goal ? ` · supports <a href="#/goals" data-close-link>${esc(goal.title)}</a>` : ''}</p>
      <div class="stats-row" id="habit-stats">${stats()}</div>
      <h4 class="section-label">Last 6 months <span class="muted small">— click a day to fix your history</span></h4>
      ${heatmap(h)}`,
    extraActions: `
      <button type="button" class="btn ghost sm" data-hact="edit">${icon('edit', 15)} Edit</button>
      <button type="button" class="btn ghost sm" data-hact="archive">${icon('archive', 15)} ${h.archived ? 'Restore' : 'Archive'}</button>
      <button type="button" class="btn ghost sm danger-text" data-hact="delete">${icon('trash', 15)} Delete</button>`,
  });
  dlg.addEventListener('close', () => refresh());
  dlg.addEventListener('click', (e) => {
    if (e.target.closest('[data-close-link]')) return close();
    const cell = e.target.closest('.hm-cell[data-key]');
    if (cell) {
      toggleHabit(h, cell.dataset.key);
      const key = cell.dataset.key;
      cell.className = `hm-cell ${isDone(h, key) ? 'done' : isScheduled(h, key) ? 'missed' : 'off'}`;
      $('#habit-stats', dlg).innerHTML = stats();
      commit({ render: false });
      return;
    }
    const act = e.target.closest('[data-hact]')?.dataset.hact;
    if (act === 'edit') { close(); openHabitModal(h); }
    if (act === 'archive') { h.archived = !h.archived; close(); commit(); }
    if (act === 'delete') {
      close();
      confirmDialog(`Delete "${h.name}" and all of its history?`, () => {
        state.habits.items = state.habits.items.filter((x) => x !== h);
        commit();
      });
    }
  });
}

// ---- View ----

export function render(root) {
  const t = today();
  const all = state.habits.items;
  const active = all.filter((h) => !h.archived);
  const archived = all.filter((h) => h.archived);

  const monday = addDays(t, -((parseKey(t).getDay() + 6) % 7) + weekOffset * 7);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const weekTitle = weekOffset === 0 ? 'This week' : weekOffset === -1 ? 'Last week' : `${fmtDate(week[0])} – ${fmtDate(week[6])}`;

  const dueToday = active.filter((h) => isScheduled(h, t));
  const doneToday = dueToday.filter((h) => isDone(h, t)).length;
  const pctToday = dueToday.length ? Math.round((doneToday / dueToday.length) * 100) : 0;
  const topStreak = Math.max(0, ...active.map(currentStreak));
  const avgRate = active.length ? Math.round(active.reduce((s, h) => s + completionRate(h), 0) / active.length) : 0;

  const row = (h) => `
    <div class="habit-row ${h.archived ? 'archived' : ''}" data-id="${h.id}" style="--hc:${h.color}">
      <button class="habit-name" data-act="detail">
        <span class="habit-emoji">${esc(h.emoji)}</span>
        <span><strong>${esc(h.name)}</strong><small>${scheduleLabel(h.days)}</small></span>
      </button>
      ${week.map((key) => {
        const future = key > t;
        const cls = isDone(h, key) ? 'done' : isScheduled(h, key) ? (key < t ? 'missed' : 'due') : 'off';
        return `<button class="habit-cell ${cls} ${key === t ? 'today' : ''}" data-key="${key}" ${future ? 'disabled' : ''} title="${fmtDate(key, { weekday: 'long' })}">${isDone(h, key) ? icon('check', 16) : ''}</button>`;
      }).join('')}
      <div class="habit-stat" title="Current streak">🔥 ${currentStreak(h)}</div>
      <div class="habit-stat muted" title="Completion, last 30 days">${completionRate(h)}%</div>
    </div>`;

  root.innerHTML = `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Habits</h1>
          <p class="muted">Small things, done daily, become who you are.</p>
        </div>
        <div class="head-actions">
          <button class="btn primary" data-act="new">${icon('plus', 17)} New habit</button>
        </div>
      </header>

      ${active.length ? `
        <div class="stats-row">
          <div class="stat ring-stat">
            <div class="ring" style="--p:${pctToday}"><span>${doneToday}/${dueToday.length}</span></div>
            <span>Done today</span>
          </div>
          <div class="stat"><strong>🔥 ${topStreak}</strong><span>Longest active streak</span></div>
          <div class="stat"><strong>${avgRate}%</strong><span>30-day consistency</span></div>
          <div class="stat"><strong>${active.length}</strong><span>Active habits</span></div>
        </div>

        <div class="card habit-table">
          <div class="habit-head">
            <div class="week-nav">
              <button class="icon-btn sm" data-week="-1" title="Previous week">${icon('left', 16)}</button>
              <strong>${weekTitle}</strong>
              <button class="icon-btn sm" data-week="1" title="Next week" ${weekOffset >= 0 ? 'disabled' : ''}>${icon('right', 16)}</button>
              ${weekOffset !== 0 ? '<button class="link" data-week="0">Today</button>' : ''}
            </div>
            ${week.map((key) => `<div class="day-head ${key === t ? 'today' : ''}"><span>${WEEKDAYS[parseKey(key).getDay()]}</span><b>${parseKey(key).getDate()}</b></div>`).join('')}
            <div class="day-head"><span>Streak</span></div>
            <div class="day-head"><span>30d</span></div>
          </div>
          ${active.map(row).join('')}
        </div>` : `
        <div class="empty big">
          <div class="empty-icon">${icon('habits', 40)}</div>
          <h3>Build your first habit</h3>
          <p>Track anything you want to do regularly — streaks and stats are calculated for you.</p>
          <button class="btn primary" data-act="new">${icon('plus', 16)} New habit</button>
        </div>`}

      ${archived.length ? `
        <button class="link archived-toggle" data-act="toggle-archived">${showArchived ? 'Hide' : 'Show'} archived (${archived.length})</button>
        ${showArchived ? `<div class="card habit-table">${archived.map(row).join('')}</div>` : ''}` : ''}
    </div>`;

  root.addEventListener('click', (e) => {
    const weekBtn = e.target.closest('[data-week]');
    if (weekBtn) {
      const d = +weekBtn.dataset.week;
      weekOffset = d === 0 ? 0 : Math.min(0, weekOffset + d);
      return refresh();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'new') return openHabitModal();
    if (act === 'toggle-archived') { showArchived = !showArchived; return refresh(); }
    const h = all.find((x) => x.id === e.target.closest('.habit-row')?.dataset.id);
    if (!h) return;
    if (act === 'detail') return openHabitDetail(h);
    const cell = e.target.closest('.habit-cell[data-key]');
    if (cell) {
      toggleHabit(h, cell.dataset.key);
      if (cell.dataset.key === t && isDone(h, t) && dueToday.every((x) => isDone(x, t))) {
        toast('All habits done for today — great job! 🌟');
      }
      commit();
    }
  });
}
