/**
 * developer_tab.js — Developer tab: browser console capture + server log viewer
 *                    + action log (advanced mode).
 * Only active when developer_mode is enabled in Settings.
 */

// ── State ──────────────────────────────────────────────────────────────────────

const _devConsoleEntries = [];
let   _devServerEntries  = [];
let   _devLevelFilter    = '';   // '' | 'EVENT' | 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR'
let   _devAdvanced       = false;

const _LEVEL_ORDER = { EVENT: 0, DEBUG: 1, INFO: 2, WARNING: 3, WARN: 3, ERROR: 4, CRITICAL: 4 };
const _LEVEL_COLOR = {
  EVENT:    '#7c3aed',
  DEBUG:    '#6b7280',
  INFO:     '#16a34a',
  WARNING:  '#d97706',
  WARN:     '#d97706',
  ERROR:    '#dc2626',
  CRITICAL: '#9333ea',
};

// ── Browser console capture ───────────────────────────────────────────────────

(function _installConsoleCapture() {
  const _origLog   = console.log.bind(console);
  const _origWarn  = console.warn.bind(console);
  const _origError = console.error.bind(console);
  const _origInfo  = console.info.bind(console);

  function _capture(level, args) {
    const ts  = new Date().toLocaleTimeString('en-US', { hour12: false });
    const msg = args.map(a => {
      if (a instanceof Error) return a.message + (a.stack ? '\n' + a.stack : '');
      if (typeof a === 'object') {
        try { return JSON.stringify(a, null, 0); } catch { return String(a); }
      }
      return String(a);
    }).join(' ');
    _devConsoleEntries.push({ ts, level, msg });
    if (_devConsoleEntries.length > 1000) _devConsoleEntries.shift();
    _devRenderConsole();
  }

  console.log   = (...a) => { _origLog(...a);   _capture('INFO',    a); };
  console.info  = (...a) => { _origInfo(...a);  _capture('INFO',    a); };
  console.warn  = (...a) => { _origWarn(...a);  _capture('WARNING', a); };
  console.error = (...a) => { _origError(...a); _capture('ERROR',   a); };
})();

// ── EventBus capture (non-internal events only) ───────────────────────────────

EventBus.onAny((event, data) => {
  if (event.startsWith('_')) return; // skip _action, _dev:*, _actionlog:* internals
  const ts  = new Date().toLocaleTimeString('en-US', { hour12: false });
  let payload = '';
  if (data !== undefined) {
    try { payload = ' ' + JSON.stringify(data, null, 0); } catch { payload = ' [unprintable]'; }
  }
  _devConsoleEntries.push({ ts, level: 'EVENT', msg: `[${event}]${payload}` });
  if (_devConsoleEntries.length > 1000) _devConsoleEntries.shift();
  _devRenderConsole();
});

// ── Fetch interceptor ─────────────────────────────────────────────────────────

(function _installFetchCapture() {
  const _origFetch = window.fetch.bind(window);

  window.fetch = async function(...args) {
    const input  = args[0];
    const opts   = args[1] || {};
    const method = (opts.method || 'GET').toUpperCase();
    const url    = typeof input === 'string' ? input
                 : input instanceof Request  ? input.url
                 : String(input);
    const path   = url.replace(window.location.origin, '');
    const ts1    = new Date().toLocaleTimeString('en-US', { hour12: false });

    _devConsoleEntries.push({ ts: ts1, level: 'DEBUG', msg: `→ ${method} ${path}` });
    if (_devConsoleEntries.length > 1000) _devConsoleEntries.shift();
    _devRenderConsole();

    try {
      const res = await _origFetch(...args);
      const ts2 = new Date().toLocaleTimeString('en-US', { hour12: false });
      const lvl = res.ok ? 'DEBUG' : 'ERROR';
      _devConsoleEntries.push({ ts: ts2, level: lvl, msg: `← ${res.status} ${method} ${path}` });
      if (_devConsoleEntries.length > 1000) _devConsoleEntries.shift();
      _devRenderConsole();
      return res;
    } catch (err) {
      const ts2 = new Date().toLocaleTimeString('en-US', { hour12: false });
      _devConsoleEntries.push({ ts: ts2, level: 'ERROR', msg: `✗ ${method} ${path} — ${err.message}` });
      if (_devConsoleEntries.length > 1000) _devConsoleEntries.shift();
      _devRenderConsole();
      throw err;
    }
  };
})();

// Boot marker
(function() {
  const ts = new Date().toLocaleTimeString('en-US', { hour12: false });
  _devConsoleEntries.push({ ts, level: 'INFO', msg: 'DevTools ready — console + EventBus + fetch capture active' });
})();

// ── Action log (advanced mode) ────────────────────────────────────────────────

