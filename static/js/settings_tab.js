/**
 * settings_tab.js — loads and saves settings.json via the API.
 * Also handles user profile (separate store, separate API endpoint).
 */

// ── Version labels ────────────────────────────────────────────────────────────
// Preload runs before renderer JS, so window.hormiga is already populated here.
// DOM is also fully built (scripts are at end of <body>), so no need to defer.

;(function _setVersionLabels() {
  const v = window.hormiga?.appVersion
  if (!v) return
  const vStr = `v${v}`
  document.querySelectorAll('#aboutVersionLabel, #changelogCurrentVersion')
    .forEach(el => { el.textContent = vStr })
})()

// ── Export .miga ──────────────────────────────────────────────────────────────

async function exportMigaFile() {
  const btn    = document.getElementById('exportMigaBtn')
  const status = document.getElementById('exportMigaStatus')
  if (!window.hormiga?.exportMiga) {
    status.textContent = 'Export only available in the desktop app.'
    return
  }
  btn.disabled = true
  btn.textContent = '⏳ Exporting…'
  status.textContent = ''
  try {
    const result = await window.hormiga.exportMiga()
    if (result?.ok) {
      status.style.color = 'var(--success)'
      const name = result.filePath?.split(/[\\/]/).pop() || result.filePath
      status.textContent = `Saved: ${name}`
    } else if (!result || result.error === 'Cancelled.') {
      status.textContent = ''
    } else {
      status.style.color = 'var(--danger)'
      status.textContent = result?.error || 'Export failed.'
    }
  } catch (err) {
    status.style.color = 'var(--danger)'
    status.textContent = String(err)
  } finally {
    btn.disabled = false
    btn.textContent = '⬇ Export .miga file'
  }
}

// ── User Profile ──────────────────────────────────────────────────────────────

let _profileData = {};
let _profileContacts = [];

function renderProfileSummary() {
  const avatarEl  = document.getElementById('s-profile-avatar');
  const displayEl = document.getElementById('s-profile-display');
  const subEl     = document.getElementById('s-profile-sub');
  if (!avatarEl) return;

  const name  = _profileData.display_name || '';
  const uname = _profileData.username || '';
  const email = _profileData.email || '';

  if (name) {
    const initials = name.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
    avatarEl.textContent  = initials || '?';
    displayEl.textContent = name;
    subEl.textContent     = email || uname || 'Profile set up';
  } else {
    avatarEl.textContent  = '?';
    displayEl.textContent = '—';
    subEl.textContent     = 'Not set up yet';
  }
}

async function loadUserProfile() {
  try {
    const res  = await fetch('/api/user/profile');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    _profileData = json.data;
    renderProfileSummary();
  } catch (_) {
    // Missing profile is fine — just show defaults
  }
}

document.getElementById('s-profile-edit-btn')?.addEventListener('click', () => {
  const form = document.getElementById('s-profile-form');
  const isHidden = form.classList.contains('hidden');
  form.classList.toggle('hidden');
  if (isHidden) {
    // Populate form with current data when opening
    document.getElementById('s-profile-name').value     = _profileData.display_name || '';
    document.getElementById('s-profile-username').value = _profileData.username || '';
    document.getElementById('s-profile-email').value    = _profileData.email || '';
    // Show linked contact if any
    if (_profileData.linked_contact_id) {
      const linked = _profileContacts.find(
        c => String(c.row_index) === String(_profileData.linked_contact_id)
      );
      if (linked) {
        document.getElementById('s-profile-contact-search').value = linked.name || '';
        document.getElementById('s-profile-contact-results').innerHTML =
          `<div style="font-size:11px;color:#16a34a;padding:2px 0;">✓ Linked to ${esc(linked.name || '')}</div>`;
      }
    }
  }
});

document.getElementById('s-profile-cancel-btn')?.addEventListener('click', () => {
  document.getElementById('s-profile-form').classList.add('hidden');
  document.getElementById('s-profile-contact-results').innerHTML = '';
});

