import { state, commit, refresh } from '../store.js';
import { $, esc, icon, uid, timeAgo, modal, confirmDialog, toast, markdown, COLORS } from '../utils.js';

let folder = 'all'; // 'all' | 'pinned' | folder id
let selectedId = null;
let query = '';
let preview = false;
let focusTitle = false;

const notes = () => state.notes.items;

/** Lets other views open a specific note. */
export function selectNote(id) {
  selectedId = id;
  folder = 'all';
  query = '';
  preview = false;
}

function visibleNotes() {
  const q = query.trim().toLowerCase();
  return notes()
    .filter((n) => folder === 'all' || (folder === 'pinned' ? n.pinned : n.folderId === folder))
    .filter((n) => !q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
    .sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));
}

function snippet(body) {
  const text = body.replace(/[#*`>~_\-[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > 90 ? text.slice(0, 90) + '…' : text || 'No additional text';
}

function noteItem(n) {
  return `
    <button class="note-item ${n.id === selectedId ? 'active' : ''}" data-note="${n.id}" style="${n.color ? `--nc:${n.color}` : ''}">
      <div class="note-item-title">${n.pinned ? icon('pin', 13) : ''}<span>${esc(n.title || 'Untitled')}</span></div>
      <div class="note-item-snippet">${esc(snippet(n.body))}</div>
      <div class="note-item-date">${timeAgo(n.updatedAt)}</div>
    </button>`;
}

function newNote() {
  const note = {
    id: uid(), title: '', body: '', color: '', pinned: folder === 'pinned',
    folderId: state.notes.folders.some((f) => f.id === folder) ? folder : null,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  notes().unshift(note);
  selectedId = note.id;
  query = '';
  preview = false;
  focusTitle = true;
  commit();
}

function openFolderModal(existing = null) {
  modal({
    title: existing ? 'Rename folder' : 'New folder',
    body: `<label class="field"><span>Name</span><input name="name" value="${esc(existing?.name)}" required placeholder="e.g. Journal, Ideas, Uni"></label>`,
    onSubmit: (v) => {
      const name = v.name.trim();
      if (!name) return false;
      if (existing) existing.name = name;
      else {
        const created = { id: uid(), name };
        state.notes.folders.push(created);
        folder = created.id;
      }
      commit();
    },
  });
}

export function render(root) {
  const { folders } = state.notes;
  if (!['all', 'pinned'].includes(folder) && !folders.some((f) => f.id === folder)) folder = 'all';
  const list = visibleNotes();
  if (!list.some((n) => n.id === selectedId)) selectedId = list[0]?.id ?? null;
  const note = notes().find((n) => n.id === selectedId);
  const count = (pred) => notes().filter(pred).length;

  root.innerHTML = `
    <div class="split notes-split">
      <aside class="subnav">
        <button class="subnav-item ${folder === 'all' ? 'active' : ''}" data-folder="all">${icon('notes', 17)}<span>All notes</span><em>${notes().length || ''}</em></button>
        <button class="subnav-item ${folder === 'pinned' ? 'active' : ''}" data-folder="pinned">${icon('pin', 17)}<span>Pinned</span><em>${count((n) => n.pinned) || ''}</em></button>
        <div class="subnav-title">Folders
          <button class="icon-btn sm" data-act="new-folder" title="New folder">${icon('plus', 16)}</button>
        </div>
        ${folders.map((f) => `
          <div class="subnav-row">
            <button class="subnav-item ${folder === f.id ? 'active' : ''}" data-folder="${f.id}">${icon('folder', 17)}<span>${esc(f.name)}</span><em>${count((n) => n.folderId === f.id) || ''}</em></button>
            <div class="row-actions">
              <button class="icon-btn sm" data-act="rename-folder" data-id="${f.id}" title="Rename">${icon('edit', 14)}</button>
              <button class="icon-btn sm" data-act="delete-folder" data-id="${f.id}" title="Delete">${icon('trash', 14)}</button>
            </div>
          </div>`).join('')}
        ${!folders.length ? '<p class="subnav-hint">Group notes into folders like Journal or Ideas.</p>' : ''}
      </aside>

      <section class="note-list-pane">
        <div class="note-list-head">
          <label class="search">${icon('search', 16)}<input id="note-search" placeholder="Search notes" value="${esc(query)}"></label>
          <button class="btn primary sm" data-act="new-note" title="New note">${icon('plus', 16)} New</button>
        </div>
        <div class="note-list" id="note-list" data-keep-scroll>
          ${list.map(noteItem).join('') || `<div class="empty small"><p>${query ? 'No matching notes.' : 'No notes here yet.'}</p></div>`}
        </div>
      </section>

      <section class="note-editor">
        ${note ? editorHtml(note, folders) : `
          <div class="empty big">
            <div class="empty-icon">${icon('notes', 38)}</div>
            <h3>Capture a thought</h3>
            <p>Notes support simple formatting: # headings, **bold**, - lists, - [ ] checklists.</p>
            <button class="btn primary" data-act="new-note">${icon('plus', 16)} New note</button>
          </div>`}
      </section>
    </div>`;

  // Typing in a note saves without a full re-render, so the cursor stays put.
  if (note) {
    const title = $('#note-title', root);
    const body = $('#note-body', root);
    const touch = () => {
      note.updatedAt = Date.now();
      commit({ render: false });
      const item = $(`[data-note="${note.id}"]`, root);
      if (item) item.outerHTML = noteItem(note);
      $('#note-saved', root).textContent = 'Edited just now';
    };
    title.addEventListener('input', () => { note.title = title.value; touch(); });
    body?.addEventListener('input', () => { note.body = body.value; touch(); });
    body?.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        body.setRangeText('  ', body.selectionStart, body.selectionEnd, 'end');
        body.dispatchEvent(new Event('input'));
      }
    });
    $('#note-folder', root).addEventListener('change', (e) => {
      note.folderId = e.target.value || null;
      commit();
    });
    if (focusTitle) { title.focus(); focusTitle = false; }
  }

  const search = $('#note-search', root);
  search.addEventListener('input', () => {
    query = search.value;
    const filtered = visibleNotes();
    $('#note-list', root).innerHTML = filtered.map(noteItem).join('') || '<div class="empty small"><p>No matching notes.</p></div>';
  });

  root.addEventListener('click', (e) => {
    const folderBtn = e.target.closest('[data-folder]');
    if (folderBtn) { folder = folderBtn.dataset.folder; return refresh(); }
    const noteBtn = e.target.closest('[data-note]');
    if (noteBtn) { selectedId = noteBtn.dataset.note; return refresh(); }
    const colorBtn = e.target.closest('[data-color]');
    if (colorBtn && note) { note.color = colorBtn.dataset.color; return commit(); }

    const actEl = e.target.closest('[data-act]');
    if (!actEl) return;
    const target = folders.find((f) => f.id === actEl.dataset.id);
    switch (actEl.dataset.act) {
      case 'new-note': return newNote();
      case 'new-folder': return openFolderModal();
      case 'rename-folder': return openFolderModal(target);
      case 'delete-folder':
        return confirmDialog(`Delete the folder "${target.name}"? Its notes are kept and moved to "All notes".`, () => {
          state.notes.folders = folders.filter((f) => f !== target);
          notes().forEach((n) => { if (n.folderId === target.id) n.folderId = null; });
          commit();
        });
      case 'pin': note.pinned = !note.pinned; return commit();
      case 'preview': preview = !preview; return refresh();
      case 'delete-note': {
        const index = notes().indexOf(note);
        notes().splice(index, 1);
        commit();
        return toast('Note deleted', { action: 'Undo', onAction: () => { notes().splice(index, 0, note); selectedId = note.id; commit(); } });
      }
    }
  });
}

