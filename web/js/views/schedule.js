import { state, commit, refresh } from '../store.js';
import { esc, icon, uid, today, addDays, parseKey, fmtDate, WEEKDAYS, modal, confirmDialog, colorPicker } from '../utils.js';

// Visible day range: one row per hour from START_HOUR up to (not including) END_HOUR.
export const START_HOUR = 6;
export const END_HOUR = 24;
const ROW = 54; // px per hour

let weekOffset = 0;

/*
 * Entry shapes in state.schedule.items:
 *   weekly:   { weekday: 0-6, date: null, from: 'YYYY-MM-DD', hour, duration, text, color }
 *   one-off:  { weekday: null, date: 'YYYY-MM-DD', hour, duration, text, color }
 *   override: one-off with `overrides: <weekly id>` — replaces that weekly entry on its date;
 *             with `skip: true` it just hides the weekly entry that day.
 */
const items = () => state.schedule.items;
const mondayOf = (key) => addDays(key, -((parseKey(key).getDay() + 6) % 7));
const dayName = (key) => WEEKDAYS[parseKey(key).getDay()];
export const hourLabel = (h) => `${String(h % 24).padStart(2, '0')}:00`;

/** Done is tracked per date, so a weekly entry can be done this week but not next. */
export const isEntryDone = (e, date) => !!e.doneOn?.[date];
export function toggleEntryDone(e, date) {
  e.doneOn ??= {};
  if (e.doneOn[date]) delete e.doneOn[date];
  else e.doneOn[date] = true;
}

/** Everything planned on a given date, sorted by start time. */
export function entriesFor(key, { includeSkipped = false } = {}) {
  const dow = parseKey(key).getDay();
  const dated = items().filter((i) => i.date === key);
  const replaced = new Set(dated.map((i) => i.overrides).filter(Boolean));
  const weekly = items().filter((i) =>
    i.weekday === dow && !i.date && (!i.from || i.from <= key) && !replaced.has(i.id));
  return [...weekly, ...dated]
    .filter((i) => includeSkipped || !i.skip)
    .sort((a, b) => a.hour - b.hour || b.duration - a.duration);
}

/** Puts overlapping entries side by side, like a calendar app. */
function layout(entries) {
  const placed = [];
  let cluster = [];
  let clusterEnd = -1;
  const closeCluster = () => {
    const lanes = Math.max(...cluster.map((p) => p.lane)) + 1;
    cluster.forEach((p) => (p.lanes = lanes));
    cluster = [];
    clusterEnd = -1;
  };
  for (const e of entries) {
    const end = e.hour + e.duration;
    if (cluster.length && e.hour >= clusterEnd) closeCluster();
    let lane = 0;
    while (cluster.some((p) => p.lane === lane && p.end > e.hour)) lane++;
    const p = { e, lane, end };
    cluster.push(p);
    placed.push(p);
    clusterEnd = Math.max(clusterEnd, end);
  }
  if (cluster.length) closeCluster();
  return placed;
}

function nowTop() {
  const now = new Date();
  return (now.getHours() + now.getMinutes() / 60 - START_HOUR) * ROW;
}
setInterval(() => {
  const line = document.querySelector('.now-line');
  if (line) line.style.top = `${nowTop()}px`;
}, 60_000);

