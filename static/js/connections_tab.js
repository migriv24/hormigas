/**
 * connections_tab.js — Connections Manager tab.
 *
 * Manages the local property graph (nodes + edges) and renders the
 * entity list / detail panel UI.  All mutations go through /api/graph/…
 * and immediately update local state + re-render.
 */

// ── State ─────────────────────────────────────────────────────────────────────

let _connNodes   = [];   // GraphNode[]
let _connEdges   = [];   // GraphEdge[]
let _connFilter  = 'all'; // 'all' | 'contact' | 'org' | 'event' | 'image' | 'tag' | '_tagmgr'
let _connSearch  = '';
let _connSelected = null; // selected node id
let _tagColor    = '#6366f1';
let _editingTagId = null; // null = creating new

// Tag color palette
const TAG_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#6366f1', '#a855f7',
  '#ec4899', '#6b7280',
];

// ── DOM refs ──────────────────────────────────────────────────────────────────

const connEntityList  = document.getElementById('connEntityList');
const connDetail      = document.getElementById('connDetail');
const connSearch      = document.getElementById('connSearch');
const connSyncBtn     = document.getElementById('connSyncBtn');
const connNewTagBtn   = document.getElementById('connNewTagBtn');

const connTagModal        = document.getElementById('connTagModal');
const connTagModalTitle   = document.getElementById('connTagModalTitle');
const connTagModalClose   = document.getElementById('connTagModalClose');
const connTagModalCancel  = document.getElementById('connTagModalCancel');
const connTagModalSave    = document.getElementById('connTagModalSave');
const connTagName         = document.getElementById('connTagName');
const connTagColorCustom  = document.getElementById('connTagColorCustom');
const connTagColorPreview = document.getElementById('connTagColorPreview');
const connColorPalette    = document.getElementById('connColorPalette');

const connEdgeModal       = document.getElementById('connEdgeModal');
const connEdgeModalClose  = document.getElementById('connEdgeModalClose');
const connEdgeModalCancel = document.getElementById('connEdgeModalCancel');
const connEdgeModalSave   = document.getElementById('connEdgeModalSave');
const connEdgeFrom        = document.getElementById('connEdgeFrom');
const connEdgeRelation    = document.getElementById('connEdgeRelation');
const connEdgeTo          = document.getElementById('connEdgeTo');

// ── API helpers ───────────────────────────────────────────────────────────────

async function connFetch(url, opts = {}) {
  const res  = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'API error');
  return json;
}

// ── Load ──────────────────────────────────────────────────────────────────────

async function loadGraph() {
  try {
    const json = await connFetch('/api/graph');
    _connNodes = json.data?.nodes || [];
    _connEdges = json.data?.edges || [];
    _seInvalidateCache?.();
    renderEntityList();
    if (_connSelected) renderDetail(_connSelected);
  } catch (err) {
    toast('Failed to load graph: ' + err.message, 'error');
  }
}

// ── Entity list rendering ────────────────────────────────────────────────────

function getVisibleNodes() {
  let nodes = _connNodes;
  if (_connFilter !== 'all') nodes = nodes.filter(n => n.type === _connFilter);
  if (_connSearch) {
    const q = _connSearch.toLowerCase();
    nodes = nodes.filter(n => n.label.toLowerCase().includes(q));
  }
  return nodes.sort((a, b) => a.label.localeCompare(b.label));
}

function renderEntityList() {
  // Tag Manager is a separate full-panel view
  if (_connFilter === '_tagmgr') {
    renderTagManager();
    return;
  }

  const nodes = getVisibleNodes();
  if (!nodes.length) {
    connEntityList.innerHTML = '<div class="conn-empty">No matching entities.</div>';
    return;
  }

  // Group by type for 'all' view
  let html = '';
  if (_connFilter === 'all') {
    const groups = {
      contact: nodes.filter(n => n.type === 'contact'),
      org:     nodes.filter(n => n.type === 'org'),
      event:   nodes.filter(n => n.type === 'event'),
      image:   nodes.filter(n => n.type === 'image'),
      tag:     nodes.filter(n => n.type === 'tag'),
    };
    const labels = { contact: '👤 People', org: '🏢 Organizations', event: '📅 Events', image: '🖼 Images', tag: '🏷 Tags' };
    for (const [type, grp] of Object.entries(groups)) {
      if (!grp.length) continue;
      html += `<div class="conn-group-label">${labels[type]}</div>`;
      html += grp.map(n => nodeRow(n)).join('');
    }
  } else {
    html = nodes.map(n => nodeRow(n)).join('');
  }

  connEntityList.innerHTML = html;

  connEntityList.querySelectorAll('.conn-entity-row').forEach(el => {
    el.addEventListener('click', () => selectNode(el.dataset.id));
  });
}

