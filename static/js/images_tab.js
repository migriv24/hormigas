/**
 * images_tab.js — Image Library tab.
 * Manages upload, display, metadata editing, and deletion of ImgBB images.
 */

// ── State ────────────────────────────────────────────────────────────────────

let _images           = [];
let _editingId        = null;
let _editingTags      = [];   // mutable copy of tags for the currently-open edit modal
let _imgView          = localStorage.getItem('imgView') || 'small'; // small | medium | large | detail
let _hlSettings       = null; // highlights config from settings.json (shared with resources)
let _tagFilterInclude = new Set(); // show only images with at least one of these tags
let _tagFilterExclude = new Set(); // hide images with any of these tags
let _imgSearch        = '';        // text search across name + tags

// ── DOM refs ─────────────────────────────────────────────────────────────────

const imagesGrid      = document.getElementById('imagesGrid');
const imageCount      = document.getElementById('imageCount');
const imgTabUploadBtn = document.getElementById('imgTabUploadBtn');
const imgTabUploadZone= document.getElementById('imgTabUploadZone');
const imgTabDropZone  = document.getElementById('imgTabDropZone');
const imgTabFileInput = document.getElementById('imgTabFileInput');
const imgTabBrowse    = document.getElementById('imgTabBrowse');
const imgTabCloseUpload= document.getElementById('imgTabCloseUpload');

const imgEditModal    = document.getElementById('imgEditModal');
const imgEditBody     = document.getElementById('imgEditBody');
const imgEditClose    = document.getElementById('imgEditClose');
const imgEditCancel   = document.getElementById('imgEditCancel');
const imgEditSave     = document.getElementById('imgEditSave');
const imgEditDelete   = document.getElementById('imgEditDelete');

// ── View toggle ───────────────────────────────────────────────────────────────

// _setViewState: update persistent state + DOM attributes/buttons, no re-render.
// Used by loadImages so we don't renderGrid() before data has arrived.
function _setViewState(view) {
  _imgView = view;
  localStorage.setItem('imgView', view);
  if (imagesGrid) imagesGrid.dataset.view = view;
  document.querySelectorAll('#imgViewToggle [data-imgview]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.imgview === view);
  });
}

// applyImgView: change view AND re-render (used by the button clicks).
function applyImgView(view) {
  _setViewState(view);
  renderGrid();
}

// Wire toggle buttons — guard against null in case of stale HTML cache.
const _imgViewToggle = document.getElementById('imgViewToggle');
if (_imgViewToggle) {
  _imgViewToggle.addEventListener('click', e => {
    const btn = e.target.closest('[data-imgview]');
    if (btn) applyImgView(btn.dataset.imgview);
  });
}

// ── Tag filter bar ────────────────────────────────────────────────────────────

function _updateFilterClear() {
  const clearBtn = document.getElementById('imgFilterClear');
  if (!clearBtn) return;
  const active = _tagFilterInclude.size || _tagFilterExclude.size || _imgSearch;
  clearBtn.style.display = active ? '' : 'none';
}

function buildTagFilterChips() {
  const el = document.getElementById('imgTagFilterChips');
  if (!el) return;

  // Collect all unique tags across all images (merged for pairs)
  const allTags = new Set();
  _images.forEach(img => (img.tags || []).forEach(t => allTags.add(t)));
  if (!allTags.size) { el.innerHTML = ''; return; }

  el.innerHTML = [...allTags].sort().map(tag => {
    const state = _tagFilterInclude.has(tag) ? 'include'
                : _tagFilterExclude.has(tag) ? 'exclude'
                : 'off';
    return `<button class="img-ftag img-ftag--${state}" data-tag="${esc(tag)}">${esc(tag)}</button>`;
  }).join('');

  _updateFilterClear();
}

function _cycleTagFilter(tag) {
  if (_tagFilterInclude.has(tag)) {
    _tagFilterInclude.delete(tag);
    _tagFilterExclude.add(tag);
  } else if (_tagFilterExclude.has(tag)) {
    _tagFilterExclude.delete(tag);
  } else {
    _tagFilterInclude.add(tag);
  }
  buildTagFilterChips();
  renderGrid();
}

function _filterGroups(groups) {
  const q = _imgSearch.toLowerCase();
  const hasInc = _tagFilterInclude.size > 0;
  const hasExc = _tagFilterExclude.size > 0;
  if (!hasInc && !hasExc && !q) return groups;

  return groups.filter(g => {
    // Gather merged tags and name for the group
    const tags = [...new Set(g.images.flatMap(i => i.tags || []))];
    const name = (g.images[0].name || g.images[1]?.name || '').toLowerCase();

    // Text search: name or any tag contains query
    if (q && !name.includes(q) && !tags.some(t => t.toLowerCase().includes(q))) return false;

    // Exclude: hide if any excluded tag present
    if (hasExc && tags.some(t => _tagFilterExclude.has(t))) return false;

    // Include: show only if at least one included tag matches
    if (hasInc && !tags.some(t => _tagFilterInclude.has(t))) return false;

    return true;
  });
}

// Wire up DOM events for the filter bar
const _imgSearchInput = document.getElementById('imgSearchInput');
if (_imgSearchInput) {
  _imgSearchInput.addEventListener('input', function() {
    _imgSearch = this.value.trim();
    _updateFilterClear();
    renderGrid();
  });
}

const _imgTagFilterChipsEl = document.getElementById('imgTagFilterChips');
if (_imgTagFilterChipsEl) {
  _imgTagFilterChipsEl.addEventListener('click', e => {
    const btn = e.target.closest('[data-tag]');
    if (btn) _cycleTagFilter(btn.dataset.tag);
  });
}

const _imgFilterClearBtn = document.getElementById('imgFilterClear');
if (_imgFilterClearBtn) {
  _imgFilterClearBtn.addEventListener('click', () => {
    _tagFilterInclude.clear();
    _tagFilterExclude.clear();
    _imgSearch = '';
    const searchEl = document.getElementById('imgSearchInput');
    if (searchEl) searchEl.value = '';
    buildTagFilterChips();
    renderGrid();
  });
}

// ── Load images ───────────────────────────────────────────────────────────────

async function loadImages() {
  imagesGrid.innerHTML = '<div class="images-loading">Loading images…</div>';
  _setViewState(_imgView); // restore persisted view state (no re-render yet)
  try {
    const [imgRes, settingsRes] = await Promise.all([
      fetch('/api/images'),
      fetch('/api/settings'),
    ]);
    const imgJson  = await imgRes.json();
    const stJson   = await settingsRes.json();
    if (!imgJson.ok) throw new Error(imgJson.error);
    _images     = imgJson.data || [];
    _hlSettings = stJson.ok ? (stJson.data?.highlights ?? null) : null;
    buildTagFilterChips();
    renderGrid();
  } catch (err) {
    imagesGrid.innerHTML = `<div class="images-loading" style="color:var(--danger);">Error: ${esc(err.message)}</div>`;
    toast('Failed to load images: ' + err.message, 'error');
  }
}

// ── Image highlight / glow engine ────────────────────────────────────────────

function _hexToRgb(hex) {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map(x => x + x).join('') : c;
  return [
    parseInt(full.slice(0, 2), 16),
    parseInt(full.slice(2, 4), 16),
    parseInt(full.slice(4, 6), 16),
  ];
}

function _lerpColor(hex1, hex2, t) {
  const [r1, g1, b1] = _hexToRgb(hex1);
  const [r2, g2, b2] = _hexToRgb(hex2);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return `rgb(${r},${g},${b})`;
}

