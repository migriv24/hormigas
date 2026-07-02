/**
 * resources_tab.js — Attached Resources tab.
 * PDFs and files used as email attachments, with page-preview graphic generation.
 * Mirrors the Images tab UX: language pairing, shared tag highlights, tag filter.
 */

// ── Boot marker (stored even before developer_tab.js initialises) ─────────────
ActionLog.record('sys', 'resources_tab: script loaded');

// ── State ─────────────────────────────────────────────────────────────────────

let _resources        = [];
let _resourceFileData = null;
let _hlSettings       = null;   // shared highlights config from settings.json
let _resViewMode      = localStorage.getItem('res-view') || 'grid';
let _resTagFilter     = {};     // tag → 'include' | 'exclude'
let _resTextFilter    = '';
let _resEditingId     = null;
let _resEditingTags   = [];
let _resPairPickerFor = null;   // resource id currently being paired
let _resTagSugs       = [];

// ── Language helpers ──────────────────────────────────────────────────────────

const RES_LANG_LABELS = { en: 'EN', es: 'ES', '': '—' };
const RES_LANG_COLORS = { en: '#2563eb', es: '#dc2626', '': '#6b7280' };

function resLangBadge(lang) {
  const l     = lang || '';
  const color = RES_LANG_COLORS[l] || '#6b7280';
  const label = RES_LANG_LABELS[l] || '—';
  return `<span style="background:${color};color:#fff;font-size:10px;font-weight:700;
    padding:2px 7px;border-radius:99px;letter-spacing:.04em;flex-shrink:0;">${label}</span>`;
}

// ── Highlight engine (tag-based glow, mirrors images_tab.js logic) ────────────

function _resHexToRgb(hex) {
  const c    = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
  return [parseInt(full.slice(0,2),16), parseInt(full.slice(2,4),16), parseInt(full.slice(4,6),16)];
}

function _resLerp(h1, h2, t) {
  const [r1,g1,b1] = _resHexToRgb(h1), [r2,g2,b2] = _resHexToRgb(h2);
  return `rgb(${Math.round(r1+(r2-r1)*t)},${Math.round(g1+(g2-g1)*t)},${Math.round(b1+(b2-b1)*t)})`;
}

function resComputeHighlight(r) {
  if (!_hlSettings?.enabled) return '';
  const rules   = _hlSettings.rules || [];
  const rTags   = r.tags || [];
  const matched = rules.filter(rule => rTags.includes(rule.tag));

  let color;
  if (rTags.length === 0) {
    color = _hlSettings.no_tag_color || '#9ca3af';
  } else if (matched.length === 0) {
    return '';
  } else if (matched.length > 1) {
    color = _hlSettings.conflict_color || '#3b82f6';
  } else {
    const rule = matched[0];
    if (rule.mode === 'solid') {
      color = rule.color || '#9ca3af';
    } else if (rule.mode === 'event_linked') {
      // Resources have no event_ids — always show unlinked color
      color = rule.color_unlinked || '#fed7aa';
    } else if (rule.mode === 'frequency') {
      // Frequency relative to other resources with this tag
      const maxF = Math.max(1, ..._resources
        .filter(i => (i.tags || []).includes(rule.tag))
        .map(i => (i.event_ids || []).length));
      const t = (r.event_ids || []).length / maxF;
      color = _resLerp(rule.color_min || '#bbf7d0', rule.color_max || '#16a34a', t);
    }
  }
  if (!color) return '';
  return `box-shadow: 0 0 0 3px ${color}, 0 0 14px 4px ${color}99;`;
}

// ── Tag filter ─────────────────────────────────────────────────────────────────

function _resAllTags() {
  const s = new Set();
  _resources.forEach(r => (r.tags || []).forEach(t => s.add(t)));
  return [...s].sort();
}

