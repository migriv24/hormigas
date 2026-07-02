/**
 * data_tab.js — contacts, events, presenters + calendar view.
 */

const DEFAULT_AVATAR = 'https://cdn-icons-png.flaticon.com/512/8847/8847419.png';

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  let json;
  try {
    json = await res.json();
  } catch (_) {
    throw new Error(`Server error ${res.status} — unexpected response format`);
  }
  if (!json.ok) throw new Error(json.error || 'API error');
  return json;
}

// ── Sub-tabs ──────────────────────────────────────────────────────────────────

document.querySelectorAll('.subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.subtab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const id = btn.dataset.subtab;
    document.querySelectorAll('.subtab-panel').forEach(p => {
      p.classList.toggle('hidden', !p.id.endsWith(id));
      p.classList.toggle('active', p.id.endsWith(id));
    });
  });
});

// ── Modal ─────────────────────────────────────────────────────────────────────

const modal       = document.getElementById('modal');
const modalTitle  = document.getElementById('modalTitle');
const modalBody   = document.getElementById('modalBody');
const modalSave   = document.getElementById('modalSave');
const modalCancel = document.getElementById('modalCancel');
const modalClose  = document.getElementById('modalClose');

let _modalSaveHandler = null;

function openModal(title, bodyHtml, onSave) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  _modalSaveHandler = onSave;
  modal.classList.remove('hidden');
  SmartFields.initAll(modalBody);
}

function closeModal() {
  modal.classList.add('hidden');
  _modalSaveHandler = null;
}

[modalCancel, modalClose].forEach(btn => btn.addEventListener('click', closeModal));
modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
modalSave.addEventListener('click', () => { if (_modalSaveHandler) _modalSaveHandler(); });

function field(label, id, value = '', type = 'text', extra = '') {
  return `<div class="form-field">
    <label for="${id}">${label}</label>
    <input type="${type}" id="${id}" value="${esc(value)}" ${extra}>
  </div>`;
}
function textareaField(label, id, value = '') {
  return `<div class="form-field">
    <label for="${id}">${label}</label>
    <textarea id="${id}">${esc(value)}</textarea>
  </div>`;
}
function checkboxField(label, id, checked) {
  return `<div class="form-field">
    <label class="form-checkbox">
      <input type="checkbox" id="${id}" ${checked ? 'checked' : ''}>
      ${label}
    </label>
  </div>`;
}

function val(id) { return document.getElementById(id)?.value?.trim() ?? ''; }
function chk(id) { return document.getElementById(id)?.checked ?? false; }

// ── Event tag helpers ─────────────────────────────────────────────────────────

let _editingEventTags = [];

function evTagsRender() {
  const wrap = document.getElementById('ef-tags-chips');
  if (!wrap) return;
  wrap.innerHTML = _editingEventTags.length
    ? _editingEventTags.map((t, i) =>
        `<span class="img-tag-chip">${esc(t)}<button class="img-tag-chip-remove" onclick="evTagRemove(${i})" title="Remove">✕</button></span>`
      ).join('')
    : `<span style="font-size:12px;color:var(--text-muted);">No tags yet</span>`;
}

window.evTagRemove = function(i) {
  _editingEventTags.splice(i, 1);
  evTagsRender();
};

function evTagAdd(raw) {
  const tag = raw.trim().toLowerCase();
  if (!tag || _editingEventTags.includes(tag)) return;
  _editingEventTags.push(tag);
  evTagsRender();
  fetch('/api/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tag }) }).catch(() => {});
}

function evTagsInit(existingTags) {
  _editingEventTags = [...(existingTags || [])];
  evTagsRender();
  // Load suggestions from shared tag pool
  const dl = document.getElementById('ef-tag-suggestions');
  if (!dl) return;
  fetch('/api/tags').then(r => r.json()).then(json => {
    if (!json.ok) return;
    dl.innerHTML = json.data.map(t => `<option value="${esc(t)}">`).join('');
  }).catch(() => {});

  const input = document.getElementById('ef-tag-input');
  if (!input) return;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      evTagAdd(input.value);
      input.value = '';
    }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) { evTagAdd(input.value); input.value = ''; }
  });
}

// ── Contact tag helpers ───────────────────────────────────────────────────────

let _editingContactTags  = [];
let _editingContactRowIndex = null;

function ctTagsRender() {
  const wrap = document.getElementById('ct-tags-chips');
  if (!wrap) return;
  wrap.innerHTML = _editingContactTags.length
    ? _editingContactTags.map((t, i) =>
        `<span class="img-tag-chip">${esc(t)}<button class="img-tag-chip-remove" onclick="ctTagRemove(${i})" title="Remove">✕</button></span>`).join('')
    : `<span style="font-size:12px;color:var(--text-muted);">No tags yet</span>`;
}
window.ctTagRemove = function(i) { _editingContactTags.splice(i, 1); ctTagsRender(); };
function ctTagAdd(raw) {
  const tag = raw.trim().toLowerCase();
  if (!tag || _editingContactTags.includes(tag)) return;
  _editingContactTags.push(tag);
  ctTagsRender();
  fetch('/api/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tag }) }).catch(() => {});
}
function ctTagsInit(existing) {
  _editingContactTags = [...(existing || [])];
  ctTagsRender();
  const dl = document.getElementById('ct-tag-suggestions');
  if (!dl) return;
  fetch('/api/tags').then(r => r.json()).then(json => {
    if (!json.ok) return;
    dl.innerHTML = json.data.map(t => `<option value="${esc(t)}">`).join('');
  }).catch(() => {});
  const input = document.getElementById('ct-tag-input');
  if (!input) return;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); ctTagAdd(input.value); input.value = ''; }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) { ctTagAdd(input.value); input.value = ''; }
  });
}

// ── Event linked-fliers helpers ───────────────────────────────────────────────

let _editingEventRowIndex = null;

async function evLinkedImgsLoad(rowIndex) {
  const section = document.getElementById('ef-linked-imgs');
  if (!section) return;
  section.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">Loading…</span>';
  try {
    const json = await apiFetch(`/api/events/${rowIndex}/images`);
    const imgs = json.data || [];
    section.innerHTML = imgs.length
      ? imgs.map(img => `
          <div class="ev-linked-img" data-img-id="${esc(img.id)}">
            <img src="${esc(img.thumb_url || img.url)}" title="${esc(img.name || '')}">
            <button class="img-tag-chip-remove" onclick="evUnlinkImg('${esc(img.id)}')" title="Unlink">✕</button>
          </div>`).join('')
      : '<span style="font-size:12px;color:var(--text-muted);">No linked fliers</span>';
  } catch {
    section.innerHTML = '<span style="font-size:12px;color:var(--text-muted);">Could not load</span>';
  }
}