/** Returns an inline CSS box-shadow string (or '') for a single image card. */
function imgComputeHighlight(img) {
  if (!_hlSettings || !_hlSettings.enabled) return '';
  const rules    = _hlSettings.rules || [];
  const imgTags  = img.tags || [];
  const matched  = rules.filter(r => imgTags.includes(r.tag));

  let color;
  if (imgTags.length === 0) {
    color = _hlSettings.no_tag_color || '#9ca3af';
  } else if (matched.length === 0) {
    return ''; // has tags but none match any rule → no highlight
  } else if (matched.length > 1) {
    color = _hlSettings.conflict_color || '#3b82f6';
  } else {
    const rule = matched[0];
    if (rule.mode === 'solid') {
      color = rule.color || '#9ca3af';
    } else if (rule.mode === 'event_linked') {
      const linked = (img.event_ids || []).length > 0;
      color = linked ? (rule.color_linked || '#f97316') : (rule.color_unlinked || '#fed7aa');
    } else if (rule.mode === 'frequency') {
      const freq   = (img.event_ids || []).length;
      const maxFreq = Math.max(1, ..._images
        .filter(i => (i.tags || []).includes(rule.tag))
        .map(i => (i.event_ids || []).length));
      const t = freq / maxFreq;
      color = _lerpColor(rule.color_min || '#bbf7d0', rule.color_max || '#16a34a', t);
    }
  }

  if (!color) return '';
  // Outer ring + soft bloom — stays behind image content
  return `box-shadow: 0 0 0 3px ${color}, 0 0 14px 4px ${color}99;`;
}

// ── Language badge ─────────────────────────────────────────────────────────

const LANG_LABELS = { en: 'EN', es: 'ES', '': '—' };
const LANG_COLORS = { en: '#2563eb', es: '#dc2626', '': '#6b7280' };

function langBadge(lang) {
  const color = LANG_COLORS[lang] || '#6b7280';
  return `<span class="img-lang-badge" style="background:${color}22;color:${color};">${LANG_LABELS[lang] || '—'}</span>`;
}

function renderGrid() {
  imageCount.textContent = `${_images.length} image${_images.length !== 1 ? 's' : ''}`;

  if (!_images.length) {
    imagesGrid.innerHTML = `
      <div class="images-empty">
        <div style="font-size:40px;margin-bottom:12px;">🖼</div>
        <div style="font-weight:600;margin-bottom:6px;">No images yet</div>
        <div style="color:var(--text-muted);font-size:13px;">Upload images to use them in your newsletters</div>
      </div>
    `;
    return;
  }

  // Group images: pairs share a card, standalones get their own
  const allGroups = [];
  const seen = new Set();
  for (const img of _images) {
    if (seen.has(img.id)) continue;
    seen.add(img.id);
    if (img.pair_id) {
      const partner = _images.find(i => i.pair_id === img.pair_id && i.id !== img.id);
      if (partner && !seen.has(partner.id)) {
        seen.add(partner.id);
        const pair = [img, partner].sort(a => (a.language === 'en' ? -1 : 1));
        allGroups.push({ type: 'pair', pair_id: img.pair_id, images: pair });
        continue;
      }
    }
    allGroups.push({ type: 'single', images: [img] });
  }

  // Apply tag + text filters
  const groups = _filterGroups(allGroups);

  // Show filtered count if filters are active
  const isFiltered = _tagFilterInclude.size || _tagFilterExclude.size || _imgSearch;
  imageCount.textContent = isFiltered
    ? `${groups.length} of ${allGroups.length} shown`
    : `${_images.length} image${_images.length !== 1 ? 's' : ''}`;

  if (!groups.length) {
    imagesGrid.innerHTML = `
      <div class="images-empty">
        <div style="font-size:32px;margin-bottom:12px;">🔍</div>
        <div style="font-weight:600;margin-bottom:6px;">No images match your filter</div>
        <div style="color:var(--text-muted);font-size:13px;">Try removing a tag filter or clearing your search</div>
      </div>
    `;
    return;
  }

  // ── Detail (list) view ────────────────────────────────────────────────────
  if (_imgView === 'detail') {
    imagesGrid.innerHTML = groups.map(g => {
      if (g.type === 'pair') {
        const [imgA, imgB] = g.images;
        return `
          <div class="img-detail-row img-detail-pair">
            <div class="img-detail-pair-thumbs">
              <div style="position:relative;display:inline-block;">
                ${langBadge(imgA.language)}
                <img src="${esc(imgA.thumb_url || imgA.url)}" class="img-detail-thumb"
                     alt="${esc(imgA.alt || '')}"
                     onclick="imgLightbox('${esc(imgA.url)}','${esc(imgA.name || 'Image')}')"
                     style="cursor:zoom-in;">
              </div>
              <div style="position:relative;display:inline-block;">
                ${langBadge(imgB.language)}
                <img src="${esc(imgB.thumb_url || imgB.url)}" class="img-detail-thumb"
                     alt="${esc(imgB.alt || '')}"
                     onclick="imgLightbox('${esc(imgB.url)}','${esc(imgB.name || 'Image')}')"
                     style="cursor:zoom-in;">
              </div>
            </div>
            <div class="img-detail-info">
              <div class="img-detail-name">${esc(imgA.name || imgB.name || 'Untitled')} <span class="img-detail-pair-badge">EN / ES Pair</span></div>
              ${(imgA.tags || []).length ? `<div class="img-tags-row">${imgA.tags.map(t=>`<span class="img-tag-chip">${esc(t)}</span>`).join('')}</div>` : ''}
              <div class="img-detail-meta">${formatUploadDate(imgA.uploaded_at)}</div>
            </div>
            <div class="img-detail-actions">
              <button class="btn btn-sm btn-ghost" onclick="imgEditOpen('${esc(imgA.id)}')">✏ ${LANG_LABELS[imgA.language] || 'A'}</button>
              <button class="btn btn-sm btn-ghost" onclick="imgEditOpen('${esc(imgB.id)}')">✏ ${LANG_LABELS[imgB.language] || 'B'}</button>
              <button class="btn btn-sm btn-ghost" onclick="imgUnpair('${esc(g.pair_id)}')">Unlink</button>
            </div>
          </div>`;
      }
      const img = g.images[0];
      return `
        <div class="img-detail-row" data-id="${esc(img.id)}">
          <div style="position:relative;display:inline-block;flex-shrink:0;">
            ${langBadge(img.language)}
            <img src="${esc(img.thumb_url || img.display_url || img.url)}" class="img-detail-thumb"
                 alt="${esc(img.alt || '')}"
                 onclick="imgLightbox('${esc(img.url)}','${esc(img.name || 'Image')}')"
                 style="cursor:zoom-in;">
          </div>
          <div class="img-detail-info">
            <div class="img-detail-name">${esc(img.name || 'Untitled')}</div>
            ${(img.tags || []).length ? `<div class="img-tags-row">${img.tags.map(t=>`<span class="img-tag-chip">${esc(t)}</span>`).join('')}</div>` : ''}
            <div class="img-detail-meta">
              ${img.alt ? `<span>Alt: ${esc(img.alt)}</span> · ` : ''}${img.description ? `<span title="${esc(img.description)}">${esc(img.description.length > 60 ? img.description.slice(0,60)+'…' : img.description)}</span> · ` : ''}<span>${formatUploadDate(img.uploaded_at)}</span>
            </div>
          </div>
          <div class="img-detail-actions">
            <button class="btn btn-sm btn-ghost" onclick="imgEditOpen('${esc(img.id)}')">✏ Edit</button>
            <button class="btn btn-sm btn-ghost" onclick="imgCopyUrl('${esc(img.id)}')" title="Copy URL">📋</button>
          </div>
        </div>`;
    }).join('');
    return;
  }

  // ── Card views (small / medium / large) ──────────────────────────────────
  imagesGrid.innerHTML = groups.map(g => {
    if (g.type === 'pair') {
      const [imgA, imgB] = g.images;
      // Merged view: union of tags and event_ids across both images
      const mergedTags     = [...new Set([...(imgA.tags||[]), ...(imgB.tags||[])])];
      const mergedEventIds = [...new Set([...(imgA.event_ids||[]), ...(imgB.event_ids||[])])];
      const mergedImg      = { tags: mergedTags, event_ids: mergedEventIds };
      const hlStyle        = imgComputeHighlight(mergedImg);
      return `
        <div class="image-card image-card-pair" data-pair="${esc(g.pair_id)}"${hlStyle ? ` style="${hlStyle}"` : ''}>
          <div class="image-pair-header">
            <span class="image-pair-label">EN / ES Pair</span>
            <button class="btn btn-sm btn-ghost" style="font-size:11px;padding:2px 6px;"
                    onclick="imgUnpair('${esc(g.pair_id)}')">Unlink</button>
          </div>
          <div class="image-pair-thumbs" style="position:relative;">
            ${mergedEventIds.length ? `<span class="img-event-badge"
              onclick="event.stopPropagation();imgShowLinkedEvent('${esc(imgA.id)}')"
              title="${mergedEventIds.length > 1 ? mergedEventIds.length + ' linked events' : '1 linked event'}"
              style="z-index:3;"></span>` : ''}
            ${[imgA, imgB].map(img => `
              <div class="image-pair-slot">
                ${langBadge(img.language)}
                <img src="${esc(img.thumb_url || img.url)}" alt="${esc(img.alt || '')}"
                     style="cursor:zoom-in;width:100%;border-radius:6px;object-fit:cover;aspect-ratio:4/3;"
                     onclick="imgLightbox('${esc(img.url)}','${esc(img.name || 'Image')}','${esc(img.id)}')"
                     onerror="this.style.opacity='.3'">
              </div>`).join('')}
          </div>
          <div class="image-card-body">
            <div class="image-card-name">${esc(imgA.name || imgB.name || 'Untitled')}</div>
            ${mergedTags.length ? `<div class="img-tags-row">${mergedTags.map(t=>`<span class="img-tag-chip">${esc(t)}</span>`).join('')}</div>` : ''}
            <div class="image-card-meta" style="font-size:10px;">${formatUploadDate(imgA.uploaded_at)}</div>
          </div>
          <div class="image-card-actions">
            <button class="btn btn-sm btn-ghost" onclick="imgEditOpen('${esc(imgA.id)}')">✏ ${LANG_LABELS[imgA.language] || 'A'}</button>
            <button class="btn btn-sm btn-ghost" onclick="imgEditOpen('${esc(imgB.id)}')">✏ ${LANG_LABELS[imgB.language] || 'B'}</button>
          </div>
        </div>`;
    }
    const img = g.images[0];
    const hlStyle = imgComputeHighlight(img);
    return `
      <div class="image-card" data-id="${esc(img.id)}"${hlStyle ? ` style="${hlStyle}"` : ''}>
        <div class="image-card-thumb-wrap">
          ${langBadge(img.language)}
          <img class="image-card-thumb"
               src="${esc(img.thumb_url || img.display_url || img.url)}"
               alt="${esc(img.alt || '')}"
               style="cursor:zoom-in;"
               onclick="imgLightbox('${esc(img.url)}','${esc(img.name || 'Image')}','${esc(img.id)}')"
               onerror="this.style.background='#f1f5f9';this.style.padding='20px';">
          ${(img.event_ids || []).length ? `<span class="img-event-badge" onclick="event.stopPropagation();imgShowLinkedEvent('${esc(img.id)}')" title="${(img.event_ids).length > 1 ? (img.event_ids).length + ' linked events' : '1 linked event'}"></span>` : ''}
          <div class="image-card-hover">
            <button class="btn btn-sm btn-outline" onclick="imgLightbox('${esc(img.url)}','${esc(img.name || 'Image')}','${esc(img.id)}')">🔍 View</button>
            <button class="btn btn-sm btn-outline" onclick="imgCopyUrl('${esc(img.id)}')">📋 Copy URL</button>
          </div>
        </div>
        <div class="image-card-body">
          <div class="image-card-name" title="${esc(img.name || '')}">${esc(img.name || 'Untitled')}</div>
          ${img.alt ? `<div class="image-card-meta">Alt: ${esc(img.alt)}</div>` : ''}
          ${img.description ? `<div class="image-card-meta" title="${esc(img.description)}">${esc(img.description.length > 50 ? img.description.slice(0,50)+'…' : img.description)}</div>` : ''}
          ${(img.tags || []).length ? `<div class="img-tags-row">${(img.tags).map(t => `<span class="img-tag-chip">${esc(t)}</span>`).join('')}</div>` : ''}
          <div class="image-card-meta" style="margin-top:4px;font-size:10px;">${formatUploadDate(img.uploaded_at)}</div>
        </div>
        <div class="image-card-actions">
          <button class="btn btn-sm btn-ghost" onclick="imgEditOpen('${esc(img.id)}')">✏ Edit</button>
          <button class="btn btn-sm btn-ghost" onclick="imgCopyUrl('${esc(img.id)}')" title="Copy image URL">📋</button>
        </div>
      </div>`;
  }).join('');
}

