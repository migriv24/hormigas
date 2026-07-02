/**
 * app.js — wires up tabs, sidebar, sync, undo/redo, toasts.
 * Also owns: StatusBar, sidebar collapse, tooltip system.
 */

// ── Toast ────────────────────────────────────────────────────────────────────

function toast(message, type = 'info', duration = 3500) {
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = message;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => el.remove(), duration);
}

window.toast = toast;

// ── StatusBar ─────────────────────────────────────────────────────────────────
// Controls the status text + progress bar in the sidebar footer.
// Other modules can call StatusBar.set() to surface one-line status messages.

const StatusBar = (() => {
  const dotEl      = document.getElementById('syncDot');
  const textEl     = document.getElementById('statusText');
  const progressEl = document.getElementById('statusProgress');
  const fillEl     = document.getElementById('statusProgressFill');

  let _clearTimer = null;

  function _clearPending() {
    if (_clearTimer) { clearTimeout(_clearTimer); _clearTimer = null; }
  }

  // Persistent state change (stays until next call or reset)
  function set(msg, state = 'ready') {
    _clearPending();
    if (textEl) textEl.textContent = msg;
    if (dotEl)  dotEl.className = 'sync-dot' + (state !== 'ready' ? ` ${state}` : '');
  }

  // Temporary message — reverts to Ready after `duration` ms
  function setTemp(msg, state = 'ready', duration = 2500) {
    set(msg, state);
    _clearTimer = setTimeout(reset, duration);
  }

  function reset() {
    _clearPending();
    if (textEl) textEl.textContent = 'Ready';
    if (dotEl)  dotEl.className = 'sync-dot';
    hideProgress();
  }

  function progress(pct) {
    if (!progressEl || !fillEl) return;
    progressEl.classList.remove('hidden');
    fillEl.style.width = Math.min(100, Math.max(0, pct)) + '%';
  }

  function hideProgress() {
    if (progressEl) progressEl.classList.add('hidden');
    if (fillEl)     fillEl.style.width = '0%';
  }

  return { set, setTemp, reset, progress, hideProgress };
})();

window.StatusBar = StatusBar;

// ── Sidebar collapse ──────────────────────────────────────────────────────────

const _sidebar       = document.getElementById('sidebar');
const _sidebarToggle = document.getElementById('sidebarToggle');
const _SIDEBAR_KEY   = 'lon_sidebar_collapsed';

function setSidebarCollapsed(collapsed, persist = true) {
  _sidebar.classList.toggle('sidebar--collapsed', collapsed);
  if (_sidebarToggle) {
    _sidebarToggle.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
  }
  if (persist) localStorage.setItem(_SIDEBAR_KEY, collapsed ? '1' : '0');
}

// Restore from last session
if (localStorage.getItem(_SIDEBAR_KEY) === '1') {
  setSidebarCollapsed(true, false);
}

_sidebarToggle?.addEventListener('click', () => {
  setSidebarCollapsed(!_sidebar.classList.contains('sidebar--collapsed'));
});

// Auto-collapse at narrow viewport (CSS media query handles layout, this triggers the class)
const _narrowMql = window.matchMedia('(max-width: 700px)');
function _onNarrowChange(e) {
  if (e.matches) setSidebarCollapsed(true, false);
}
_narrowMql.addEventListener('change', _onNarrowChange);
if (_narrowMql.matches) setSidebarCollapsed(true, false);

// ── Tooltip system ────────────────────────────────────────────────────────────
// Any element with data-tooltip="…" gets a custom floating tooltip.
// Nav links only show the tooltip when the sidebar is collapsed
// (since the label text is visible when expanded).

const _tooltipEl = document.getElementById('tooltipEl');

function _showTooltip(target) {
  if (!_tooltipEl) return;
  const text = target.dataset.tooltip;
  if (!text) return;

  // Nav links only show tooltip when sidebar is collapsed
  if (target.classList.contains('nav-link') && !_sidebar.classList.contains('sidebar--collapsed')) return;

  _tooltipEl.textContent = text;
  _tooltipEl.classList.add('tooltip--visible');
  _tooltipEl.removeAttribute('aria-hidden');

  const rect = target.getBoundingClientRect();

  if (target.closest('.sidebar')) {
    // Sidebar elements: tooltip floats to the right
    _tooltipEl.style.left      = (rect.right + 10) + 'px';
    _tooltipEl.style.top       = rect.top + 'px';
    _tooltipEl.style.transform = 'translateY(-0%)';
  } else {
    // Everything else: tooltip floats above, centered
    _tooltipEl.style.left      = (rect.left + rect.width / 2) + 'px';
    _tooltipEl.style.top       = (rect.top - 6) + 'px';
    _tooltipEl.style.transform = 'translateX(-50%) translateY(-100%)';
  }
}

