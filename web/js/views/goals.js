import { state, commit, refresh } from '../store.js';
import { $, $$, esc, icon, uid, today, diffDays, fmtDate, clamp, modal, confirmDialog, toast } from '../utils.js';
import { currentStreak } from './habits.js';

export const CATEGORIES = {
  Health: { emoji: '💪', color: '#7f9f73' },
  Career: { emoji: '💼', color: '#6e90ab' },
  Finance: { emoji: '💰', color: '#d4a24c' },
  Learning: { emoji: '📚', color: '#bf6a45' },
  Relationships: { emoji: '❤️', color: '#c46f6a' },
  Personal: { emoji: '🌱', color: '#5f958f' },
  Creative: { emoji: '🎨', color: '#a07a9e' },
  Travel: { emoji: '✈️', color: '#7aa5b6' },
  Other: { emoji: '⭐', color: '#9a8b7e' },
};
const category = (name) => CATEGORIES[name] || CATEGORIES.Other;

let tab = 'active';
let catFilter = 'all';
let refocus = null; // form to put the cursor back into after a re-render

export function goalProgress(g) {
  if (g.status === 'done') return 100;
  if (g.type === 'numeric') {
    const span = g.target - g.start;
    if (!span) return g.current >= g.target ? 100 : 0;
    return Math.round(clamp(((g.current - g.start) / span) * 100, 0, 100));
  }
  const ms = g.milestones || [];
  return ms.length ? Math.round((ms.filter((m) => m.done).length / ms.length) * 100) : 0;
}

export function deadlineLabel(g) {
  if (!g.deadline) return '';
  const days = diffDays(g.deadline, today());
  if (g.status === 'done') return `Due ${fmtDate(g.deadline)}`;
  if (days < 0) return `${-days} day${days === -1 ? '' : 's'} overdue`;
  if (days === 0) return 'Due today';
  if (days < 60) return `${days} day${days === 1 ? '' : 's'} left`;
  return `Due ${fmtDate(g.deadline)}`;
}

const fmtNum = (n) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

export function celebrate() {
  const layer = document.createElement('div');
  layer.className = 'confetti';
  const colors = ['#bf6a45', '#c46f6a', '#d4a24c', '#7f9f73', '#6e90ab', '#a07a9e'];
  for (let i = 0; i < 80; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + 'vw';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.6 + 's';
    p.style.animationDuration = 2 + Math.random() * 1.5 + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.append(p);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 4500);
}