function nodeRow(n) {
  const isSelected = n.id === _connSelected;
  const tags = _connEdges
    .filter(e => e.from_id === n.id && e.relation === 'tagged')
    .map(e => _connNodes.find(x => x.id === e.to_id))
    .filter(Boolean);

  return `
    <div class="conn-entity-row${isSelected ? ' selected' : ''}" data-id="${n.id}">
      <div class="conn-entity-icon">${nodeIcon(n.type)}</div>
      <div class="conn-entity-info">
        <div class="conn-entity-label${n.stale ? ' conn-stale' : ''}">${cEsc(n.label)}${n.stale ? ' <span class="conn-stale-badge">stale</span>' : ''}</div>
        <div class="conn-entity-tags">
          ${tags.slice(0, 5).map(t => tagChip(t, false)).join('')}
        </div>
      </div>
    </div>
  `;
}

function nodeIcon(type) {
  if (type === 'contact') return '👤';
  if (type === 'org')     return '🏢';
  if (type === 'event')   return '📅';
  if (type === 'image')   return '🖼';
  return '🏷';
}

function tagChip(tagNode, withRemove = false, entityId = null) {
  const bg    = tagNode.color || '#6366f1';
  const style = `background:${bg}22;color:${bg};border-color:${bg}55;`;
  const rem   = withRemove
    ? `<span class="conn-chip-remove" data-tag="${tagNode.id}" data-entity="${entityId}">×</span>`
    : '';
  return `<span class="conn-tag-chip" style="${style}">#${cEsc(tagNode.label)}${rem}</span>`;
}

// ── Node selection + detail panel ────────────────────────────────────────────

function selectNode(id) {
  _connSelected = id;
  renderEntityList();
  renderDetail(id);
}

