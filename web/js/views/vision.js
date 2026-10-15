import { state, commit, refresh } from '../store.js';
import { $, $$, esc, icon, uid, modal, confirmDialog, toast, colorPicker } from '../utils.js';

let boardId = null;
let dragId = null;

const boards = () => state.vision.boards;
const itemsOf = (id) => state.vision.items.filter((i) => i.boardId === id);

async function uploadImage(file) {
  const ext = (file.type.split('/')[1] || '').toLowerCase();
  const res = await fetch(`/api/upload?ext=${encodeURIComponent(ext)}`, { method: 'POST', body: file });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()).url;
}

function removeUploaded(src) {
  if (src?.startsWith('/uploads/')) {
    fetch(`/api/upload?name=${encodeURIComponent(src.slice('/uploads/'.length))}`, { method: 'DELETE' });
  }
}

async function addImageFiles(files) {
  const images = [...files].filter((f) => f.type.startsWith('image/'));
  for (const file of images) {
    try {
      const src = await uploadImage(file);
      state.vision.items.push({ id: uid(), boardId, type: 'image', src, caption: '', createdAt: Date.now() });
    } catch (err) {
      toast(`Couldn't add ${file.name}: ${err.message}`);
    }
  }
  if (images.length) commit();
}

function openImageModal(item = null) {
  modal({
    title: item ? 'Edit image' : 'Add an image',
    body: `
      ${item ? `<img class="modal-preview" src="${esc(item.src)}" alt="">` : `
        <label class="dropzone" id="dz">
          ${icon('upload', 26)}
          <strong>Choose images</strong><span>or drag them here — PNG, JPG, GIF, WEBP</span>
          <input type="file" name="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden>
          <em id="dz-name"></em>
        </label>
        <div class="or">or paste an image link</div>
        <label class="field"><input name="url" type="url" placeholder="https://…"></label>`}
      <label class="field"><span>Caption (optional)</span><input name="caption" value="${esc(item?.caption)}" placeholder="e.g. My dream home by the sea"></label>`,
    submitLabel: item ? 'Save' : 'Add to board',
    onMount: (dlg) => {
      const input = $('input[type=file]', dlg);
      const dz = $('#dz', dlg);
      if (!input) return;
      const show = () => { $('#dz-name', dlg).textContent = [...input.files].map((f) => f.name).join(', '); };
      input.addEventListener('change', show);
      dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('over'));
      dz.addEventListener('drop', (e) => {
        e.preventDefault();
        dz.classList.remove('over');
        input.files = e.dataTransfer.files;
        show();
      });
    },
    onSubmit: (v, form) => {
      if (item) { item.caption = v.caption.trim(); commit(); return; }
      const files = [...form.file.files];
      const url = v.url.trim();
      if (!files.length && !url) { toast('Choose an image or paste a link'); return false; }
      if (url) state.vision.items.push({ id: uid(), boardId, type: 'image', src: url, caption: v.caption.trim(), createdAt: Date.now() });
      if (files.length) {
        const caption = v.caption.trim();
        const before = state.vision.items.length;
        addImageFiles(files).then(() => {
          if (caption && files.length === 1 && state.vision.items.length > before) state.vision.items.at(-1).caption = caption;
          commit();
        });
      } else commit();
    },
  });
}

function openWordsModal(item = null) {
  modal({
    title: item ? 'Edit words' : 'Add words',
    body: `
      <label class="field"><span>Affirmation, quote or intention</span>
        <textarea name="text" rows="3" required placeholder="I am becoming the person who…">${esc(item?.text)}</textarea></label>
      <label class="field"><span>Author / note (optional)</span><input name="caption" value="${esc(item?.caption)}"></label>
      <div class="field"><span>Card color</span>${colorPicker('color', item?.color || '#bf6a45')}</div>`,
    onSubmit: (v) => {
      if (!v.text.trim()) return false;
      const fields = { text: v.text.trim(), caption: v.caption.trim(), color: v.color };
      if (item) Object.assign(item, fields);
      else state.vision.items.push({ id: uid(), boardId, type: 'quote', createdAt: Date.now(), ...fields });
      commit();
    },
  });
}