window.resToggleTagFilter = function(tag) {
  const cur = _resTagFilter[tag] || 'off';
  if (cur === 'off')          _resTagFilter[tag] = 'include';
  else if (cur === 'include') _resTagFilter[tag] = 'exclude';
  else                        delete _resTagFilter[tag];
  renderResources();
};

window.resClearFilters = function() {
  _resTagFilter = {};
  _resTextFilter = '';
  const tf = document.getElementById('resTextFilter');
  if (tf) tf.value = '';
  renderResources();
};

window.resOnTextFilter = function(val) {
  _resTextFilter = val.trim().toLowerCase();
  renderResources();
};

function _resPassesFilter(r) {
  const inc = Object.entries(_resTagFilter).filter(([,v]) => v === 'include').map(([k]) => k);
  const exc = Object.entries(_resTagFilter).filter(([,v]) => v === 'exclude').map(([k]) => k);
  const tags = r.tags || [];
  if (inc.length && !inc.some(t => tags.includes(t))) return false;
  if (exc.some(t => tags.includes(t)))                 return false;
  if (_resTextFilter) {
    const q = _resTextFilter;
    if (!r.display_name.toLowerCase().includes(q) && !tags.some(t => t.toLowerCase().includes(q)))
      return false;
  }
  return true;
}

function _resRenderFilterBar() {
  const bar = document.getElementById('resFilterBar');
  if (!bar) return;
  const allTags  = _resAllTags();
  const hasActive = Object.keys(_resTagFilter).length > 0 || _resTextFilter;

  bar.innerHTML = allTags.map(tag => {
    const state = _resTagFilter[tag] || 'off';
    const style = state === 'include'
      ? 'background:var(--accent,#0f766e);color:#fff;'
      : state === 'exclude'
        ? 'background:#fee2e2;color:#dc2626;text-decoration:line-through;'
        : 'background:var(--surface-alt,#f3f4f6);color:var(--text-muted);';
    return `<button onclick="resToggleTagFilter('${esc(tag)}')"
      style="${style}border:none;cursor:pointer;font-size:11px;padding:3px 10px;
             border-radius:99px;">${esc(tag)}</button>`;
  }).join('') + (hasActive
    ? `<button onclick="resClearFilters()" style="font-size:11px;color:var(--text-muted);
        background:none;border:none;cursor:pointer;padding:3px 6px;">✕ Clear</button>`
    : '');
}

// ── View toggle ────────────────────────────────────────────────────────────────

window.resToggleView = function() {
  _resViewMode = _resViewMode === 'grid' ? 'detail' : 'grid';
  localStorage.setItem('res-view', _resViewMode);
  const btn = document.getElementById('resViewToggle');
  if (btn) btn.textContent = _resViewMode === 'grid' ? '⊞' : '☰';
  renderResources();
};

// ── Load & render ──────────────────────────────────────────────────────────────

async function loadResources() {
  ActionLog.record('sys', 'loadResources: fetching resources…');
  try {
    const [stRes, rRes] = await Promise.all([
      fetch('/api/settings'),
      fetch('/api/resources'),
    ]);
    const stJson = await stRes.json();
    const rJson  = await rRes.json();
    if (!rJson.ok) {
      ActionLog.record('err', `loadResources: server error — ${rJson.error}`);
    }
    _hlSettings = stJson.ok ? (stJson.data?.highlights ?? null) : null;
    _resources  = rJson.ok  ? (rJson.data || []) : [];
    ActionLog.record('sys', `loadResources: ${_resources.length} resource(s) loaded`);

    fetch('/api/tags').then(r => r.json()).then(j => {
      if (j.ok) _resTagSugs = j.data || [];
      _populateTagDatalist('resourceTagSuggestions');
      _populateTagDatalist('reTagSuggestions');
    }).catch(() => {});

    renderResources();
  } catch (e) {
    ActionLog.record('err', `loadResources: unexpected error — ${e.message}`);
  }
}