document.getElementById('s-profile-save-btn')?.addEventListener('click', async () => {
  const payload = {
    display_name:       document.getElementById('s-profile-name').value.trim(),
    username:           document.getElementById('s-profile-username').value.trim(),
    email:              document.getElementById('s-profile-email').value.trim(),
    linked_contact_id:  _profileData.linked_contact_id ?? null,
  };
  try {
    const res  = await fetch('/api/user/profile', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    _profileData = json.data;
    renderProfileSummary();
    document.getElementById('s-profile-form').classList.add('hidden');
    document.getElementById('s-profile-contact-results').innerHTML = '';
    toast('Profile saved!', 'success');
  } catch (err) {
    toast('Failed to save profile: ' + err.message, 'error');
  }
});

// Contact search for "link to directory" field
document.getElementById('s-profile-contact-search')?.addEventListener('input', async function () {
  const q         = this.value.trim().toLowerCase();
  const resultsEl = document.getElementById('s-profile-contact-results');
  if (!q) { resultsEl.innerHTML = ''; return; }

  // Lazy-load contacts once
  if (!_profileContacts.length) {
    try {
      const res  = await fetch('/api/contacts?per_page=9999&page=1');
      const json = await res.json();
      if (json.ok) _profileContacts = json.data || [];
    } catch (_) {}
  }

  const matches = _profileContacts.filter(c =>
    (c.name  || '').toLowerCase().includes(q) ||
    (c.email || '').toLowerCase().includes(q)
  ).slice(0, 6);

  if (!matches.length) {
    resultsEl.innerHTML = '<div style="font-size:11px;color:var(--text-muted);padding:4px 0;">No matches found</div>';
    return;
  }

  resultsEl.innerHTML = matches.map(c => `
    <div class="profile-contact-result"
         data-id="${esc(String(c.row_index ?? ''))}"
         data-name="${esc(c.name || '')}">
      <span style="font-weight:600;">${esc(c.name || '')}</span>
      <span style="font-size:11px;color:var(--text-muted);margin-left:6px;">${esc(c.email || '')}</span>
    </div>
  `).join('');

  resultsEl.querySelectorAll('.profile-contact-result').forEach(row => {
    row.addEventListener('click', () => {
      _profileData.linked_contact_id = row.dataset.id;
      document.getElementById('s-profile-contact-search').value = row.dataset.name;
      resultsEl.innerHTML = `<div style="font-size:11px;color:#16a34a;padding:2px 0;">✓ Linked to ${esc(row.dataset.name)}</div>`;
    });
  });
});

document.getElementById('s-profile-contact-clear')?.addEventListener('click', () => {
  _profileData.linked_contact_id = null;
  document.getElementById('s-profile-contact-search').value = '';
  document.getElementById('s-profile-contact-results').innerHTML = '';
});


// ── Developer mode ────────────────────────────────────────────────────────────

function _applyDevMode(enabled) {
  const item = document.getElementById('nav-dev-item');
  if (item) item.style.display = enabled ? '' : 'none';
  // Re-wire tooltip for the dynamically shown link
  if (enabled) {
    const link = item?.querySelector('.nav-link');
    if (link && window.wireTooltips) wireTooltips(item);
  }
}

document.getElementById('s-dev-mode')?.addEventListener('change', function () {
  _applyDevMode(this.checked);
});

// ── Image Highlights rules editor ─────────────────────────────────────────────

let _hlRules = [];

function sHlRenderRules() {
  const container = document.getElementById('s-highlights-rules');
  if (!container) return;
  if (!_hlRules.length) {
    container.innerHTML = '<div style="color:var(--text-muted);font-size:13px;">No rules yet. Add one below.</div>';
    return;
  }
  container.innerHTML = _hlRules.map((r, i) => {
    let colorCells = '';
    if (r.mode === 'event_linked') {
      colorCells = `
        <label style="font-size:11px;color:var(--text-muted);">unlinked</label>
        <input type="color" value="${r.color_unlinked || '#fed7aa'}"
               oninput="_hlRules[${i}].color_unlinked=this.value" title="Color when no event linked">
        <label style="font-size:11px;color:var(--text-muted);">linked</label>
        <input type="color" value="${r.color_linked || '#f97316'}"
               oninput="_hlRules[${i}].color_linked=this.value" title="Color when event linked">`;
    } else if (r.mode === 'frequency') {
      colorCells = `
        <label style="font-size:11px;color:var(--text-muted);">min</label>
        <input type="color" value="${r.color_min || '#bbf7d0'}"
               oninput="_hlRules[${i}].color_min=this.value" title="Color when unused">
        <label style="font-size:11px;color:var(--text-muted);">max</label>
        <input type="color" value="${r.color_max || '#16a34a'}"
               oninput="_hlRules[${i}].color_max=this.value" title="Color at max usage">`;
    } else {
      colorCells = `
        <input type="color" value="${r.color || '#9ca3af'}"
               oninput="_hlRules[${i}].color=this.value" title="Solid color">`;
    }
    return `<div class="s-hl-rule-row">
      <input type="text" value="${esc(r.tag)}" style="width:100px;"
             oninput="_hlRules[${i}].tag=this.value.trim().toLowerCase()" placeholder="tag">
      <select onchange="_hlRules[${i}].mode=this.value;sHlRenderRules()">
        <option value="solid" ${r.mode === 'solid' ? 'selected' : ''}>Solid</option>
        <option value="event_linked" ${r.mode === 'event_linked' ? 'selected' : ''}>Event-linked</option>
        <option value="frequency" ${r.mode === 'frequency' ? 'selected' : ''}>Frequency</option>
      </select>
      ${colorCells}
      <button class="btn btn-sm btn-ghost" title="Remove rule"
              onclick="_hlRules.splice(${i},1);sHlRenderRules()">✕</button>
    </div>`;
  }).join('');
}

window.sHlAddRule = function() {
  const tagEl  = document.getElementById('s-hl-new-tag');
  const tag    = tagEl.value.trim().toLowerCase();
  if (!tag) { toast('Enter a tag name', 'warn'); return; }
  const mode   = document.getElementById('s-hl-new-mode').value;
  const color1 = document.getElementById('s-hl-new-color1').value;
  const color2 = document.getElementById('s-hl-new-color2').value;
  const rule   = { tag, mode };
  if (mode === 'solid')             { rule.color = color1; }
  else if (mode === 'event_linked') { rule.color_unlinked = color1; rule.color_linked = color2; }
  else if (mode === 'frequency')    { rule.color_min = color1; rule.color_max = color2; }
  _hlRules.push(rule);
  tagEl.value = '';
  sHlRenderRules();
};

window.sHlToggleAddColors = function() {
  const mode = document.getElementById('s-hl-new-mode').value;
  const c2   = document.getElementById('s-hl-new-color2');
  if (c2) c2.style.display = mode === 'solid' ? 'none' : '';
};

async function loadSettings() {
  try {
    const res  = await fetch('/api/settings');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    const s = json.data;
    const d = s.newsletter_defaults || {};

    document.getElementById('s-sheet-id').value      = s.google_sheet_id || '';
    document.getElementById('s-creds-path').value    = s.google_credentials_path || '';
    document.getElementById('s-imgbb-key').value     = s.imgbb_api_key || '';
    document.getElementById('s-org-name').value      = d.org_name || '';
    document.getElementById('s-group-email').value   = d.group_email || '';
    document.getElementById('s-host-location').value = d.host_location || '';
    document.getElementById('s-author-name').value   = d.author_name || '';
    document.getElementById('s-author-email').value  = d.author_email || '';
    document.getElementById('s-directory-url').value = d.directory_url || '';
    document.getElementById('s-events-url').value    = d.events_url || '';
    document.getElementById('s-presenter-url').value = d.presenter_signup_url || '';
    document.getElementById('s-port').value          = s.port || 5000;
    document.getElementById('s-log-level').value     = s.log_level || 'INFO';
    document.getElementById('s-cache-ttl').value     = s.cache_ttl_seconds || 300;
    document.getElementById('s-translation').value          = s.translation_provider || 'google';
    document.getElementById('s-render-both-langs').checked  = s.render_both_languages ?? false;

    // Auto-open is an Electron-level pref, not a Flask setting
    if (window.hormiga?.getAutoOpen) {
      const autoOpen = await window.hormiga.getAutoOpen()
      const el = document.getElementById('s-auto-open')
      if (el) el.checked = autoOpen !== false
    }

    // Expose to other modules (e.g. builder.js reads render settings)
    window._appSettings = s;

    // Developer mode
    const devModeEl = document.getElementById('s-dev-mode');
    if (devModeEl) devModeEl.checked = s.developer_mode === true;
    _applyDevMode(s.developer_mode === true);

    // Tag highlights (shared across images and resources)
    const hl = s.highlights || {};
    document.getElementById('s-highlights-enabled').checked  = hl.enabled !== false;
    document.getElementById('s-hl-notag-color').value        = hl.no_tag_color   || '#9ca3af';
    document.getElementById('s-hl-conflict-color').value     = hl.conflict_color || '#3b82f6';
    _hlRules = JSON.parse(JSON.stringify(hl.rules || []));
    sHlRenderRules();
  } catch (err) {
    toast('Failed to load settings: ' + err.message, 'error');
  }
}

document.getElementById('settingsSaveBtn').addEventListener('click', async () => {
  const payload = {
    google_sheet_id:         document.getElementById('s-sheet-id').value.trim(),
    google_credentials_path: document.getElementById('s-creds-path').value.trim(),
    imgbb_api_key:           document.getElementById('s-imgbb-key').value.trim(),
    port:                    parseInt(document.getElementById('s-port').value) || 5000,
    log_level:               document.getElementById('s-log-level').value,
    cache_ttl_seconds:       parseInt(document.getElementById('s-cache-ttl').value) || 300,
    translation_provider:    document.getElementById('s-translation').value,
    render_both_languages:   document.getElementById('s-render-both-langs').checked,
    developer_mode: document.getElementById('s-dev-mode')?.checked ?? false,
    highlights: {
      enabled:        document.getElementById('s-highlights-enabled').checked,
      no_tag_color:   document.getElementById('s-hl-notag-color').value,
      conflict_color: document.getElementById('s-hl-conflict-color').value,
      rules:          _hlRules,
    },
    newsletter_defaults: {
      org_name:             document.getElementById('s-org-name').value.trim(),
      group_email:          document.getElementById('s-group-email').value.trim(),
      host_location:        document.getElementById('s-host-location').value.trim(),
      author_name:          document.getElementById('s-author-name').value.trim(),
      author_email:         document.getElementById('s-author-email').value.trim(),
      directory_url:        document.getElementById('s-directory-url').value.trim(),
      events_url:           document.getElementById('s-events-url').value.trim(),
      presenter_signup_url: document.getElementById('s-presenter-url').value.trim(),
    },
  };

  try {
    const res  = await fetch('/api/settings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);

    // Save auto-open pref directly to Electron (not via Flask)
    if (window.hormiga?.setAutoOpen) {
      const autoOpenEl = document.getElementById('s-auto-open')
      if (autoOpenEl) await window.hormiga.setAutoOpen(autoOpenEl.checked)
    }

    toast('Settings saved!', 'success');
  } catch (err) {
    toast('Save failed: ' + err.message, 'error');
  }
});

document.getElementById('settingsReloadBtn').addEventListener('click', async () => {
  try {
    await fetch('/api/settings/reload', { method: 'POST' });
    await loadSettings();
    toast('Settings reloaded from file', 'info');
  } catch (err) {
    toast('Reload failed: ' + err.message, 'error');
  }
});

EventBus.on('tab:changed', ({ tab }) => {
  if (tab === 'settings') {
    loadSettings();
    loadUserProfile();
    _syncThemeSwatches();
  }
});

EventBus.on('app:ready', () => {
  loadSettings();
  loadUserProfile();
  _syncThemeSwatches();
});

// ── Theme switcher ────────────────────────────────────────────────────────────

const _THEMES = ['default', 'rouge', 'antfarm', 'blocks'];

function applyTheme(theme) {
  if (!_THEMES.includes(theme)) theme = 'default';
  if (theme === 'default') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem('hormiga-theme', theme);
  _syncThemeSwatches();
}

function _syncThemeSwatches() {
  const active = localStorage.getItem('hormiga-theme') || 'default';
  document.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.classList.toggle('theme-swatch--active', btn.dataset.theme === active);
  });
}