const _ACTION_CAT_COLOR = {
  nav:  '#3b82f6',
  user: '#16a34a',
  sys:  '#6b7280',
  err:  '#dc2626',
};
const _ACTION_CAT_LABEL = { nav: 'NAV', user: 'USER', sys: 'SYS', err: 'ERR' };

function _devActionLine(entry, index) {
  const color    = _ACTION_CAT_COLOR[entry.category] || '#6b7280';
  const catLabel = _ACTION_CAT_LABEL[entry.category]  || entry.category.toUpperCase();
  let   text     = entry.action;
  if (entry.detail) {
    const d = typeof entry.detail === 'object'
      ? JSON.stringify(entry.detail, null, 0) : String(entry.detail);
    text += ' — ' + d;
  }
  const escaped = text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<div style="padding:2px 16px;border-bottom:1px solid var(--border);
                      display:flex;gap:8px;align-items:baseline;
                      ${index % 2 === 0 ? '' : 'background:rgba(0,0,0,.02);'}">
    <span style="color:var(--text-muted);flex-shrink:0;font-size:10px;">${entry.ts}</span>
    <span style="color:${color};font-weight:700;flex-shrink:0;font-size:10px;
                 min-width:40px;">${catLabel}</span>
    <span style="white-space:pre-wrap;word-break:break-word;color:var(--text);
                 flex:1;">${escaped}</span>
  </div>`;
}

function _devRenderActionLog() {
  const el = document.getElementById('dev-action-log');
  if (!el) return;

  const entries = ActionLog.getAll();
  el.innerHTML  = entries.map((e, i) => _devActionLine(e, i)).join('');

  const countEl = document.getElementById('dev-action-count');
  if (countEl) countEl.textContent = `${entries.length}`;

  _devScroll(el);
}

// Subscribe to new action entries in real-time
EventBus.on('_action', () => {
  const panel = document.getElementById('tab-developer');
  if (!panel || panel.classList.contains('hidden')) return;
  if (!_devAdvanced) return;
  _devRenderActionLog();
});

EventBus.on('_action:cleared', () => {
  _devRenderActionLog();
});

// ── Filter helpers ────────────────────────────────────────────────────────────

function _passesLevelFilter(level) {
  if (!_devLevelFilter) return true;
  const minOrder = _LEVEL_ORDER[_devLevelFilter] ?? 0;
  return (_LEVEL_ORDER[level] ?? 0) >= minOrder;
}

// ── Render ────────────────────────────────────────────────────────────────────

function _devLogLine(entry, index) {
  const color = _LEVEL_COLOR[entry.level] || '#6b7280';
  const msgEscaped = entry.msg
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  return `<div style="padding:2px 16px;border-bottom:1px solid var(--border);
                      display:flex;gap:8px;align-items:baseline;
                      ${index % 2 === 0 ? '' : 'background:rgba(0,0,0,.02);'}">
    <span style="color:var(--text-muted);flex-shrink:0;font-size:10px;">${entry.ts}</span>
    <span style="color:${color};font-weight:700;flex-shrink:0;font-size:10px;
                 min-width:52px;">${entry.level}</span>
    <span style="white-space:pre-wrap;word-break:break-word;color:var(--text);
                 flex:1;">${msgEscaped}</span>
  </div>`;
}

function _devRenderConsole() {
  const el = document.getElementById('dev-console-log');
  if (!el) return;

  const panel = document.getElementById('tab-developer');
  if (!panel || panel.classList.contains('hidden')) return;

  const visible = _devConsoleEntries.filter(e => _passesLevelFilter(e.level));
  el.innerHTML  = visible.map((e, i) => _devLogLine(e, i)).join('');

  const countEl = document.getElementById('dev-console-count');
  if (countEl) countEl.textContent = `${visible.length}`;

  _devScroll(el);
}

function _devRenderServer(records) {
  _devServerEntries = records || [];
  const el = document.getElementById('dev-server-log');
  if (!el) return;

  const visible = _devServerEntries.filter(e => _passesLevelFilter(e.level));
  el.innerHTML  = visible.map((e, i) => _devLogLine(e, i)).join('');

  const countEl = document.getElementById('dev-server-count');
  if (countEl) countEl.textContent = `${visible.length}`;

  _devScroll(el);
}

function _devScroll(el) {
  const autoEl = document.getElementById('dev-autoscroll');
  if (autoEl?.checked) el.scrollTop = el.scrollHeight;
}

// ── Simple / Advanced mode toggle ─────────────────────────────────────────────

function _devApplyMode() {
  const actionPane = document.getElementById('dev-action-pane');
  const grid       = document.getElementById('dev-body-grid');
  const btn        = document.getElementById('dev-mode-btn');
  if (!actionPane || !grid || !btn) return;

  if (_devAdvanced) {
    actionPane.classList.remove('hidden');
    grid.style.gridTemplateColumns = '1fr 1fr 1fr';
    btn.textContent = 'Simple mode';
    btn.title       = 'Switch to simple view';
    _devRenderActionLog();
  } else {
    actionPane.classList.add('hidden');
    grid.style.gridTemplateColumns = '1fr 1fr';
    btn.textContent = 'Advanced mode';
    btn.title       = 'Show full action log';
  }
}

window.devToggleAdvanced = function() {
  _devAdvanced = !_devAdvanced;
  localStorage.setItem('dev-advanced', _devAdvanced ? '1' : '0');
  _devApplyMode();
};

window.devClearActions = function() {
  ActionLog.clear();
  _devRenderActionLog();
};

// ── Server logs ───────────────────────────────────────────────────────────────

window.devRefreshServer = async function() {
  try {
    const res  = await fetch('/api/dev/logs?limit=500');
    const json = await res.json();
    if (json.ok) _devRenderServer(json.data);
  } catch (e) {
    console.error('devRefreshServer:', e);
  }
};

// ── Controls ──────────────────────────────────────────────────────────────────

window.devApplyFilter = function() {
  const sel = document.getElementById('dev-level-filter');
  _devLevelFilter = sel ? sel.value : '';
  _devRenderConsole();
  devRefreshServer();
};

window.devClearConsole = function() {
  _devConsoleEntries.length = 0;
  _devRenderConsole();
};

window.devClearServer = async function() {
  try {
    await fetch('/api/dev/logs/clear', { method: 'POST' });
    _devRenderServer([]);
  } catch (e) {
    console.error('devClearServer:', e);
  }
};

// ── Tab lifecycle + auto-poll ─────────────────────────────────────────────────

let _devPollTimer = null;

function _devStartPoll() {
  if (_devPollTimer) return;
  devRefreshServer();
  _devPollTimer = setInterval(devRefreshServer, 3000);
}

function _devStopPoll() {
  if (_devPollTimer) { clearInterval(_devPollTimer); _devPollTimer = null; }
}

EventBus.on('tab:changed', ({ tab }) => {
  if (tab === 'developer') {
    // Restore mode preference
    _devAdvanced = localStorage.getItem('dev-advanced') === '1';
    _devApplyMode();
    _devRenderConsole();
    _devStartPoll();
  } else {
    _devStopPoll();
  }
});

// ── Copy logs ─────────────────────────────────────────────────────────────────

window.devCopyLogs = async function() {
  const now    = new Date().toLocaleString('en-US', { hour12: false });
  const parts  = [`Hormiga Developer Logs — ${now}\n`];

  const actionEntries = ActionLog.getAll();
  parts.push(`${'='.repeat(60)}\nACTION LOG (${actionEntries.length} entries)\n${'='.repeat(60)}`);
  if (actionEntries.length === 0) {
    parts.push('(empty)');
  } else {
    parts.push(actionEntries.map(e => {
      const cat  = (_ACTION_CAT_LABEL[e.category] || e.category.toUpperCase()).padEnd(4);
      const det  = e.detail
        ? '  ' + (typeof e.detail === 'object' ? JSON.stringify(e.detail) : String(e.detail))
        : '';
      return `${e.ts}  ${cat}  ${e.action}${det}`;
    }).join('\n'));
  }

  const consoleVisible = _devConsoleEntries.filter(e => _passesLevelFilter(e.level));
  parts.push(`\n${'='.repeat(60)}\nBROWSER CONSOLE (${consoleVisible.length} entries)\n${'='.repeat(60)}`);
  if (consoleVisible.length === 0) {
    parts.push('(empty)');
  } else {
    parts.push(consoleVisible.map(e =>
      `${e.ts}  ${e.level.padEnd(8)}  ${e.msg}`
    ).join('\n'));
  }

  const serverVisible = _devServerEntries.filter(e => _passesLevelFilter(e.level));
  parts.push(`\n${'='.repeat(60)}\nSERVER LOGS (${serverVisible.length} entries)\n${'='.repeat(60)}`);
  if (serverVisible.length === 0) {
    parts.push('(empty — click Refresh to load)');
  } else {
    parts.push(serverVisible.map(e =>
      `${e.ts}  ${(e.level || '').padEnd(8)}  ${e.msg}`
    ).join('\n'));
  }

  try {
    await navigator.clipboard.writeText(parts.join('\n'));
    toast('Logs copied to clipboard', 'success');
  } catch (err) {
    toast('Copy failed: ' + err.message, 'error');
  }
};

// ── CSS ───────────────────────────────────────────────────────────────────────

(function() {
  const s = document.createElement('style');
  s.textContent = `
    .dev-tab { display:flex; flex-direction:column; height:100%; overflow:hidden; }
  `;
  document.head.appendChild(s);
})();
