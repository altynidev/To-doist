import { state, commit, refresh } from '../store.js';
import {
  $, esc, icon, uid, today, addDays, addMonths, parseKey, relDate, fmtDate,
  modal, confirmDialog, toast, colorPicker,
} from '../utils.js';

export const PRIORITIES = {
  1: { label: 'Urgent', color: '#c46f6a' },
  2: { label: 'High', color: '#d4a24c' },
  3: { label: 'Medium', color: '#6e90ab' },
  4: { label: 'No priority', color: '' },
};
const REPEATS = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekdays: 'Every weekday',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
};

let view = { type: 'smart', id: 'today' };
let showCompleted = false;
let focusQuickAdd = false;

// ---- Task logic (also used by the dashboard) ----

function nextDue(key, repeat) {
  switch (repeat) {
    case 'daily': return addDays(key, 1);
    case 'weekly': return addDays(key, 7);
    case 'monthly': return addMonths(key, 1);
    case 'yearly': return addMonths(key, 12);
    case 'weekdays': {
      let next = addDays(key, 1);
      while ([0, 6].includes(parseKey(next).getDay())) next = addDays(next, 1);
      return next;
    }
    default: return key;
  }
}

export function toggleTask(task) {
  if (!task.done && task.repeat && task.repeat !== 'none') {
    // Repeating task: move it to its next occurrence instead of completing it.
    let due = nextDue(task.due || today(), task.repeat);
    while (due <= today()) due = nextDue(due, task.repeat);
    task.due = due;
    (task.subtasks || []).forEach((s) => (s.done = false));
    task.completions = (task.completions || 0) + 1;
    toast(`Nice! Next one: ${relDate(due)}`);
  } else {
    task.done = !task.done;
    task.doneAt = task.done ? Date.now() : null;
  }
  commit();
}

export function sortTasks(tasks) {
  return [...tasks].sort((a, b) =>
    (a.due || '9999') .localeCompare(b.due || '9999') ||
    a.priority - b.priority ||
    a.createdAt - b.createdAt);
}

function deleteTask(task) {
  const tasks = state.todo.tasks;
  const index = tasks.indexOf(task);
  tasks.splice(index, 1);
  commit();
  toast('Task deleted', {
    action: 'Undo',
    onAction: () => { tasks.splice(index, 0, task); commit(); },
  });
}

export function taskRow(task, { showList = false } = {}) {
  const t = today();
  const list = state.todo.lists.find((l) => l.id === task.listId);
  const overdue = task.due && task.due < t && !task.done;
  const subs = task.subtasks || [];
  const subsDone = subs.filter((s) => s.done).length;
  const pColor = PRIORITIES[task.priority]?.color;
  return `
    <div class="task ${task.done ? 'done' : ''}" data-id="${task.id}">
      <button class="check" data-act="toggle" style="${pColor ? `--pc:${pColor}` : ''}" aria-label="Toggle complete">${icon('check', 13)}</button>
      <div class="task-main" data-act="edit">
        <div class="task-title">${esc(task.title)}</div>
        <div class="task-meta">
          ${task.due ? `<span class="chip ${overdue ? 'danger' : task.due === t ? 'accent' : ''}">${icon('calendar', 13)}${esc(relDate(task.due))}</span>` : ''}
          ${task.repeat && task.repeat !== 'none' ? `<span class="chip">${icon('repeat', 13)}${esc(REPEATS[task.repeat])}</span>` : ''}
          ${pColor ? `<span class="chip" style="color:${pColor}">${icon('flag', 13)}${PRIORITIES[task.priority].label}</span>` : ''}
          ${subs.length ? `<span class="chip">${icon('todo', 13)}${subsDone}/${subs.length}</span>` : ''}
          ${task.notes ? `<span class="chip" title="Has notes">${icon('note', 13)}</span>` : ''}
          ${showList && list ? `<span class="chip"><i class="dot" style="background:${list.color}"></i>${esc(list.name)}</span>` : ''}
        </div>
      </div>
      <button class="icon-btn hover-only" data-act="delete" title="Delete">${icon('trash', 16)}</button>
    </div>`;
}

/** Click handling for task rows; returns true if the click was handled. */
export function handleTaskClick(e) {
  const row = e.target.closest('.task[data-id]');
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!row || !act) return false;
  const task = state.todo.tasks.find((x) => x.id === row.dataset.id);
  if (!task) return false;
  if (act === 'toggle') {
    row.classList.add('completing');
    setTimeout(() => toggleTask(task), task.done ? 0 : 180);
  } else if (act === 'edit') openTaskModal(task);
  else if (act === 'delete') deleteTask(task);
  else return false;
  return true;
}