function _hideTooltip() {
  if (!_tooltipEl) return;
  _tooltipEl.classList.remove('tooltip--visible');
  _tooltipEl.setAttribute('aria-hidden', 'true');
}

function wireTooltips(root = document) {
  root.querySelectorAll('[data-tooltip]').forEach(el => {
    if (el._tooltipWired) return;
    el._tooltipWired = true;
    el.addEventListener('mouseenter', () => _showTooltip(el));
    el.addEventListener('mouseleave', _hideTooltip);
    el.addEventListener('focus',      () => _showTooltip(el));
    el.addEventListener('blur',       _hideTooltip);
  });
}

window.wireTooltips = wireTooltips;
wireTooltips();

// ── Status bar hover hints for nav ────────────────────────────────────────────
// When sidebar is expanded, hovering a nav link shows its description in
// the status bar instead of a tooltip (since the label is already visible).

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('mouseenter', () => {
    if (!_sidebar.classList.contains('sidebar--collapsed')) {
      StatusBar.setTemp(link.dataset.tooltip || '', 'ready', 2000);
    }
  });
  link.addEventListener('mouseleave', () => {
    if (!_sidebar.classList.contains('sidebar--collapsed')) {
      StatusBar.reset();
    }
  });
});

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', e => {
    e.preventDefault();
    const tabId = link.dataset.tab;

    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');

    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    const panel = document.getElementById(`tab-${tabId}`);
    if (panel) panel.classList.remove('hidden');

    EventBus.emit('tab:changed', { tab: tabId });
  });
});

// ── Pull Sheet ────────────────────────────────────────────────────────────────

const syncBtn = document.getElementById('syncBtn');

syncBtn.addEventListener('click', _doPullSheet);

async function _doPullSheet() {
  StatusBar.set('Checking sheet…', 'syncing');
  StatusBar.progress(20);
  syncBtn.disabled = true;
  try {
    const res  = await fetch('/api/sync/preview');
    StatusBar.progress(80);
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);

    StatusBar.progress(100);
    setTimeout(() => StatusBar.reset(), 600);

    const d = json.data;
    if (d.identical) {
      StatusBar.setTemp('✓ Up to date', 'ready', 3000);
      toast(`Local and sheet match — no changes (${d.totals.contacts} contacts, ${d.totals.events} events)`, 'success');
      return;
    }

    // There are differences — open the diff panel
    _openPullPanel(d);
  } catch (err) {
    StatusBar.set('Pull failed', 'error');
    StatusBar.hideProgress();
    toast(`Pull failed: ${err.message}`, 'error');
  } finally {
    syncBtn.disabled = false;
  }
}