function openGoalModal(goal = null) {
  const g = goal || { title: '', why: '', category: 'Personal', deadline: '', type: 'milestones', start: 0, current: 0, target: 100, unit: '' };
  modal({
    title: goal ? 'Edit goal' : 'New goal',
    wide: true,
    submitLabel: goal ? 'Save' : 'Create goal',
    body: `
      <label class="field"><span>What do you want to achieve?</span>
        <input name="title" value="${esc(g.title)}" required placeholder="e.g. Run a half marathon"></label>
      <label class="field"><span>Why does it matter to you?</span>
        <textarea name="why" rows="2" placeholder="Your reason will keep you going on hard days.">${esc(g.why)}</textarea></label>
      <div class="field-row">
        <label class="field"><span>Category</span><select name="category">
          ${Object.entries(CATEGORIES).map(([name, c]) => `<option value="${name}" ${name === g.category ? 'selected' : ''}>${c.emoji} ${name}</option>`).join('')}
        </select></label>
        <label class="field"><span>Target date</span><input type="date" name="deadline" value="${esc(g.deadline)}"></label>
      </div>
      <div class="field"><span>How will you measure progress?</span>
        <div class="segmented">
          <label><input type="radio" name="type" value="milestones" ${g.type !== 'numeric' ? 'checked' : ''}><span>${icon('todo', 16)} Milestones</span></label>
          <label><input type="radio" name="type" value="numeric" ${g.type === 'numeric' ? 'checked' : ''}><span>${icon('goals', 16)} A number</span></label>
        </div>
      </div>
      <div data-type="milestones">
        ${goal ? '<p class="muted small">Add and tick off milestones right on the goal card.</p>' : `
          <label class="field"><span>Milestones (one per line)</span>
            <textarea name="milestones" rows="4" placeholder="Run 5 km without stopping&#10;Run 10 km&#10;Sign up for the race"></textarea></label>`}
      </div>
      <div data-type="numeric" class="field-row three">
        <label class="field"><span>Start</span><input type="number" step="any" name="start" value="${g.start}"></label>
        <label class="field"><span>Target</span><input type="number" step="any" name="target" value="${g.target}"></label>
        <label class="field"><span>Unit</span><input name="unit" value="${esc(g.unit)}" placeholder="km, $, books…"></label>
      </div>`,
    onMount: (dlg) => {
      const sync = () => {
        const type = $('input[name=type]:checked', dlg).value;
        $$('[data-type]', dlg).forEach((el) => (el.hidden = el.dataset.type !== type));
      };
      $$('input[name=type]', dlg).forEach((r) => r.addEventListener('change', sync));
      sync();
    },
    onSubmit: (v) => {
      if (!v.title.trim()) return false;
      const fields = {
        title: v.title.trim(), why: v.why.trim(), category: v.category, deadline: v.deadline, type: v.type,
        start: +v.start || 0, target: +v.target || 0, unit: v.unit.trim(),
      };
      if (goal) {
        if (goal.type !== 'numeric' && fields.type === 'numeric' && goal.current == null) fields.current = fields.start;
        Object.assign(goal, fields);
      } else {
        state.goals.items.push({
          id: uid(), ...fields, current: fields.start, status: 'active', createdAt: Date.now(), log: [],
          milestones: (v.milestones || '').split('\n').map((s) => s.trim()).filter(Boolean)
            .map((title) => ({ id: uid(), title, done: false })),
        });
        tab = 'active';
      }
      commit();
    },
  });
}

function openProgressModal(goal) {
  modal({
    title: `Update: ${goal.title}`,
    submitLabel: 'Log progress',
    body: `
      <label class="field"><span>Current value${goal.unit ? ` (${esc(goal.unit)})` : ''}</span>
        <input type="number" step="any" name="value" value="${goal.current}" required autofocus></label>
      <p class="muted small">Target: ${fmtNum(goal.target)} ${esc(goal.unit)} · started at ${fmtNum(goal.start)}</p>
      <label class="field"><span>Note (optional)</span><input name="text" placeholder="What happened?"></label>`,
    onSubmit: (v) => {
      if (v.value === '') return false;
      const before = goalProgress(goal);
      goal.current = +v.value;
      goal.log.push({ id: uid(), date: today(), value: goal.current, text: v.text.trim() });
      if (before < 100 && goalProgress(goal) === 100) {
        celebrate();
        toast('Target reached! Mark the goal as achieved when you are ready.');
      }
      commit();
    },
  });
}