export function openTaskModal(task = null, defaults = {}) {
  const isNew = !task;
  const draft = task
    ? structuredClone(task)
    : { title: '', notes: '', due: '', priority: 4, listId: 'inbox', repeat: 'none', subtasks: [], ...defaults };
  const subs = draft.subtasks || [];

  modal({
    title: isNew ? 'New task' : 'Edit task',
    wide: true,
    submitLabel: isNew ? 'Add task' : 'Save',
    body: `
      <label class="field"><span>Title</span><input name="title" value="${esc(draft.title)}" required autofocus></label>
      <label class="field"><span>Notes</span><textarea name="notes" rows="3" placeholder="Details, links, ideas…">${esc(draft.notes)}</textarea></label>
      <div class="field-row">
        <label class="field"><span>Due date</span><input type="date" name="due" value="${esc(draft.due)}"></label>
        <label class="field"><span>Priority</span><select name="priority">
          ${Object.entries(PRIORITIES).map(([k, p]) => `<option value="${k}" ${+k === +draft.priority ? 'selected' : ''}>${p.label}</option>`).join('')}
        </select></label>
      </div>
      <div class="field-row">
        <label class="field"><span>List</span><select name="listId">
          ${state.todo.lists.map((l) => `<option value="${l.id}" ${l.id === draft.listId ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}
        </select></label>
        <label class="field"><span>Repeat</span><select name="repeat">
          ${Object.entries(REPEATS).map(([k, label]) => `<option value="${k}" ${k === (draft.repeat || 'none') ? 'selected' : ''}>${label}</option>`).join('')}
        </select></label>
      </div>
      <div class="field"><span>Subtasks</span>
        <div class="subtasks" id="subtasks"></div>
        <div class="inline-add">
          <input id="new-sub" placeholder="Add a subtask and press Enter">
          <button type="button" class="btn ghost sm" id="add-sub">${icon('plus', 16)}</button>
        </div>
      </div>`,
    onMount: (dlg) => {
      const box = $('#subtasks', dlg);
      const input = $('#new-sub', dlg);
      const draw = () => {
        box.innerHTML = subs.map((s, i) => `
          <div class="subtask ${s.done ? 'done' : ''}">
            <label><input type="checkbox" data-i="${i}" ${s.done ? 'checked' : ''}><span>${esc(s.title)}</span></label>
            <button type="button" class="icon-btn sm" data-remove="${i}">${icon('x', 14)}</button>
          </div>`).join('');
      };
      const add = () => {
        const title = input.value.trim();
        if (!title) return;
        subs.push({ id: uid(), title, done: false });
        input.value = '';
        draw();
      };
      box.addEventListener('change', (e) => {
        const i = e.target.dataset.i;
        if (i != null) { subs[i].done = e.target.checked; draw(); }
      });
      box.addEventListener('click', (e) => {
        const i = e.target.closest('[data-remove]')?.dataset.remove;
        if (i != null) { subs.splice(i, 1); draw(); }
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      $('#add-sub', dlg).onclick = add;
      draw();
    },
    onSubmit: (v) => {
      const pendingSub = document.querySelector('#new-sub')?.value.trim();
      if (pendingSub) subs.push({ id: uid(), title: pendingSub, done: false });
      const fields = {
        title: v.title.trim(),
        notes: v.notes.trim(),
        due: v.due,
        priority: +v.priority,
        listId: v.listId,
        repeat: v.repeat,
        subtasks: subs,
      };
      if (!fields.title) return false;
      if (isNew) {
        state.todo.tasks.push({ id: uid(), done: false, doneAt: null, createdAt: Date.now(), ...fields });
      } else {
        Object.assign(task, fields);
      }
      commit();
    },
  });
}

function openListModal(list = null) {
  modal({
    title: list ? 'Edit list' : 'New list',
    body: `
      <label class="field"><span>Name</span><input name="name" value="${esc(list?.name)}" required placeholder="e.g. Work, Groceries, Uni"></label>
      <div class="field"><span>Color</span>${colorPicker('color', list?.color || '#6e90ab')}</div>`,
    onSubmit: (v) => {
      if (!v.name.trim()) return false;
      if (list) Object.assign(list, { name: v.name.trim(), color: v.color });
      else {
        const created = { id: uid(), name: v.name.trim(), color: v.color };
        state.todo.lists.push(created);
        view = { type: 'list', id: created.id };
      }
      commit();
    },
  });
}

// ---- View ----

export function render(root) {
  const t = today();
  const { lists, tasks } = state.todo;
  const open = tasks.filter((x) => !x.done);
  if (view.type === 'list' && !lists.some((l) => l.id === view.id)) view = { type: 'smart', id: 'today' };

  const smart = [
    { id: 'today', label: 'Today', icon: 'sun', count: open.filter((x) => x.due && x.due <= t).length },
    { id: 'upcoming', label: 'Upcoming', icon: 'calendar', count: open.filter((x) => x.due && x.due > t).length },
    { id: 'all', label: 'All tasks', icon: 'list', count: open.length },
    { id: 'completed', label: 'Completed', icon: 'done', count: tasks.length - open.length },
  ];
  const isActive = (type, id) => view.type === type && view.id === id;
  const currentList = view.type === 'list' ? lists.find((l) => l.id === view.id) : null;

  let title;
  let subtitle = '';
  let groups = [];
  let showList = true;

  if (view.type === 'list') {
    title = currentList.name;
    showList = false;
    const mine = tasks.filter((x) => x.listId === currentList.id);
    groups = [{ title: '', tasks: sortTasks(mine.filter((x) => !x.done)) }];
    const done = mine.filter((x) => x.done).sort((a, b) => b.doneAt - a.doneAt);
    if (done.length) groups.push({ title: `Completed (${done.length})`, tasks: showCompleted ? done : [], toggle: true });
    subtitle = `${groups[0].tasks.length} open`;
  } else if (view.id === 'today') {
    title = 'Today';
    subtitle = parseKey(t).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    groups = [
      { title: 'Overdue', tasks: sortTasks(open.filter((x) => x.due && x.due < t)), danger: true },
      { title: 'Today', tasks: sortTasks(open.filter((x) => x.due === t)) },
    ];
  } else if (view.id === 'upcoming') {
    title = 'Upcoming';
    const byDate = new Map();
    for (const task of sortTasks(open.filter((x) => x.due && x.due > t))) {
      if (!byDate.has(task.due)) byDate.set(task.due, []);
      byDate.get(task.due).push(task);
    }
    groups = [...byDate].map(([due, list]) => ({
      title: `${relDate(due)} · ${fmtDate(due, { weekday: 'short' })}`, tasks: list,
    }));
  } else if (view.id === 'all') {
    title = 'All tasks';
    groups = [
      { title: 'Overdue', tasks: sortTasks(open.filter((x) => x.due && x.due < t)), danger: true },
      { title: 'Today', tasks: sortTasks(open.filter((x) => x.due === t)) },
      { title: 'Later', tasks: sortTasks(open.filter((x) => x.due && x.due > t)) },
      { title: 'No date', tasks: sortTasks(open.filter((x) => !x.due)) },
    ];
  } else {
    title = 'Completed';
    groups = [{ title: '', tasks: tasks.filter((x) => x.done).sort((a, b) => b.doneAt - a.doneAt) }];
  }

  const visibleGroups = groups.filter((g) => g.tasks.length || g.toggle || (g.title === 'Today' && view.id === 'today'));
  const hasAny = groups.some((g) => g.tasks.length || g.toggle);
  const defaultDue = view.id === 'today' && view.type === 'smart' ? t : '';

  root.innerHTML = `
    <div class="split">
      <aside class="subnav">
        ${smart.map((s) => `
          <button class="subnav-item ${isActive('smart', s.id) ? 'active' : ''}" data-view="smart:${s.id}">
            ${icon(s.icon, 17)}<span>${s.label}</span>${s.count ? `<em>${s.count}</em>` : ''}
          </button>`).join('')}
        <div class="subnav-title">Lists
          <button class="icon-btn sm" data-act="new-list" title="New list">${icon('plus', 16)}</button>
        </div>
        ${lists.map((l) => `
          <button class="subnav-item ${isActive('list', l.id) ? 'active' : ''}" data-view="list:${l.id}">
            ${l.id === 'inbox' ? icon('inbox', 17) : `<i class="dot lg" style="background:${l.color}"></i>`}
            <span>${esc(l.name)}</span>
            ${open.filter((x) => x.listId === l.id).length ? `<em>${open.filter((x) => x.listId === l.id).length}</em>` : ''}
          </button>`).join('')}
      </aside>

      <section class="content">
        <header class="page-head">
          <div>
            <h1>${esc(title)}</h1>
            ${subtitle ? `<p class="muted">${esc(subtitle)}</p>` : ''}
          </div>
          <div class="head-actions">
            ${currentList && currentList.id !== 'inbox' ? `
              <button class="btn ghost sm" data-act="edit-list">${icon('edit', 16)} Edit list</button>
              <button class="btn ghost sm" data-act="delete-list">${icon('trash', 16)}</button>` : ''}
            ${view.id === 'completed' && groups[0].tasks.length ? `<button class="btn ghost sm" data-act="clear-done">${icon('trash', 16)} Clear all</button>` : ''}
          </div>
        </header>

        ${view.id !== 'completed' ? `
          <form class="quick-add" id="quick-add">
            <span class="quick-icon">${icon('plus', 18)}</span>
            <input name="title" placeholder="Add a task — press Enter to save" autocomplete="off">
            <input type="date" name="due" value="${defaultDue}" title="Due date">
            <select name="priority" title="Priority">
              ${Object.entries(PRIORITIES).map(([k, p]) => `<option value="${k}" ${k === '4' ? 'selected' : ''}>${k === '4' ? 'Priority' : p.label}</option>`).join('')}
            </select>
            <button class="btn primary sm">Add</button>
          </form>` : ''}

        <div class="task-groups">
          ${visibleGroups.map((g) => `
            <div class="task-group">
              ${g.title ? `<h3 class="group-title ${g.danger ? 'danger' : ''}" ${g.toggle ? 'data-act="toggle-completed"' : ''}>
                ${g.toggle ? `<span class="chev ${showCompleted ? 'open' : ''}">${icon('right', 14)}</span>` : ''}${esc(g.title)}
                ${!g.toggle ? `<span class="count">${g.tasks.length}</span>` : ''}</h3>` : ''}
              ${g.tasks.map((task) => taskRow(task, { showList })).join('')}
            </div>`).join('')}
          ${!hasAny ? emptyState() : ''}
        </div>
      </section>
    </div>`;

  const form = $('#quick-add', root);
  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    if (!v.title.trim()) return;
    state.todo.tasks.push({
      id: uid(), title: v.title.trim(), notes: '', due: v.due, priority: +v.priority,
      listId: currentList?.id || 'inbox', repeat: 'none', subtasks: [],
      done: false, doneAt: null, createdAt: Date.now(),
    });
    focusQuickAdd = true;
    commit();
  });
  if (focusQuickAdd) { $('input[name=title]', root)?.focus(); focusQuickAdd = false; }

  root.addEventListener('click', (e) => {
    if (handleTaskClick(e)) return;
    const viewBtn = e.target.closest('[data-view]');
    if (viewBtn) {
      const [type, id] = viewBtn.dataset.view.split(':');
      view = { type, id };
      showCompleted = false;
      return refresh();
    }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'new-list') openListModal();
    if (act === 'edit-list') openListModal(currentList);
    if (act === 'toggle-completed') { showCompleted = !showCompleted; refresh(); }
    if (act === 'delete-list') {
      const count = tasks.filter((x) => x.listId === currentList.id).length;
      confirmDialog(`Delete the list "${currentList.name}"${count ? ` and its ${count} task(s)` : ''}?`, () => {
        state.todo.lists = lists.filter((l) => l !== currentList);
        state.todo.tasks = tasks.filter((x) => x.listId !== currentList.id);
        commit();
      });
    }
    if (act === 'clear-done') {
      confirmDialog('Permanently remove all completed tasks?', () => {
        state.todo.tasks = tasks.filter((x) => !x.done);
        commit();
      });
    }
  });
}

function emptyState() {
  const messages = {
    today: ['Nothing due today', 'Enjoy the calm — or plan something above.'],
    upcoming: ['Nothing scheduled', 'Tasks with a future due date show up here.'],
    all: ['No open tasks', 'Add your first task above.'],
    completed: ['Nothing completed yet', 'Finished tasks will collect here.'],
  };
  const [h, p] = view.type === 'list' ? ['This list is empty', 'Add a task above to get started.'] : messages[view.id];
  return `<div class="empty"><div class="empty-icon">${icon('done', 34)}</div><h3>${h}</h3><p>${p}</p></div>`;
}