function renderDetail(id) {
  const node = _connNodes.find(n => n.id === id);
  if (!node) {
    connDetail.innerHTML = '<div class="conn-detail-empty">Not found.</div>';
    return;
  }

  // Collect edges
  const outEdges = _connEdges.filter(e => e.from_id === id);
  const inEdges  = _connEdges.filter(e => e.to_id   === id);

  const tagEdges      = outEdges.filter(e => e.relation === 'tagged');
  const memberOfEdges = outEdges.filter(e => e.relation === 'member_of');
  const memberEdges   = inEdges.filter(e => e.relation === 'member_of');
  const otherOut      = outEdges.filter(e => e.relation !== 'tagged' && e.relation !== 'member_of');
  const otherIn       = inEdges.filter(e => e.relation !== 'member_of');

  const tags   = tagEdges.map(e => _connNodes.find(x => x.id === e.to_id)).filter(Boolean);
  const orgs   = memberOfEdges.map(e => _connNodes.find(x => x.id === e.to_id)).filter(Boolean);
  const members= memberEdges.map(e => _connNodes.find(x => x.id === e.from_id)).filter(Boolean);

  connDetail.innerHTML = `
    <div class="conn-detail-inner">

      <div class="conn-detail-head">
        <span class="conn-detail-icon">${nodeIcon(node.type)}</span>
        <div>
          <div class="conn-detail-name">${cEsc(node.label)}</div>
          <div class="conn-detail-type">${node.type}</div>
        </div>
        <div class="conn-detail-actions">
          ${node.type === 'tag' ? `<button class="btn btn-sm btn-outline" onclick="connEditTag('${node.id}')">✏ Edit Tag</button>` : ''}
          <button class="btn btn-sm btn-ghost conn-delete-node-btn" onclick="connDeleteNode('${node.id}')">🗑 Delete</button>
        </div>
      </div>

      <!-- Tags section -->
      <div class="conn-section">
        <div class="conn-section-title">Tags</div>
        <div class="conn-tags-wrap" id="detailTagsWrap">
          ${tags.map(t => tagChip(t, true, id)).join('')}
          <button class="btn btn-sm btn-ghost conn-add-tag-btn" id="detailAddTagBtn">+ Add tag</button>
        </div>
        <div id="detailTagSearch" class="conn-tag-search-wrap hidden">
          <input type="text" id="detailTagInput" placeholder="Search or create tag…" autocomplete="off">
          <div id="detailTagSuggestions" class="conn-tag-suggestions"></div>
        </div>
      </div>

      <!-- Org membership (contacts) -->
      ${orgs.length ? `
        <div class="conn-section">
          <div class="conn-section-title">Member of</div>
          ${orgs.map(o => `
            <div class="conn-relation-row">
              <span class="conn-relation-icon">🏢</span>
              <span class="conn-relation-label" onclick="selectNode('${o.id}')" style="cursor:pointer;">${cEsc(o.label)}</span>
              <button class="btn btn-xs btn-ghost conn-remove-edge-btn"
                      data-from="${id}" data-to="${o.id}" data-rel="member_of">×</button>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- Members (orgs / tags) -->
      ${members.length ? `
        <div class="conn-section">
          <div class="conn-section-title">${node.type === 'org' ? 'Members' : 'Tagged entities'}</div>
          ${members.map(m => `
            <div class="conn-relation-row">
              <span class="conn-relation-icon">${nodeIcon(m.type)}</span>
              <span class="conn-relation-label" onclick="selectNode('${m.id}')" style="cursor:pointer;">${cEsc(m.label)}</span>
              <button class="btn btn-xs btn-ghost conn-remove-edge-btn"
                      data-from="${m.id}" data-to="${id}" data-rel="${memberEdges.find(e => e.from_id === m.id)?.relation || 'member_of'}">×</button>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- Other connections (out) -->
      ${otherOut.length ? `
        <div class="conn-section">
          <div class="conn-section-title">Connections (out)</div>
          ${otherOut.map(e => {
            const target = _connNodes.find(x => x.id === e.to_id);
            if (!target) return '';
            return `
              <div class="conn-relation-row">
                <span class="conn-relation-icon">${nodeIcon(target.type)}</span>
                <span class="conn-relation-chip">${cEsc(e.relation)}</span>
                <span class="conn-relation-label" onclick="selectNode('${target.id}')" style="cursor:pointer;">${cEsc(target.label)}</span>
                <button class="btn btn-xs btn-ghost conn-remove-edge-btn"
                        data-edge="${e.id}">×</button>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}

      <!-- Other connections (in) -->
      ${otherIn.length ? `
        <div class="conn-section">
          <div class="conn-section-title">Connections (in)</div>
          ${otherIn.map(e => {
            const src = _connNodes.find(x => x.id === e.from_id);
            if (!src) return '';
            return `
              <div class="conn-relation-row">
                <span class="conn-relation-icon">${nodeIcon(src.type)}</span>
                <span class="conn-relation-label" onclick="selectNode('${src.id}')" style="cursor:pointer;">${cEsc(src.label)}</span>
                <span class="conn-relation-chip">${cEsc(e.relation)}</span>
                <button class="btn btn-xs btn-ghost conn-remove-edge-btn"
                        data-edge="${e.id}">×</button>
              </div>
            `;
          }).join('')}
        </div>
      ` : ''}

      <!-- Add connection -->
      <div class="conn-section">
        <button class="btn btn-sm btn-outline" onclick="openAddConnectionModal('${id}')">+ Add connection</button>
      </div>

    </div>
  `;

  // Wire tag chip remove buttons
  connDetail.querySelectorAll('.conn-chip-remove').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      removeTag(btn.dataset.entity, btn.dataset.tag);
    });
  });

  // Wire edge remove buttons
  connDetail.querySelectorAll('.conn-remove-edge-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      if (btn.dataset.edge) {
        removeEdge(btn.dataset.edge);
      } else {
        removeEdgeByEndpoints(btn.dataset.from, btn.dataset.to, btn.dataset.rel);
      }
    });
  });

  // Wire add-tag button
  document.getElementById('detailAddTagBtn')?.addEventListener('click', () => {
    const wrap = document.getElementById('detailTagSearch');
    wrap?.classList.toggle('hidden');
    if (!wrap?.classList.contains('hidden')) {
      const inp = document.getElementById('detailTagInput');
      inp?.focus();
      inp?.addEventListener('input', () => renderTagSuggestions(id, inp.value));
      renderTagSuggestions(id, '');
    }
  });
}