function goalCard(g) {
  const cat = category(g.category);
  const pct = goalProgress(g);
  const deadline = deadlineLabel(g);
  const overdue = g.deadline && g.status === 'active' && g.deadline < today();
  const habits = state.habits.items.filter((h) => h.goalId === g.id && !h.archived);
  const ms = g.milestones || [];

  return `
    <article class="goal-card ${g.status}" data-id="${g.id}" style="--gc:${cat.color}">
      <div class="goal-top">
        <span class="cat-chip">${cat.emoji} ${esc(g.category)}</span>
        ${deadline ? `<span class="chip ${overdue ? 'danger' : ''}">${icon('calendar', 13)}${deadline}</span>` : ''}
        <span class="spacer"></span>
        <span class="goal-actions">
          <button class="icon-btn sm" data-act="edit" title="Edit">${icon('edit', 15)}</button>
          <button class="icon-btn sm" data-act="${g.status === 'archived' ? 'unarchive' : 'archive'}" title="${g.status === 'archived' ? 'Restore' : 'Archive'}">${icon('archive', 15)}</button>
          <button class="icon-btn sm" data-act="delete" title="Delete">${icon('trash', 15)}</button>
        </span>
      </div>
      <h3 class="goal-title">${esc(g.title)}</h3>
      ${g.why ? `<p class="goal-why">${esc(g.why)}</p>` : ''}

      <div class="goal-progress">
        <div class="bar"><div style="width:${pct}%"></div></div>
        <strong>${pct}%</strong>
      </div>

      ${g.type === 'numeric' ? `
        <div class="goal-numeric">
          <div><span class="big">${fmtNum(g.current)}</span><span class="muted"> / ${fmtNum(g.target)} ${esc(g.unit)}</span></div>
          ${g.status === 'active' ? `<button class="btn ghost sm" data-act="progress">${icon('plus', 15)} Update</button>` : ''}
        </div>` : `
        <div class="milestones">
          ${ms.map((m) => `
            <div class="milestone ${m.done ? 'done' : ''}">
              <label><input type="checkbox" data-ms="${m.id}" ${m.done ? 'checked' : ''}><span>${esc(m.title)}</span></label>
              <button class="icon-btn xs hover-only" data-remove-ms="${m.id}" title="Remove">${icon('x', 13)}</button>
            </div>`).join('')}
          ${g.status === 'active' ? `
            <form class="inline-add" data-add-ms>
              <input name="title" placeholder="Add a milestone" autocomplete="off">
            </form>` : ''}
        </div>`}

      ${habits.length ? `
        <div class="goal-habits">
          ${habits.map((h) => `<a class="chip" href="#/habits">${esc(h.emoji)} ${esc(h.name)} · 🔥${currentStreak(h)}</a>`).join('')}
        </div>` : ''}

      <details class="goal-journal">
        <summary>${icon('note', 14)} Journal${g.log.length ? ` (${g.log.length})` : ''}</summary>
        <form class="inline-add" data-add-log>
          <input name="text" placeholder="Reflection, win or lesson…" autocomplete="off">
        </form>
        <ul>
          ${[...g.log].reverse().map((l) => `
            <li><span class="muted">${fmtDate(l.date)}</span>
              ${l.value != null ? `<strong>${fmtNum(l.value)} ${esc(g.unit)}</strong>` : ''} ${esc(l.text)}</li>`).join('')}
        </ul>
      </details>

      ${g.status === 'active' && pct === 100 ? `<button class="btn primary block" data-act="complete">🎉 Mark as achieved</button>` : ''}
      ${g.status === 'active' && pct < 100 ? `<button class="btn ghost block subtle" data-act="complete">${icon('check', 15)} Mark as achieved</button>` : ''}
      ${g.status === 'done' ? `<div class="achieved">🏆 Achieved ${g.completedAt ? fmtDate(g.completedAt) : ''} <button class="link" data-act="reopen">Reopen</button></div>` : ''}
    </article>`;
}

