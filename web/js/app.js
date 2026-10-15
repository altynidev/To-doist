import { load, onChange, startSync, state } from './store.js';
import { $, icon, esc } from './utils.js';
import * as dashboard from './views/dashboard.js';
import * as todo from './views/todo.js';
import * as schedule from './views/schedule.js';
import * as notes from './views/notes.js';
import * as vision from './views/vision.js';
import * as goals from './views/goals.js';
import * as habits from './views/habits.js';
import * as settings from './views/settings.js';
import * as assistant from './views/assistant.js';

const ROUTES = [
  { id: 'dashboard', label: 'Dashboard', icon: 'home', view: dashboard },
  { id: 'assistant', label: 'Assistant', icon: 'sparkle', view: assistant },
  { id: 'todo', label: 'To-Do', icon: 'todo', view: todo },
  { id: 'schedule', label: 'Schedule', icon: 'calendar', view: schedule },
  { id: 'notes', label: 'Notes', icon: 'notes', view: notes },
  { id: 'vision', label: 'Vision Board', icon: 'vision', view: vision },
  { id: 'goals', label: 'Goals', icon: 'goals', view: goals },
  { id: 'habits', label: 'Habits', icon: 'habits', view: habits },
  { id: 'settings', label: 'Settings', icon: 'settings', view: settings },
];

const main = $('#main');
let lastRoute = null;

function currentRoute() {
  const id = location.hash.replace(/^#\/?/, '').split('/')[0];
  return ROUTES.find((r) => r.id === id) || ROUTES[0];
}

function renderNav() {
  const active = currentRoute().id;
  $('#nav').innerHTML = ROUTES.map((r) => `
    <a href="#/${r.id}" class="nav-item ${r.id === active ? 'active' : ''}" ${r.id === 'settings' ? 'data-bottom' : ''}>
      ${icon(r.icon, 19)}<span>${esc(r.label)}</span>
    </a>`).join('');
}

function render() {
  const route = currentRoute();
  const sameRoute = route.id === lastRoute;
  const scroll = sameRoute ? [...main.querySelectorAll('[data-keep-scroll]')].map((el) => el.scrollTop) : [];
  const mainScroll = sameRoute ? main.scrollTop : 0;

  renderNav();
  // A fresh container per render, so each view's event listeners go away with it.
  const container = document.createElement('div');
  container.className = `view view-${route.id}`;
  main.replaceChildren(container);
  route.view.render(container);

  main.scrollTop = mainScroll;
  main.querySelectorAll('[data-keep-scroll]').forEach((el, i) => { if (scroll[i] != null) el.scrollTop = scroll[i]; });
  lastRoute = route.id;
}

export function applyTheme() {
  const theme = state?.settings.theme || 'system';
  if (theme === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}

async function start() {
  try {
    await load();
  } catch (err) {
    main.innerHTML = `
      <div class="empty big">
        <h2>Can't reach the local server</h2>
        <p>Start To-doist on your computer with <code>run.bat</code> (or run <code>Main</code> in IntelliJ), then reload this page.</p>
        <p class="muted">${esc(err.message)}</p>
      </div>`;
    return;
  }
  applyTheme();
  onChange(() => { applyTheme(); render(); });
  window.addEventListener('hashchange', render);
  render();
  startSync();
}

start();