window.imgUnpair = async function(pairId) {
  if (!confirm('Unlink this EN/ES pair? Both images stay in the library as standalones.')) return;
  try {
    const res  = await fetch(`/api/images/pair/${encodeURIComponent(pairId)}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    toast('Pair unlinked', 'success');
    await loadImages();
  } catch (err) { toast('Unlink failed: ' + err.message, 'error'); }
};

function formatUploadDate(isoStr) {
  if (!isoStr) return '';
  try {
    const d = new Date(isoStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch { return ''; }
}

// ── URL copy ──────────────────────────────────────────────────────────────────

window.imgCopyUrl = function(id) {
  const img = _images.find(i => i.id === id);
  if (!img) return;
  navigator.clipboard.writeText(img.url).then(() => {
    toast('URL copied!', 'success');
  }).catch(() => {
    prompt('Copy this URL:', img.url);
  });
};

// ── Edit modal ────────────────────────────────────────────────────────────────

window.imgEditOpen = function(id) {
  const img = _images.find(i => i.id === id);
  if (!img) return;
  _editingId   = id;
  _editingTags = [...(img.tags || [])];

  const partner = img.pair_id ? _images.find(i => i.pair_id === img.pair_id && i.id !== img.id) : null;

  imgEditBody.innerHTML = `
    <div style="text-align:center;margin-bottom:16px;">
      <img src="${esc(img.thumb_url || img.display_url || img.url)}"
           style="max-height:140px;max-width:100%;border-radius:8px;object-fit:contain;">
    </div>
    <div class="form-field">
      <label for="ime-name">Name</label>
      <input type="text" id="ime-name" value="${esc(img.name || '')}">
    </div>
    <div class="form-field">
      <label for="ime-lang">Language</label>
      <select id="ime-lang">
        <option value=""  ${!img.language       ? 'selected' : ''}>— Both (no language tag)</option>
        <option value="en" ${img.language==='en' ? 'selected' : ''}>🇺🇸 English (EN)</option>
        <option value="es" ${img.language==='es' ? 'selected' : ''}>🇪🇸 Spanish (ES)</option>
      </select>
    </div>
    <div class="form-field">
      <label>EN / ES Pair</label>
      ${partner
        ? `<div style="display:flex;align-items:center;gap:8px;font-size:13px;">
             <img src="${esc(partner.thumb_url || partner.url)}" width="36" height="36"
                  style="border-radius:4px;object-fit:cover;flex-shrink:0;">
             <span style="flex:1;color:var(--text-muted);">${esc(partner.name || 'Untitled')} (${LANG_LABELS[partner.language] || '—'})</span>
             <button class="btn btn-sm btn-ghost" onclick="imgUnpair('${esc(img.pair_id)}');imgEditModal.classList.add('hidden');">Unlink</button>
           </div>`
        : `<button class="btn btn-sm btn-outline" onclick="imgPairPicker('${esc(img.id)}')">
             🔗 Link to another image as its counterpart
           </button>`
      }
    </div>
    <div class="form-field">
      <label for="ime-alt">Alt Text <span style="font-weight:400;color:var(--text-muted);">(accessibility)</span></label>
      <input type="text" id="ime-alt" value="${esc(img.alt || '')}">
    </div>
    <div class="form-field">
      <label for="ime-desc">Description / Notes</label>
      <textarea id="ime-desc" style="min-height:70px;">${esc(img.description || '')}</textarea>
    </div>
    <div class="form-field">
      <label>Tags</label>
      <div id="ime-tags-chips" class="img-tags-row" style="min-height:28px;margin-bottom:6px;"></div>
      <div style="display:flex;gap:6px;position:relative;">
        <input type="text" id="ime-tag-input" placeholder="Add a tag…"
               style="flex:1;" autocomplete="off"
               list="ime-tag-suggestions">
        <datalist id="ime-tag-suggestions"></datalist>
        <button type="button" class="btn btn-sm btn-outline" onclick="imgEditAddTag()">Add</button>
      </div>
      <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
        e.g. flier, march-2026, spanish — click ✕ on a chip to remove
      </div>
    </div>
    <div class="form-field">
      <label>Full URL <span style="font-size:10px;color:var(--text-muted);">v${img.meta_version || 1}</span></label>
      <div style="display:flex;gap:6px;align-items:center;">
        <input type="text" value="${esc(img.url)}" readonly style="flex:1;color:var(--text-muted);font-size:12px;cursor:text;">
        <button class="btn btn-sm btn-ghost" onclick="imgCopyUrl('${esc(img.id)}')">Copy</button>
      </div>
    </div>
  `;
  imgEditModal.classList.remove('hidden');
  _renderEditTags();
  _loadTagSuggestions();

  // Allow pressing Enter in the tag input to add
  const tagInput = document.getElementById('ime-tag-input');
  if (tagInput) {
    tagInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); imgEditAddTag(); }
    });
  }
};

function _renderEditTags() {
  const wrap = document.getElementById('ime-tags-chips');
  if (!wrap) return;
  wrap.innerHTML = _editingTags.length
    ? _editingTags.map((t, i) =>
        `<span class="img-tag-chip">${esc(t)}<button class="img-tag-chip-remove" onclick="imgEditRemoveTag(${i})" title="Remove tag">✕</button></span>`
      ).join('')
    : `<span style="font-size:12px;color:var(--text-muted);">No tags yet</span>`;
}

async function _loadTagSuggestions() {
  try {
    const res  = await fetch('/api/tags');
    const json = await res.json();
    if (!json.ok) return;
    const dl = document.getElementById('ime-tag-suggestions');
    if (!dl) return;
    dl.innerHTML = (json.data || []).map(t => `<option value="${esc(t)}">`).join('');
  } catch { /* non-critical */ }
}

window.imgEditAddTag = function() {
  const input = document.getElementById('ime-tag-input');
  if (!input) return;
  const val = input.value.trim().toLowerCase().replace(/\s+/g, '-');
  if (!val) return;
  if (!_editingTags.includes(val)) {
    _editingTags.push(val);
    _renderEditTags();
  }
  input.value = '';
  input.focus();
};

window.imgEditRemoveTag = function(index) {
  _editingTags.splice(index, 1);
  _renderEditTags();
};

imgEditClose.addEventListener('click',  () => imgEditModal.classList.add('hidden'));
imgEditCancel.addEventListener('click', () => imgEditModal.classList.add('hidden'));
imgEditModal.addEventListener('click',  e => { if (e.target === imgEditModal) imgEditModal.classList.add('hidden'); });

imgEditSave.addEventListener('click', async () => {
  if (!_editingId) return;
  const body = {
    name:        document.getElementById('ime-name')?.value?.trim() || '',
    alt:         document.getElementById('ime-alt')?.value?.trim()  || '',
    description: document.getElementById('ime-desc')?.value?.trim() || '',
    language:    document.getElementById('ime-lang')?.value ?? '',
    tags:        [..._editingTags],
  };
  try {
    const res  = await fetch(`/api/images/${encodeURIComponent(_editingId)}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    // Update local state
    const idx = _images.findIndex(i => i.id === _editingId);
    if (idx >= 0) _images[idx] = json.data;

    // Sync tags to pair partner (tags are shared across EN/ES pairs)
    const saved  = json.data;
    const partner = saved.pair_id ? _images.find(i => i.pair_id === saved.pair_id && i.id !== saved.id) : null;
    if (partner) {
      const pRes  = await fetch(`/api/images/${encodeURIComponent(partner.id)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: [..._editingTags] }),
      });
      const pJson = await pRes.json();
      if (pJson.ok) {
        const pIdx = _images.findIndex(i => i.id === partner.id);
        if (pIdx >= 0) _images[pIdx] = pJson.data;
      }
    }

    imgEditModal.classList.add('hidden');
    buildTagFilterChips();
    renderGrid();
    toast('Image updated' + (partner ? ' (tags synced to partner)' : ''), 'success');
  } catch (err) { toast('Update failed: ' + err.message, 'error'); }
});

imgEditDelete.addEventListener('click', async () => {
  if (!_editingId) return;
  if (!confirm('Delete this image from the library? The hosted file on ImgBB is not affected.')) return;
  const img = _images.find(i => i.id === _editingId);
  ActionLog.record('user', `Deleting image: ${img?.name || _editingId}`);
  try {
    const res  = await fetch(`/api/images/${encodeURIComponent(_editingId)}`, { method: 'DELETE' });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    ActionLog.record('sys', `Image deleted: ${img?.name || _editingId}`);
    _images = _images.filter(i => i.id !== _editingId);
    imgEditModal.classList.add('hidden');
    renderGrid();
    toast('Image removed from library', 'success');
  } catch (err) {
    ActionLog.record('err', `Image delete failed: ${err.message}`);
    toast('Delete failed: ' + err.message, 'error');
  }
});

// ── Upload ────────────────────────────────────────────────────────────────────

document.getElementById('imgTabImportBtn').addEventListener('click', () => {
  const existing = document.getElementById('_importUrlsModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = '_importUrlsModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" style="width:540px;">
      <div class="modal-header">
        <h2>Import Image URLs</h2>
        <button class="modal-close" id="_importClose">✕</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 10px;">
          Paste ImgBB image URLs — one per line. Already-imported URLs are skipped.
        </p>
        <textarea id="_importUrlsText"
          style="width:100%;height:220px;font-size:12px;font-family:monospace;box-sizing:border-box;"
          placeholder="https://i.ibb.co/…&#10;https://i.ibb.co/…"></textarea>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="_importCancel">Cancel</button>
        <button class="btn btn-primary" id="_importSave">Import</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector('#_importClose').addEventListener('click',  () => overlay.remove());
  overlay.querySelector('#_importCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#_importSave').addEventListener('click', async () => {
    const raw  = document.getElementById('_importUrlsText').value;
    const urls = raw.split('\n').map(u => u.trim()).filter(Boolean);
    if (!urls.length) { toast('No URLs entered', 'info'); return; }
    try {
      const res  = await fetch('/api/images/import', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ urls }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      overlay.remove();
      toast(`Imported ${json.data.imported} image${json.data.imported !== 1 ? 's' : ''}${json.data.skipped ? `, ${json.data.skipped} already existed` : ''}`, 'success');
      await loadImages();
    } catch (err) { toast('Import failed: ' + err.message, 'error'); }
  });
});

imgTabUploadBtn.addEventListener('click', () => {
  imgTabUploadZone.classList.toggle('hidden');
});
imgTabCloseUpload.addEventListener('click', () => {
  imgTabUploadZone.classList.add('hidden');
});
imgTabBrowse.addEventListener('click', () => imgTabFileInput.click());
imgTabDropZone.addEventListener('click', () => imgTabFileInput.click());

imgTabDropZone.addEventListener('dragover', e => {
  e.preventDefault();
  imgTabDropZone.classList.add('drag-active');
});
imgTabDropZone.addEventListener('dragleave', () => imgTabDropZone.classList.remove('drag-active'));
imgTabDropZone.addEventListener('drop', e => {
  e.preventDefault();
  imgTabDropZone.classList.remove('drag-active');
  const file = e.dataTransfer.files[0];
  if (file) uploadImage(file);
});
imgTabFileInput.addEventListener('change', () => {
  if (imgTabFileInput.files[0]) uploadImage(imgTabFileInput.files[0]);
});

async function uploadImage(file) {
  const form = new FormData();
  const name = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ');
  form.append('file', file);
  form.append('name', name);
  const sizeMB = (file.size / 1048576).toFixed(2);
  ActionLog.record('user', `Uploading image: ${file.name}`, `${sizeMB} MB`);
  toast('Uploading…', 'info');
  try {
    const res  = await fetch('/api/upload-image', { method: 'POST', body: form });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    ActionLog.record('sys', `Image uploaded: ${name}`, { id: json.data?.id });
    toast('Uploaded! 🎉', 'success');
    imgTabUploadZone.classList.add('hidden');
    imgTabFileInput.value = '';
    await loadImages();
  } catch (err) {
    ActionLog.record('err', `Image upload failed: ${err.message}`);
    toast('Upload failed: ' + err.message, 'error');
  }
}

// ── Pair picker ───────────────────────────────────────────────────────────────

window.imgPairPicker = function(sourceId) {
  const source = _images.find(i => i.id === sourceId);
  if (!source) return;

  // Candidates: images that aren't already paired with someone else
  const candidates = _images.filter(i => i.id !== sourceId && !i.pair_id);

  const existing = document.getElementById('_pairPickerModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = '_pairPickerModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" style="width:480px;">
      <div class="modal-header">
        <h2>Link as EN / ES Pair</h2>
        <button class="modal-close" id="_pairClose">✕</button>
      </div>
      <div class="modal-body" style="padding:16px;">
        <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px;">
          Select the <strong>${source.language === 'en' ? 'Spanish' : 'English'}</strong> counterpart for
          <strong>${esc(source.name || 'this image')}</strong>.
        </p>
        ${candidates.length === 0
          ? `<div style="text-align:center;color:var(--text-muted);font-size:13px;padding:20px;">
               No unpaired images available. Upload or unlink another image first.
             </div>`
          : `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;max-height:320px;overflow-y:auto;">
               ${candidates.map(img => `
                 <div class="pair-candidate" data-id="${esc(img.id)}"
                      style="border:2px solid var(--border);border-radius:8px;overflow:hidden;cursor:pointer;transition:.15s;">
                   ${langBadge(img.language)}
                   <img src="${esc(img.thumb_url || img.url)}" style="width:100%;aspect-ratio:4/3;object-fit:cover;display:block;">
                   <div style="padding:6px 6px 4px;font-size:11px;font-weight:600;
                               white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">
                     ${esc(img.name || 'Untitled')}
                   </div>
                 </div>`).join('')}
             </div>`
        }
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector('#_pairClose').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('.pair-candidate').forEach(el => {
    el.addEventListener('mouseenter', () => el.style.borderColor = '#0f766e');
    el.addEventListener('mouseleave', () => el.style.borderColor = '');
    el.addEventListener('click', async () => {
      const targetId = el.dataset.id;
      // Determine language assignment: source gets its current lang (or en default), target gets the other
      const lang1 = source.language || 'en';
      const lang2 = lang1 === 'en' ? 'es' : 'en';
      try {
        const res  = await fetch('/api/images/pair', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id1: sourceId, lang1, id2: targetId, lang2 }),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);
        overlay.remove();
        imgEditModal.classList.add('hidden');
        toast('Images paired as EN / ES', 'success');
        await loadImages();
      } catch (err) { toast('Pair failed: ' + err.message, 'error'); }
    });
  });
};

// ── In-panel event tag state ──────────────────────────────────────────────────

let _imgPanelTags = [];

function imgPanelTagsRender() {
  const wrap = document.getElementById('iep-tags-chips');
  if (!wrap) return;
  wrap.innerHTML = _imgPanelTags.length
    ? _imgPanelTags.map((t, i) =>
        `<span class="img-tag-chip">${esc(t)}<button class="img-tag-chip-remove" onclick="imgPanelTagRemove(${i})" title="Remove">✕</button></span>`
      ).join('')
    : `<span style="font-size:12px;color:var(--text-muted);">No tags yet</span>`;
}

window.imgPanelTagRemove = function(i) {
  _imgPanelTags.splice(i, 1);
  imgPanelTagsRender();
};

window.imgPanelTagAdd = function(raw) {
  const tag = (raw || '').trim().toLowerCase();
  if (!tag || _imgPanelTags.includes(tag)) return;
  _imgPanelTags.push(tag);
  imgPanelTagsRender();
  fetch('/api/tags', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: tag }) }).catch(() => {});
};

function imgPanelTagsInit(existing) {
  _imgPanelTags = [...(existing || [])];
  imgPanelTagsRender();
  const dl = document.getElementById('iep-tag-suggestions');
  if (dl) {
    fetch('/api/tags').then(r => r.json()).then(json => {
      if (json.ok) dl.innerHTML = json.data.map(t => `<option value="${esc(t)}">`).join('');
    }).catch(() => {});
  }
  const input = document.getElementById('iep-tag-input');
  if (!input) return;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      window.imgPanelTagAdd(input.value);
      input.value = '';
    }
  });
  input.addEventListener('blur', () => {
    if (input.value.trim()) { window.imgPanelTagAdd(input.value); input.value = ''; }
  });
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

window.imgLightbox = function(url, name, imageId) {
  const existing = document.getElementById('_imgLightbox');
  if (existing) existing.remove();

  const img = _images.find(i => i.id === imageId);
  const eventIds = img?.event_ids || [];
  const hasEvents = eventIds.length > 0;

  const overlay = document.createElement('div');
  overlay.id = '_imgLightbox';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:1000;
    background:rgba(0,0,0,.85);
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    cursor:zoom-out;
  `;
  overlay.innerHTML = `
    <div style="position:absolute;top:16px;right:20px;display:flex;gap:10px;align-items:center;">
      <span style="color:rgba(255,255,255,.7);font-size:13px;">${esc(name)}</span>
      <button id="_lbClose" style="background:none;border:none;color:#fff;font-size:22px;cursor:pointer;line-height:1;padding:4px 8px;">✕</button>
    </div>
    <img src="${esc(url)}"
         style="max-width:90vw;max-height:82vh;object-fit:contain;border-radius:6px;
                box-shadow:0 8px 40px rgba(0,0,0,.6);cursor:default;"
         onclick="event.stopPropagation()">
    <div style="margin-top:14px;display:flex;gap:12px;align-items:center;" onclick="event.stopPropagation()">
      <a href="${esc(url)}" target="_blank" rel="noopener"
         style="color:rgba(255,255,255,.7);font-size:12px;text-decoration:none;">Open full size ↗</a>
      ${hasEvents ? `
        <button id="_lbEditEvent"
                style="background:#1d4ed8;color:#fff;border:none;padding:7px 14px;
                       border-radius:7px;font-size:13px;cursor:pointer;font-weight:600;">
          ✏ Edit Linked Event${eventIds.length > 1 ? `s (${eventIds.length})` : ''}
        </button>` : ''}
      <button id="_lbLinkEvent"
              style="background:#7c3aed;color:#fff;border:none;padding:7px 14px;
                     border-radius:7px;font-size:13px;cursor:pointer;font-weight:600;">
        🔗 Link to Event
      </button>
      <button id="_lbMakeEvent"
              style="background:#0f766e;color:#fff;border:none;padding:7px 14px;
                     border-radius:7px;font-size:13px;cursor:pointer;font-weight:600;">
        ${hasEvents ? '➕ Create Another Event' : '🗓 Make into Event'}
      </button>
      <button id="_lbLinkJob"
              style="background:#b45309;color:#fff;border:none;padding:7px 14px;
                     border-radius:7px;font-size:13px;cursor:pointer;font-weight:600;">
        🔗 Link to Job
      </button>
      <button id="_lbMakeJob"
              style="background:#1e3a5f;color:#fff;border:none;padding:7px 14px;
                     border-radius:7px;font-size:13px;cursor:pointer;font-weight:600;">
        💼 Make into Job
      </button>
    </div>
  `;

  function closeOverlay() { overlay.remove(); }
  overlay.addEventListener('click', closeOverlay);
  overlay.querySelector('#_lbClose').addEventListener('click', closeOverlay);

  if (hasEvents) {
    overlay.querySelector('#_lbEditEvent').addEventListener('click', async () => {
      overlay.remove();
      if (eventIds.length === 1) {
        await imgOpenEventEditor(imageId, url, name, eventIds[0]);
      } else {
        imgShowEventPicker(imageId, url, name, eventIds);
      }
    });
  }

  overlay.querySelector('#_lbLinkEvent').addEventListener('click', () => {
    overlay.remove();
    imgLinkToEventPicker(imageId);
  });

  overlay.querySelector('#_lbMakeEvent').addEventListener('click', () => {
    overlay.remove();
    imgOpenEventPanel({ mode: 'create', imageUrl: url, imageName: name, imageId });
  });

  overlay.querySelector('#_lbLinkJob').addEventListener('click', () => {
    overlay.remove();
    imgLinkToJobPicker(imageId);
  });

  overlay.querySelector('#_lbMakeJob').addEventListener('click', () => {
    overlay.remove();
    if (typeof jobOpenPanel === 'function') {
      jobOpenPanel(null, { imageUrl: url, imageName: name, imageId });
    } else {
      toast('Jobs tab not loaded', 'error');
    }
  });

  document.addEventListener('keydown', function _lbEsc(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', _lbEsc); }
  });
  document.body.appendChild(overlay);
};

// ── Event split panel (create OR edit) ────────────────────────────────────────

function imgOpenEventPanel({ mode, imageUrl, imageName, imageId, eventData = null }) {
  const existing = document.getElementById('_makeEventPanel');
  if (existing) existing.remove();

  const isEdit = mode === 'edit';
  const e = eventData || {};

  const panel = document.createElement('div');
  panel.id = '_makeEventPanel';
  panel.style.cssText = `position:fixed;inset:0;z-index:990;display:grid;grid-template-columns:1fr 1fr;background:var(--bg,#f8fafc);`;

  panel.innerHTML = `
    <div style="background:#0f172a;display:flex;flex-direction:column;
                align-items:center;justify-content:center;padding:24px;gap:12px;">
      <div style="color:rgba(255,255,255,.6);font-size:12px;letter-spacing:.05em;
                  text-transform:uppercase;font-weight:600;">Flier Reference</div>
      <img src="${esc(imageUrl)}"
           style="max-width:100%;max-height:80vh;object-fit:contain;border-radius:8px;
                  box-shadow:0 8px 40px rgba(0,0,0,.5);">
      <div style="color:rgba(255,255,255,.5);font-size:11px;">${esc(imageName)}</div>
    </div>
    <div style="overflow-y:auto;padding:28px 32px;display:flex;flex-direction:column;gap:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
        <h2 style="margin:0;font-size:18px;font-weight:700;color:var(--text);">
          ${isEdit ? 'Edit Event' : 'Create Event from Flier'}
        </h2>
        <button id="_iepClose" class="btn btn-ghost">✕ Close</button>
      </div>
      <div id="_iepForm"></div>
      <div style="display:flex;gap:10px;margin-top:18px;padding-top:18px;border-top:1px solid var(--border);">
        <button class="btn btn-ghost" id="_iepCancel">Cancel</button>
        <button class="btn btn-primary" id="_iepSave">${isEdit ? '💾 Save Changes' : '💾 Save Event'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  const formEl = panel.querySelector('#_iepForm');
  formEl.innerHTML = [
    `<div class="form-field"><label for="iep-title">Event Name</label>
       <input type="text" id="iep-title" value="${esc(e.title || (!isEdit ? imageName : ''))}"></div>`,
    !isEdit ? `<div class="form-field" style="padding:8px 12px;background:var(--bg-muted,#f1f5f9);border-radius:6px;margin-top:-8px;">
       <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:400;font-size:13px;">
         <input type="checkbox" id="iep-rename-img" style="accent-color:var(--primary,#2563eb);">
         <span>📝 Rename image to match event title when saved</span>
       </label></div>` : '',
    SmartFields.datePicker('Date', 'iep-date', 'iep-date-text', e.days || ''),
    SmartFields.timePicker('Start Time', 'iep-time-start', e.start_time || ''),
    SmartFields.timePicker('End Time',   'iep-time-end',   e.end_time   || ''),
    SmartFields.location('Physical Location', 'iep-location', e.location || ''),
    `<div class="form-field"><label for="iep-virt">Zoom / Virtual Link</label>
       <input type="text" id="iep-virt" value="${esc(e.virtual_location || '')}"></div>`,
    `<div class="form-field"><label for="iep-email">Contact Email</label>
       <input type="text" id="iep-email" value="${esc(e.contact_email || '')}"></div>`,
    `<div class="form-field"><label for="iep-desc">Description</label>
       <textarea id="iep-desc" style="min-height:80px;">${esc(e.description || '')}</textarea></div>`,
    `<div class="form-field"><label for="iep-org">Organization</label>
       <input type="text" id="iep-org" list="iep-org-list" data-sf-ac="orgs" autocomplete="off" value="${esc(e.organization || '')}">
       <datalist id="iep-org-list"></datalist></div>`,
    `<div style="margin:16px 0 10px;border-top:1px solid var(--border);padding-top:12px;">
       <div style="font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;
                   color:var(--text-muted);margin-bottom:12px;">Local Only — not synced to sheet</div>
       ${SmartFields.imagePicker('Event Icon', 'iep-icon', e.icon_url || '')}
       <div class="form-field">
         <label>Tags</label>
         <div id="iep-tags-chips" class="img-tags-row" style="min-height:28px;margin-bottom:6px;"></div>
         <div style="display:flex;gap:6px;">
           <input type="text" id="iep-tag-input" placeholder="Add a tag…"
                  style="flex:1;" list="iep-tag-suggestions" autocomplete="off">
           <datalist id="iep-tag-suggestions"></datalist>
           <button type="button" class="btn btn-sm btn-outline"
                   onclick="imgPanelTagAdd(document.getElementById('iep-tag-input').value);document.getElementById('iep-tag-input').value='';">Add</button>
         </div>
         <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Press Enter or comma to add · click ✕ to remove</div>
       </div>
     </div>`,
  ].join('');

  SmartFields.initAll(formEl);
  imgPanelTagsInit(e.tags || []);

  panel.querySelector('#_iepClose').addEventListener('click',  () => panel.remove());
  panel.querySelector('#_iepCancel').addEventListener('click', () => panel.remove());

  panel.querySelector('#_iepSave').addEventListener('click', async () => {
    const title     = document.getElementById('iep-title')?.value?.trim() || '';
    const days      = SmartFields.getDateOrText('iep-date', 'iep-date-text');
    const startTime = SmartFields.getTimeVal('iep-time-start');
    const endTime   = SmartFields.getTimeVal('iep-time-end');
    const location  = document.getElementById('iep-location')?.value?.trim() || '';
    const virt      = document.getElementById('iep-virt')?.value?.trim() || '';
    const email     = document.getElementById('iep-email')?.value?.trim() || '';
    const desc      = document.getElementById('iep-desc')?.value?.trim() || '';
    const org       = document.getElementById('iep-org')?.value?.trim() || '';
    const iconUrl   = document.getElementById('iep-icon')?.value?.trim() || '';
    const renameImg = document.getElementById('iep-rename-img')?.checked || false;

    if (!title) { toast('Event name is required', 'info'); return; }

    const payload = { title, days, start_time: startTime, end_time: endTime,
                      location, virtual_location: virt, contact_email: email,
                      description: desc, organization: org, icon_url: iconUrl };

    try {
      if (isEdit) {
        const rowIndex = e.row_index;
        const upd = await fetch(`/api/events/${rowIndex}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }).then(r => r.json());
        if (!upd.ok) throw new Error(upd.error);
        await fetch(`/api/events/${rowIndex}/meta`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tags: _imgPanelTags }),
        });
        toast(`Event "${title}" updated!`, 'success');
      } else {
        const res  = await fetch('/api/events', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!json.ok) throw new Error(json.error);
        const rowIndex = json.data?.row_index;
        if (imageId && rowIndex != null) {
          await fetch(`/api/images/${encodeURIComponent(imageId)}/link-event`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event_row_index: rowIndex }),
          });
        }
        if (rowIndex != null && _imgPanelTags.length) {
          await fetch(`/api/events/${rowIndex}/meta`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tags: _imgPanelTags }),
          });
        }
        if (imageId && renameImg && title !== imageName) {
          await fetch(`/api/images/${encodeURIComponent(imageId)}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: title }),
          });
        }
        toast(`Event "${title}" created!`, 'success');
      }
      panel.remove();
      await loadImages();
      if (typeof loadEvents === 'function') loadEvents();
    } catch (err) {
      toast('Could not save event: ' + err.message, 'error');
    }
  });
}

async function imgOpenEventEditor(imageId, imageUrl, imageName, eventRowIndex) {
  try {
    const json = await fetch('/api/events').then(r => r.json());
    const eventData = (json.data || []).find(e => String(e.row_index) === String(eventRowIndex));
    if (!eventData) { toast('Linked event not found — it may have been deleted', 'error'); return; }
    imgOpenEventPanel({ mode: 'edit', imageUrl, imageName, imageId, eventData });
  } catch (err) {
    toast('Could not load event data', 'error');
  }
}

async function imgShowEventPicker(imageId, imageUrl, imageName, eventIds) {
  let events;
  try {
    const json = await fetch('/api/events').then(r => r.json());
    events = (json.data || []).filter(e => eventIds.includes(String(e.row_index)));
  } catch { toast('Could not load events', 'error'); return; }

  const picker = document.createElement('div');
  picker.style.cssText = `position:fixed;inset:0;z-index:1010;background:rgba(0,0,0,.6);
    display:flex;align-items:center;justify-content:center;`;
  picker.innerHTML = `
    <div style="background:var(--bg,#fff);border-radius:12px;padding:20px 24px;
                min-width:300px;max-width:480px;box-shadow:0 8px 40px rgba(0,0,0,.3);">
      <div style="font-weight:700;font-size:15px;margin-bottom:14px;">Select event to edit:</div>
      <div style="display:flex;flex-direction:column;gap:8px;" id="_evPickerList"></div>
      <div style="margin-top:14px;">
        <button class="btn btn-ghost btn-sm" id="_evPickerCancel">Cancel</button>
      </div>
    </div>`;

  const list = picker.querySelector('#_evPickerList');
  events.forEach(ev => {
    const btn = document.createElement('button');
    btn.className = 'btn btn-outline';
    btn.style.cssText = 'text-align:left;font-size:14px;';
    btn.innerHTML = `${esc(ev.title || '(untitled)')}${ev.days ? ` <span style="color:var(--text-muted);font-size:12px;">${esc(ev.days)}</span>` : ''}`;
    btn.addEventListener('click', async () => {
      picker.remove();
      await imgOpenEventEditor(imageId, imageUrl, imageName, ev.row_index);
    });
    list.appendChild(btn);
  });
  picker.querySelector('#_evPickerCancel').addEventListener('click', () => picker.remove());
  picker.addEventListener('click', ev => { if (ev.target === picker) picker.remove(); });
  document.body.appendChild(picker);
}

// ── Link image to an existing event ──────────────────────────────────────────

async function imgLinkToEventPicker(imageId) {
  const img = _images.find(i => i.id === imageId);
  if (!img) return;
  const alreadyLinked = new Set((img.event_ids || []).map(String));

  let events;
  try {
    const json = await fetch('/api/events').then(r => r.json());
    events = (json.data || []);
  } catch { toast('Could not load events', 'error'); return; }

  // Separate into already-linked and unlinked
  const unlinked = events.filter(e => !alreadyLinked.has(String(e.row_index)));
  const linked   = events.filter(e =>  alreadyLinked.has(String(e.row_index)));

  const picker = document.createElement('div');
  picker.style.cssText = `position:fixed;inset:0;z-index:1010;background:rgba(0,0,0,.6);
    display:flex;align-items:center;justify-content:center;`;

  function eventBtn(ev, isLinked) {
    return `<div class="img-lep-row${isLinked ? ' img-lep-linked' : ''}" data-row="${esc(String(ev.row_index))}">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
          ${esc(ev.title || '(untitled)')}
        </div>
        ${ev.days ? `<div style="font-size:11px;color:var(--text-muted);">${esc(ev.days)}</div>` : ''}
      </div>
      ${isLinked
        ? `<button class="btn btn-sm" style="background:#fee2e2;color:#dc2626;border:none;flex-shrink:0;"
                   data-unlink="${esc(String(ev.row_index))}">Unlink</button>`
        : `<button class="btn btn-sm" style="background:#dcfce7;color:#16a34a;border:none;flex-shrink:0;"
                   data-link="${esc(String(ev.row_index))}">Link</button>`}
    </div>`;
  }

  picker.innerHTML = `
    <div style="background:var(--bg,#fff);border-radius:12px;padding:20px 24px;
                width:440px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;
                box-shadow:0 8px 40px rgba(0,0,0,.3);">
      <div style="font-weight:700;font-size:15px;margin-bottom:4px;">Link to Event</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">
        Choose events to attach <strong>${esc(img.name || 'this image')}</strong> to.
      </div>
      <input type="search" id="_lepSearch" placeholder="Search events…"
             style="margin-bottom:12px;padding:7px 10px;border:1px solid var(--border);
                    border-radius:7px;font-size:13px;width:100%;">
      <div id="_lepList" style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:6px;">
        ${linked.length ? `<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin-bottom:2px;">Already linked</div>
          ${linked.map(e => eventBtn(e, true)).join('')}
          ${unlinked.length ? `<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin:6px 0 2px;">Other events</div>` : ''}` : ''}
        ${unlinked.map(e => eventBtn(e, false)).join('')}
        ${!events.length ? '<div style="color:var(--text-muted);font-size:13px;">No events found.</div>' : ''}
      </div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
        <button class="btn btn-ghost btn-sm" id="_lepCancel">Close</button>
      </div>
    </div>`;

  // Search filter
  picker.querySelector('#_lepSearch').addEventListener('input', function() {
    const q = this.value.trim().toLowerCase();
    picker.querySelectorAll('.img-lep-row').forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(q) ? '' : 'none';
    });
  });

  // Link / Unlink button delegation
  picker.querySelector('#_lepList').addEventListener('click', async e => {
    const linkBtn   = e.target.closest('[data-link]');
    const unlinkBtn = e.target.closest('[data-unlink]');
    if (!linkBtn && !unlinkBtn) return;

    const rowIndex = parseInt(linkBtn ? linkBtn.dataset.link : unlinkBtn.dataset.unlink);
    const isLink   = !!linkBtn;
    const btn      = linkBtn || unlinkBtn;
    btn.disabled   = true;
    btn.textContent = '…';

    // Helper: apply same link/unlink to a single image id
    async function _applyLink(imgId) {
      return apiFetch(`/api/images/${encodeURIComponent(imgId)}/link-event`, {
        method: isLink ? 'POST' : 'DELETE',
        body:   JSON.stringify({ event_row_index: rowIndex }),
      });
    }
    try {
      await _applyLink(imageId);
      // Also sync to pair partner if one exists
      const local = _images.find(i => i.id === imageId);
      const partner = local?.pair_id
        ? _images.find(i => i.pair_id === local.pair_id && i.id !== imageId)
        : null;
      if (partner) await _applyLink(partner.id);

      // Update local state
      for (const id of [imageId, partner?.id].filter(Boolean)) {
        const loc = _images.find(i => i.id === id);
        if (!loc) continue;
        if (isLink) {
          if (!loc.event_ids.includes(String(rowIndex))) loc.event_ids.push(String(rowIndex));
        } else {
          loc.event_ids = loc.event_ids.filter(x => x !== String(rowIndex));
        }
      }

      const row = btn.closest('.img-lep-row');
      if (isLink) {
        btn.outerHTML = `<button class="btn btn-sm" style="background:#fee2e2;color:#dc2626;border:none;flex-shrink:0;"
                                  data-unlink="${rowIndex}">Unlink</button>`;
        row.classList.add('img-lep-linked');
      } else {
        btn.outerHTML = `<button class="btn btn-sm" style="background:#dcfce7;color:#16a34a;border:none;flex-shrink:0;"
                                  data-link="${rowIndex}">Link</button>`;
        row.classList.remove('img-lep-linked');
      }
      renderGrid();
    } catch (err) {
      toast((isLink ? 'Link' : 'Unlink') + ' failed: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = isLink ? 'Link' : 'Unlink';
    }
  });

  picker.querySelector('#_lepCancel').addEventListener('click', () => picker.remove());
  picker.addEventListener('click', ev => { if (ev.target === picker) picker.remove(); });
  document.body.appendChild(picker);
  picker.querySelector('#_lepSearch').focus();
}

// ── Link to Job picker ────────────────────────────────────────────────────────

async function imgLinkToJobPicker(imageId) {
  const img = _images.find(i => i.id === imageId);
  if (!img) return;
  const alreadyLinked = new Set((img.job_ids || []).map(String));

  let jobs = [];
  try {
    const r = await fetch('/api/jobs');
    const j = await r.json();
    jobs = (j.data || []).filter(j => j.active || alreadyLinked.has(String(j.id)));
  } catch { toast('Could not load jobs', 'error'); return; }

  const linked   = jobs.filter(j => alreadyLinked.has(String(j.id)));
  const unlinked = jobs.filter(j => !alreadyLinked.has(String(j.id)));

  function jobBtn(job, isLinked) {
    const icon = job.icon_url && job.icon_url.length <= 4 ? job.icon_url : '💼';
    return `<div class="img-lep-row${isLinked ? ' img-lep-linked' : ''}" data-job-id="${esc(job.id)}">
      <span style="font-size:18px;">${esc(icon)}</span>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;font-size:13px;">${esc(job.title)}</div>
        ${job.org ? `<div style="font-size:12px;color:var(--text-muted);">${esc(job.org)}</div>` : ''}
      </div>
      <button class="btn btn-sm" style="${isLinked
        ? 'background:#fee2e2;color:#dc2626;border:none;flex-shrink:0;'
        : 'background:#dcfce7;color:#16a34a;border:none;flex-shrink:0;'}"
              data-link="${esc(job.id)}">${isLinked ? 'Unlink' : 'Link'}</button>
    </div>`;
  }

  const picker = document.createElement('div');
  picker.style.cssText = `position:fixed;inset:0;z-index:1010;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;`;
  picker.innerHTML = `
    <div style="background:var(--surface);border-radius:16px;padding:20px;
                width:440px;max-width:95vw;max-height:85vh;display:flex;flex-direction:column;
                box-shadow:0 8px 40px rgba(0,0,0,.3);">
      <div style="font-weight:700;font-size:15px;margin-bottom:4px;">Link to Job</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px;">
        Attach <strong>${esc(img.name || 'this image')}</strong> to job listings.
      </div>
      <input type="search" id="_ljpSearch" placeholder="Search jobs…"
             style="margin-bottom:10px;padding:7px 10px;border:1px solid var(--border);
                    border-radius:7px;font-size:13px;width:100%;">
      <div id="_ljpList" style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:6px;">
        ${linked.length ? `<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin-bottom:2px;">Already linked</div>
          ${linked.map(j => jobBtn(j, true)).join('')}
          ${unlinked.length ? `<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin:6px 0 2px;">Other jobs</div>` : ''}` : ''}
        ${unlinked.map(j => jobBtn(j, false)).join('')}
        ${!jobs.length ? '<div style="color:var(--text-muted);font-size:13px;">No active jobs found.</div>' : ''}
      </div>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border);">
        <button class="btn btn-ghost btn-sm" id="_ljpCancel">Close</button>
      </div>
    </div>`;
  document.body.appendChild(picker);

  // Search filter
  picker.querySelector('#_ljpSearch').addEventListener('input', e => {
    const q = e.target.value.toLowerCase();
    picker.querySelectorAll('.img-lep-row').forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(q) ? '' : 'none';
    });
  });

  // Link / Unlink buttons
  picker.querySelector('#_ljpList').addEventListener('click', async e => {
    const btn = e.target.closest('[data-link]');
    if (!btn) return;
    const jobId  = btn.dataset.link;
    const row    = btn.closest('.img-lep-row');
    const isLink = !row.classList.contains('img-lep-linked');
    btn.disabled = true;
    btn.textContent = isLink ? 'Linking…' : 'Unlinking…';
    try {
      const res = await apiFetch(`/api/images/${encodeURIComponent(imageId)}/link-job`, {
        method: isLink ? 'POST' : 'DELETE',
        body:   JSON.stringify({ job_id: jobId }),
      });
      // Update local image cache
      const imgIdx = _images.findIndex(i => i.id === imageId);
      if (imgIdx >= 0) _images[imgIdx] = res.data;
      if (isLink) {
        btn.outerHTML = `<button class="btn btn-sm" style="background:#fee2e2;color:#dc2626;border:none;flex-shrink:0;" data-link="${esc(jobId)}">Unlink</button>`;
        row.classList.add('img-lep-linked');
      } else {
        btn.outerHTML = `<button class="btn btn-sm" style="background:#dcfce7;color:#16a34a;border:none;flex-shrink:0;" data-link="${esc(jobId)}">Link</button>`;
        row.classList.remove('img-lep-linked');
      }
    } catch (err) {
      toast((isLink ? 'Link' : 'Unlink') + ' failed: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = isLink ? 'Link' : 'Unlink';
    }
  });

  picker.querySelector('#_ljpCancel').addEventListener('click', () => picker.remove());
  picker.addEventListener('click', ev => { if (ev.target === picker) picker.remove(); });
  picker.querySelector('#_ljpSearch').focus();
}

/** Returns the pair partner id for a given image id, or null. Used by data_tab.js. */
window.imgGetPairPartnerId = function(imageId) {
  const img = _images.find(i => i.id === imageId);
  if (!img?.pair_id) return null;
  const partner = _images.find(i => i.pair_id === img.pair_id && i.id !== imageId);
  return partner?.id ?? null;
};

// ── Badge click — open event editor (or picker if multiple) ──────────────────

window.imgShowLinkedEvent = async function(imageId) {
  const img = _images.find(i => i.id === imageId);
  if (!img) return;
  const eventIds = img.event_ids || [];
  if (!eventIds.length) return;

  if (eventIds.length === 1) {
    await imgOpenEventEditor(imageId, img.url, img.name || '', eventIds[0]);
  } else {
    imgShowEventPicker(imageId, img.url, img.name || '', eventIds);
  }
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

EventBus.on('app:ready', loadImages);
EventBus.on('tab:changed', ({ tab }) => {
  if (tab === 'images') loadImages();
});
