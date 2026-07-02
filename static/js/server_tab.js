/**
 * server_tab.js — Server tab: tunnel control, config, live logs, connections.
 */

// ── State ─────────────────────────────────────────────────────────────────────

let _srvStatus      = 'off';
let _srvUrl         = null;
let _srvConfig      = {};
let _srvPollTimer   = null;
let _srvSse         = null;
let _tokenRevealed  = false;
let _connTokenRevealed = false;

// ── Initialization ─────────────────────────────────────────────────────────────

document.addEventListener('tab:changed', (e) => {
  if (e.detail?.tab === 'server') serverInit();
});

async function serverInit() {
  await serverLoadConfig();
  await serverRefreshStatus();
  serverLoadConnections();
  _startStatusPoll();
}

// ── Status polling ─────────────────────────────────────────────────────────────

function _startStatusPoll() {
  if (_srvPollTimer) return;
  _srvPollTimer = setInterval(async () => {
    const prev = _srvStatus;
    await serverRefreshStatus();
    if (prev !== 'on' && _srvStatus === 'on') {
      serverLoadConnections();
      _loadQr();
    }
  }, 4000);
}

async function serverRefreshStatus() {
  try {
    const res  = await fetch('/api/server/status');
    const json = await res.json();
    if (!json.ok) return;
    _srvStatus = json.data.status;
    _srvUrl    = json.data.url || null;
    _renderBanner(json.data);
    _renderConnectCard(json.data);
  } catch (_) {}
}

// ── Banner ─────────────────────────────────────────────────────────────────────

function _renderBanner(data) {
  const dot     = document.getElementById('serverDot');
  const label   = document.getElementById('serverStatusLabel');
  const sub     = document.getElementById('serverStatusSub');
  const pill    = document.getElementById('serverUrlPill');
  const pillTxt = document.getElementById('serverUrlPillText');
  const togBtn  = document.getElementById('serverToggleBtn');
  const noInst  = document.getElementById('serverNotInstalled');
  if (!dot) return;

  const wasOn = _srvStatus === 'on';

  dot.className = 'server-status-dot';
  noInst?.classList.add('hidden');
  togBtn.disabled = false;
  pill?.classList.add('hidden');

  if (data.installed === false) {
    noInst?.classList.remove('hidden');
    dot.classList.add('server-dot--off');
    label.textContent = 'cloudflared not installed';
    sub.textContent   = '';
    togBtn.disabled   = true;
    return;
  }

  switch (data.status) {
    case 'on':
      dot.classList.add('server-dot--on');
      label.textContent  = data.server_name || 'Hormiga Server';
      sub.textContent    = 'Tunnel active';
      togBtn.textContent = 'Stop Tunnel';
      togBtn.className   = 'btn btn-sm btn-danger';
      togBtn.disabled    = false;
      if (data.url) {
        pill?.classList.remove('hidden');
        if (pillTxt) pillTxt.textContent = data.url;
      }
      if (!wasOn) toast(`Tunnel online — ${data.url}`, 'success', 5000);
      _startSse();
      break;
    case 'starting':
      dot.classList.add('server-dot--starting');
      label.textContent  = 'Connecting…';
      sub.textContent    = 'Waiting for Cloudflare URL…';
      togBtn.textContent = 'Starting…';
      togBtn.disabled    = true;
      togBtn.className   = 'btn btn-sm';
      _startSse();
      break;
    case 'error':
      dot.classList.add('server-dot--error');
      label.textContent  = 'Error';
      sub.textContent    = data.error || 'Tunnel failed to start';
      togBtn.textContent = 'Retry';
      togBtn.className   = 'btn btn-sm';
      togBtn.disabled    = false;
      break;
    default:
      dot.classList.add('server-dot--off');
      label.textContent  = 'Tunnel Off';
      sub.textContent    = 'Start the tunnel to share this server';
      togBtn.textContent = 'Start Tunnel';
      togBtn.className   = 'btn btn-sm';
      _stopSse();
      break;
  }
}

// ── Connection info card ───────────────────────────────────────────────────────