window.evUnlinkImg = async function(imageId) {
  try {
    const body = { event_row_index: _editingEventRowIndex };
    await apiFetch(`/api/images/${encodeURIComponent(imageId)}/link-event`, {
      method: 'DELETE', body: JSON.stringify(body),
    });
    // Sync pair partner
    const partnerId = window.imgGetPairPartnerId?.(imageId);
    if (partnerId) {
      await apiFetch(`/api/images/${encodeURIComponent(partnerId)}/link-event`, {
        method: 'DELETE', body: JSON.stringify(body),
      }).catch(() => {});
    }
    if (_editingEventRowIndex != null) evLinkedImgsLoad(_editingEventRowIndex);
  } catch (err) { toast('Unlink failed: ' + err.message, 'error'); }
};

window.evPickFlier = async function() {
  if (_editingEventRowIndex == null) return;
  // Fetch all images and show a mini picker
  let allImgs;
  try {
    const json = await apiFetch('/api/images');
    allImgs = json.data || [];
  } catch { toast('Could not load image library', 'error'); return; }

  const existing = document.getElementById('_evFlierPicker');
  if (existing) existing.remove();

  const picker = document.createElement('div');
  picker.id = '_evFlierPicker';
  picker.style.cssText = `position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.6);
    display:flex;align-items:center;justify-content:center;`;
  picker.innerHTML = `
    <div style="background:var(--bg,#fff);border-radius:12px;padding:20px;
                max-width:680px;width:95%;max-height:80vh;display:flex;flex-direction:column;
                box-shadow:0 8px 40px rgba(0,0,0,.4);">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <span style="font-weight:700;font-size:15px;">Attach Flier from Library</span>
        <button id="_evFpClose" style="background:none;border:none;font-size:18px;cursor:pointer;color:var(--text-muted);">✕</button>
      </div>
      <div style="overflow-y:auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;">
        ${allImgs.map(img => `
          <div onclick="evFlierSelect('${esc(img.id)}')"
               style="cursor:pointer;border:2px solid var(--border);border-radius:8px;overflow:hidden;
                      transition:border-color .15s;" class="ev-fp-card">
            <img src="${esc(img.thumb_url || img.url)}"
                 style="width:100%;aspect-ratio:1;object-fit:cover;display:block;">
            <div style="padding:4px 6px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                 title="${esc(img.name || '')}">${esc(img.name || 'Untitled')}</div>
          </div>`).join('')}
        ${!allImgs.length ? '<span style="color:var(--text-muted);font-size:13px;">No images in library</span>' : ''}
      </div>
    </div>`;
  picker.querySelector('#_evFpClose').addEventListener('click', () => picker.remove());
  picker.addEventListener('click', e => { if (e.target === picker) picker.remove(); });
  document.body.appendChild(picker);
};

window.evFlierSelect = async function(imageId) {
  if (_editingEventRowIndex == null) return;
  const picker = document.getElementById('_evFlierPicker');
  if (picker) picker.remove();
  try {
    const body = { event_row_index: _editingEventRowIndex };
    await apiFetch(`/api/images/${encodeURIComponent(imageId)}/link-event`, {
      method: 'POST', body: JSON.stringify(body),
    });
    // Sync pair partner
    const partnerId = window.imgGetPairPartnerId?.(imageId);
    if (partnerId) {
      await apiFetch(`/api/images/${encodeURIComponent(partnerId)}/link-event`, {
        method: 'POST', body: JSON.stringify(body),
      }).catch(() => {});
    }
    evLinkedImgsLoad(_editingEventRowIndex);
  } catch (err) { toast('Link failed: ' + err.message, 'error'); }
};

// ── Sort utilities ────────────────────────────────────────────────────────────

function sortBy(arr, key, dir) {
  return [...arr].sort((a, b) => {
    const av = String(a[key] ?? '').toLowerCase();
    const bv = String(b[key] ?? '').toLowerCase();
    return av < bv ? -dir : av > bv ? dir : 0;
  });
}

function refreshSortIndicators(tableId, sortKey, sortDir) {
  document.querySelectorAll(`#${tableId} .th-sort`).forEach(btn => {
    const key = btn.dataset.sort || btn.dataset.sortEvents;
    const ind = btn.querySelector('.sort-ind');
    if (!ind || !key) return;
    if (key === sortKey) {
      ind.textContent = sortDir === 1 ? ' ↑' : ' ↓';
      ind.style.color = 'var(--accent)';
      ind.style.opacity = '1';
    } else {
      ind.textContent = ' ↕';
      ind.style.color = '';
      ind.style.opacity = '0.3';
    }
  });
}

// ── CONTACTS ─────────────────────────────────────────────────────────────────

let _contacts     = [];
let _contactQuery = '';
let _contactSort  = { key: 'name', dir: 1 };

async function loadContacts() {
  document.getElementById('contactsBody').innerHTML =
    '<tr><td colspan="9" class="loading">Loading…</td></tr>';
  try {
    const json = await apiFetch('/api/contacts?per_page=9999&page=1&q=');
    _contacts = json.data || [];
    document.getElementById('contactCount').textContent = `${_contacts.length} total`;
    applyContactFilters();
  } catch (err) {
    document.getElementById('contactsBody').innerHTML =
      `<tr><td colspan="9" class="loading" style="color:var(--danger);">Error: ${esc(err.message)}</td></tr>`;
    toast('Failed to load contacts: ' + err.message, 'error');
  }
}

function applyContactFilters() {
  const q = _contactQuery.toLowerCase();
  let list = q
    ? _contacts.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.organization.toLowerCase().includes(q) ||
        c.email.toLowerCase().includes(q))
    : _contacts;
  list = sortBy(list, _contactSort.key, _contactSort.dir);
  renderContactRows(list);
  refreshSortIndicators('contactsTable', _contactSort.key, _contactSort.dir);
}

function renderContactRows(contacts) {
  const body = document.getElementById('contactsBody');
  if (!contacts.length) {
    body.innerHTML = '<tr><td colspan="9" class="loading">No contacts found.</td></tr>';
    return;
  }
  body.innerHTML = contacts.map(c => {
    const avatar = c.image_url || DEFAULT_AVATAR;
    return `
    <tr>
      <td style="padding:4px 8px;">
        <img src="${esc(avatar)}" alt=""
             style="width:28px;height:28px;border-radius:50%;object-fit:cover;cursor:zoom-in;display:block;"
             onclick="contactAvatarZoom('${esc(avatar)}','${esc(c.name)}')"
             onerror="this.src='${DEFAULT_AVATAR}'">
      </td>
      <td>${esc(c.name)}</td>
      <td>${esc(c.organization)}</td>
      <td>${esc(c.title)}</td>
      <td><a href="mailto:${esc(c.email)}" style="color:var(--accent)">${esc(c.email)}</a></td>
      <td>${esc(c.office_phone || c.work_cell)}</td>
      <td><span class="badge ${c.receive_newsletter ? 'badge-green' : 'badge-red'}">
        ${c.receive_newsletter ? 'Yes' : 'No'}
      </span></td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
          title="${esc(c.notes)}">${esc(c.notes)}</td>
      <td>
        <button class="btn btn-sm btn-ghost"
                onclick="editContact(${c.row_index})">Edit</button>
      </td>
    </tr>`;
  }).join('');
}