function _openPullPanel(diff) {
  const existing = document.getElementById('_pullPanel');
  if (existing) existing.remove();

  function _diffSection(label, icon, data) {
    const { added, modified, removed } = data;
    if (!added.length && !modified.length && !removed.length) return '';
    const rows = [
      ...added.map(r    => `<div class="pull-diff-row pull-diff-added">   <span class="pull-diff-badge">+ Added</span>    <span>${_esc(r.label)}</span></div>`),
      ...modified.map(r => `<div class="pull-diff-row pull-diff-modified"><span class="pull-diff-badge">~ Changed</span> <span>${_esc(r.label)}</span><span class="pull-diff-fields">${r.changes.map(_esc).join(', ')}</span></div>`),
      ...removed.map(r  => `<div class="pull-diff-row pull-diff-removed"> <span class="pull-diff-badge">− Removed</span> <span>${_esc(r.label)}</span></div>`),
    ].join('');
    return `
      <div class="pull-section">
        <div class="pull-section-header">${icon} ${_esc(label)}
          <span class="pull-section-counts">
            ${added.length    ? `<span class="pull-count-added">+${added.length}</span>` : ''}
            ${modified.length ? `<span class="pull-count-mod">~${modified.length}</span>` : ''}
            ${removed.length  ? `<span class="pull-count-rem">-${removed.length}</span>` : ''}
          </span>
        </div>
        <div class="pull-diff-rows">${rows}</div>
      </div>`;
  }

  function _esc(s) {
    return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  const body =
    _diffSection('Contacts',   '👤', diff.contacts)   +
    _diffSection('Events',     '📅', diff.events)      +
    _diffSection('Presenters', '🎤', diff.presenters);

  const panel = document.createElement('div');
  panel.id = '_pullPanel';
  panel.className = 'pull-panel-overlay';
  panel.innerHTML = `
    <div class="pull-panel">
      <div class="pull-panel-header">
        <div>
          <div style="font-size:16px;font-weight:700;">Sheet Changes Detected</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
            These differences were found between your local data and Google Sheets.
            The fresh data has already been loaded — click Accept to keep it.
          </div>
        </div>
        <button class="modal-close" id="_pullClose">✕</button>
      </div>
      <div class="pull-panel-body">${body}</div>
      <div class="pull-panel-footer">
        <button class="btn btn-ghost" id="_pullRevert">↩ Revert to Previous</button>
        <button class="btn btn-primary" id="_pullAccept">✓ Accept Changes</button>
      </div>
    </div>`;

  document.body.appendChild(panel);

  // Accept — commit staged sheet data to Postgres (no-op in sheets mode)
  panel.querySelector('#_pullAccept').addEventListener('click', async () => {
    panel.remove();
    try {
      await fetch('/api/sync/accept', { method: 'POST' });
    } catch { /* best-effort */ }
    toast(`Pulled: ${diff.totals.contacts} contacts, ${diff.totals.events} events`, 'success');
    EventBus.emit('data:synced', diff.totals);
  });

  // Revert — re-sync forces a full reload (effectively same as old sync)
  panel.querySelector('#_pullRevert').addEventListener('click', async () => {
    panel.remove();
    StatusBar.set('Reverting…', 'syncing');
    try {
      await fetch('/api/sync', { method: 'POST' });
      StatusBar.setTemp('Reverted', 'ready', 2000);
    } catch {
      StatusBar.reset();
    }
  });

  panel.querySelector('#_pullClose').addEventListener('click', () => panel.remove());
  panel.addEventListener('click', e => { if (e.target === panel) panel.remove(); });
}

// ── Undo / Redo ───────────────────────────────────────────────────────────────

const undoBtn = document.getElementById('undoBtn');
const redoBtn = document.getElementById('redoBtn');

async function updateUndoButtons() {
  const res  = await fetch('/api/status');
  const json = await res.json();
  if (json.ok) {
    undoBtn.disabled = !json.data.can_undo;
    redoBtn.disabled = !json.data.can_redo;
  }
}

undoBtn.addEventListener('click', async () => {
  try {
    const res  = await fetch('/api/undo', { method: 'POST' });
    const json = await res.json();
    if (json.ok) {
      toast(`Undone: ${json.data.undone || 'action'}`, 'info');
      undoBtn.disabled = !json.data.can_undo;
      redoBtn.disabled = !json.data.can_redo;
      EventBus.emit('data:changed');
    }
  } catch (err) {
    toast(`Undo failed: ${err.message}`, 'error');
  }
});

redoBtn.addEventListener('click', async () => {
  try {
    const res  = await fetch('/api/redo', { method: 'POST' });
    const json = await res.json();
    if (json.ok) {
      toast(`Redone: ${json.data.redone || 'action'}`, 'info');
      undoBtn.disabled = !json.data.can_undo;
      redoBtn.disabled = !json.data.can_redo;
      EventBus.emit('data:changed');
    }
  } catch (err) {
    toast(`Redo failed: ${err.message}`, 'error');
  }
});

EventBus.on('data:changed', updateUndoButtons);

// Invalidate SmartFields autocomplete cache whenever data changes so datalists
// don't show stale names/orgs after an add, edit, or delete.
EventBus.on('data:changed',   () => SmartFields.invalidateCache());
EventBus.on('orgs:changed',   () => SmartFields.invalidateCache());
EventBus.on('contacts:changed', () => SmartFields.invalidateCache());

// ── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  await updateUndoButtons();
  EventBus.emit('app:ready');
})();