function _renderConnectCard(data) {
  const offline  = document.getElementById('srvUrlOffline');
  const online   = document.getElementById('srvUrlOnline');
  if (!offline || !online) return;

  if (data.status === 'on' && data.url) {
    offline.style.display = 'none';
    online.style.display  = '';

    const urlText = document.getElementById('serverUrlText');
    if (urlText) urlText.textContent = data.url;

    const tokenFld = document.getElementById('srvConnTokenField');
    const tokenInp = document.getElementById('srvConnToken');
    if (tokenFld) tokenFld.style.display = data.token_enabled ? '' : 'none';
    if (tokenInp && _srvConfig.access_token) tokenInp.value = _srvConfig.access_token;
  } else {
    offline.style.display = '';
    online.style.display  = 'none';
  }
}

async function _loadQr() {
  const qrEl = document.getElementById('serverQrInline');
  if (!qrEl) return;
  qrEl.innerHTML = '<div class="server-qr-loading">Loading…</div>';
  try {
    const res  = await fetch('/api/server/qr');
    const json = await res.json();
    if (!json.ok) { qrEl.innerHTML = '<div class="server-qr-loading">QR unavailable</div>'; return; }
    qrEl.innerHTML = `<img src="${json.data.qr_data_url}" class="server-qr-img-inline" alt="QR">`;
  } catch (_) {
    qrEl.innerHTML = '<div class="server-qr-loading">QR unavailable</div>';
  }
}

function serverCopyUrl() {
  if (_srvUrl) navigator.clipboard.writeText(_srvUrl).then(() => toast('URL copied', 'success'));
}

function serverRevealConnToken() {
  const inp = document.getElementById('srvConnToken');
  if (!inp) return;
  _connTokenRevealed = !_connTokenRevealed;
  inp.type = _connTokenRevealed ? 'text' : 'password';
}

function serverCopyConnToken() {
  const val = document.getElementById('srvConnToken')?.value;
  if (val) navigator.clipboard.writeText(val).then(() => toast('Token copied', 'success'));
}

// ── Start / Stop ───────────────────────────────────────────────────────────────

async function serverToggle() {
  if (_srvStatus === 'on' || _srvStatus === 'starting') {
    await _serverStop();
  } else {
    await _serverStart();
  }
}

async function _serverStart() {
  const btn = document.getElementById('serverToggleBtn');
  if (btn) { btn.classList.add('btn--launching'); btn.textContent = 'Launching…'; btn.disabled = true; }
  _logSystem('Starting tunnel…');
  try {
    const res  = await fetch('/api/server/start', { method: 'POST' });
    const json = await res.json();
    if (!json.ok) {
      const msg = json.error || 'Could not start tunnel';
      _logError(msg);
      toast(msg, 'error');
      if (btn) { btn.classList.remove('btn--launching'); btn.classList.add('btn--failed'); }
      setTimeout(() => {
        if (btn) { btn.classList.remove('btn--failed'); btn.disabled = false; btn.textContent = 'Start Tunnel'; btn.className = 'btn btn-sm'; }
      }, 2000);
      return;
    }
    await serverRefreshStatus();
  } catch (e) {
    const msg = 'Network error — is Hormiga running?';
    _logError(msg);
    toast(msg, 'error');
    if (btn) { btn.classList.remove('btn--launching'); btn.disabled = false; }
  }
}

async function _serverStop() {
  try {
    const res  = await fetch('/api/server/stop', { method: 'POST' });
    const json = await res.json();
    if (!json.ok) { toast(json.error || 'Could not stop tunnel', 'error'); return; }
    _srvUrl = null;
    _logSystem('Tunnel stopped.');
    await serverRefreshStatus();
  } catch (_) {
    toast('Network error', 'error');
  }
}

// ── SSE log streaming ──────────────────────────────────────────────────────────

let _srvWaitTicker = null;