function openEntryModal({ entry = null, date, hour = 9, week }) {
  const isWeekly = entry?.weekday != null;
  const e = entry || { text: '', hour, duration: 1, color: '#bf6a45' };
  const hours = [];
  for (let h = START_HOUR; h < END_HOUR; h++) hours.push(h);

  let extraActions = '';
  if (isWeekly) {
    extraActions = `
      <button type="button" class="btn ghost sm" data-mact="skip">Skip ${esc(fmtDate(date))}</button>
      <button type="button" class="btn ghost sm danger-text" data-mact="delete-all">${icon('trash', 15)} Every week</button>`;
  } else if (entry) {
    extraActions = `<button type="button" class="btn ghost sm danger-text" data-mact="delete">${icon('trash', 15)} Delete</button>`;
    if (entry.overrides) extraActions += `<button type="button" class="btn ghost sm" data-mact="delete">Restore weekly</button>`;
  }

  const { dlg, close } = modal({
    title: entry ? 'Edit plan' : 'Add to schedule',
    wide: true,
    submitLabel: entry ? 'Save' : 'Add',
    extraActions,
    body: `
      <label class="field"><span>What are you planning?</span>
        <textarea name="text" rows="2" required autofocus placeholder="e.g. Gym, Deep work, Lecture, Call mom">${esc(e.text)}</textarea></label>
      <div class="field-row three">
        <label class="field"><span>Day</span><select name="date">
          ${week.map((d) => `<option value="${d}" ${d === date ? 'selected' : ''}>${dayName(d)} ${fmtDate(d)}</option>`).join('')}
        </select></label>
        <label class="field"><span>From</span><select name="hour">
          ${hours.map((h) => `<option value="${h}" ${h === e.hour ? 'selected' : ''}>${hourLabel(h)}</option>`).join('')}
        </select></label>
        <label class="field"><span>Length</span><select name="duration">
          ${hours.map((_, i) => i + 1).map((n) => `<option value="${n}" ${n === e.duration ? 'selected' : ''}>${n} hour${n > 1 ? 's' : ''}</option>`).join('')}
        </select></label>
      </div>
      <div class="field"><span>Color</span>${colorPicker('color', e.color)}</div>
      ${isWeekly ? `
        <div class="field"><span>Apply changes to</span>
          <div class="segmented">
            <label><input type="radio" name="scope" value="all" checked><span>${icon('repeat', 15)} Every week</span></label>
            <label><input type="radio" name="scope" value="this"><span>Only ${esc(fmtDate(date))}</span></label>
          </div>
        </div>` : `
        <label class="check-row"><input type="checkbox" name="repeat"> <span>Repeat every week</span></label>`}`,
    onSubmit: (v) => {
      const text = v.text.trim();
      if (!text) return false;
      const start = +v.hour;
      const fields = { text, hour: start, duration: Math.min(+v.duration, END_HOUR - start), color: v.color };
      const dow = parseKey(v.date).getDay();

      if (!entry) {
        items().push(v.repeat
          ? { id: uid(), weekday: dow, date: null, from: mondayOf(v.date), ...fields }
          : { id: uid(), weekday: null, date: v.date, ...fields });
      } else if (isWeekly && v.scope === 'this') {
        if (v.date === date) {
          items().push({ id: uid(), weekday: null, date, overrides: entry.id, ...fields });
        } else {
          // Moved to another day this week: skip it here, add a one-off there.
          items().push({ ...entry, id: uid(), weekday: null, date, overrides: entry.id, skip: true });
          items().push({ id: uid(), weekday: null, date: v.date, ...fields });
        }
      } else if (isWeekly) {
        Object.assign(entry, fields, { weekday: dow });
      } else if (v.repeat) {
        Object.assign(entry, fields, { weekday: dow, date: null, from: mondayOf(v.date) });
        delete entry.overrides;
        delete entry.skip;
      } else {
        Object.assign(entry, fields, { date: v.date });
      }
      commit();
    },
  });

  dlg.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-mact]')?.dataset.mact;
    if (!act) return;
    close();
    if (act === 'delete') {
      state.schedule.items = items().filter((i) => i !== entry);
      commit();
    }
    if (act === 'skip') {
      items().push({ ...entry, id: uid(), weekday: null, date, overrides: entry.id, skip: true });
      commit();
    }
    if (act === 'delete-all') {
      confirmDialog(`Remove "${entry.text}" from every week?`, () => {
        state.schedule.items = items().filter((i) => i !== entry && i.overrides !== entry.id);
        commit();
      });
    }
  });
}