// ── Tag suggestions in detail panel ──────────────────────────────────────────

function renderTagSuggestions(entityId, query) {
  const q      = query.toLowerCase();
  const existing = _connEdges
    .filter(e => e.from_id === entityId && e.relation === 'tagged')
    .map(e => e.to_id);
  const tags   = _connNodes.filter(n => n.type === 'tag' && !existing.includes(n.id));
  const matches = tags.filter(t => t.label.toLowerCase().includes(q));

  const suggEl = document.getElementById('detailTagSuggestions');
  if (!suggEl) return;

  let html = matches.slice(0, 10).map(t => `
    <div class="conn-tag-suggestion" data-tag="${t.id}">
      ${tagChip(t, false)} ${cEsc(t.label)}
    </div>
  `).join('');

  if (q && !matches.find(t => t.label.toLowerCase() === q)) {
    html += `<div class="conn-tag-suggestion conn-tag-create" data-create="${cEsc(query)}">
      + Create tag "<strong>${cEsc(query)}</strong>"
    </div>`;
  }

  if (!html) html = '<div style="padding:8px;font-size:12px;color:var(--text-muted);">No tags found.</div>';
  suggEl.innerHTML = html;

  suggEl.querySelectorAll('[data-tag]').forEach(el => {
    el.addEventListener('click', () => addTagToEntity(entityId, el.dataset.tag));
  });
  suggEl.querySelectorAll('[data-create]').forEach(el => {
    el.addEventListener('click', () => createTagAndAttach(entityId, el.dataset.create));
  });
}

async function addTagToEntity(entityId, tagId) {
  try {
    const json = await connFetch('/api/graph/edges', {
      method: 'POST',
      body: JSON.stringify({ from_id: entityId, to_id: tagId, relation: 'tagged' }),
    });
    _connEdges.push(json.data);
    _seInvalidateCache?.();
    renderEntityList();
    renderDetail(entityId);
  } catch (err) { toast('Could not add tag: ' + err.message, 'error'); }
}

async function removeTag(entityId, tagId) {
  await removeEdgeByEndpoints(entityId, tagId, 'tagged');
  _seInvalidateCache?.();
  renderEntityList();
  renderDetail(entityId);
}

async function createTagAndAttach(entityId, label) {
  try {
    const newTagJson = await connFetch('/api/graph/nodes', {
      method: 'POST',
      body: JSON.stringify({ type: 'tag', label, color: TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)] }),
    });
    _connNodes.push(newTagJson.data);
    await addTagToEntity(entityId, newTagJson.data.id);
  } catch (err) { toast('Could not create tag: ' + err.message, 'error'); }
}

// ── Edge removal helpers ──────────────────────────────────────────────────────

async function removeEdge(edgeId) {
  if (!confirm('Remove this connection?')) return;
  try {
    await connFetch(`/api/graph/edges/${encodeURIComponent(edgeId)}`, { method: 'DELETE' });
    _connEdges = _connEdges.filter(e => e.id !== edgeId);
    _seInvalidateCache?.();
    renderEntityList();
    if (_connSelected) renderDetail(_connSelected);
  } catch (err) { toast('Could not remove connection: ' + err.message, 'error'); }
}