function openBoardModal(board = null) {
  modal({
    title: board ? 'Rename board' : 'New board',
    body: `<label class="field"><span>Name</span><input name="name" value="${esc(board?.name)}" required placeholder="e.g. 2027, Dream Life, Career"></label>`,
    onSubmit: (v) => {
      if (!v.name.trim()) return false;
      if (board) board.name = v.name.trim();
      else {
        const created = { id: uid(), name: v.name.trim() };
        boards().push(created);
        boardId = created.id;
      }
      commit();
    },
  });
}

function present(items, start = 0) {
  let index = start;
  const el = document.createElement('div');
  el.className = 'presenter';
  const draw = () => {
    const it = items[index];
    el.innerHTML = `
      <button class="presenter-close icon-btn" aria-label="Close">${icon('x', 24)}</button>
      <button class="presenter-nav prev icon-btn" aria-label="Previous">${icon('left', 30)}</button>
      <div class="presenter-stage">
        ${it.type === 'image'
          ? `<img src="${esc(it.src)}" alt="">${it.caption ? `<p class="presenter-caption">${esc(it.caption)}</p>` : ''}`
          : `<blockquote class="presenter-quote" style="--c:${it.color}">${esc(it.text)}${it.caption ? `<cite>— ${esc(it.caption)}</cite>` : ''}</blockquote>`}
      </div>
      <button class="presenter-nav next icon-btn" aria-label="Next">${icon('right', 30)}</button>
      <div class="presenter-count">${index + 1} / ${items.length}</div>`;
  };
  const go = (d) => { index = (index + d + items.length) % items.length; draw(); };
  const close = () => { clearInterval(timer); document.removeEventListener('keydown', onKey); el.remove(); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
  };
  el.addEventListener('click', (e) => {
    if (e.target.closest('.presenter-close')) close();
    else if (e.target.closest('.prev')) go(-1);
    else if (e.target.closest('.next')) go(1);
  });
  document.addEventListener('keydown', onKey);
  const timer = setInterval(() => go(1), 7000);
  draw();
  document.body.append(el);
}