window.contactAvatarZoom = function(url, name) {
  const existing = document.getElementById('_avatarLightbox');
  if (existing) existing.remove();
  const overlay = document.createElement('div');
  overlay.id = '_avatarLightbox';
  overlay.style.cssText = 'position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
  overlay.innerHTML = `<div style="text-align:center;">
    <img src="${esc(url)}" style="max-width:320px;max-height:320px;border-radius:50%;border:4px solid #fff;box-shadow:0 8px 40px rgba(0,0,0,.5);cursor:default;" onclick="event.stopPropagation()">
    <div style="color:rgba(255,255,255,.8);margin-top:12px;font-size:14px;">${esc(name)}</div>
  </div>`;
  overlay.addEventListener('click', () => overlay.remove());
  document.addEventListener('keydown', function handler(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', handler); }
  });
  document.body.appendChild(overlay);
};

function _contactTagsField() {
  return `<div class="form-field">
    <label>Tags</label>
    <div id="ct-tags-chips" class="img-tags-row" style="min-height:28px;margin-bottom:6px;"></div>
    <div style="display:flex;gap:6px;">
      <input type="text" id="ct-tag-input" placeholder="Add a tag…"
             style="flex:1;" list="ct-tag-suggestions" autocomplete="off">
      <datalist id="ct-tag-suggestions"></datalist>
      <button type="button" class="btn btn-sm btn-outline"
              onclick="ctTagAdd(document.getElementById('ct-tag-input').value);document.getElementById('ct-tag-input').value='';">Add</button>
    </div>
    <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Press Enter or comma · click ✕ to remove</div>
  </div>`;
}