export function render(root) {
  const all = state.goals.items;
  const counts = {
    active: all.filter((g) => g.status === 'active').length,
    done: all.filter((g) => g.status === 'done').length,
    archived: all.filter((g) => g.status === 'archived').length,
  };
  const inTab = all.filter((g) => g.status === tab);
  const cats = [...new Set(inTab.map((g) => g.category))];
  if (catFilter !== 'all' && !cats.includes(catFilter)) catFilter = 'all';
  const shown = inTab
    .filter((g) => catFilter === 'all' || g.category === catFilter)
    .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));

  const active = all.filter((g) => g.status === 'active');
  const avg = active.length ? Math.round(active.reduce((s, g) => s + goalProgress(g), 0) / active.length) : 0;

  root.innerHTML = `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Goals</h1>
          <p class="muted">${counts.active ? `${counts.active} active · ${avg}% average progress · ${counts.done} achieved` : 'Decide what matters, then make it measurable.'}</p>
        </div>
        <div class="head-actions">
          <button class="btn primary" data-act="new">${icon('plus', 17)} New goal</button>
        </div>
      </header>

      <div class="tabs">
        ${[['active', 'Active'], ['done', 'Achieved'], ['archived', 'Archived']].map(([id, label]) =>
          `<button class="tab ${tab === id ? 'active' : ''}" data-tab="${id}">${label}<span class="tab-count">${counts[id]}</span></button>`).join('')}
        <span class="spacer"></span>
        ${cats.length > 1 ? `
          <div class="filter-chips">
            <button class="fchip ${catFilter === 'all' ? 'active' : ''}" data-cat="all">All</button>
            ${cats.map((c) => `<button class="fchip ${catFilter === c ? 'active' : ''}" data-cat="${esc(c)}">${category(c).emoji} ${esc(c)}</button>`).join('')}
          </div>` : ''}
      </div>

      ${shown.length ? `<div class="goal-grid">${shown.map(goalCard).join('')}</div>` : `
        <div class="empty big">
          <div class="empty-icon">${icon('goals', 40)}</div>
          <h3>${tab === 'active' ? 'No active goals yet' : tab === 'done' ? 'No achieved goals yet' : 'Nothing archived'}</h3>
          <p>${tab === 'active' ? 'Set a goal, break it into milestones, and link daily habits to it.' : 'They will appear here.'}</p>
          ${tab === 'active' ? `<button class="btn primary" data-act="new">${icon('plus', 16)} Create your first goal</button>` : ''}
        </div>`}
    </div>`;

  const find = (el) => all.find((g) => g.id === el.closest('.goal-card')?.dataset.id);

  root.addEventListener('click', (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) { tab = tabBtn.dataset.tab; return refresh(); }
    const catBtn = e.target.closest('[data-cat]');
    if (catBtn) { catFilter = catBtn.dataset.cat; return refresh(); }
    const removeMs = e.target.closest('[data-remove-ms]');
    if (removeMs) {
      const g = find(removeMs);
      g.milestones = g.milestones.filter((m) => m.id !== removeMs.dataset.removeMs);
      return commit();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'new') return openGoalModal();
    const g = find(e.target);
    switch (act) {
      case 'edit': return openGoalModal(g);
      case 'progress': return openProgressModal(g);
      case 'archive': g.status = 'archived'; return commit();
      case 'unarchive': g.status = 'active'; return commit();
      case 'reopen': g.status = 'active'; g.completedAt = null; return commit();
      case 'complete':
        g.status = 'done';
        g.completedAt = today();
        celebrate();
        toast(`Goal achieved: ${g.title} 🎉`);
        return commit();
      case 'delete':
        return confirmDialog(`Delete the goal "${g.title}" and its journal?`, () => {
          state.goals.items = all.filter((x) => x !== g);
          state.habits.items.forEach((h) => { if (h.goalId === g.id) h.goalId = ''; });
          commit();
        });
    }
  });

  root.addEventListener('change', (e) => {
    const id = e.target.dataset.ms;
    if (!id) return;
    const g = find(e.target);
    const m = g.milestones.find((x) => x.id === id);
    const before = goalProgress(g);
    m.done = e.target.checked;
    if (m.done) g.log.push({ id: uid(), date: today(), text: `✓ ${m.title}` });
    if (before < 100 && goalProgress(g) === 100) celebrate();
    commit();
  });

  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.target;
    const g = find(form);
    const text = form.elements[0].value.trim();
    if (!text) return;
    if (form.hasAttribute('data-add-ms')) {
      g.milestones.push({ id: uid(), title: text, done: false });
      refocus = `.goal-card[data-id="${g.id}"] [data-add-ms] input`;
    }
    if (form.hasAttribute('data-add-log')) {
      g.log.push({ id: uid(), date: today(), text });
      refocus = `.goal-card[data-id="${g.id}"] [data-add-log] input`;
    }
    commit();
  });

  if (refocus) {
    const input = $(refocus, root);
    input?.closest('details')?.setAttribute('open', '');
    input?.focus();
    refocus = null;
  }
}