async function removeEdgeByEndpoints(fromId, toId, relation) {
  const edge = _connEdges.find(e => e.from_id === fromId && e.to_id === toId && e.relation === relation);
  if (!edge) return;
  try {
    await connFetch(`/api/graph/edges/${encodeURIComponent(edge.id)}`, { method: 'DELETE' });
    _connEdges = _connEdges.filter(e => e.id !== edge.id);
    _seInvalidateCache?.();
    renderEntityList();
    if (_connSelected) renderDetail(_connSelected);
  } catch (err) { toast('Could not remove connection: ' + err.message, 'error'); }
}

// ── Delete node ───────────────────────────────────────────────────────────────

window.connDeleteNode = async function(id) {
  const node = _connNodes.find(n => n.id === id);
  if (!node) return;
  if (!confirm(`Delete "${node.label}"?\nThis also removes all its connections.`)) return;
  if (!confirm(`Are you sure? This cannot be undone.`)) return;
  try {
    await connFetch(`/api/graph/nodes/${encodeURIComponent(id)}`, { method: 'DELETE' });
    _connNodes = _connNodes.filter(n => n.id !== id);
    _connEdges = _connEdges.filter(e => e.from_id !== id && e.to_id !== id);
    _connSelected = null;
    _seInvalidateCache?.();
    renderEntityList();
    connDetail.innerHTML = '<div class="conn-detail-empty">Deleted.</div>';
    toast('Deleted', 'success');
  } catch (err) { toast('Delete failed: ' + err.message, 'error'); }
};

// ── Add Connection modal ──────────────────────────────────────────────────────

window.openAddConnectionModal = function(fromId) {
  const fromNode = _connNodes.find(n => n.id === fromId);
  if (!fromNode) return;
  connEdgeFrom.textContent = `${nodeIcon(fromNode.type)} ${fromNode.label}`;
  connEdgeFrom.dataset.id  = fromId;
  connEdgeRelation.value   = 'connected_to';
  connEdgeTo.value         = '';
  // Populate datalist with all known entity labels (excluding the source node)
  const list = document.getElementById('connEdgeToList');
  if (list) {
    list.innerHTML = _connNodes
      .filter(n => n.id !== fromId)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map(n => `<option value="${cEsc(n.label)}" label="${cEsc(nodeIcon(n.type) + ' ' + n.type)}">`)
      .join('');
  }
  connEdgeModal.classList.remove('hidden');
  SyntaxEngine.install(connEdgeTo);
  connEdgeTo.focus();
};

connEdgeModalClose.addEventListener('click',  () => connEdgeModal.classList.add('hidden'));
connEdgeModalCancel.addEventListener('click', () => connEdgeModal.classList.add('hidden'));
connEdgeModal.addEventListener('click', e => { if (e.target === connEdgeModal) connEdgeModal.classList.add('hidden'); });

connEdgeModalSave.addEventListener('click', async () => {
  const fromId   = connEdgeFrom.dataset.id;
  const relation = connEdgeRelation.value.trim() || 'connected_to';
  const toLabel  = connEdgeTo.value.trim();
  if (!toLabel) { toast('Enter a target entity name', 'info'); return; }

  // Find target node by label (case-insensitive)
  const toNode = _connNodes.find(n => n.label.toLowerCase() === toLabel.toLowerCase());
  if (!toNode) { toast(`No entity named "${toLabel}" found. Sync the sheet or check spelling.`, 'info'); return; }

  try {
    const json = await connFetch('/api/graph/edges', {
      method: 'POST',
      body: JSON.stringify({ from_id: fromId, to_id: toNode.id, relation }),
    });
    _connEdges.push(json.data);
    _seInvalidateCache?.();
    connEdgeModal.classList.add('hidden');
    renderEntityList();
    renderDetail(fromId);
    toast('Connection added', 'success');
  } catch (err) { toast('Could not add connection: ' + err.message, 'error'); }
});

// ── Tag modal ─────────────────────────────────────────────────────────────────

function buildColorPalette() {
  connColorPalette.innerHTML = TAG_COLORS.map(c => `
    <button class="conn-color-swatch${c === _tagColor ? ' active' : ''}"
            style="background:${c};" data-color="${c}" title="${c}"></button>
  `).join('');
  connColorPalette.querySelectorAll('.conn-color-swatch').forEach(btn => {
    btn.addEventListener('click', () => {
      _tagColor = btn.dataset.color;
      connTagColorCustom.value = _tagColor;
      syncColorPreview();
      connColorPalette.querySelectorAll('.conn-color-swatch').forEach(b =>
        b.classList.toggle('active', b.dataset.color === _tagColor)
      );
    });
  });
}

