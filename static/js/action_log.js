/**
 * action_log.js — Central action/activity recorder.
 *
 * Captures everything a user does and everything the system responds with,
 * expressed as short human-readable lines. Always active (zero overhead when
 * developer mode is off — just accumulates in a ring buffer).
 *
 * Usage from any module:
 *   ActionLog.record('user', 'Uploaded resource', { name: 'foo.pdf' })
 *   ActionLog.record('sys',  'Resource saved',    { id: 'abc123' })
 *   ActionLog.record('err',  'Upload failed: 404 Not Found')
 *
 * Categories: 'nav' | 'user' | 'sys' | 'err'
 */

const ActionLog = (() => {
  const _MAX     = 2000;
  const _entries = [];

  // ── Core ───────────────────────────────────────────────────────────────────

  function record(category, action, detail = null) {
    const ts    = new Date().toLocaleTimeString('en-US', { hour12: false });
    const entry = { ts, category, action, detail };
    _entries.push(entry);
    if (_entries.length > _MAX) _entries.shift();
    EventBus.emit('_action', entry);
  }

  function getAll()  { return [..._entries]; }
  function clear()   { _entries.length = 0; EventBus.emit('_action:cleared'); }

  // ── Auto-capture: tab navigation ──────────────────────────────────────────

  EventBus.on('tab:changed', ({ tab }) => {
    const label = tab.charAt(0).toUpperCase() + tab.slice(1);
    record('nav', `Navigated to ${label}`);
  });

  // ── Auto-capture: button / label clicks ───────────────────────────────────
  // Runs in capture phase so it fires before any onclick handler.
  // Skips developer-tab internal controls to avoid noise.

  document.addEventListener('click', e => {
    const el = e.target.closest('button, label[for]');
    if (!el) return;
    if (el.closest('#tab-developer')) return; // don't log dev-tab own buttons

    const override = el.dataset.actionLabel;
    const raw      = (override || el.textContent || '').trim().replace(/\s+/g, ' ');

    // Skip pure-symbol / icon-only labels (✕ ↺ ⊞ ☰ etc.)
    if (!override && raw.length <= 3 && !/[a-zA-Z0-9]/.test(raw)) return;

    const label = (override || raw).slice(0, 70);
    record('user', `Clicked: ${label}`);
  }, true);

  return { record, getAll, clear };
})();

window.ActionLog = ActionLog;