export function render(root) {
  const t = today();
  const monday = addDays(mondayOf(t), weekOffset * 7);
  const week = Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  const hours = [];
  for (let h = START_HOUR; h < END_HOUR; h++) hours.push(h);
  const weekTitle = weekOffset === 0 ? 'This week' : weekOffset === 1 ? 'Next week' : weekOffset === -1 ? 'Last week' : '';
  const openTasks = state.todo.tasks.filter((x) => !x.done);
  const weekEntries = week.flatMap((d) => entriesFor(d).map((e) => ({ e, d })));
  const planned = weekEntries.reduce((s, { e }) => s + e.duration, 0);
  const doneCount = weekEntries.filter(({ e, d }) => isEntryDone(e, d)).length;

  const block = ({ e, lane, lanes }, date) => `
    <div class="sch-block ${e.skip ? 'skipped' : ''} ${isEntryDone(e, date) ? 'done' : ''} ${e.duration === 1 ? 'short' : ''}" data-id="${e.id}" data-date="${date}"
      style="top:${(e.hour - START_HOUR) * ROW + 2}px;height:${e.duration * ROW - 4}px;left:calc(${lane} * 100% / ${lanes} + 3px);width:calc(100% / ${lanes} - 6px);--c:${e.color}"
      title="${esc(e.text)}">
      <div class="sch-row">
        ${e.skip ? '' : `<button class="sch-check" data-done title="${isEntryDone(e, date) ? 'Mark as not done' : 'Mark as done'}">${icon('check', 11)}</button>`}
        <strong>${esc(e.text)}</strong>
      </div>
      <span>${hourLabel(e.hour)}–${hourLabel(e.hour + e.duration)}${e.weekday != null || e.overrides ? ` ${icon('repeat', 11)}` : ''}${e.skip ? ' · skipped' : ''}</span>
    </div>`;

  root.innerHTML = `
    <div class="page wide">
      <header class="page-head">
        <div>
          <h1>Schedule</h1>
          <p class="muted">${fmtDate(week[0])} – ${fmtDate(week[6])} · ${planned} hour${planned === 1 ? '' : 's'} planned${weekEntries.length ? ` · ${doneCount}/${weekEntries.length} done` : ''} · click any empty slot to add</p>
        </div>
        <div class="head-actions">
          <div class="week-nav">
            <button class="icon-btn sm" data-week="-1" title="Previous week">${icon('left', 16)}</button>
            <strong>${weekTitle || `${fmtDate(week[0])}`}</strong>
            <button class="icon-btn sm" data-week="1" title="Next week">${icon('right', 16)}</button>
            ${weekOffset !== 0 ? '<button class="link" data-week="0">Today</button>' : ''}
          </div>
          <button class="btn primary" data-act="new">${icon('plus', 17)} Add</button>
        </div>
      </header>

      <div class="card schedule-card">
        <div class="schedule" style="--row:${ROW}px">
          <div class="sch-corner"></div>
          ${week.map((d) => {
            const due = openTasks.filter((x) => x.due === d).length;
            return `
              <div class="sch-day-head ${d === t ? 'today' : ''}">
                <span>${dayName(d)}</span><b>${parseKey(d).getDate()}</b>
                ${due ? `<a class="sch-tasks" href="#/todo" title="Tasks due">${icon('todo', 12)} ${due}</a>` : ''}
              </div>`;
          }).join('')}

          <div class="sch-times">${hours.map((h) => `<div class="sch-time"><span>${hourLabel(h)}</span></div>`).join('')}</div>
          ${week.map((d) => `
            <div class="sch-col ${d === t ? 'today' : ''}" data-date="${d}">
              ${hours.map((h) => `<button class="sch-slot" data-hour="${h}" aria-label="Add at ${hourLabel(h)} on ${dayName(d)}"></button>`).join('')}
              ${layout(entriesFor(d, { includeSkipped: true })).map((p) => block(p, d)).join('')}
              ${d === t && nowTop() >= 0 && nowTop() <= hours.length * ROW ? `<div class="now-line" style="top:${nowTop()}px"></div>` : ''}
            </div>`).join('')}
        </div>
      </div>
    </div>`;

  root.addEventListener('click', (e) => {
    const weekBtn = e.target.closest('[data-week]');
    if (weekBtn) {
      const d = +weekBtn.dataset.week;
      weekOffset = d === 0 ? 0 : weekOffset + d;
      return refresh();
    }
    if (e.target.closest('[data-act="new"]')) {
      const date = week.includes(t) ? t : week[0];
      const hour = Math.min(Math.max(new Date().getHours() + 1, START_HOUR), END_HOUR - 1);
      return openEntryModal({ date, hour, week });
    }
    const blockEl = e.target.closest('.sch-block');
    if (blockEl) {
      const entry = items().find((i) => i.id === blockEl.dataset.id);
      if (e.target.closest('[data-done]')) {
        toggleEntryDone(entry, blockEl.dataset.date);
        return commit();
      }
      if (entry.skip) {
        return confirmDialog(`Bring back "${entry.text}" on ${fmtDate(blockEl.dataset.date)}?`, () => {
          state.schedule.items = items().filter((i) => i !== entry);
          commit();
        }, { title: 'Restore', label: 'Restore' });
      }
      return openEntryModal({ entry, date: blockEl.dataset.date, week });
    }
    const slot = e.target.closest('.sch-slot');
    if (slot) openEntryModal({ date: slot.closest('.sch-col').dataset.date, hour: +slot.dataset.hour, week });
  });
}