function editorHtml(note, folders) {
  return `
    <div class="note-toolbar">
      <select id="note-folder" class="select-sm" title="Folder">
        <option value="">No folder</option>
        ${folders.map((f) => `<option value="${f.id}" ${f.id === note.folderId ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}
      </select>
      <div class="note-colors">
        <button class="color-dot none ${!note.color ? 'active' : ''}" data-color="" title="No color"></button>
        ${COLORS.map((c) => `<button class="color-dot ${note.color === c ? 'active' : ''}" data-color="${c}" style="--c:${c}" title="Color"></button>`).join('')}
      </div>
      <span class="spacer"></span>
      <button class="icon-btn ${preview ? 'on' : ''}" data-act="preview" title="${preview ? 'Edit' : 'Preview formatting'}">${icon(preview ? 'edit' : 'eye', 18)}</button>
      <button class="icon-btn ${note.pinned ? 'on' : ''}" data-act="pin" title="${note.pinned ? 'Unpin' : 'Pin'}">${icon('pin', 18)}</button>
      <button class="icon-btn" data-act="delete-note" title="Delete note">${icon('trash', 18)}</button>
    </div>
    <input id="note-title" class="note-title" placeholder="Title" value="${esc(note.title)}">
    <div class="note-saved" id="note-saved">Edited ${timeAgo(note.updatedAt)}</div>
    ${preview
      ? `<div class="note-preview md">${markdown(note.body) || '<p class="muted">Nothing to preview yet.</p>'}</div>`
      : `<textarea id="note-body" class="note-body" placeholder="Start writing…  (# heading, **bold**, *italic*, - list, - [ ] checklist, > quote)">${esc(note.body)}</textarea>`}`;
}