function syncColorPreview() {
  const c = _tagColor;
  connTagColorPreview.textContent = connTagName.value.trim() ? '#' + connTagName.value.trim() : '#preview';
  connTagColorPreview.style.background  = c + '22';
  connTagColorPreview.style.color       = c;
  connTagColorPreview.style.borderColor = c + '55';
}

connTagColorCustom.addEventListener('input', () => {
  _tagColor = connTagColorCustom.value;
  connColorPalette.querySelectorAll('.conn-color-swatch').forEach(b =>
    b.classList.toggle('active', b.dataset.color === _tagColor)
  );
  syncColorPreview();
});
connTagName.addEventListener('input', syncColorPreview);

connNewTagBtn.addEventListener('click', () => {
  _editingTagId = null;
  connTagModalTitle.textContent = 'New Tag';
  connTagName.value = '';
  _tagColor = TAG_COLORS[0];
  connTagColorCustom.value = _tagColor;
  buildColorPalette();
  syncColorPreview();
  connTagModal.classList.remove('hidden');
  connTagName.focus();
});

window.connEditTag = function(id) {
  const node = _connNodes.find(n => n.id === id);
  if (!node) return;
  _editingTagId = id;
  connTagModalTitle.textContent = 'Edit Tag';
  connTagName.value = node.label;
  _tagColor = node.color || TAG_COLORS[0];
  connTagColorCustom.value = _tagColor;
  buildColorPalette();
  syncColorPreview();
  connTagModal.classList.remove('hidden');
  connTagName.focus();
};

connTagModalClose.addEventListener('click',  () => connTagModal.classList.add('hidden'));
connTagModalCancel.addEventListener('click', () => connTagModal.classList.add('hidden'));
connTagModal.addEventListener('click', e => { if (e.target === connTagModal) connTagModal.classList.add('hidden'); });