function _startSse() {
  if (_srvSse) return;
  const logEl = document.getElementById('serverLog');
  if (logEl) { const ph = logEl.querySelector('.server-log-placeholder'); if (ph) ph.remove(); }

  // Tick every 2s so the log shows activity while cloudflared negotiates
  let _waitSec = 0;
  const _waitRow = document.createElement('div');
  _waitRow.id = 'srvWaitRow';
  _waitRow.className = 'server-log-row server-log-system';
  _waitRow.innerHTML = '<span class="server-log-ts">—</span><span class="server-log-line">Connecting to Cloudflare… (0s)</span>';
  logEl?.appendChild(_waitRow);

  _srvWaitTicker = setInterval(() => {
    _waitSec += 2;
    const r = document.getElementById('srvWaitRow');
    if (r) r.querySelector('.server-log-line').textContent = `Connecting to Cloudflare… (${_waitSec}s)`;
  }, 2000);

  _srvSse = new EventSource('/api/server/logs/stream');
  _srvSse.addEventListener('log', (e) => {
    // Remove the waiting ticker row on first real log line
    clearInterval(_srvWaitTicker); _srvWaitTicker = null;
    document.getElementById('srvWaitRow')?.remove();
    try { const entry = JSON.parse(e.data); _appendLogLine(entry.ts, entry.line); }
    catch (_) {}
  });
  _srvSse.addEventListener('ping', () => {}); // keep-alive, ignore
  _srvSse.onerror = () => { clearInterval(_srvWaitTicker); _srvWaitTicker = null; _stopSse(); };
}

function _stopSse() {
  clearInterval(_srvWaitTicker); _srvWaitTicker = null;
  document.getElementById('srvWaitRow')?.remove();
  if (_srvSse) { _srvSse.close(); _srvSse = null; }
}

function _logSystem(msg) {
  const now = new Date().toLocaleTimeString('en-US', { hour12: false });
  _appendLogLine(now, msg, 'system');
}

function _logError(msg) {
  const now = new Date().toLocaleTimeString('en-US', { hour12: false });
  _appendLogLine(now, '✕ ' + msg, 'error');
}

function _appendLogLine(ts, line, forcedClass) {
  const logEl = document.getElementById('serverLog');
  if (!logEl) return;
  const ph = logEl.querySelector('.server-log-placeholder');
  if (ph) ph.remove();
  const row = document.createElement('div');
  row.className = 'server-log-row';
  if (forcedClass)                         row.classList.add('server-log-' + forcedClass);
  else if (/error|failed|unable/i.test(line)) row.classList.add('server-log-error');
  else if (/trycloudflare/i.test(line))    row.classList.add('server-log-success');
  row.innerHTML = `<span class="server-log-ts">${ts}</span><span class="server-log-line">${_esc(line)}</span>`;
  logEl.appendChild(row);
  logEl.scrollTop = logEl.scrollHeight;
  const badge = document.getElementById('serverLogBadge');
  if (badge) badge.textContent = logEl.querySelectorAll('.server-log-row').length;
}

function serverClearLog() {
  const logEl = document.getElementById('serverLog');
  if (logEl) logEl.innerHTML = '';
  const badge = document.getElementById('serverLogBadge');
  if (badge) badge.textContent = '—';
}

// ── Config ────────────────────────────────────────────────────────────────────

async function serverLoadConfig() {
  try {
    const res  = await fetch('/api/server/config');
    const json = await res.json();
    if (!json.ok) return;
    _srvConfig = json.data;
    _renderConfig(json.data);
  } catch (_) {}
}

function _renderConfig(cfg) {
  const nameEl    = document.getElementById('srvName');
  const portEl    = document.getElementById('srvPort');
  const autoChk   = document.getElementById('srvAutoPort');
  const tokenChk  = document.getElementById('srvTokenEnabled');
  const tokenInp  = document.getElementById('srvTokenVal');
  const tokenFld  = document.getElementById('srvTokenField');

  if (nameEl)   nameEl.value   = cfg.server_name || '';
  if (portEl)   portEl.value   = cfg.port || 5000;
  if (autoChk) {
    autoChk.checked = !!cfg.auto_port;
    _applyAutoPort(!!cfg.auto_port);
  }
  if (tokenChk) {
    tokenChk.checked = !!cfg.token_enabled;
    if (tokenFld) tokenFld.style.display = cfg.token_enabled ? '' : 'none';
  }
  if (tokenInp) tokenInp.value = cfg.access_token || '';
}

