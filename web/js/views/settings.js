import { state, commit, replaceState, defaultState, flush } from '../store.js';
import { $, esc, icon, today, modal, toast } from '../utils.js';
import {
  PROVIDERS, DEFAULT_OLLAMA_MODEL, listOllamaModels, listGeminiModels, pickGeminiModel, hasGeminiKey, saveGeminiKey,
} from '../ai.js';

export function render(root) {
  const s = state.settings;
  const counts = [
    [state.todo.tasks.length, 'tasks'],
    [state.notes.items.length, 'notes'],
    [state.vision.items.length, 'vision cards'],
    [state.goals.items.length, 'goals'],
    [state.habits.items.length, 'habits'],
  ];

  root.innerHTML = `
    <div class="page narrow">
      <header class="page-head"><div><h1>Settings</h1></div></header>

      <section class="card settings-card">
        <h2>Personal</h2>
        <label class="field"><span>Your name (used in greetings)</span>
          <input id="name" value="${esc(s.name)}" placeholder="What should I call you?"></label>
        <div class="field"><span>Theme</span>
          <div class="segmented" id="theme">
            ${[['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']].map(([v, label]) =>
              `<label><input type="radio" name="theme" value="${v}" ${s.theme === v ? 'checked' : ''}><span>${label}</span></label>`).join('')}
          </div>
        </div>
      </section>

      <section class="card settings-card">
        <h2>AI assistant</h2>
        <div class="field"><span>Which AI to use</span>
          <div class="segmented" id="ai-provider">
            ${Object.entries(PROVIDERS).map(([v, label]) =>
              `<label><input type="radio" name="provider" value="${v}" ${s.ai.provider === v ? 'checked' : ''}><span>${label}</span></label>`).join('')}
          </div>
        </div>
        <div id="ai-detail"><p class="muted">Checking…</p></div>
      </section>

      <section class="card settings-card">
        <h2>Your data</h2>
        <p class="muted">Everything is stored only on your computer, in the <code>data</code> folder next to the app:</p>
        <ul class="data-info">
          <li><code>data/data.json</code> — all tasks, notes, goals, habits and boards (${counts.map(([n, l]) => `${n} ${l}`).join(', ')})</li>
          <li><code>data/backups/</code> — an automatic snapshot every day (last 30 days kept)</li>
          <li><code>data/uploads/</code> — images on your vision boards</li>
        </ul>
        <div class="btn-row">
          <button class="btn ghost" data-act="export">${icon('download', 16)} Export backup (.json)</button>
          <label class="btn ghost">${icon('upload', 16)} Import backup
            <input type="file" id="import" accept="application/json,.json" hidden></label>
        </div>
      </section>

      <section class="card settings-card" id="phone">
        <h2>Use on your phone</h2>
        <p class="muted">Checking…</p>
      </section>

      <section class="card settings-card danger-zone">
        <h2>Danger zone</h2>
        <p class="muted">Erase everything and start fresh. Yesterday's automatic backup stays in <code>data/backups</code>.</p>
        <button class="btn danger" data-act="reset">${icon('trash', 16)} Erase all data</button>
      </section>
    </div>`;

  renderPhone($('#phone', root));
  renderAi($('#ai-detail', root));
  $('#ai-provider', root).addEventListener('change', (e) => { s.ai.provider = e.target.value; commit(); });

  $('#name', root).addEventListener('input', (e) => { s.name = e.target.value; commit({ render: false }); });
  $('#theme', root).addEventListener('change', (e) => { s.theme = e.target.value; commit(); });

  $('#import', root).addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let data;
    try {
      data = JSON.parse(await file.text());
      if (typeof data !== 'object' || !data.todo || !data.notes) throw new Error('Not a To-doist backup');
    } catch (err) {
      return toast(`Couldn't import: ${err.message}`);
    }
    modal({
      title: 'Import backup?',
      body: `<p class="confirm-text">This replaces <strong>all</strong> current data with the contents of “${esc(file.name)}”.</p>`,
      submitLabel: 'Replace my data',
      onSubmit: () => { replaceState(data); toast('Backup imported'); },
    });
  });

  root.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'export') {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `to-doist-backup-${today()}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    if (act === 'phone-on' || act === 'phone-reset' || act === 'phone-off') {
      const run = () => fetch(`/api/phone?action=${act.slice(6)}`, { method: 'POST' })
        .then((res) => { if (!res.ok) throw new Error(); renderPhone($('#phone', root)); })
        .catch(() => toast('Could not change phone access'));
      if (act === 'phone-on') return run();
      confirmPhone(act, run);
    }
    if (act === 'reset') {
      modal({
        title: 'Erase all data?',
        body: `<p class="confirm-text">Type <strong>ERASE</strong> to confirm. This cannot be undone from inside the app.</p>
               <label class="field"><input name="confirm" autocomplete="off" autofocus></label>`,
        submitLabel: 'Erase everything',
        onMount: (dlg) => $('button[type=submit]', dlg).classList.add('danger'),
        onSubmit: (v) => {
          if (v.confirm !== 'ERASE') { toast('Type ERASE to confirm'); return false; }
          replaceState(defaultState());
          flush();
          toast('All data erased');
        },
      });
    }
  });
}

// ---- AI assistant ----

const modelSelect = (models, current) => `
  <select id="ai-model">${models.map((m) => `<option ${m === current ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>`;

async function renderAi(box) {
  const ai = state.settings.ai;
  if (ai.provider === 'ollama') {
    let models;
    try {
      models = await listOllamaModels();
    } catch {
      if (!box.isConnected) return;
      box.innerHTML = `<p class="muted">Ollama isn't running on this computer. Start the <strong>Ollama</strong> app
        (it sits in the taskbar tray), then reopen Settings. Get it free at <a href="https://ollama.com/download" target="_blank" rel="noopener">ollama.com</a>.</p>`;
      return;
    }
    if (!box.isConnected) return;
    const current = ai.ollamaModel || DEFAULT_OLLAMA_MODEL;
    if (!models.length) {
      box.innerHTML = `<p class="muted">Ollama is running but has no models yet. In a terminal, run
        <code>ollama pull ${esc(DEFAULT_OLLAMA_MODEL)}</code>, then reopen Settings.</p>`;
      return;
    }
    const installed = models.includes(current);
    box.innerHTML = `
      <label class="field"><span>Model</span>${modelSelect(installed ? models : [current, ...models], current)}</label>
      ${installed ? '' : `<p class="muted small">“${esc(current)}” isn't downloaded. Pick another, or run <code>ollama pull ${esc(current)}</code>.</p>`}
      <p class="muted small">${icon('check', 13)} Free and private: everything stays on this computer. Ollama must be running.</p>`;
    $('#ai-model', box).addEventListener('change', (e) => { ai.ollamaModel = e.target.value; commit({ render: false }); });
    return;
  }

  const hasKey = await hasGeminiKey();
  if (!box.isConnected) return;
  const keyForm = `
    <form class="field" id="gemini-key"><span>Gemini API key</span>
      <div class="inline-form">
        <input name="key" type="password" autocomplete="off" placeholder="${hasKey ? 'Saved. Paste a new key to replace it' : 'Paste your key here'}">
        <button class="btn primary">Save key</button>
      </div>
    </form>
    <p class="muted small">Get a free key (no card needed) at
      <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>.
      The key is kept only on this computer, in <code>data/gemini-key.txt</code>.
      On the free plan Google may use what you send to improve its products.</p>`;
  box.innerHTML = `${keyForm}<div id="gemini-models"></div>`;

  $('#gemini-key', box).addEventListener('submit', async (e) => {
    e.preventDefault();
    const key = e.target.key.value.trim();
    if (!key) return;
    try {
      await saveGeminiKey(key);
    } catch (err) {
      return toast(err.message.includes('only be changed') ? 'Save the key on the computer, not the phone' : `Couldn't save: ${err.message}`);
    }
    toast('Key saved');
    renderAi(box);
  });

  if (!hasKey) return;
  const area = $('#gemini-models', box);
  area.innerHTML = '<p class="muted small">Checking the key…</p>';
  try {
    const models = await listGeminiModels();
    if (!ai.geminiModel || !models.includes(ai.geminiModel)) {
      ai.geminiModel = pickGeminiModel(models);
      commit({ render: false });
    }
    area.innerHTML = `
      <label class="field"><span>Model</span>${modelSelect(models, ai.geminiModel)}</label>
      <p class="muted small">${icon('check', 13)} Key works. “Flash” models are fast and have the most generous free limits.</p>`;
    $('#ai-model', area).addEventListener('change', (e) => { ai.geminiModel = e.target.value; commit({ render: false }); });
  } catch (err) {
    area.innerHTML = `<p class="small" style="color: var(--danger)">${esc(err.message)}</p>`;
  }
}

// ---- Phone access ----

async function renderPhone(card) {
  const head = '<h2>Use on your phone</h2>';
  let info;
  try {
    const res = await fetch('/api/phone', { cache: 'no-store' });
    if (res.status === 403) {
      card.innerHTML = `${head}<p class="muted">You're using To-doist from another device. Phone access is managed in Settings on the computer.</p>`;
      return;
    }
    info = await res.json();
  } catch {
    card.innerHTML = `${head}<p class="muted">Couldn't check phone access.</p>`;
    return;
  }
  if (!card.isConnected) return;

  if (!info.enabled) {
    card.innerHTML = `${head}
      <p class="muted">Open To-doist on your phone over your home Wi-Fi. You get a private link (and QR code) that only works for you.</p>
      <div class="btn-row"><button class="btn primary" data-act="phone-on">${icon('phone', 16)} Turn on phone access</button></div>`;
    return;
  }
  if (!info.addresses.length) {
    card.innerHTML = `${head}
      <p class="muted">This computer doesn't seem to be connected to a network. Connect it to Wi-Fi and reopen Settings.</p>
      <div class="btn-row"><button class="btn ghost" data-act="phone-off">Turn off phone access</button></div>`;
    return;
  }
  const urls = info.addresses.map((a) => `http://${a}:${info.port}/?key=${info.key}`);
  card.innerHTML = `${head}
    <div class="phone-setup">
      <div class="qr" id="qr" aria-label="QR code for the phone link"></div>
      <ol class="phone-steps">
        <li>Connect your phone to the <strong>same Wi-Fi</strong> as this computer.</li>
        <li>Scan the code with the phone's camera, or type this link:
          <code class="phone-link">${esc(urls[0])}</code></li>
        <li>In the browser menu choose <strong>Add to Home screen</strong> to get an app icon.</li>
      </ol>
    </div>
    <p class="muted small">To-doist must be running on this computer while you use the phone, and the computer must be awake.
      If Windows asks whether to allow Java on networks, choose <strong>Private networks</strong>.</p>
    ${urls.length > 1 ? `<p class="muted small">If the link doesn't open, try: ${urls.slice(1).map((u) => `<code>${esc(u)}</code>`).join(' ')}</p>` : ''}
    <div class="btn-row">
      <button class="btn ghost" data-act="phone-reset">${icon('repeat', 16)} New link (signs out phones)</button>
      <button class="btn ghost" data-act="phone-off">Turn off phone access</button>
    </div>`;
  drawQr($('#qr', card), urls[0]);
}

// The QR library comes from the internet; without it the link is still shown as text.
let qrLib;
async function drawQr(el, text) {
  qrLib ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js';
    s.onload = () => resolve(window.qrcode);
    s.onerror = () => { qrLib = null; reject(); };
    document.head.append(s);
  });
  try {
    const qrcode = await qrLib;
    const qr = qrcode(0, 'M');
    qr.addData(text);
    qr.make();
    el.innerHTML = qr.createSvgTag(5, 2);
  } catch {
    el.remove();
  }
}

function confirmPhone(act, run) {
  const reset = act === 'phone-reset';
  modal({
    title: reset ? 'Make a new phone link?' : 'Turn off phone access?',
    body: `<p class="confirm-text">${reset
      ? 'The old link and QR code stop working. Phones that use it will need to scan the new code.'
      : 'Phones lose access right away. You can turn it back on any time, with a new link.'}</p>`,
    submitLabel: reset ? 'Make new link' : 'Turn off',
    onSubmit: run,
  });
}