connTagModalSave.addEventListener('click', async () => {
  const label = connTagName.value.trim().replace(/\s+/g, '_');
  if (!label) { toast('Tag name is required', 'info'); return; }

  try {
    if (_editingTagId) {
      // Update
      const json = await connFetch(`/api/graph/nodes/${encodeURIComponent(_editingTagId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ label, color: _tagColor }),
      });
      const idx = _connNodes.findIndex(n => n.id === _editingTagId);
      if (idx >= 0) _connNodes[idx] = json.data;
      toast('Tag updated', 'success');
    } else {
      // Create
      const json = await connFetch('/api/graph/nodes', {
        method: 'POST',
        body: JSON.stringify({ type: 'tag', label, color: _tagColor }),
      });
      _connNodes.push(json.data);
      toast('Tag created: #' + label, 'success');
    }
    _seInvalidateCache?.();
    connTagModal.classList.add('hidden');
    renderEntityList();
    if (_connSelected) renderDetail(_connSelected);
  } catch (err) { toast('Could not save tag: ' + err.message, 'error'); }
});

// ── Sync from sheet ───────────────────────────────────────────────────────────

connSyncBtn.addEventListener('click', async () => {
  connSyncBtn.disabled = true;
  connSyncBtn.textContent = 'Syncing…';
  try {
    const json = await connFetch('/api/graph/sync', { method: 'POST' });
    const d = json.data;
    toast(`Synced: ${d.contacts_synced} people, ${d.orgs_synced} orgs, ${d.events_synced ?? 0} events, ${d.images_synced ?? 0} images`, 'success');
    await loadGraph();
  } catch (err) {
    toast('Sync failed: ' + err.message, 'error');
  } finally {
    connSyncBtn.disabled = false;
    connSyncBtn.textContent = '↻ Sync Sheet';
  }
});

// ── Type filter tabs ──────────────────────────────────────────────────────────

document.getElementById('connTypeTabs')?.querySelectorAll('.conn-type-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.conn-type-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    _connFilter = btn.dataset.ctype;
    renderEntityList();
  });
});

// ── Search ────────────────────────────────────────────────────────────────────

connSearch.addEventListener('input', () => {
  _connSearch = connSearch.value.trim();
  renderEntityList();
});

// ── Tag Manager panel ─────────────────────────────────────────────────────────

let _tagStats = [];  // [{name, count}]

async function renderTagManager() {
  connEntityList.innerHTML = '<div class="conn-empty" style="padding:16px;">Loading tags…</div>';
  connDetail.innerHTML = '';
  try {
    const json = await connFetch('/api/tags/stats');
    _tagStats = json.data || [];
  } catch (err) {
    connEntityList.innerHTML = `<div class="conn-empty">Failed to load: ${cEsc(err.message)}</div>`;
    return;
  }

  if (!_tagStats.length) {
    connEntityList.innerHTML = '<div class="conn-empty">No tags yet. Add tags to contacts, events, or images to see them here.</div>';
    return;
  }

  connEntityList.innerHTML = `
    <div class="conn-tagmgr-header">
      <span>${_tagStats.length} tags across all systems</span>
    </div>
    ${_tagStats.map(t => `
      <div class="conn-entity-row conn-tagmgr-row" data-tag="${cEsc(t.name)}" style="cursor:pointer;">
        <div class="conn-entity-icon">🏷</div>
        <div class="conn-entity-info" style="flex:1;min-width:0;">
          <div class="conn-entity-label">#${cEsc(t.name)}</div>
          <div style="font-size:11px;color:var(--text-muted);">${t.count} uses — click to preview</div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0;">
          <button class="btn btn-xs btn-ghost" onclick="event.stopPropagation();connTagMgrRename('${cEsc(t.name)}')" title="Rename">✏</button>
          <button class="btn btn-xs btn-ghost" style="color:var(--danger);" onclick="event.stopPropagation();connTagMgrDelete('${cEsc(t.name)}')" title="Delete">🗑</button>
        </div>
      </div>
    `).join('')}
  `;

  // Click a tag row → show which graph entities use it
  connEntityList.querySelectorAll('.conn-tagmgr-row').forEach(row => {
    row.addEventListener('click', () => {
      connEntityList.querySelectorAll('.conn-tagmgr-row').forEach(r => r.classList.remove('selected'));
      row.classList.add('selected');
      renderTagPreview(row.dataset.tag);
    });
  });
}

async function renderTagPreview(tagName) {
  // Show loading state immediately
  connDetail.innerHTML = `
    <div class="conn-detail-inner">
      <div class="conn-detail-head">
        <span class="conn-detail-icon">🏷</span>
        <div>
          <div class="conn-detail-name">#${cEsc(tagName)}</div>
          <div class="conn-detail-type" style="color:var(--text-muted);">Loading…</div>
        </div>
        <div class="conn-detail-actions">
          <button class="btn btn-sm btn-outline" onclick="connTagMgrRename('${cEsc(tagName)}')">✏ Rename</button>
          <button class="btn btn-sm btn-ghost" style="color:var(--danger);" onclick="connTagMgrDelete('${cEsc(tagName)}')">🗑 Delete</button>
        </div>
      </div>
    </div>`;

  let data;
  try {
    const json = await connFetch(`/api/tags/${encodeURIComponent(tagName)}/entities`);
    data = json.data;
  } catch (err) {
    connDetail.innerHTML += `<div style="padding:16px;color:var(--danger);">Failed to load: ${cEsc(err.message)}</div>`;
    return;
  }

  const images   = data.images   || [];
  const events   = data.events   || [];
  const contacts = data.contacts || [];
  const total    = images.length + events.length + contacts.length;

  // Also check graph nodes tagged with this tag
  const tagNodes  = _connNodes.filter(n => n.type === 'tag' && n.label === tagName);
  const tagIds    = new Set(tagNodes.map(n => n.id));
  const graphNodes = _connEdges
    .filter(e => e.relation === 'tagged' && tagIds.has(e.to_id))
    .map(e => _connNodes.find(n => n.id === e.from_id))
    .filter(Boolean);
  // Only show graph nodes that aren't already shown via store queries
  const graphOther = graphNodes.filter(n => n.type !== 'contact' && n.type !== 'event' && n.type !== 'image');

  let html = `
    <div class="conn-detail-inner">
      <div class="conn-detail-head">
        <span class="conn-detail-icon">🏷</span>
        <div>
          <div class="conn-detail-name">#${cEsc(tagName)}</div>
          <div class="conn-detail-type">${total + graphOther.length} tagged across all stores</div>
        </div>
        <div class="conn-detail-actions">
          <button class="btn btn-sm btn-outline" onclick="connTagMgrRename('${cEsc(tagName)}')">✏ Rename</button>
          <button class="btn btn-sm btn-ghost" style="color:var(--danger);" onclick="connTagMgrDelete('${cEsc(tagName)}')">🗑 Delete</button>
        </div>
      </div>`;

  function section(title, rows) {
    if (!rows.length) return '';
    return `<div class="conn-section">
      <div class="conn-section-title">${title} (${rows.length})</div>
      <div style="display:flex;flex-direction:column;gap:2px;max-height:220px;overflow-y:auto;">
        ${rows.join('')}
      </div>
    </div>`;
  }

  html += section('🖼 Images', images.map(i => `
    <div class="conn-relation-row">
      ${i.url ? `<img src="${cEsc(i.url)}" style="width:28px;height:28px;object-fit:cover;border-radius:4px;flex-shrink:0;">` : '<span class="conn-relation-icon">🖼</span>'}
      <span class="conn-relation-label">${cEsc(i.name)}${i.language ? ` <span style="font-size:10px;background:#e0e7ff;color:#3730a3;padding:1px 5px;border-radius:3px;">${cEsc(i.language.toUpperCase())}</span>` : ''}</span>
    </div>`));

  html += section('📅 Events', events.map(e => `
    <div class="conn-relation-row">
      <span class="conn-relation-icon">📅</span>
      <span class="conn-relation-label">${cEsc(e.title)}</span>
    </div>`));

  html += section('👤 People', contacts.map(c => `
    <div class="conn-relation-row">
      <span class="conn-relation-icon">👤</span>
      <span class="conn-relation-label">${cEsc(c.name)}</span>
    </div>`));

  if (graphOther.length) {
    html += section('🔗 Other (graph)', graphOther.map(n => `
      <div class="conn-relation-row" style="cursor:pointer;" onclick="selectNode('${n.id}')">
        <span class="conn-relation-icon">${nodeIcon(n.type)}</span>
        <span class="conn-relation-label">${cEsc(n.label)}</span>
      </div>`));
  }

  if (total === 0 && graphOther.length === 0) {
    html += `<div class="conn-detail-empty" style="padding:16px;">No entities tagged with <strong>#${cEsc(tagName)}</strong> found in any store.</div>`;
  }

  html += `</div>`;
  connDetail.innerHTML = html;
}

window.connTagMgrRename = async function(name) {
  const newName = prompt(`Rename tag "#${name}" to:`, name);
  if (!newName || newName.trim() === name) return;
  try {
    const json = await connFetch('/api/tags/rename', {
      method: 'POST',
      body: JSON.stringify({ old: name, new: newName.trim() }),
    });
    toast(`Renamed "#${name}" → "#${newName.trim()}" (${json.data.updated} updated)`, 'success');
    renderTagManager();
  } catch (err) { toast('Rename failed: ' + err.message, 'error'); }
};

window.connTagMgrDelete = async function(name) {
  const stat = _tagStats.find(t => t.name === name);
  if (!confirm(`Delete tag "#${name}"?${stat?.count ? `\nThis will remove it from ${stat.count} entities.` : ''}`)) return;
  try {
    const json = await connFetch('/api/tags/delete', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    toast(`Deleted "#${name}" (removed from ${json.data.updated} entities)`, 'success');
    renderTagManager();
  } catch (err) { toast('Delete failed: ' + err.message, 'error'); }
};

// ── Shared escape helper ──────────────────────────────────────────────────────

function cEsc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Init ──────────────────────────────────────────────────────────────────────

EventBus.on('tab:changed', ({ tab }) => {
  if (tab === 'connections') loadGraph();
});