function serverAutoPortToggle() {
  const checked = document.getElementById('srvAutoPort')?.checked ?? true;
  _applyAutoPort(checked);
}

function _applyAutoPort(auto) {
  const portEl  = document.getElementById('srvPort');
  const hintEl  = document.getElementById('srvPortHint');
  const labelEl = document.getElementById('srvAutoPortLabel');
  if (portEl)  portEl.disabled = auto;
  if (labelEl) labelEl.textContent = auto ? 'Auto (recommended)' : 'Manual';
  if (hintEl)  hintEl.textContent  = auto
    ? 'Auto uses the same port as the Hormiga app — no configuration needed.'
    : 'Set a specific port for cloudflared to forward to.';
}

async function serverSaveConfig() {
  const nameEl   = document.getElementById('srvName');
  const portEl   = document.getElementById('srvPort');
  const autoChk  = document.getElementById('srvAutoPort');
  const tokenChk = document.getElementById('srvTokenEnabled');
  const tokenFld = document.getElementById('srvTokenField');

  const patch = {
    server_name:   nameEl?.value.trim() || 'Hormiga Server',
    port:          parseInt(portEl?.value) || 5000,
    auto_port:     autoChk?.checked ?? true,
    token_enabled: tokenChk?.checked ?? true,
  };

  if (tokenFld) tokenFld.style.display = patch.token_enabled ? '' : 'none';

  try {
    const res  = await fetch('/api/server/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!json.ok) { toast(json.error || 'Save failed', 'error'); return; }
    _srvConfig = json.data;
    _renderConfig(json.data);
    toast('Settings saved', 'success');
  } catch (_) {
    toast('Network error', 'error');
  }
}

async function serverRegenToken() {
  if (!confirm('Generate a new access token? The current one will stop working.')) return;
  try {
    const res  = await fetch('/api/server/token/regenerate', { method: 'POST' });
    const json = await res.json();
    if (!json.ok) { toast(json.error || 'Failed', 'error'); return; }
    const newToken = json.data.access_token;
    _srvConfig.access_token = newToken;
    const tokenInp = document.getElementById('srvTokenVal');
    if (tokenInp) { tokenInp.value = newToken; tokenInp.type = 'text'; _tokenRevealed = true; }
    const connInp = document.getElementById('srvConnToken');
    if (connInp) connInp.value = newToken;
    toast('New token generated', 'success');
  } catch (_) {
    toast('Network error', 'error');
  }
}

function serverRevealToken() {
  const inp = document.getElementById('srvTokenVal');
  if (!inp) return;
  _tokenRevealed = !_tokenRevealed;
  inp.type = _tokenRevealed ? 'text' : 'password';
}

function serverCopyToken() {
  const val = document.getElementById('srvTokenVal')?.value;
  if (val) navigator.clipboard.writeText(val).then(() => toast('Token copied', 'success'));
}

// ── Connections ───────────────────────────────────────────────────────────────

async function serverLoadConnections() {
  try {
    const res  = await fetch('/api/server/connections');
    const json = await res.json();
    if (!json.ok) return;
    _renderConnections(json.data);  // data is the list directly
  } catch (_) {}
}

function _renderConnections(list) {
  const el = document.getElementById('serverConnTable');
  if (!el) return;
  if (!Array.isArray(list) || list.length === 0) {
    el.innerHTML = '<div class="server-empty-hint">No connections recorded yet.</div>';
    return;
  }
  const rows = list.map(c => `
    <div class="server-conn-row">
      <span class="server-conn-device" title="${_esc(c.user_agent)}">${_esc(c.device)}</span>
      <span class="server-conn-method">${_esc(c.method)}</span>
      <span class="server-conn-path" title="${_esc(c.path)}">${_esc(c.path)}</span>
      <span class="server-conn-status ${c.status < 400 ? 'server-conn-ok' : 'server-conn-err'}">${c.status}</span>
      <span class="server-conn-ts">${_esc(c.ts)}</span>
    </div>`).join('');
  el.innerHTML = `
    <div class="server-conn-header">
      <span>Device</span><span>Method</span><span>Path</span><span>Status</span><span>Time</span>
    </div>${rows}`;
}

function _esc(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