window.editContact = function(rowIndex) {
  const c = _contacts.find(x => x.row_index === rowIndex);
  if (!c) return;
  _editingContactRowIndex = rowIndex;
  openModal(`Edit: ${c.name}`, `
    ${field('Name', 'cf-name', c.name)}
    ${SmartFields.autocomplete('Organization', 'cf-org', c.organization, 'orgs')}
    ${field('Title', 'cf-title', c.title)}
    ${field('Email', 'cf-email', c.email, 'email')}
    ${field('Office Phone', 'cf-phone', c.office_phone)}
    ${field('Work Cell', 'cf-cell', c.work_cell)}
    ${field('Website', 'cf-website', c.website)}
    ${textareaField('Public Bio', 'cf-notes', c.notes)}
    <div class="form-field"><label for="cf-internal-notes" style="color:var(--text-muted);">Internal Notes <span style="font-weight:400;font-size:11px;">(private — never shown in newsletters)</span></label><textarea id="cf-internal-notes" style="background:var(--surface-alt);">${esc(c.internal_notes || '')}</textarea></div>
    ${checkboxField('Receives Newsletter', 'cf-newsletter', c.receive_newsletter)}
    ${SmartFields.imagePicker('Profile Photo URL', 'cf-image', c.image_url)}
    ${_contactTagsField()}
  `, async () => {
    try {
      await apiFetch(`/api/contacts/${c.row_index}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: val('cf-name'), organization: val('cf-org'), title: val('cf-title'),
          email: val('cf-email'), office_phone: val('cf-phone'), work_cell: val('cf-cell'),
          website: val('cf-website'), notes: val('cf-notes'),
          internal_notes: val('cf-internal-notes'),
          receive_newsletter: chk('cf-newsletter'),
          image_url: val('cf-image'),
        }),
      });
      await apiFetch(`/api/contacts/${c.row_index}/meta`, {
        method: 'PATCH',
        body: JSON.stringify({ tags: _editingContactTags }),
      });
      closeModal();
      _editingContactRowIndex = null;
      toast('Contact updated', 'success');
      EventBus.emit('data:changed');
      loadContacts();
    } catch (err) { toast('Update failed: ' + err.message, 'error'); }
  });
  ctTagsInit(c.tags || []);
};

document.getElementById('addContactBtn').addEventListener('click', () => {
  openModal('Add Contact', `
    ${field('Name', 'cf-name', '')}
    ${SmartFields.autocomplete('Organization', 'cf-org', '', 'orgs')}
    ${field('Title', 'cf-title', '')}
    ${field('Email', 'cf-email', '', 'email')}
    ${field('Office Phone', 'cf-phone', '')}
    ${field('Work Cell', 'cf-cell', '')}
    ${field('Website', 'cf-website', '')}
    ${textareaField('Public Bio', 'cf-notes', '')}
    ${textareaField('Internal Notes', 'cf-internal-notes', '')}
    ${checkboxField('Receives Newsletter', 'cf-newsletter', true)}
    ${SmartFields.imagePicker('Profile Photo URL', 'cf-image', '')}
  `, async () => {
    try {
      await apiFetch('/api/contacts', {
        method: 'POST',
        body: JSON.stringify({
          name: val('cf-name'), organization: val('cf-org'), title: val('cf-title'),
          email: val('cf-email'), office_phone: val('cf-phone'), work_cell: val('cf-cell'),
          website: val('cf-website'), notes: val('cf-notes'),
          internal_notes: val('cf-internal-notes'),
          receive_newsletter: chk('cf-newsletter'),
          image_url: val('cf-image'),
        }),
      });
      closeModal();
      toast('Contact added', 'success');
      EventBus.emit('data:changed');
      loadContacts();
    } catch (err) { toast('Add failed: ' + err.message, 'error'); }
  });
});

let _searchTimer;
document.getElementById('contactSearch').addEventListener('input', e => {
  clearTimeout(_searchTimer);
  _contactQuery = e.target.value.trim();
  _searchTimer = setTimeout(applyContactFilters, 250);
});

// Contact sort header clicks
document.getElementById('contactsTable').addEventListener('click', e => {
  const btn = e.target.closest('.th-sort[data-sort]');
  if (!btn) return;
  const key = btn.dataset.sort;
  if (_contactSort.key === key) _contactSort.dir *= -1;
  else { _contactSort.key = key; _contactSort.dir = 1; }
  applyContactFilters();
});

// ── EVENTS ───────────────────────────────────────────────────────────────────

const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];
const WEEK_DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

let _events         = [];
let _eventImgMap    = {};   // row_index (string) → [image objects]
let _calView        = 'calendar';
let _calYear        = new Date().getFullYear();
let _calMonth       = new Date().getMonth();
let _calSelectedDay = null;
let _eventSort      = { key: 'days', dir: 1 };

function parseEventDate(days) {
  if (!days) return null;
  const m = days.match(/([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})/);
  if (m) {
    const d = new Date(`${m[1]} ${m[2]}, ${m[3]}`);
    if (!isNaN(d.getTime())) return d;
  }
  const d2 = new Date(days);
  if (!isNaN(d2.getTime()) && d2.getFullYear() > 2000) return d2;
  return null;
}

async function loadEvents() {
  document.getElementById('eventCount').textContent = '';
  try {
    const [evJson, imgJson] = await Promise.all([
      apiFetch('/api/events'),
      apiFetch('/api/images').catch(() => ({ data: [] })),
    ]);
    _events = evJson.data || [];
    // Build reverse map: row_index → linked images
    _eventImgMap = {};
    for (const img of (imgJson.data || [])) {
      for (const rid of (img.event_ids || [])) {
        (_eventImgMap[String(rid)] = _eventImgMap[String(rid)] || []).push(img);
      }
    }
    document.getElementById('eventCount').textContent =
      `${_events.length} event${_events.length !== 1 ? 's' : ''}`;
    renderEventsView();
  } catch (err) {
    document.getElementById('eventsCalendarView').innerHTML =
      `<div style="color:var(--danger);padding:40px;text-align:center;">Error: ${esc(err.message)}</div>`;
    toast('Failed to load events: ' + err.message, 'error');
  }
}

function renderEventsView() {
  const calView  = document.getElementById('eventsCalendarView');
  const listView = document.getElementById('eventsListView');
  const calBtn   = document.getElementById('eventsCalBtn');
  const listBtn  = document.getElementById('eventsListBtn');
  if (_calView === 'calendar') {
    calView.style.display  = '';
    listView.style.display = 'none';
    calBtn.classList.add('active');
    listBtn.classList.remove('active');
    renderCalendar();
  } else {
    calView.style.display  = 'none';
    listView.style.display = '';
    calBtn.classList.remove('active');
    listBtn.classList.add('active');
    const sorted = sortBy(_events, _eventSort.key, _eventSort.dir);
    renderEventRows(sorted);
    refreshSortIndicators('eventsTable', _eventSort.key, _eventSort.dir);
  }
}

document.getElementById('eventsCalBtn').addEventListener('click', () => {
  _calView = 'calendar'; renderEventsView();
});
document.getElementById('eventsListBtn').addEventListener('click', () => {
  _calView = 'list'; renderEventsView();
});

// Event list sort header clicks
document.getElementById('eventsTable').addEventListener('click', e => {
  const btn = e.target.closest('.th-sort[data-sort-events]');
  if (!btn) return;
  const key = btn.dataset.sortEvents;
  if (_eventSort.key === key) _eventSort.dir *= -1;
  else { _eventSort.key = key; _eventSort.dir = 1; }
  renderEventsView();
});

// ── Calendar renderer ─────────────────────────────────────────────────────────

function renderCalendar() {
  const container = document.getElementById('eventsCalendarView');
  const today     = new Date();

  // Partition events
  const datedEvents = [], recurringEvents = [];
  _events.forEach(e => {
    const d = parseEventDate(e.days);
    if (d) datedEvents.push({ ...e, _date: d });
    else   recurringEvents.push(e);
  });

  // Index dated events by "Y-M-D"
  const byDay = {};
  datedEvents.forEach(e => {
    const k = `${e._date.getFullYear()}-${e._date.getMonth()}-${e._date.getDate()}`;
    (byDay[k] = byDay[k] || []).push(e);
  });

  const firstDay  = new Date(_calYear, _calMonth, 1);
  const lastDate  = new Date(_calYear, _calMonth + 1, 0).getDate();
  const startDow  = firstDay.getDay();

  // Build cell list (null = empty padding)
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= lastDate; d++) cells.push(d);
  while (cells.length % 7) cells.push(null);

  const sel = _calSelectedDay;

  const dayPanelHtml = sel ? (() => {
    const k = `${sel.year}-${sel.month}-${sel.day}`;
    const evs = byDay[k] || [];
    const label = `${MONTHS[sel.month]} ${sel.day}, ${sel.year}`;
    const preDate = `${MONTHS[sel.month]} ${sel.day}, ${sel.year}`;
    return `
      <div class="cal-day-panel">
        <div class="cal-day-panel-header">
          <strong>${label}</strong>
          <button class="btn btn-sm btn-ghost" onclick="calSelectDay(null)">✕</button>
        </div>
        ${evs.length ? evs.map(e => `
          <div class="cal-day-event">
            <div class="cde-title"><strong>${esc(e.title)}</strong>
              ${e.organization ? `<span style="color:var(--text-muted);font-size:12px;margin-left:6px;">— ${esc(e.organization)}</span>` : ''}
            </div>
            ${e.start_time ? `<div class="cde-meta">🕐 ${esc(e.start_time)}${e.end_time ? ' – ' + esc(e.end_time) : ''}</div>` : ''}
            ${e.location    ? `<div class="cde-meta">📍 ${esc(e.location)}</div>` : ''}
            ${e.virtual_location ? `<div class="cde-meta">🔗 <a href="${esc(e.virtual_location)}" target="_blank" style="color:var(--accent)">Virtual link</a></div>` : ''}
            ${e.description ? `<div class="cde-desc">${esc(e.description)}</div>` : ''}
            ${(() => {
              const imgs = _eventImgMap[String(e.row_index)] || [];
              return imgs.length ? `<div class="cde-fliers">${imgs.slice(0,4).map(img =>
                `<img src="${esc(img.thumb_url || img.url)}" title="${esc(img.name || '')}"
                      class="cde-flier-thumb">`).join('')}${imgs.length > 4 ? `<span class="cde-flier-more">+${imgs.length - 4}</span>` : ''}</div>` : '';
            })()}
            <div class="cde-actions">
              <button class="btn btn-sm btn-ghost" onclick="editEvent(${e.row_index})">Edit</button>
              <button class="btn btn-sm btn-danger" onclick="deleteEvent(${e.row_index})">Del</button>
            </div>
          </div>
        `).join('') : `<div style="color:var(--text-muted);font-size:13px;padding:8px 0;">No events on this day.</div>`}
        <button class="btn btn-sm btn-outline" style="margin-top:8px;"
                onclick="addEventOnDay('${esc(preDate)}')">+ Add Event on This Day</button>
      </div>`;
  })() : '';

  container.innerHTML = `
    <div class="cal-header">
      <button class="btn btn-sm btn-ghost" id="calPrevBtn">‹ Prev</button>
      <h3 style="flex:1;text-align:center;font-size:16px;font-weight:700;">${MONTHS[_calMonth]} ${_calYear}</h3>
      <button class="btn btn-sm btn-ghost" id="calTodayBtn">Today</button>
      <button class="btn btn-sm btn-ghost" id="calNextBtn">Next ›</button>
    </div>
    <div class="cal-grid">
      ${WEEK_DAYS.map(d => `<div class="cal-day-header">${d}</div>`).join('')}
      ${cells.map(day => {
        if (!day) return '<div class="cal-day-empty"></div>';
        const k = `${_calYear}-${_calMonth}-${day}`;
        const isToday = today.getFullYear() === _calYear &&
                        today.getMonth() === _calMonth &&
                        today.getDate() === day;
        const isSel   = sel && sel.year === _calYear &&
                        sel.month === _calMonth && sel.day === day;
        const evs = byDay[k] || [];
        return `
          <div class="cal-day ${isToday ? 'today' : ''} ${isSel ? 'selected' : ''}"
               onclick="calSelectDay(${_calYear},${_calMonth},${day})">
            <div class="cal-day-num">${day}</div>
            ${evs.slice(0,3).map(e => `
              <div class="cal-event-chip" title="${esc(e.title)}"
                   onclick="event.stopPropagation();editEvent(${e.row_index})">
                ${esc(e.title)}
              </div>`).join('')}
            ${evs.length > 3 ? `<div class="cal-event-more">+${evs.length - 3} more</div>` : ''}
          </div>`;
      }).join('')}
    </div>
    ${dayPanelHtml}
    ${recurringEvents.length ? `
      <div class="cal-recurring">
        <div class="cal-recurring-header">🔄 Recurring / Ongoing Events</div>
        ${recurringEvents.map(e => `
          <div class="cal-recurring-row">
            <div style="flex:1;">
              <strong>${esc(e.title)}</strong>
              ${e.organization ? `<span class="badge badge-blue" style="margin-left:6px;">${esc(e.organization)}</span>` : ''}
              <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
                ${esc(e.days)}${e.start_time ? ' · ' + esc(e.start_time) : ''}
              </div>
            </div>
            <div style="display:flex;gap:4px;flex-shrink:0;">
              <button class="btn btn-sm btn-ghost" onclick="editEvent(${e.row_index})">Edit</button>
              <button class="btn btn-sm btn-danger" onclick="deleteEvent(${e.row_index})">Del</button>
            </div>
          </div>`).join('')}
      </div>` : ''}
  `;

  document.getElementById('calPrevBtn').addEventListener('click', () => {
    if (_calMonth === 0) { _calMonth = 11; _calYear--; } else _calMonth--;
    renderCalendar();
  });
  document.getElementById('calNextBtn').addEventListener('click', () => {
    if (_calMonth === 11) { _calMonth = 0; _calYear++; } else _calMonth++;
    renderCalendar();
  });
  document.getElementById('calTodayBtn').addEventListener('click', () => {
    const n = new Date(); _calYear = n.getFullYear(); _calMonth = n.getMonth();
    _calSelectedDay = null; renderCalendar();
  });
}

window.calSelectDay = function(year, month, day) {
  if (year === null ||
      (_calSelectedDay && _calSelectedDay.year === year &&
       _calSelectedDay.month === month && _calSelectedDay.day === day)) {
    _calSelectedDay = null;
  } else {
    _calSelectedDay = { year, month, day };
  }
  renderCalendar();
};

// ── Event list render ─────────────────────────────────────────────────────────

function renderEventRows(events) {
  const body = document.getElementById('eventsBody');
  if (!events.length) {
    body.innerHTML = '<tr><td colspan="8" class="loading">No events found.</td></tr>';
    return;
  }
  body.innerHTML = events.map(e => {
    const linkedImgs = _eventImgMap[String(e.row_index)] || [];
    return `
    <tr>
      <td>${esc(e.days)}</td>
      <td>
        <strong>${esc(e.title)}</strong>
        ${linkedImgs.length ? `<div class="ev-row-thumbs">${linkedImgs.slice(0,3).map(img =>
          `<img src="${esc(img.thumb_url || img.url)}" title="${esc(img.name || '')}" class="ev-row-thumb">`).join('')}${linkedImgs.length > 3 ? `<span class="ev-row-thumb-more">+${linkedImgs.length - 3}</span>` : ''}</div>` : ''}
      </td>
      <td>${esc(e.organization)}</td>
      <td>${esc(e.start_time)}${e.end_time ? ' – ' + esc(e.end_time) : ''}</td>
      <td>${esc(e.location)}</td>
      <td>${e.virtual_location ? `<a href="${esc(e.virtual_location)}" target="_blank" style="color:var(--accent)">Link</a>` : ''}</td>
      <td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(e.description)}</td>
      <td style="display:flex;gap:4px;">
        <button class="btn btn-sm btn-ghost" onclick="editEvent(${e.row_index})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteEvent(${e.row_index})">Del</button>
      </td>
    </tr>
  `; }).join('');
}

// ── Event modal fields ────────────────────────────────────────────────────────

function eventModalFields(e = {}) {
  return `
    ${SmartFields.datePicker('Date', 'ef-days-date', 'ef-days-text', e.days || '')}
    ${field('Title', 'ef-title', e.title || '')}
    ${SmartFields.autocomplete('Organization', 'ef-org', e.organization || '', 'orgs')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${SmartFields.timePicker('Start Time', 'ef-start', e.start_time || '')}
      ${SmartFields.timePicker('End Time',   'ef-end',   e.end_time   || '')}
    </div>
    ${SmartFields.location('Physical Location', 'ef-loc', e.location || '')}
    ${field('Zoom / Virtual Link', 'ef-virt', e.virtual_location || '')}
    ${SmartFields.autocomplete('Contact Email', 'ef-email', e.contact_email || '', 'emails')}
    ${textareaField('Description', 'ef-desc', e.description || '')}

    <div style="margin:18px 0 10px;border-top:1px solid var(--border);padding-top:14px;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
                  color:var(--text-muted);margin-bottom:12px;">Event Assets (local only — not synced to sheet)</div>
      ${SmartFields.imagePicker('Event Icon', 'ef-icon', e.icon_url || '')}

      <div class="form-field">
        <label>Tags</label>
        <div id="ef-tags-chips" class="img-tags-row" style="min-height:28px;margin-bottom:6px;"></div>
        <div style="display:flex;gap:6px;">
          <input type="text" id="ef-tag-input" placeholder="Add a tag…"
                 style="flex:1;" list="ef-tag-suggestions" autocomplete="off">
          <datalist id="ef-tag-suggestions"></datalist>
          <button type="button" class="btn btn-sm btn-outline"
                  onclick="evTagAdd(document.getElementById('ef-tag-input').value);document.getElementById('ef-tag-input').value='';">Add</button>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Press Enter or comma to add · click ✕ to remove</div>
      </div>

      <div class="form-field">
        <label>Linked Fliers</label>
        <div id="ef-linked-imgs" style="display:flex;flex-wrap:wrap;gap:8px;min-height:28px;margin-bottom:8px;align-items:center;">
          ${e.row_index != null ? '' : '<span style="font-size:12px;color:var(--text-muted);">Save event first to link fliers</span>'}
        </div>
        ${e.row_index != null
          ? `<button type="button" class="btn btn-sm btn-outline" onclick="evPickFlier()">📷 Attach Flier from Library</button>`
          : ''}
      </div>
    </div>
  `;
}

function collectEventData() {
  return {
    days:             SmartFields.getDateOrText('ef-days-date', 'ef-days-text'),
    title:            val('ef-title'),
    organization:     val('ef-org'),
    start_time:       SmartFields.getTimeVal('ef-start') || val('ef-start'),
    end_time:         SmartFields.getTimeVal('ef-end')   || val('ef-end'),
    location:         val('ef-loc'),
    virtual_location: val('ef-virt'),
    contact_email:    val('ef-email'),
    description:      val('ef-desc'),
    icon_url:         val('ef-icon'),
  };
}

window.editEvent = function(rowIndex) {
  const e = _events.find(x => x.row_index === rowIndex);
  if (!e) return;
  _editingEventRowIndex = rowIndex;
  openModal(`Edit Event: ${e.title}`, eventModalFields(e), async () => {
    try {
      await apiFetch(`/api/events/${e.row_index}`, { method: 'PUT', body: JSON.stringify(collectEventData()) });
      // Save local-only metadata (tags + icon_url)
      if (_editingEventTags !== undefined) {
        const iconUrl = val('ef-icon') || '';
        await apiFetch(`/api/events/${e.row_index}/meta`, {
          method: 'PATCH',
          body: JSON.stringify({ tags: _editingEventTags, icon_url: iconUrl }),
        });
      }
      closeModal();
      _editingEventRowIndex = null;
      toast('Event updated', 'success');
      EventBus.emit('data:changed');
      loadEvents();
    } catch (err) { toast('Update failed: ' + err.message, 'error'); }
  });
  // Init tags chips and load linked fliers after modal is in the DOM
  evTagsInit(e.tags || []);
  evLinkedImgsLoad(rowIndex);
};

window.deleteEvent = async function(rowIndex) {
  const e = _events.find(x => x.row_index === rowIndex);
  const label = e ? `"${e.title}"` : 'this event';
  if (!confirm(`Delete ${label}?`)) return;
  if (!confirm(`This will permanently remove it from the spreadsheet. Continue?`)) return;
  try {
    await apiFetch(`/api/events/${rowIndex}`, { method: 'DELETE' });
    toast('Event deleted', 'success');
    EventBus.emit('data:changed');
    loadEvents();
  } catch (err) { toast('Delete failed: ' + err.message, 'error'); }
};

async function _saveNewEvent() {
  const json = await apiFetch('/api/events', { method: 'POST', body: JSON.stringify(collectEventData()) });
  // Save local-only metadata (tags + icon_url)
  const rowIndex = json.data?.row_index;
  if (rowIndex != null) {
    const iconUrl = val('ef-icon') || '';
    const meta = { tags: _editingEventTags };
    if (iconUrl) meta.icon_url = iconUrl;
    if (meta.tags.length || meta.icon_url) {
      await apiFetch(`/api/events/${rowIndex}/meta`, { method: 'PATCH', body: JSON.stringify(meta) });
    }
  }
  _editingEventRowIndex = null;
  closeModal();
  toast('Event added', 'success');
  EventBus.emit('data:changed');
  loadEvents();
}

function _openAddEventModal(prefill = {}) {
  _editingEventRowIndex = null;
  openModal('Add Event', eventModalFields(prefill), async () => {
    try { await _saveNewEvent(); }
    catch (err) { toast('Add failed: ' + err.message, 'error'); }
  });
  evTagsInit([]);
}

window.addEventOnDay = function(dateStr) { _openAddEventModal({ days: dateStr }); };

document.getElementById('addEventBtn').addEventListener('click', () => { _openAddEventModal(); });

// ── PRESENTERS ───────────────────────────────────────────────────────────────

let _presenters     = [];
let _presenterView  = 'card';
let _presenterSort  = { key: 'presentation_month', dir: 1 };

function presenterSortedList() {
  return [..._presenters].sort((a, b) => {
    const { key, dir } = _presenterSort;
    if (key === 'presentation_month') {
      // Primary: year; Secondary: month index
      const ay = parseInt(a.presentation_year) || 9999;
      const by = parseInt(b.presentation_year) || 9999;
      if (ay !== by) return (ay - by) * dir;
      let ai = MONTHS.indexOf(a.presentation_month);
      let bi = MONTHS.indexOf(b.presentation_month);
      if (ai === -1) ai = 99;
      if (bi === -1) bi = 99;
      return (ai - bi) * dir;
    }
    const av = String(a[key] ?? '').toLowerCase();
    const bv = String(b[key] ?? '').toLowerCase();
    return av < bv ? -dir : av > bv ? dir : 0;
  });
}

async function loadPresenters() {
  const cardView = document.getElementById('presenterCardView');
  if (cardView) cardView.innerHTML =
    '<div style="color:var(--text-muted);text-align:center;padding:40px;">Loading…</div>';
  try {
    const json = await apiFetch('/api/presenters');
    _presenters = json.data || [];
    document.getElementById('presenterCount').textContent =
      `${_presenters.length} presenter${_presenters.length !== 1 ? 's' : ''}`;
    renderPresentersView();
  } catch (err) {
    const cardView = document.getElementById('presenterCardView');
    if (cardView) cardView.innerHTML =
      `<div style="color:var(--danger);text-align:center;padding:40px;">Error: ${esc(err.message)}</div>`;
    toast('Failed to load presenters: ' + err.message, 'error');
  }
}

function renderPresentersView() {
  const cardView  = document.getElementById('presenterCardView');
  const listView  = document.getElementById('presenterListView');
  const cardBtn   = document.getElementById('presenterCardBtn');
  const listBtn   = document.getElementById('presenterListBtn');
  const sorted    = presenterSortedList();
  if (_presenterView === 'card') {
    cardView.style.display = '';
    listView.style.display = 'none';
    cardBtn.classList.add('active');
    listBtn.classList.remove('active');
    renderPresenterCards(sorted);
  } else {
    cardView.style.display = 'none';
    listView.style.display = '';
    cardBtn.classList.remove('active');
    listBtn.classList.add('active');
    renderPresenterList(sorted);
  }
  // Sync sort direction button label
  const dirBtn = document.getElementById('presenterSortDirBtn');
  if (dirBtn) dirBtn.textContent = _presenterSort.dir === 1 ? '↑' : '↓';
}

function getPresenterAvatar(name) {
  const match = _contacts.find(c => c.name.toLowerCase() === name.toLowerCase());
  return match?.image_url || DEFAULT_AVATAR;
}

function renderPresenterCards(presenters) {
  const grid = document.getElementById('presenterCardView');
  if (!presenters.length) {
    grid.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:60px;grid-column:1/-1;">No presenters yet. Add the first one!</div>';
    return;
  }
  grid.innerHTML = presenters.map(p => {
    const avatar = getPresenterAvatar(p.name);
    return `
    <div class="presenter-card">
      <div class="presenter-card-header">
        <img class="presenter-avatar" src="${esc(avatar)}"
             alt="${esc(p.name)}"
             onclick="contactAvatarZoom('${esc(avatar)}','${esc(p.name)}')"
             onerror="this.src='${DEFAULT_AVATAR}'">
        <div class="presenter-name">${esc(p.name)}</div>
        <div class="presenter-org">${esc(p.organization)}</div>
        ${p.presentation_month ? `<div class="presenter-month">${esc(p.presentation_month)}${p.presentation_year ? ' ' + esc(p.presentation_year) : ''}</div>` : ''}
      </div>
      ${p.description ? `<div class="presenter-card-body">${esc(p.description)}</div>` : ''}
      ${(p.tags || []).length ? `<div style="display:flex;flex-wrap:wrap;gap:4px;padding:0 10px 6px;">${p.tags.map(t => `<span style="font-size:11px;background:var(--bg-muted,#f1f5f9);border-radius:4px;padding:1px 6px;color:var(--text-muted);">#${esc(t)}</span>`).join('')}</div>` : ''}
      <div class="presenter-card-footer">
        ${p.slides_link ? `<a class="btn btn-sm btn-ghost" href="${esc(p.slides_link)}" target="_blank" rel="noopener">📊 Slides</a>` : ''}
        ${(p.resource_links || []).map(lnk => `<a class="btn btn-sm btn-ghost" href="${esc(lnk.url)}" target="_blank" rel="noopener">🔗 ${esc(lnk.label)}</a>`).join('')}
        <button class="btn btn-sm btn-ghost" onclick="editPresenter(${p.row_index})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deletePresenter(${p.row_index})">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function renderPresenterList(presenters) {
  const body = document.getElementById('presenterBody');
  if (!presenters.length) {
    body.innerHTML = '<tr><td colspan="7" class="loading">No presenters found.</td></tr>';
    return;
  }
  body.innerHTML = presenters.map(p => {
    const avatar = getPresenterAvatar(p.name);
    return `
    <tr>
      <td style="padding:4px 8px;">
        <img src="${esc(avatar)}" alt=""
             style="width:28px;height:28px;border-radius:50%;object-fit:cover;display:block;cursor:zoom-in;"
             onclick="contactAvatarZoom('${esc(avatar)}','${esc(p.name)}')"
             onerror="this.src='${DEFAULT_AVATAR}'">
      </td>
      <td><strong>${esc(p.name)}</strong></td>
      <td>${esc(p.organization)}</td>
      <td>${esc(p.presentation_month)}${p.presentation_year ? ' ' + esc(p.presentation_year) : ''}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
          title="${esc(p.description)}">${esc(p.description)}</td>
      <td>${p.slides_link ? `<a href="${esc(p.slides_link)}" target="_blank" style="color:var(--accent)">Link</a>` : ''}</td>
      <td style="display:flex;gap:4px;">
        <button class="btn btn-sm btn-ghost" onclick="editPresenter(${p.row_index})">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deletePresenter(${p.row_index})">Delete</button>
      </td>
    </tr>`;
  }).join('');
}

function monthSelectField(label, id, value = '') {
  return `<div class="form-field">
    <label for="${id}">${label}</label>
    <select id="${id}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--surface);">
      <option value="">— Select month —</option>
      ${MONTHS.map(m => `<option value="${esc(m)}"${m === value ? ' selected' : ''}>${m}</option>`).join('')}
    </select>
  </div>`;
}

function yearSelectField(label, id, value = '') {
  const thisYear = new Date().getFullYear();
  const years = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2];
  return `<div class="form-field">
    <label for="${id}">${label}</label>
    <select id="${id}" style="width:100%;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13px;background:var(--surface);">
      <option value="">— Select year —</option>
      ${years.map(y => `<option value="${y}"${String(y) === String(value) ? ' selected' : ''}>${y}</option>`).join('')}
    </select>
  </div>`;
}

// ── Presenter tag + resource link helpers ─────────────────────────────────────

let _editingPresenterTags  = [];
let _editingPresenterLinks = [];   // [{label, url}]

function ptTagsRender() {
  const wrap = document.getElementById('pt-tags-chips');
  if (!wrap) return;
  wrap.innerHTML = _editingPresenterTags.length
    ? _editingPresenterTags.map((t, i) =>
        `<span class="img-tag-chip">${esc(t)}<button class="img-tag-chip-remove" onclick="ptTagRemove(${i})" title="Remove">✕</button></span>`).join('')
    : `<span style="font-size:12px;color:var(--text-muted);">No tags yet</span>`;
}
window.ptTagRemove = function(i) { _editingPresenterTags.splice(i, 1); ptTagsRender(); };
function ptTagAdd(raw) {
  const tag = raw.trim().toLowerCase();
  if (!tag || _editingPresenterTags.includes(tag)) return;
  _editingPresenterTags.push(tag);
  ptTagsRender();
  fetch('/api/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tag }) }).catch(() => {});
}
function ptTagsInit(existing) {
  _editingPresenterTags = [...(existing || [])];
  ptTagsRender();
  const dl = document.getElementById('pt-tag-suggestions');
  if (dl) fetch('/api/tags').then(r => r.json()).then(json => {
    if (json.ok) dl.innerHTML = json.data.map(t => `<option value="${esc(t)}">`).join('');
  }).catch(() => {});
  const input = document.getElementById('pt-tag-input');
  if (!input) return;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); ptTagAdd(input.value); input.value = ''; }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) { ptTagAdd(input.value); input.value = ''; }
  });
}

function ptLinksRender() {
  const wrap = document.getElementById('pt-links-list');
  if (!wrap) return;
  wrap.innerHTML = _editingPresenterLinks.map((lnk, i) => `
    <div style="display:flex;gap:6px;margin-bottom:4px;align-items:center;">
      <input type="text" placeholder="Label" value="${esc(lnk.label)}"
             style="width:110px;font-size:12px;" onchange="ptLinkUpdate(${i},'label',this.value)">
      <input type="text" placeholder="URL" value="${esc(lnk.url)}"
             style="flex:1;font-size:12px;" onchange="ptLinkUpdate(${i},'url',this.value)">
      <button type="button" class="btn btn-sm btn-ghost" style="padding:2px 6px;"
              onclick="ptLinkRemove(${i})">✕</button>
    </div>`).join('') || '<span style="font-size:12px;color:var(--text-muted);">No links yet</span>';
}
window.ptLinkUpdate = function(i, key, val) { _editingPresenterLinks[i][key] = val; };
window.ptLinkRemove = function(i) { _editingPresenterLinks.splice(i, 1); ptLinksRender(); };
window.ptLinkAdd    = function() { _editingPresenterLinks.push({ label: '', url: '' }); ptLinksRender(); };
function ptLinksInit(existing) {
  _editingPresenterLinks = (existing || []).map(l => ({ label: l.label || '', url: l.url || '' }));
  ptLinksRender();
}

function presenterFields(p = {}) {
  return `
    ${SmartFields.autocomplete('Name', 'pf-name', p.name || '', 'names')}
    ${SmartFields.autocomplete('Organization', 'pf-org', p.organization || '', 'orgs')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      ${monthSelectField('Presentation Month', 'pf-month', p.presentation_month || '')}
      ${yearSelectField('Presentation Year', 'pf-year', p.presentation_year || '')}
    </div>
    ${textareaField('Description', 'pf-desc', p.description || '')}
    ${field('Slides Link', 'pf-slides', p.slides_link || '')}
    <div class="form-field">
      <label>Tags</label>
      <div id="pt-tags-chips" class="img-tags-row" style="min-height:28px;margin-bottom:6px;"></div>
      <div style="display:flex;gap:6px;">
        <input type="text" id="pt-tag-input" placeholder="Add a tag…"
               style="flex:1;" list="pt-tag-suggestions" autocomplete="off">
        <datalist id="pt-tag-suggestions"></datalist>
        <button type="button" class="btn btn-sm btn-outline"
                onclick="ptTagAdd(document.getElementById('pt-tag-input').value);document.getElementById('pt-tag-input').value='';">Add</button>
      </div>
    </div>
    <div class="form-field">
      <label>Resource Links (slides, Drive, PDFs…)</label>
      <div id="pt-links-list" style="margin-bottom:6px;"></div>
      <button type="button" class="btn btn-sm btn-outline" onclick="ptLinkAdd()">+ Add Link</button>
    </div>
  `;
}

function _wirePresenterNameFill() {
  const nameInp = document.getElementById('pf-name');
  const orgInp  = document.getElementById('pf-org');
  if (!nameInp || !orgInp) return;
  nameInp.addEventListener('change', () => {
    if (orgInp.value) return;
    const match = _contacts.find(
      c => c.name.toLowerCase() === nameInp.value.toLowerCase()
    );
    if (match) orgInp.value = match.organization;
  });
}

function _collectPresenterData() {
  return {
    name:               val('pf-name'),
    organization:       val('pf-org'),
    presentation_month: document.getElementById('pf-month')?.value || '',
    presentation_year:  document.getElementById('pf-year')?.value  || '',
    description:        val('pf-desc'),
    slides_link:        val('pf-slides'),
  };
}

window.editPresenter = function(rowIndex) {
  const p = _presenters.find(x => x.row_index === rowIndex);
  if (!p) return;
  openModal(`Edit Presenter: ${p.name}`, presenterFields(p), async () => {
    try {
      await apiFetch(`/api/presenters/${p.row_index}`, {
        method: 'PUT',
        body: JSON.stringify(_collectPresenterData()),
      });
      await apiFetch(`/api/presenters/${p.row_index}/meta`, {
        method: 'PATCH',
        body: JSON.stringify({ tags: _editingPresenterTags, resource_links: _editingPresenterLinks }),
      });
      closeModal();
      toast('Presenter updated', 'success');
      EventBus.emit('data:changed');
      loadPresenters();
    } catch (err) { toast('Update failed: ' + err.message, 'error'); }
  });
  _wirePresenterNameFill();
  ptTagsInit(p.tags || []);
  ptLinksInit(p.resource_links || []);
};

window.deletePresenter = async function(rowIndex) {
  const p = _presenters.find(x => x.row_index === rowIndex);
  const label = p ? `"${p.name}"` : 'this presenter';
  if (!confirm(`Delete ${label}?`)) return;
  if (!confirm(`This will permanently remove them from the spreadsheet. Continue?`)) return;
  try {
    await apiFetch(`/api/presenters/${rowIndex}`, { method: 'DELETE' });
    toast('Presenter deleted', 'success');
    EventBus.emit('data:changed');
    loadPresenters();
  } catch (err) { toast('Delete failed: ' + err.message, 'error'); }
};

document.getElementById('addPresenterBtn').addEventListener('click', () => {
  openModal('Add Presenter', presenterFields(), async () => {
    try {
      const json = await apiFetch('/api/presenters', {
        method: 'POST',
        body: JSON.stringify(_collectPresenterData()),
      });
      const rowIndex = json.data?.row_index;
      if (rowIndex != null && (_editingPresenterTags.length || _editingPresenterLinks.length)) {
        await apiFetch(`/api/presenters/${rowIndex}/meta`, {
          method: 'PATCH',
          body: JSON.stringify({ tags: _editingPresenterTags, resource_links: _editingPresenterLinks }),
        });
      }
      closeModal();
      toast('Presenter added', 'success');
      EventBus.emit('data:changed');
      loadPresenters();
    } catch (err) { toast('Add failed: ' + err.message, 'error'); }
  });
  _wirePresenterNameFill();
  ptTagsInit([]);
  ptLinksInit([]);
});

document.getElementById('presenterCardBtn').addEventListener('click', () => {
  _presenterView = 'card'; renderPresentersView();
});
document.getElementById('presenterListBtn').addEventListener('click', () => {
  _presenterView = 'list'; renderPresentersView();
});

document.getElementById('presenterSortSelect').addEventListener('change', e => {
  _presenterSort.key = e.target.value;
  renderPresentersView();
});
document.getElementById('presenterSortDirBtn').addEventListener('click', () => {
  _presenterSort.dir *= -1;
  renderPresentersView();
});

// ── Init & event wiring ───────────────────────────────────────────────────────

EventBus.on('app:ready', () => loadContacts());
EventBus.on('data:synced', () => {
  loadContacts();
  loadEvents();
  loadPresenters();
});
EventBus.on('tab:changed', ({ tab }) => {
  if (tab === 'data') loadContacts();
});

let _eventsLoaded     = false;
let _presentersLoaded = false;
document.querySelectorAll('.subtab').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.subtab === 'events' && !_eventsLoaded) {
      _eventsLoaded = true; loadEvents();
    }
    if (btn.dataset.subtab === 'presenters' && !_presentersLoaded) {
      _presentersLoaded = true; loadPresenters();
    }
  });
});