function _populateTagDatalist(id) {
  const dl = document.getElementById(id);
  if (!dl) return;
  dl.innerHTML = _resTagSugs.map(t => `<option value="${esc(t)}">`).join('');
}

function renderResources() {
  _resRenderFilterBar();
  const list    = document.getElementById('resourceList');
  const empty   = document.getElementById('resourceEmpty');
  const countEl = document.getElementById('resourceCount');
  if (!list) return;

  const visible = _resources.filter(_resPassesFilter);
  if (countEl) countEl.textContent = `${_resources.length} resource${_resources.length !== 1 ? 's' : ''}`;

  if (visible.length === 0) {
    list.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  const btn = document.getElementById('resViewToggle');
  if (btn) btn.textContent = _resViewMode === 'grid' ? '⊞' : '☰';

  if (_resViewMode === 'detail') {
    list.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
    list.innerHTML = visible.map(_resourceRow).join('');
  } else {
    list.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px;';
    list.innerHTML = visible.map(_resourceCard).join('');
  }
}

// ── Card (grid view) ──────────────────────────────────────────────────────────

function _resourceCard(r) {
  const hl        = resComputeHighlight(r);
  const hlStyle   = hl ? `style="${hl}"` : '';
  const hasGfx    = !!r.generated_image_url;
  const lang      = r.language || '';
  const partner   = r.pair_id ? _resources.find(x => x.pair_id === r.pair_id && x.id !== r.id) : null;
  const pages     = r.page_count ? `${r.page_count}p` : '';
  const date      = r.uploaded_at ? new Date(r.uploaded_at).toLocaleDateString() : '—';
  const typeLabel = (r.resource_type || 'file').toUpperCase();

  const tagsHtml = (r.tags || []).length
    ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;">
        ${r.tags.map(t => `<span style="font-size:11px;background:var(--primary-soft,#dbeafe);
          color:var(--primary,#2563eb);padding:2px 8px;border-radius:99px;">${esc(t)}</span>`).join('')}
       </div>` : '';

  const previewSection = hasGfx
    ? `<div style="position:relative;margin:-1px -1px 0;border-radius:12px 12px 0 0;overflow:hidden;">
         <img src="${esc(r.generated_image_url)}" alt="Preview"
              style="width:100%;height:160px;object-fit:cover;display:block;">
         <div class="res-regen-overlay">
           <button class="btn btn-sm" style="font-size:11px;color:#fff;background:rgba(0,0,0,.5);
                   border:1px solid rgba(255,255,255,.3);"
                   onclick="generateResourceGraphic('${esc(r.id)}')">↺ Regenerate</button>
         </div>
       </div>`
    : `<div style="margin:-1px -1px 0;padding:24px 16px;
                   background:var(--surface-alt,#f3f4f6);border-radius:12px 12px 0 0;
                   display:flex;flex-direction:column;align-items:center;justify-content:center;
                   gap:8px;border-bottom:1px solid var(--border);min-height:120px;cursor:pointer;"
            onclick="generateResourceGraphic('${esc(r.id)}')" class="res-preview-cta">
         <div style="font-size:32px;">📄</div>
         <div style="font-size:12px;color:var(--text-muted);">No preview yet</div>
         <button class="btn btn-sm btn-outline" style="font-size:11px;"
                 onclick="event.stopPropagation();generateResourceGraphic('${esc(r.id)}')">
           🎨 Generate Preview
         </button>
       </div>`;

  const pairBadge = partner
    ? `<span style="font-size:10px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;
                    white-space:nowrap;" title="Paired with ${esc(partner.display_name)}">
         🔗 ${esc(partner.display_name.length > 18 ? partner.display_name.slice(0, 18) + '…' : partner.display_name)}
       </span>` : '';

  return `
    <div class="resource-card" data-id="${esc(r.id)}" ${hlStyle}
         style="background:var(--surface);border:1px solid var(--border);border-radius:12px;
                display:flex;flex-direction:column;overflow:hidden;
                box-shadow:0 1px 4px rgba(0,0,0,.04);">
      ${previewSection}
      <div style="padding:12px 14px;display:flex;flex-direction:column;gap:4px;flex:1;">
        <div style="display:flex;align-items:center;gap:6px;min-width:0;">
          ${resLangBadge(lang)}
          <span style="font-weight:600;font-size:13px;flex:1;overflow:hidden;
                       text-overflow:ellipsis;white-space:nowrap;"
                title="${esc(r.display_name)}">${esc(r.display_name)}</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);">
          ${typeLabel}${pages ? ' · ' + pages : ''} · ${date}
        </div>
        ${tagsHtml}
        <div style="display:flex;align-items:center;justify-content:space-between;margin-top:8px;gap:6px;min-width:0;">
          <div style="flex:1;min-width:0;">${pairBadge}</div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            <button class="btn btn-sm btn-outline" style="font-size:11px;"
                    onclick="resEditOpen('${esc(r.id)}')">Edit</button>
            <button class="btn btn-sm btn-ghost" style="font-size:11px;color:var(--danger,#dc2626);"
                    onclick="deleteResource('${esc(r.id)}','${esc(r.display_name)}')">✕</button>
          </div>
        </div>
      </div>
    </div>`;
}

// ── Row (detail view) ─────────────────────────────────────────────────────────

function _resourceRow(r) {
  const hl      = resComputeHighlight(r);
  const hlStyle = hl ? hl : '';
  const lang    = r.language || '';
  const pages   = r.page_count ? `${r.page_count} page${r.page_count !== 1 ? 's' : ''}` : '';
  const date    = r.uploaded_at ? new Date(r.uploaded_at).toLocaleDateString() : '—';
  const partner = r.pair_id ? _resources.find(x => x.pair_id === r.pair_id && x.id !== r.id) : null;

  const thumb = r.generated_image_url
    ? `<img src="${esc(r.generated_image_url)}" style="width:52px;height:52px;object-fit:cover;
           border-radius:6px;flex-shrink:0;border:1px solid var(--border);">`
    : `<div style="width:52px;height:52px;background:var(--surface-alt);border-radius:6px;
           display:flex;align-items:center;justify-content:center;font-size:22px;
           flex-shrink:0;border:1px solid var(--border);">📄</div>`;

  return `
    <div class="resource-row" data-id="${esc(r.id)}"
         style="display:flex;align-items:center;gap:12px;padding:10px 14px;
                background:var(--surface);border:1px solid var(--border);border-radius:8px;${hlStyle}">
      ${thumb}
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          ${resLangBadge(lang)}
          <span style="font-weight:600;font-size:13px;">${esc(r.display_name)}</span>
          ${partner ? `<span style="font-size:10px;color:var(--text-muted);">🔗 ${esc(partner.display_name)}</span>` : ''}
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">
          ${(r.resource_type || 'file').toUpperCase()}${pages ? ' · ' + pages : ''} · ${date}
          ${(r.tags || []).length ? ' · ' + r.tags.join(', ') : ''}
        </div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        ${!r.generated_image_url
          ? `<button class="btn btn-sm btn-outline" style="font-size:11px;"
                     onclick="generateResourceGraphic('${esc(r.id)}')">🎨 Preview</button>` : ''}
        <button class="btn btn-sm btn-outline" style="font-size:11px;"
                onclick="resEditOpen('${esc(r.id)}')">Edit</button>
        <button class="btn btn-sm btn-ghost" style="font-size:11px;color:var(--danger);"
                onclick="deleteResource('${esc(r.id)}','${esc(r.display_name)}')">✕</button>
      </div>
    </div>`;
}

// ── Upload flow ────────────────────────────────────────────────────────────────
// All event binding via addEventListener — no inline onclick/onchange attributes.
// Primary path: overlay <input type=file> (user directly clicks it through the button).
// Secondary path: drag-and-drop onto resDropZone.

function _showUploadForm(file) {
  _resourceFileData = { file, filename: file.name };
  console.log('[resources] file selected:', file.name, file.size);
  ActionLog.record('user', `Selected file: ${file.name}`);
  const nameEl = document.getElementById('resourceUploadFilename');
  const dispEl = document.getElementById('resourceDisplayName');
  const tagsEl = document.getElementById('resourceTags');
  const langEl = document.getElementById('resourceLang');
  const formEl = document.getElementById('resourceUploadForm');
  if (nameEl) nameEl.textContent = `📄 ${file.name}`;
  if (dispEl) dispEl.value = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  if (tagsEl) tagsEl.value = '';
  if (langEl) langEl.value = '';
  if (formEl) formEl.classList.remove('hidden');
}

// Wire file input — runs at script load time, DOM already present (all tabs are in layout.html)
(function _wireUpload() {
  const input    = document.getElementById('resourceFileInput');
  const dropZone = document.getElementById('resDropZone');

  if (input) {
    input.addEventListener('change', function() {
      const file = this.files?.[0];
      if (file) { _showUploadForm(file); this.value = ''; }
    });
    console.log('[resources] file input wired via addEventListener');
  } else {
    console.error('[resources] #resourceFileInput not found — upload will not work');
  }

  if (dropZone) {
    dropZone.addEventListener('dragenter', e => {
      e.preventDefault();
      dropZone.style.borderColor = 'var(--accent)';
      dropZone.style.background  = 'var(--surface-alt)';
    });
    dropZone.addEventListener('dragover', e => { e.preventDefault(); });
    dropZone.addEventListener('dragleave', () => {
      dropZone.style.borderColor = 'transparent';
      dropZone.style.background  = '';
    });
    dropZone.addEventListener('drop', e => {
      e.preventDefault();
      dropZone.style.borderColor = 'transparent';
      dropZone.style.background  = '';
      const file = e.dataTransfer?.files?.[0];
      if (file) _showUploadForm(file);
    });
    console.log('[resources] drop zone wired');
  }
})();

window.submitResourceUpload = async function() {
  if (!_resourceFileData) { console.warn('submitResourceUpload: no file data'); return; }
  const displayName = document.getElementById('resourceDisplayName').value.trim();
  const tagsRaw     = document.getElementById('resourceTags').value.trim();
  const language    = document.getElementById('resourceLang').value;

  ActionLog.record('user', `Uploading resource: ${_resourceFileData.filename}`,
    { displayName: displayName || '(from filename)', language: language || 'neutral', tags: tagsRaw || 'none' });

  StatusBar.setTemp('Uploading resource…', 'syncing', 30000);
  try {
    const form = new FormData();
    form.append('file', _resourceFileData.file);
    if (displayName) form.append('display_name', displayName);
    if (tagsRaw)     form.append('tags', tagsRaw);
    if (language)    form.append('language', language);

    const res = await fetch('/api/resources', { method: 'POST', body: form });
    let json;
    try   { json = await res.json(); }
    catch { throw new Error(`Server returned non-JSON (status ${res.status})`); }
    if (!json.ok) throw new Error(json.error || 'Upload failed');

    ActionLog.record('sys', `Resource uploaded: ${json.data?.display_name || displayName}`,
      { id: json.data?.id, type: json.data?.resource_type, pages: json.data?.page_count });
    cancelResourceUpload();
    await loadResources();
    StatusBar.setTemp('Resource uploaded', 'ready', 3000);
    toast('Resource uploaded', 'success');
  } catch (err) {
    ActionLog.record('err', `Resource upload failed: ${err.message}`);
    StatusBar.setTemp('Upload failed', 'error', 5000);
    toast(`Upload failed: ${err.message}`, 'error');
  }
};

window.cancelResourceUpload = function() {
  _resourceFileData = null;
  document.getElementById('resourceUploadForm').classList.add('hidden');
  document.getElementById('resourceDisplayName').value = '';
  document.getElementById('resourceTags').value = '';
  document.getElementById('resourceLang').value = '';
  document.getElementById('resourceUploadFilename').textContent = '';
};

// ── Graphic generation ────────────────────────────────────────────────────────

window.generateResourceGraphic = async function(resourceId) {
  const rec = _resources.find(r => r.id === resourceId);
  if (!rec) return;

  const btn = document.querySelector(`[data-id="${resourceId}"] .res-gen-btn`) ||
              document.getElementById(`gen-btn-${resourceId}`);
  StatusBar.setTemp('Generating PDF preview graphic…', 'syncing', 30000);
  if (btn) { btn.disabled = true; }

  const pages = rec.page_count > 1 ? [0, 1] : [0];
  try {
    const res  = await fetch(`/api/resources/${resourceId}/generate-graphic`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ pages }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Generation failed');

    const idx = _resources.findIndex(r => r.id === resourceId);
    if (idx >= 0) _resources[idx] = json.data;
    renderResources();

    StatusBar.setTemp('Graphic generated and saved to image library', 4000);
    toast('Graphic generated', 'success');
  } catch (err) {
    if (btn) btn.disabled = false;
    toast(`Error: ${err.message}`, 'error');
  }
};

// ── Edit modal ─────────────────────────────────────────────────────────────────

window.resEditOpen = function(id) {
  const r = _resources.find(x => x.id === id);
  if (!r) return;
  _resEditingId   = id;
  _resEditingTags = [...(r.tags || [])];

  document.getElementById('re-name').value  = r.display_name || '';
  document.getElementById('re-desc').value  = r.description || '';
  document.getElementById('re-lang').value  = r.language || '';
  _resEditRenderTags();
  _resEditRenderPairStatus(r);

  // Preview status
  const previewStatus = document.getElementById('re-preview-status');
  const genBtn        = document.getElementById('re-gen-btn');
  if (r.generated_image_url) {
    previewStatus.textContent = '✔ Preview ready';
    previewStatus.style.color = 'var(--success,#16a34a)';
    genBtn.textContent = '↺ Regenerate Preview';
  } else {
    previewStatus.textContent = 'No preview generated yet';
    previewStatus.style.color = 'var(--text-muted)';
    genBtn.textContent = '🎨 Generate Preview';
  }

  _populateTagDatalist('reTagSuggestions');
  document.getElementById('resEditModal').classList.remove('hidden');
};

window.resEditClose = function(e) {
  if (e && e.target !== document.getElementById('resEditModal')) return;
  document.getElementById('resEditModal').classList.add('hidden');
  _resEditingId = null;
};

function _resEditRenderPairStatus(r) {
  const statusEl  = document.getElementById('re-pair-status');
  const pairBtn   = document.getElementById('re-pair-btn');
  const unpairBtn = document.getElementById('re-unpair-btn');
  if (!statusEl) return;

  const partner = r.pair_id ? _resources.find(x => x.pair_id === r.pair_id && x.id !== r.id) : null;
  if (partner) {
    statusEl.textContent     = `Paired with: ${partner.display_name} (${RES_LANG_LABELS[partner.language || ''] || '—'})`;
    statusEl.style.color     = 'var(--success,#16a34a)';
    pairBtn.style.display    = 'none';
    unpairBtn.style.display  = '';
  } else {
    statusEl.textContent     = 'Not paired with any resource.';
    statusEl.style.color     = 'var(--text-muted)';
    pairBtn.style.display    = '';
    unpairBtn.style.display  = 'none';
  }
}

function _resEditRenderTags() {
  const chips = document.getElementById('re-tags-chips');
  if (!chips) return;
  chips.innerHTML = _resEditingTags.map((t, i) =>
    `<span style="display:inline-flex;align-items:center;gap:4px;background:var(--primary-soft,#dbeafe);
       color:var(--primary,#2563eb);font-size:12px;padding:2px 8px;border-radius:99px;">
       ${esc(t)}
       <button onclick="_resEditRemoveTag(${i})" style="background:none;border:none;cursor:pointer;
               color:inherit;font-size:13px;line-height:1;padding:0;">✕</button>
     </span>`
  ).join('');
}

window._resEditRemoveTag = function(i) {
  _resEditingTags.splice(i, 1);
  _resEditRenderTags();
};

window.resEditTagKey = function(e) {
  if (e.key === 'Enter') { e.preventDefault(); resEditAddTag(); }
};

window.resEditAddTag = function() {
  const input = document.getElementById('re-tag-input');
  const val   = input.value.trim().toLowerCase();
  if (val && !_resEditingTags.includes(val)) {
    _resEditingTags.push(val);
    _resEditRenderTags();
  }
  input.value = '';
};

window.resEditSave = async function() {
  if (!_resEditingId) return;
  const payload = {
    display_name: document.getElementById('re-name').value.trim(),
    description:  document.getElementById('re-desc').value.trim(),
    language:     document.getElementById('re-lang').value,
    tags:         _resEditingTags,
  };
  try {
    const res  = await fetch(`/api/resources/${_resEditingId}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    const idx = _resources.findIndex(r => r.id === _resEditingId);
    if (idx >= 0) _resources[idx] = json.data;
    renderResources();
    document.getElementById('resEditModal').classList.add('hidden');
    toast('Resource saved', 'success');
  } catch (err) {
    toast(`Save failed: ${err.message}`, 'error');
  }
};

window.resEditDelete = async function() {
  if (!_resEditingId) return;
  const r = _resources.find(x => x.id === _resEditingId);
  if (!r) return;
  document.getElementById('resEditModal').classList.add('hidden');
  await deleteResource(r.id, r.display_name);
};

window.resEditGenerateGraphic = async function() {
  if (!_resEditingId) return;
  document.getElementById('resEditModal').classList.add('hidden');
  await generateResourceGraphic(_resEditingId);
};

// ── Pair picker ────────────────────────────────────────────────────────────────

window.resPairPickerOpen = function() {
  if (!_resEditingId) return;
  _resPairPickerFor = _resEditingId;
  const current     = _resources.find(r => r.id === _resEditingId);
  const currentLang = document.getElementById('re-lang')?.value || current?.language || '';

  const candidates = _resources.filter(r => r.id !== _resEditingId);
  const list       = document.getElementById('resPairList');
  if (!list) return;

  if (!candidates.length) {
    list.innerHTML = '<div style="color:var(--text-muted);font-size:13px;text-align:center;padding:20px;">No other resources to pair with.</div>';
  } else {
    const targetLang = currentLang === 'en' ? 'es' : currentLang === 'es' ? 'en' : 'es';
    list.innerHTML = candidates.map(r => {
      const partnerLabel = RES_LANG_LABELS[r.language || ''] || '—';
      const alreadyPaired = r.pair_id && r.pair_id !== current?.pair_id;
      return `<div onclick="resPairConfirm('${esc(r.id)}','${currentLang}','${targetLang}')"
                   style="display:flex;align-items:center;gap:10px;padding:10px 12px;
                          border:1px solid var(--border);border-radius:8px;cursor:pointer;
                          background:var(--surface);"
                   onmouseover="this.style.background='var(--surface-alt)'"
                   onmouseout="this.style.background='var(--surface)'">
                ${resLangBadge(r.language || '')}
                <div style="flex:1;min-width:0;">
                  <div style="font-weight:600;font-size:13px;">${esc(r.display_name)}</div>
                  <div style="font-size:11px;color:var(--text-muted);">
                    ${(r.resource_type||'file').toUpperCase()}${r.page_count ? ' · ' + r.page_count + 'p' : ''}
                    ${alreadyPaired ? ' · <span style="color:var(--warning,#d97706);">already paired</span>' : ''}
                  </div>
                </div>
                <div style="font-size:11px;color:var(--text-muted);">
                  Will pair as ${RES_LANG_LABELS[currentLang]||'—'} ↔ ${partnerLabel}
                </div>
              </div>`;
    }).join('');
  }

  document.getElementById('resPairModal').classList.remove('hidden');
};

window.resPairPickerClose = function(e) {
  if (e && e.target !== document.getElementById('resPairModal')) return;
  document.getElementById('resPairModal').classList.add('hidden');
  _resPairPickerFor = null;
};

window.resPairConfirm = async function(partnerId, lang1, lang2) {
  if (!_resPairPickerFor) return;
  document.getElementById('resPairModal').classList.add('hidden');

  try {
    const res  = await fetch(`/api/resources/${_resPairPickerFor}/pair`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ resource_id: partnerId, lang1, lang2 }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);

    // Update local state for both records
    for (const updated of (json.data?.resources || [])) {
      const idx = _resources.findIndex(r => r.id === updated.id);
      if (idx >= 0) _resources[idx] = updated;
    }
    renderResources();

    // Refresh the edit modal if still open
    if (_resEditingId) {
      const r = _resources.find(x => x.id === _resEditingId);
      if (r) {
        document.getElementById('re-lang').value = r.language || '';
        _resEditRenderPairStatus(r);
      }
    }

    toast('Resources paired', 'success');
  } catch (err) {
    toast(`Pair failed: ${err.message}`, 'error');
  }
  _resPairPickerFor = null;
};

window.resUnpair = async function() {
  if (!_resEditingId) return;
  try {
    const res  = await fetch(`/api/resources/${_resEditingId}/unpair`, { method: 'POST' });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);

    for (const updated of (json.data?.resources || [])) {
      const idx = _resources.findIndex(r => r.id === updated.id);
      if (idx >= 0) _resources[idx] = updated;
    }
    renderResources();

    const r = _resources.find(x => x.id === _resEditingId);
    if (r) _resEditRenderPairStatus(r);

    toast('Unpaired', 'success');
  } catch (err) {
    toast(`Unpair failed: ${err.message}`, 'error');
  }
};

// ── Delete ─────────────────────────────────────────────────────────────────────

window.deleteResource = async function(id, name) {
  if (!confirm(`Delete resource "${name}"?\n\nThis removes the file from disk.`)) return;
  ActionLog.record('user', `Deleting resource: ${name}`);
  try {
    const res  = await fetch(`/api/resources/${id}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Delete failed');
    ActionLog.record('sys', `Resource deleted: ${name}`);
    _resources = _resources.filter(r => r.id !== id);
    renderResources();
    toast('Resource deleted', 'success');
  } catch (err) {
    ActionLog.record('err', `Delete failed: ${err.message}`);
    toast(`Delete failed: ${err.message}`, 'error');
  }
};

// ── Init ───────────────────────────────────────────────────────────────────────

EventBus.on('tab:changed', ({ tab }) => {
  if (tab !== 'resources') return;
  EventBus.emit('_dev:res:tab-open', { fileInputExists: !!document.getElementById('resourceFileInput') });
  loadResources();
});

// Load if resources tab is already active when the app finishes booting
EventBus.on('app:ready', () => {
  // Diagnostic — confirms this script loaded and app:ready fired
  EventBus.emit('_dev:res:init', {
    v: 3,
    fileInputExists:  !!document.getElementById('resourceFileInput'),
    listExists:       !!document.getElementById('resourceList'),
    uploadFormExists: !!document.getElementById('resourceUploadForm'),
  });
  const panel = document.getElementById('tab-resources');
  if (panel && !panel.classList.contains('hidden')) loadResources();
});
