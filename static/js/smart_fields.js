/**
 * smart_fields.js — Reusable smart field components.
 * All render functions return HTML strings for injection via innerHTML.
 * Call SmartFields.initAll(container) after inserting HTML into DOM.
 */

const SmartFields = (() => {

  function esc(str) {
    return String(str ?? '')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;');
  }

  // ── Image Picker ────────────────────────────────────────────────────────────

  function imagePicker(label, id, value = '') {
    const hasImg = !!value;
    return `
      <div class="form-field sf-image-field">
        <label>${esc(label)}</label>
        <div class="sf-image-row">
          <div class="sf-image-preview" id="${id}_preview">
            ${hasImg
              ? `<img src="${esc(value)}" class="sf-img-thumb" alt="">`
              : `<div class="sf-img-placeholder">No image</div>`}
          </div>
          <div class="sf-image-controls">
            <input type="text" id="${id}" value="${esc(value)}"
                   class="sf-image-url-input" placeholder="Image URL" data-sf-img-inp>
            <div style="display:flex;gap:6px;margin-top:6px;">
              <button type="button" class="btn btn-sm btn-outline sf-choose-btn"
                      data-target="${id}">📷 Choose from Library</button>
              <button type="button" class="btn btn-sm btn-ghost sf-clear-btn"
                      data-target="${id}">✕ Clear</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Date Picker (with text fallback for recurring patterns) ─────────────────

  function datePicker(label, dateId, textId, value = '') {
    const dateVal = parseToInputDate(value);
    const isDate  = !!dateVal;
    return `
      <div class="form-field">
        <label>${esc(label)}</label>
        <input type="date" id="${dateId}" value="${esc(dateVal)}"
               style="margin-bottom:5px;" title="Pick a specific date">
        <div class="sf-or-divider">— or type a recurring pattern —</div>
        <input type="text" id="${textId}" value="${esc(isDate ? '' : value)}"
               placeholder="e.g. Every Tuesday, 3pm–5pm">
      </div>
    `;
  }

  function parseToInputDate(str) {
    if (!str) return '';
    str = str.trim();
    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(str)) return str;
    // MM-DD-YYYY
    const mdy = str.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (mdy) return `${mdy[3]}-${mdy[1].padStart(2,'0')}-${mdy[2].padStart(2,'0')}`;
    // Try native Date
    const d = new Date(str);
    if (!isNaN(d.getTime())) {
      // Avoid timezone off-by-one: parse as local
      const parts = str.match(/(\w+)\s+(\d+),?\s+(\d{4})/);
      if (parts) {
        const months = {january:1,february:2,march:3,april:4,may:5,june:6,
                        july:7,august:8,september:9,october:10,november:11,december:12};
        const m = months[parts[1].toLowerCase()];
        if (m) {
          const day = parts[2].padStart(2,'0');
          const mo  = String(m).padStart(2,'0');
          return `${parts[3]}-${mo}-${day}`;
        }
      }
      const y   = d.getFullYear();
      const mo  = String(d.getMonth() + 1).padStart(2,'0');
      const day = String(d.getDate()).padStart(2,'0');
      return `${y}-${mo}-${day}`;
    }
    return '';
  }

  /** Read a date/text combo field. Returns human-readable string for storage. */
  function getDateOrText(dateId, textId) {
    const dateVal = document.getElementById(dateId)?.value;
    if (dateVal) return formatDateForStorage(dateVal);
    return document.getElementById(textId)?.value?.trim() || '';
  }

  function formatDateForStorage(isoDate) {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-').map(Number);
    if (!y || !m || !d) return isoDate;
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    return `${months[m-1]} ${d}, ${y}`;
  }

  // ── Time Picker ─────────────────────────────────────────────────────────────

  function timePicker(label, id, value = '') {
    const timeVal = parseToInputTime(value);
    return `
      <div class="form-field">
        <label>${esc(label)}</label>
        <input type="time" id="${id}" value="${esc(timeVal)}"
               data-sf-time data-original="${esc(value)}">
      </div>
    `;
  }

  function parseToInputTime(str) {
    if (!str) return '';
    str = str.trim();
    if (/^\d{2}:\d{2}$/.test(str)) return str;
    const match = str.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
    if (match) {
      let h = parseInt(match[1]);
      const min  = (match[2] || '00');
      const ampm = (match[3] || '').toLowerCase();
      if (ampm === 'pm' && h !== 12) h += 12;
      if (ampm === 'am' && h === 12) h = 0;
      return `${String(h).padStart(2,'0')}:${min}`;
    }
    return '';
  }

  function formatTimeForDisplay(timeVal) {
    if (!timeVal) return '';
    const [hStr, mStr] = timeVal.split(':');
    let h = parseInt(hStr);
    const m    = mStr || '00';
    const ampm = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return `${h}:${m} ${ampm}`;
  }

  /** Read a time input and return display-friendly string. */
  function getTimeVal(id) {
    const raw = document.getElementById(id)?.value;
    return raw ? formatTimeForDisplay(raw) : '';
  }

  // ── Autocomplete ─────────────────────────────────────────────────────────────

  const _acCache = {};

  function autocomplete(label, id, value = '', listKey = '') {
    const listId = `sf-list-${listKey || id}`;
    return `
      <div class="form-field">
        <label>${esc(label)}</label>
        <input type="text" id="${id}" value="${esc(value)}"
               list="${listId}" autocomplete="off" data-sf-ac="${esc(listKey)}">
        <datalist id="${listId}"></datalist>
      </div>
    `;
  }

  async function _loadAcList(listKey) {
    if (_acCache[listKey]) return _acCache[listKey];
    try {
      const res  = await fetch(`/api/autocomplete/${listKey}`);
      const json = await res.json();
      if (json.ok) { _acCache[listKey] = json.data; return json.data; }
    } catch {}
    return [];
  }

  /** Clear cached autocomplete data — call after contacts/orgs/events change. */
  function invalidateCache(key = null) {
    if (key) { delete _acCache[key]; }
    else { Object.keys(_acCache).forEach(k => delete _acCache[k]); }
  }

  // ── Location with Nominatim ─────────────────────────────────────────────────

  function location(label, id, value = '') {
    return `
      <div class="form-field sf-location-field">
        <label>${esc(label)}</label>
        <div style="position:relative;">
          <input type="text" id="${id}" value="${esc(value)}"
                 autocomplete="off" data-sf-loc
                 placeholder="Start typing an address or place…">
          <ul class="sf-location-dropdown hidden" id="${id}_loc_list"></ul>
        </div>
      </div>
    `;
  }

  // ── Image picker modal ──────────────────────────────────────────────────────

  async function openImagePickerModal(targetInputId) {
    const existing = document.getElementById('_sfImagePickerModal');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = '_sfImagePickerModal';
    overlay.className = 'modal-overlay';
    overlay.innerHTML = `
      <div class="modal-box" style="width:620px;max-height:82vh;display:flex;flex-direction:column;">
        <div class="modal-header">
          <h2>Choose Image</h2>
          <button class="modal-close" id="_sfImgPickClose">✕</button>
        </div>
        <div style="padding:10px 16px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:10px;">
          <label class="btn btn-sm btn-outline" style="cursor:pointer;margin:0;">
            ⬆ Upload New
            <input type="file" accept="image/*" style="display:none" id="_sfImgPickUpload">
          </label>
          <span style="font-size:12px;color:var(--text-muted);">Click a thumbnail to select it</span>
        </div>
        <div class="modal-body" id="_sfImgPickGrid"
             style="flex:1;overflow-y:auto;padding:16px;min-height:200px;">
          <div style="color:var(--text-muted);text-align:center;padding:30px;">Loading…</div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    overlay.querySelector('#_sfImgPickClose').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    overlay.querySelector('#_sfImgPickUpload').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      const form = new FormData();
      form.append('file', file);
      form.append('name', file.name);
      if (typeof toast === 'function') toast('Uploading…', 'info');
      try {
        const res  = await fetch('/api/upload-image', { method: 'POST', body: form });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);
        if (typeof toast === 'function') toast('Uploaded!', 'success');
        await _renderPickerGrid(document.getElementById('_sfImgPickGrid'), targetInputId, overlay);
      } catch (err) {
        if (typeof toast === 'function') toast('Upload failed: ' + err.message, 'error');
      }
    });

    await _renderPickerGrid(document.getElementById('_sfImgPickGrid'), targetInputId, overlay);
  }

  async function _renderPickerGrid(container, targetInputId, overlay) {
    try {
      const res    = await fetch('/api/images');
      const json   = await res.json();
      const images = json.ok ? json.data : [];

      if (!images.length) {
        container.innerHTML = '<div style="color:var(--text-muted);text-align:center;padding:40px;">No images yet — upload one above!</div>';
        return;
      }

      container.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;">
          ${images.map(img => `
            <div class="sf-picker-thumb" data-url="${esc(img.url)}"
                 title="${esc(img.name || img.alt || 'Untitled')}">
              <img src="${esc(img.thumb_url || img.display_url || img.url)}"
                   style="width:100%;height:85px;object-fit:cover;display:block;"
                   alt="${esc(img.alt || '')}">
              <div class="sf-picker-label">${esc(img.name || 'Untitled')}</div>
            </div>
          `).join('')}
        </div>
      `;

      container.querySelectorAll('.sf-picker-thumb').forEach(el => {
        el.addEventListener('click', () => {
          const inp = document.getElementById(targetInputId);
          if (inp) {
            inp.value = el.dataset.url;
            _updatePreview(targetInputId, el.dataset.url);
          }
          overlay.remove();
        });
      });
    } catch (err) {
      container.innerHTML = `<div style="color:var(--danger);padding:20px;">Error: ${esc(err.message)}</div>`;
    }
  }

  function _updatePreview(id, url) {
    const preview = document.getElementById(id + '_preview');
    if (!preview) return;
    if (url) {
      preview.innerHTML = `<img src="${esc(url)}" class="sf-img-thumb" alt="" onerror="this.style.display='none'">`;
    } else {
      preview.innerHTML = `<div class="sf-img-placeholder">No image</div>`;
    }
  }

  // ── initAll: wire up interactivity after HTML injection ─────────────────────

  function initAll(container = document) {
    // Image picker — choose button
    container.querySelectorAll('.sf-choose-btn').forEach(btn => {
      btn.addEventListener('click', () => openImagePickerModal(btn.dataset.target));
    });

    // Image picker — clear button
    container.querySelectorAll('.sf-clear-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = document.getElementById(btn.dataset.target);
        if (inp) { inp.value = ''; _updatePreview(btn.dataset.target, ''); }
      });
    });

    // Image picker — URL typed manually → update preview
    container.querySelectorAll('[data-sf-img-inp]').forEach(inp => {
      inp.addEventListener('input', () => _updatePreview(inp.id, inp.value));
    });

    // Autocomplete datalist population + SyntaxEngine wiring
    container.querySelectorAll('[data-sf-ac]').forEach(async inp => {
      const key = inp.dataset.sfAc;
      if (!key) return;
      const list  = await _loadAcList(key);
      const dlId  = inp.getAttribute('list');
      const dl    = dlId ? document.getElementById(dlId) : null;
      if (dl) dl.innerHTML = list.map(v => `<option value="${esc(v)}">`).join('');
      // Layer SyntaxEngine on top so #tag / [[ / [ triggers work
      if (typeof SyntaxEngine !== 'undefined') SyntaxEngine.install(inp);
    });

    // Also wire explicit [data-se] inputs not covered above
    container.querySelectorAll('[data-se]:not([data-sf-ac])').forEach(inp => {
      if (typeof SyntaxEngine !== 'undefined') SyntaxEngine.install(inp);
    });

    // Location — Nominatim suggestions
    container.querySelectorAll('[data-sf-loc]').forEach(inp => {
      let _timer;
      inp.addEventListener('input', () => {
        clearTimeout(_timer);
        _timer = setTimeout(() => _fetchLocSuggestions(inp), 400);
      });
      inp.addEventListener('blur', () => {
        setTimeout(() => {
          const list = document.getElementById(inp.id + '_loc_list');
          if (list) list.classList.add('hidden');
        }, 180);
      });
    });
  }

  async function _fetchLocSuggestions(inp) {
    const q    = inp.value.trim();
    const list = document.getElementById(inp.id + '_loc_list');
    if (!q || q.length < 3 || !list) return;
    try {
      const url  = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&countrycodes=us&limit=5`;
      const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      if (!data.length) { list.classList.add('hidden'); return; }
      list.innerHTML = data.map(r =>
        `<li data-val="${esc(r.display_name)}">${esc(r.display_name)}</li>`
      ).join('');
      list.classList.remove('hidden');
      list.querySelectorAll('li').forEach(li => {
        li.addEventListener('mousedown', () => {
          inp.value = li.dataset.val;
          list.classList.add('hidden');
        });
      });
    } catch { list.classList.add('hidden'); }
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  return {
    imagePicker,
    datePicker,
    timePicker,
    autocomplete,
    location,
    initAll,
    getDateOrText,
    getTimeVal,
    formatDateForStorage,
    formatTimeForDisplay,
    parseToInputDate,
    openImagePickerModal,
    invalidateCache,
  };

})();
