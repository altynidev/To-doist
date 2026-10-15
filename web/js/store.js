// App state: loaded from the local server, saved back automatically after every change.

import { uid, toast } from './utils.js';

export let state = null;
// The server's revision our copy is based on; a save from an outdated copy is refused.
let rev = null;

const listeners = new Set();
let saveTimer = null;
let saving = false;
let saveAgain = false;
let dirty = false;

export function defaultState() {
  return {
    version: 1,
    settings: { name: '', theme: 'system', ai: { provider: 'ollama', ollamaModel: '', geminiModel: '' } },
    todo: {
      lists: [{ id: 'inbox', name: 'Inbox', color: '#bf6a45' }],
      tasks: [],
    },
    notes: { folders: [], items: [] },
    vision: {
      boards: [{ id: uid(), name: 'My Vision' }],
      items: [],
    },
    goals: { items: [] },
    habits: { items: [] },
    schedule: { items: [] },
  };
}

// The app's first palette was bright; saved colors are moved to the warm palette on load.
const OLD_COLORS = {
  '#6d5efc': '#bf6a45', '#ef5b5b': '#c46f6a', '#f59f00': '#d4a24c', '#2fb380': '#7f9f73',
  '#1c9ad6': '#6e90ab', '#d63fa3': '#a07a9e', '#7b8794': '#9a8b7e', '#14b8a6': '#5f958f',
};
function recolor(node) {
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string' && OLD_COLORS[v.toLowerCase()]) node[k] = OLD_COLORS[v.toLowerCase()];
    else if (v && typeof v === 'object') recolor(v);
  }
}

/** Fills in anything missing (e.g. data saved by an older version). */
function migrate(s) {
  recolor(s);
  const d = defaultState();
  for (const [key, value] of Object.entries(d)) {
    if (s[key] == null) s[key] = value;
    else if (typeof value === 'object' && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value)) if (s[key][k] == null) s[key][k] = v;
    }
  }
  if (!s.todo.lists.some((l) => l.id === 'inbox')) s.todo.lists.unshift(d.todo.lists[0]);
  if (!s.vision.boards.length) s.vision.boards.push(d.vision.boards[0]);
  return s;
}

export async function load() {
  const res = await fetch('/api/data', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Server answered ${res.status}`);
  rev = res.headers.get('X-Rev');
  const data = await res.json();
  state = migrate(data ?? defaultState());
  if (!data) await flush();
}

/** Picks up changes saved by another device (e.g. your phone) while nothing is being edited here. */
async function pullRemote() {
  if (document.hidden || dirty || saving || !state) return;
  try {
    const { rev: latest } = await (await fetch('/api/rev', { cache: 'no-store' })).json();
    if (String(latest) === rev || dirty || saving || isEditing()) return;
    const res = await fetch('/api/data', { cache: 'no-store' });
    if (!res.ok || dirty || saving) return;
    rev = res.headers.get('X-Rev');
    state = migrate(await res.json());
    refresh();
  } catch { /* server unreachable; try again later */ }
}

// Re-rendering would throw away whatever is being typed or edited in a dialog.
// (An empty focused box, like quick-add after adding a task, doesn't count.)
function isEditing() {
  const el = document.activeElement;
  if (document.querySelector('dialog[open]')) return true;
  if (el?.matches('textarea, [contenteditable]')) return true;
  return !!el?.matches('input:not([type=checkbox]):not([type=radio])') && el.value !== '';
}

export function startSync() {
  setInterval(pullRemote, 10000);
  document.addEventListener('visibilitychange', pullRemote);
  window.addEventListener('focus', pullRemote);
}

export function replaceState(next) {
  state = migrate(next);
  commit();
}

export function onChange(fn) {
  listeners.add(fn);
}

/** Re-render without saving (for view-only changes like switching tabs). */
export function refresh() {
  listeners.forEach((fn) => fn());
}

/** Call after mutating `state`. Saves (debounced) and re-renders unless render is false. */
export function commit({ render = true } = {}) {
  dirty = true;
  setStatus('pending');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 400);
  if (render) listeners.forEach((fn) => fn());
}

export async function flush() {
  clearTimeout(saveTimer);
  if (saving) { saveAgain = true; return; }
  saving = true;
  dirty = false;
  setStatus('saving');
  try {
    const res = await fetch(`/api/data?rev=${rev ?? ''}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(state),
    });
    if (res.status === 409) {
      // Another device saved first: switch to its version rather than overwrite it.
      rev = res.headers.get('X-Rev');
      state = migrate(await res.json());
      dirty = false;
      saveAgain = false;
      clearTimeout(saveTimer);
      setStatus('saved');
      refresh();
      toast('Changed on another device at the same time, so your last edit was not saved. Showing the latest version.', { timeout: 7000 });
      return;
    }
    if (!res.ok) throw new Error(await res.text());
    rev = String((await res.json()).rev);
    setStatus(dirty ? 'pending' : 'saved');
  } catch (err) {
    dirty = true;
    setStatus('error');
    console.error('Save failed', err);
    // Keep an emergency copy in the browser so nothing is lost if the server is down.
    try { localStorage.setItem('todoist-emergency-backup', JSON.stringify(state)); } catch { /* full or blocked */ }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 5000);
  } finally {
    saving = false;
    if (saveAgain) { saveAgain = false; flush(); }
  }
}

// Last-chance save when the tab is closed with unsaved changes.
window.addEventListener('pagehide', () => {
  if (!dirty || !state) return;
  navigator.sendBeacon(`/api/data?rev=${rev ?? ''}`, new Blob([JSON.stringify(state)], { type: 'application/json' }));
});

const STATUS_LABELS = { pending: 'Unsaved…', saving: 'Saving…', saved: 'Saved', error: 'Not saved — is the server running?' };
function setStatus(kind) {
  const el = document.getElementById('save-status');
  if (!el) return;
  el.dataset.state = kind;
  el.querySelector('.label').textContent = STATUS_LABELS[kind];
}