export function render(root) {
  if (!boards().some((b) => b.id === boardId)) boardId = boards()[0].id;
  const board = boards().find((b) => b.id === boardId);
  const items = itemsOf(boardId);

  root.innerHTML = `
    <div class="page">
      <header class="page-head">
        <div>
          <h1>Vision Board</h1>
          <p class="muted">See it. Believe it. Build it.</p>
        </div>
        <div class="head-actions">
          ${items.length ? `<button class="btn ghost" data-act="present">${icon('eye', 17)} Present</button>` : ''}
          <button class="btn ghost" data-act="add-words">${icon('quote', 17)} Add words</button>
          <button class="btn primary" data-act="add-image">${icon('plus', 17)} Add image</button>
        </div>
      </header>

      <div class="tabs">
        ${boards().map((b) => `<button class="tab ${b.id === boardId ? 'active' : ''}" data-board="${b.id}">${esc(b.name)}<span class="tab-count">${itemsOf(b.id).length}</span></button>`).join('')}
        <button class="tab add" data-act="new-board">${icon('plus', 15)} Board</button>
        <span class="spacer"></span>
        <button class="icon-btn sm" data-act="rename-board" title="Rename board">${icon('edit', 16)}</button>
        ${boards().length > 1 ? `<button class="icon-btn sm" data-act="delete-board" title="Delete board">${icon('trash', 16)}</button>` : ''}
      </div>

      <div class="vision-grid" id="vision-grid">
        ${items.map((it) => `
          <figure class="vcard ${it.type}" draggable="true" data-id="${it.id}" ${it.type === 'quote' ? `style="--c:${it.color}"` : ''}>
            ${it.type === 'image'
              ? `<img src="${esc(it.src)}" alt="${esc(it.caption)}" loading="lazy" draggable="false">${it.caption ? `<figcaption>${esc(it.caption)}</figcaption>` : ''}`
              : `<blockquote>${esc(it.text)}</blockquote>${it.caption ? `<figcaption>— ${esc(it.caption)}</figcaption>` : ''}`}
            <div class="vcard-actions">
              <button class="icon-btn sm" data-act="edit-item" title="Edit">${icon('edit', 15)}</button>
              <button class="icon-btn sm" data-act="delete-item" title="Remove">${icon('trash', 15)}</button>
            </div>
          </figure>`).join('')}
      </div>
      ${!items.length ? `
        <div class="empty big dashed" id="vision-empty">
          <div class="empty-icon">${icon('vision', 40)}</div>
          <h3>Start your “${esc(board.name)}” board</h3>
          <p>Drop images anywhere on this page, or add affirmations that keep you going.</p>
        </div>` : '<p class="hint">Tip: drag cards to rearrange · drop image files anywhere to add them · click a card to view it large</p>'}
    </div>`;

  root.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-board]');
    if (tab) { boardId = tab.dataset.board; return refresh(); }
    const card = e.target.closest('.vcard');
    const item = card && state.vision.items.find((i) => i.id === card.dataset.id);
    const act = e.target.closest('[data-act]')?.dataset.act;

    switch (act) {
      case 'add-image': return openImageModal();
      case 'add-words': return openWordsModal();
      case 'present': return present(items);
      case 'new-board': return openBoardModal();
      case 'rename-board': return openBoardModal(board);
      case 'delete-board':
        return confirmDialog(`Delete the board "${board.name}" and everything on it?`, () => {
          items.forEach((i) => removeUploaded(i.src));
          state.vision.items = state.vision.items.filter((i) => i.boardId !== board.id);
          state.vision.boards = boards().filter((b) => b !== board);
          commit();
        });
      case 'edit-item': return item.type === 'image' ? openImageModal(item) : openWordsModal(item);
      case 'delete-item':
        return confirmDialog('Remove this card from your board?', () => {
          removeUploaded(item.src);
          state.vision.items = state.vision.items.filter((i) => i !== item);
          commit();
        }, { label: 'Remove' });
    }
    if (item) present(items, items.indexOf(item));
  });

  // Drag cards to reorder.
  const grid = $('#vision-grid', root);
  grid.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.vcard');
    if (!card) return;
    dragId = card.dataset.id;
    card.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  grid.addEventListener('dragend', () => {
    dragId = null;
    $$('.vcard', grid).forEach((c) => c.classList.remove('dragging', 'drop-target'));
  });
  grid.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    $$('.vcard', grid).forEach((c) => c.classList.remove('drop-target'));
    e.target.closest('.vcard')?.classList.add('drop-target');
  });
  grid.addEventListener('drop', (e) => {
    if (!dragId) return;
    e.preventDefault();
    e.stopPropagation();
    const targetId = e.target.closest('.vcard')?.dataset.id;
    if (!targetId || targetId === dragId) return;
    const all = state.vision.items;
    const moving = all.find((i) => i.id === dragId);
    const from = all.indexOf(moving);
    all.splice(from, 1);
    let to = all.findIndex((i) => i.id === targetId);
    if (from <= to) to += 1; // dropping onto a later card puts it after that card
    all.splice(to, 0, moving);
    commit();
  });

  // Drop image files anywhere on the page.
  root.addEventListener('dragover', (e) => {
    if (dragId || !e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    root.classList.add('file-over');
  });
  root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('file-over'); });
  root.addEventListener('drop', (e) => {
    if (dragId || !e.dataTransfer.files.length) return;
    e.preventDefault();
    root.classList.remove('file-over');
    addImageFiles(e.dataTransfer.files);
  });
}
