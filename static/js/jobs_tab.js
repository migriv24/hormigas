/**
 * jobs_tab.js — Job Opportunities tab.
 *
 * Full-screen split panel (modelled after the event editor in images_tab.js).
 * Left: large icon / flier preview. Right: scrollable form with chip tags,
 * SmartFields org/contact autocomplete, creative pay entry, bilingual tabs.
 */

// ── State ─────────────────────────────────────────────────────────────────────

let _jobs          = [];
let _allJobTags    = [];
let _activeJobTags = new Set();
let _jobSearchQ    = '';
let _showArchived  = false;

// Per-panel state (reset each time panel opens)
let _editingJobId  = null;
let _jobTags       = [];
let _jobFliers     = [];   // array of URL strings
let _jobLang       = 'en'; // 'en' | 'es'
let _jobContacts   = [];   // cached contact list for auto-fill

// ── DOM refs ──────────────────────────────────────────────────────────────────

const jobsBody          = document.getElementById('jobsBody');
const jobCount          = document.getElementById('jobCount');
const jobAddBtn         = document.getElementById('jobAddBtn');
const jobSearchInput    = document.getElementById('jobSearchInput');
const jobTagFilterChips = document.getElementById('jobTagFilterChips');
const jobFilterClear    = document.getElementById('jobFilterClear');
const jobShowArchived   = document.getElementById('jobShowArchived');

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

async function jobApiFetch(url, opts = {}) {
  const r = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || 'API error');
  return j;
}

function availBadge(avail) {
  if (avail === 'closing-soon') return `<span class="job-avail-badge job-avail-badge--soon">Closing Soon</span>`;
  if (avail === 'closed')       return `<span class="job-avail-badge job-avail-badge--closed">Closed</span>`;
  return `<span class="job-avail-badge job-avail-badge--open">Open</span>`;
}

function jobTypePill(jt) {
  return `<span class="job-type-pill">${esc((jt||'').replace(/-/g,' '))}</span>`;
}

// ── Load ──────────────────────────────────────────────────────────────────────

async function loadJobs() {
  jobsBody.innerHTML = '<tr><td colspan="9" class="loading">Loading…</td></tr>';
  try {
    const [jRes, tRes] = await Promise.all([
      jobApiFetch('/api/jobs'),
      jobApiFetch('/api/jobs/tags'),
    ]);
    _jobs = jRes.data || [];
    _allJobTags = tRes.data || [];
    renderJobTagChips();
    renderJobsTable();
  } catch (err) {
    jobsBody.innerHTML = `<tr><td colspan="9" class="loading" style="color:var(--danger);">Error: ${esc(err.message)}</td></tr>`;
    if (typeof toast !== 'undefined') toast('Failed to load jobs: ' + err.message, 'error');
  }
}

// ── Render table ──────────────────────────────────────────────────────────────

function renderJobsTable() {
  let visible = (_jobs || []).filter(j => {
    if (!j) return false;
    if (!_showArchived && !j.active) return false;
    if (_jobSearchQ) {
      const q = _jobSearchQ.toLowerCase();
      if (!(j.title||'').toLowerCase().includes(q) &&
          !(j.org||'').toLowerCase().includes(q) &&
          !(j.description||'').toLowerCase().includes(q) &&
          !(j.tags||[]).some(t => t.toLowerCase().includes(q))) return false;
    }
    if (_activeJobTags.size > 0) {
      const tags = j.tags || [];
      if (![..._activeJobTags].every(t => tags.includes(t))) return false;
    }
    return true;
  });

  const active   = visible.filter(j => j.active).length;
  const archived = visible.filter(j => !j.active).length;
  jobCount.textContent = `${active} active${archived ? `, ${archived} archived` : ''}`;

  if (!visible.length) {
    jobsBody.innerHTML = `<tr><td colspan="9" class="loading">No jobs found. <button class="btn btn-sm btn-outline" onclick="jobAddBtn.click()" style="margin-left:8px;">+ Add Job</button></td></tr>`;
    return;
  }

  jobsBody.innerHTML = visible.map(job => {
    const hasEs = !!(job.translations?.es?.title);
    const icon  = job.icon_url && job.icon_url.length <= 4 ? esc(job.icon_url)
                : job.icon_url ? `<img src="${esc(job.icon_url)}" style="width:28px;height:28px;border-radius:6px;object-fit:cover;">`
                : '💼';
    return `<tr class="${job.active ? '' : 'job-row--archived'}" data-job-id="${esc(job.id)}">
      <td style="text-align:center;font-size:20px;padding:6px 8px;">${icon}</td>
      <td>
        <div style="font-weight:600;">${esc(job.title)}</div>
        ${hasEs ? `<span class="lang-badge-es">ES</span>` : ''}
        ${(job.tags||[]).length ? `<div style="margin-top:3px;">${job.tags.map(t=>`<span class="job-tag-chip">${esc(t)}</span>`).join('')}</div>` : ''}
      </td>
      <td>${esc(job.org)}</td>
      <td>${jobTypePill(job.job_type)}</td>
      <td>${esc(job.pay)}</td>
      <td>${esc(job.location)}</td>
      <td>${availBadge(job.availability)}</td>
      <td style="font-size:12px;color:var(--text-muted);">${esc(job.close_date)}</td>
      <td><button class="btn btn-sm btn-ghost" onclick="jobOpenById('${esc(job.id)}')">Edit</button></td>
    </tr>`;
  }).join('');
}

// ── Tag filter chips ──────────────────────────────────────────────────────────

function renderJobTagChips() {
  if (!_allJobTags.length) { jobTagFilterChips.innerHTML = ''; return; }
  jobTagFilterChips.innerHTML = _allJobTags.map(t => {
    const active = _activeJobTags.has(t);
    return `<button class="img-filter-chip${active ? ' active' : ''}" data-tag="${esc(t)}">${esc(t)}</button>`;
  }).join('');
  jobTagFilterChips.querySelectorAll('.img-filter-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      const t = btn.dataset.tag;
      if (_activeJobTags.has(t)) _activeJobTags.delete(t); else _activeJobTags.add(t);
      jobFilterClear.style.display = (_activeJobTags.size || _jobSearchQ) ? '' : 'none';
      renderJobTagChips();
      renderJobsTable();
    });
  });
}

// ── Pay field helpers ─────────────────────────────────────────────────────────

/**
 * Parse a stored pay string back into { type, min, max }.
 * Stored formats: "Volunteer", "$22/hr", "$22–26/hr", "$45,000/yr", "$500 fixed"
 */
function _parsePay(str) {
  if (!str) return { type: 'hourly', min: '', max: '' };
  const s = str.trim();
  if (/volunteer|unpaid/i.test(s)) return { type: 'volunteer', min: '', max: '' };
  if (/\/yr|annual|salary/i.test(s)) {
    const nums = [...s.matchAll(/[\d,]+/g)].map(m => m[0].replace(/,/g,''));
    return { type: 'annual', min: nums[0]||'', max: nums[1]||'' };
  }
  if (/fixed|flat|one.?time/i.test(s)) {
    const nums = [...s.matchAll(/[\d,]+/g)].map(m => m[0].replace(/,/g,''));
    return { type: 'fixed', min: nums[0]||'', max: '' };
  }
  if (/\/session|per session/i.test(s)) {
    const nums = [...s.matchAll(/[\d,]+/g)].map(m => m[0].replace(/,/g,''));
    return { type: 'session', min: nums[0]||'', max: nums[1]||'' };
  }
  // Default: hourly
  const nums = [...s.matchAll(/[\d.]+/g)].map(m => m[0]);
  return { type: 'hourly', min: nums[0]||'', max: nums[1]||'' };
}

function _buildPayString() {
  const type = document.getElementById('jp-pay-type')?.value;
  const min  = (document.getElementById('jp-pay-min')?.value||'').trim();
  const max  = (document.getElementById('jp-pay-max')?.value||'').trim();
  if (type === 'volunteer') return 'Volunteer/Unpaid';
  if (!min) return '';
  const fmt = n => {
    const num = parseFloat(n);
    if (isNaN(num)) return n;
    if (type === 'annual') return `$${Number(num.toFixed(0)).toLocaleString()}`;
    return `$${num % 1 === 0 ? num : num.toFixed(2)}`;
  };
  const range = max ? `${fmt(min)}–${fmt(max)}` : fmt(min);
  const unit  = type === 'annual' ? '/yr' : type === 'fixed' ? ' fixed' : type === 'session' ? '/session' : '/hr';
  return range + unit;
}

function _updatePayPreview() {
  const el = document.getElementById('jp-pay-preview');
  if (!el) return;
  const str = _buildPayString();
  el.textContent = str || '';
}

function _renderPayInputs(payData) {
  const el = document.getElementById('jp-pay-fields');
  if (!el) return;
  if (payData.type === 'volunteer') {
    el.innerHTML = '<div style="font-size:13px;color:var(--text-muted);padding:4px 0;">No compensation — volunteer role</div>';
    return;
  }
  const unit = payData.type === 'annual' ? 'per year' : payData.type === 'fixed' ? 'one-time' : payData.type === 'session' ? 'per session' : 'per hour';
  const showMax = payData.type !== 'fixed';
  el.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
      <span style="color:var(--text-muted);font-size:15px;font-weight:700;">$</span>
      <input type="number" id="jp-pay-min" placeholder="Min" min="0" step="0.5"
             value="${esc(payData.min)}" style="width:90px;" oninput="_updatePayPreview()">
      ${showMax ? `<span style="color:var(--text-muted);">to</span>
      <input type="number" id="jp-pay-max" placeholder="Max (opt.)" min="0" step="0.5"
             value="${esc(payData.max)}" style="width:110px;" oninput="_updatePayPreview()">` : ''}
      <span style="font-size:12px;color:var(--text-muted);">${unit}</span>
    </div>
    <div id="jp-pay-preview" style="font-size:12px;color:var(--accent);font-weight:600;margin-top:6px;min-height:18px;">${esc(_buildPayString())}</div>
  `;
}

// ── Tag chip helpers (panel-scoped) ───────────────────────────────────────────

function _renderJobPanelTags() {
  const wrap = document.getElementById('jp-tags-chips');
  if (!wrap) return;
  wrap.innerHTML = _jobTags.length
    ? _jobTags.map((t, i) =>
        `<span class="img-tag-chip">${esc(t)}<button class="img-tag-chip-remove" onclick="_removeJobTag(${i})" title="Remove">✕</button></span>`
      ).join('')
    : '<span style="font-size:12px;color:var(--text-muted);">No tags yet</span>';
}

window._removeJobTag = function(i) {
  _jobTags.splice(i, 1);
  _renderJobPanelTags();
};

function _addJobTag(val) {
  const v = val.trim().toLowerCase().replace(/\s+/g, '-');
  if (!v || _jobTags.includes(v)) return;
  _jobTags.push(v);
  _renderJobPanelTags();
}

// ── Flier list helpers ────────────────────────────────────────────────────────

function _renderJobFliers() {
  const wrap = document.getElementById('jp-fliers-list');
  if (!wrap) return;
  if (!_jobFliers.length) {
    wrap.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">No fliers attached</div>';
    return;
  }
  wrap.innerHTML = _jobFliers.map((url, i) => `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
      <img src="${esc(url)}" style="width:48px;height:48px;object-fit:cover;border-radius:6px;border:1px solid var(--border);" onerror="this.style.display='none'">
      <div style="flex:1;font-size:11px;color:var(--text-muted);word-break:break-all;line-height:1.4;">${esc(url)}</div>
      <button class="btn btn-sm btn-ghost" onclick="_removeJobFlier(${i})" style="color:var(--danger);">✕</button>
    </div>`).join('');
}

window._removeJobFlier = function(i) {
  _jobFliers.splice(i, 1);
  _renderJobFliers();
};

// ── Contact auto-fill ─────────────────────────────────────────────────────────

async function _loadJobContacts() {
  if (_jobContacts.length) return;
  try {
    const res = await fetch('/api/contacts');
    const j   = await res.json();
    _jobContacts = (j.data || []).filter(c => c.name);
  } catch { /* non-critical */ }
}

function _tryFillContact(nameVal) {
  const match = _jobContacts.find(c => c.name.toLowerCase() === nameVal.toLowerCase());
  if (!match) return;
  const emailEl = document.getElementById('jp-contact-email');
  const phoneEl = document.getElementById('jp-contact-phone');
  const rowEl   = document.getElementById('jp-contact-row');
  if (emailEl && !emailEl.value) emailEl.value = match.email || '';
  if (phoneEl && !phoneEl.value) phoneEl.value = match.phone || '';
  if (rowEl)   rowEl.value = match.row_index ?? '';
}

// ── Panel: left-side preview updater ─────────────────────────────────────────

function _updatePanelPreview() {
  const iconInput = document.getElementById('jp-icon');
  const previewEl = document.getElementById('jp-left-preview');
  if (!previewEl) return;
  const icon = iconInput?.value?.trim() || '';
  const firstFlier = _jobFliers[0] || '';
  if (firstFlier) {
    previewEl.innerHTML = `<img src="${esc(firstFlier)}" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.5);">`;
  } else if (icon && icon.length > 4) {
    previewEl.innerHTML = `<img src="${esc(icon)}" style="width:120px;height:120px;object-fit:cover;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.4);">`;
  } else {
    previewEl.innerHTML = `<span style="font-size:96px;line-height:1;">${esc(icon||'💼')}</span>`;
  }
}

// ── EN/ES translation tab ─────────────────────────────────────────────────────

window.jobSwitchLangTab = function(lang) {
  _jobLang = lang;
  document.getElementById('jp-tab-en')?.classList.toggle('jp-tab--active', lang === 'en');
  document.getElementById('jp-tab-es')?.classList.toggle('jp-tab--active', lang === 'es');
  document.getElementById('jp-lang-en')?.style && (document.getElementById('jp-lang-en').style.display = lang === 'en' ? '' : 'none');
  document.getElementById('jp-lang-es')?.style && (document.getElementById('jp-lang-es').style.display = lang === 'es' ? '' : 'none');
  const translateBtn = document.getElementById('jp-translate-btn');
  if (translateBtn) translateBtn.style.display = lang === 'es' ? '' : 'none';
};

// ── Open panel ────────────────────────────────────────────────────────────────

/**
 * Open the full-screen job editor panel.
 * @param {object|null} job  — existing job object to edit, or null for new
 * @param {object} imgCtx   — optional { imageUrl, imageName, imageId } when
 *                            launched from the image lightbox ("Make into Job")
 */
window.jobOpenPanel = function(job = null, imgCtx = null) {
  const existing = document.getElementById('_jobPanel');
  if (existing) existing.remove();

  _editingJobId = job?.id || null;
  _jobTags      = [...(job?.tags || [])];
  _jobFliers    = [...(job?.flier_urls || (imgCtx ? [imgCtx.imageUrl] : []))];
  _jobLang      = 'en';

  const isEdit   = !!job;
  const j        = job || {};
  const esData   = j.translations?.es || {};
  const payData  = _parsePay(j.pay || '');

  // Left-side display: flier or icon
  const leftContent = _jobFliers[0]
    ? `<img src="${esc(_jobFliers[0])}" style="max-width:100%;max-height:70vh;object-fit:contain;border-radius:8px;box-shadow:0 8px 40px rgba(0,0,0,.5);">`
    : `<span style="font-size:96px;line-height:1;">${esc(j.icon_url && j.icon_url.length <= 4 ? j.icon_url : '💼')}</span>`;

  const panel = document.createElement('div');
  panel.id = '_jobPanel';
  panel.style.cssText = `position:fixed;inset:0;z-index:990;display:grid;grid-template-columns:1fr 1fr;background:var(--bg,#f8fafc);`;

  panel.innerHTML = `
    <!-- Left: visual preview -->
    <div style="background:#0f172a;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;gap:16px;">
      <div style="color:rgba(255,255,255,.5);font-size:11px;letter-spacing:.08em;text-transform:uppercase;font-weight:600;">
        ${imgCtx ? 'Flier Reference' : 'Job Preview'}
      </div>
      <div id="jp-left-preview" style="display:flex;align-items:center;justify-content:center;">
        ${leftContent}
      </div>
      <div style="color:rgba(255,255,255,.4);font-size:12px;text-align:center;max-width:240px;line-height:1.5;">
        ${imgCtx ? esc(imgCtx.imageName) : 'Add a flier or icon below — it will appear here'}
      </div>
    </div>

    <!-- Right: form -->
    <div style="overflow-y:auto;padding:28px 32px;display:flex;flex-direction:column;gap:0;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
        <h2 style="margin:0;font-size:20px;font-weight:700;color:var(--text);">
          ${isEdit ? 'Edit Job' : 'Add Job Opportunity'}
        </h2>
        <button id="jp-close" class="btn btn-ghost">✕ Close</button>
      </div>

      <!-- EN / ES tabs -->
      <div style="display:flex;align-items:center;border-bottom:1px solid var(--border);margin-bottom:20px;">
        <button id="jp-tab-en" class="job-modal-lang-tab jp-tab--active" onclick="jobSwitchLangTab('en')">EN</button>
        <button id="jp-tab-es" class="job-modal-lang-tab" onclick="jobSwitchLangTab('es')">ES</button>
        <button id="jp-translate-btn" class="btn btn-sm btn-ghost" style="margin-left:auto;display:none;"
                title="Auto-translate EN title &amp; description to Spanish">⟷ Translate to ES</button>
      </div>

      <!-- EN content -->
      <div id="jp-lang-en">
        <div class="form-field">
          <label for="jp-title">Job Title <span style="color:#ef4444;">*</span></label>
          <input type="text" id="jp-title" placeholder="e.g. Bilingual Community Health Worker"
                 value="${esc(j.title||'')}">
        </div>
        <div class="form-field">
          <label for="jp-desc">Description</label>
          <textarea id="jp-desc" style="min-height:100px;resize:vertical;"
                    placeholder="Role responsibilities, requirements, how to apply…">${esc(j.description||'')}</textarea>
        </div>
      </div>

      <!-- ES content (hidden initially) -->
      <div id="jp-lang-es" style="display:none;">
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;font-size:12px;color:#1d4ed8;margin-bottom:14px;">
          Spanish translation — Title and Description only. All other fields are shared.
        </div>
        <div class="form-field">
          <label for="jp-title-es">Título (Spanish)</label>
          <input type="text" id="jp-title-es" placeholder="e.g. Trabajador Comunitario de Salud Bilingüe"
                 value="${esc(esData.title||'')}">
        </div>
        <div class="form-field">
          <label for="jp-desc-es">Descripción (Spanish)</label>
          <textarea id="jp-desc-es" style="min-height:100px;resize:vertical;"
                    placeholder="Descripción del puesto en español…">${esc(esData.description||'')}</textarea>
        </div>
      </div>

      <!-- ── Basics ── -->
      <div class="jp-section-header">Basics</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-field">
          <label for="jp-org">Organization</label>
          <input type="text" id="jp-org" placeholder="e.g. Lane County Public Health"
                 value="${esc(j.org||'')}" list="jp-org-list" data-sf-ac="orgs" autocomplete="off">
          <datalist id="jp-org-list"></datalist>
        </div>
        <div class="form-field">
          <label for="jp-job-type">Job Type</label>
          <select id="jp-job-type">
            ${['full-time','part-time','temporary','contract','volunteer'].map(t =>
              `<option value="${t}"${(j.job_type||'full-time')===t?' selected':''}>${t.replace(/-/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>`
            ).join('')}
          </select>
        </div>
        <div class="form-field">
          <label for="jp-availability">Availability</label>
          <select id="jp-availability">
            <option value="open"${(j.availability||'open')==='open'?' selected':''}>Open</option>
            <option value="closing-soon"${j.availability==='closing-soon'?' selected':''}>Closing Soon</option>
            <option value="closed"${j.availability==='closed'?' selected':''}>Closed</option>
          </select>
        </div>
        <div class="form-field">
          <label for="jp-close-date">Application Deadline</label>
          <input type="text" id="jp-close-date" placeholder="e.g. April 20, 2026 or Open until filled"
                 value="${esc(j.close_date||'')}">
        </div>
      </div>

      <!-- Pay -->
      <div class="form-field">
        <label>Compensation</label>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
          <select id="jp-pay-type" onchange="_renderPayInputs({type:this.value,min:'',max:''});_updatePayPreview();">
            <option value="hourly"${payData.type==='hourly'?' selected':''}>Hourly</option>
            <option value="annual"${payData.type==='annual'?' selected':''}>Annual Salary</option>
            <option value="fixed"${payData.type==='fixed'?' selected':''}>Fixed / One-time</option>
            <option value="session"${payData.type==='session'?' selected':''}>Per Session</option>
            <option value="volunteer"${payData.type==='volunteer'?' selected':''}>Volunteer / Unpaid</option>
          </select>
        </div>
        <div id="jp-pay-fields"></div>
      </div>

      <!-- Location -->
      <div class="form-field">
        <label for="jp-location">Location</label>
        <input type="text" id="jp-location" placeholder="e.g. Eugene, OR · Remote · Hybrid"
               value="${esc(j.location||'')}">
      </div>

      <!-- ── Contact ── -->
      <div class="jp-section-header">Contact</div>
      <input type="hidden" id="jp-contact-row" value="${esc(j.contact_row_index ?? '')}">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
        <div class="form-field">
          <label for="jp-contact-name">Contact Name</label>
          <input type="text" id="jp-contact-name" placeholder="Primary contact"
                 value="${esc(j.contact_name||'')}" list="jp-contact-names-list"
                 data-sf-ac="names" autocomplete="off">
          <datalist id="jp-contact-names-list"></datalist>
        </div>
        <div class="form-field">
          <label for="jp-contact-email">Contact Email</label>
          <input type="email" id="jp-contact-email" placeholder="contact@example.org"
                 value="${esc(j.contact_email||'')}">
        </div>
        <div class="form-field">
          <label for="jp-contact-phone">Contact Phone</label>
          <input type="text" id="jp-contact-phone" placeholder="(541) 555-0100"
                 value="${esc(j.contact_phone||'')}">
        </div>
      </div>

      <!-- ── Presentation ── -->
      <div class="jp-section-header">Presentation</div>
      ${SmartFields.imagePicker('Icon (emoji or image URL)', 'jp-icon', j.icon_url || '')}
      <div class="form-field">
        <label>Tags</label>
        <div id="jp-tags-chips" class="img-tags-row" style="min-height:28px;margin-bottom:6px;"></div>
        <div style="display:flex;gap:6px;">
          <input type="text" id="jp-tag-input" placeholder="Add a tag…"
                 style="flex:1;" list="jp-tag-suggestions" autocomplete="off">
          <datalist id="jp-tag-suggestions"></datalist>
          <button type="button" class="btn btn-sm btn-outline"
                  onclick="_addJobTag(document.getElementById('jp-tag-input').value);document.getElementById('jp-tag-input').value='';">Add</button>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">Press Enter to add · click ✕ to remove</div>
      </div>
      <div class="form-field">
        <label>Attached Fliers</label>
        <div id="jp-fliers-list" style="margin-bottom:8px;"></div>
        ${SmartFields.imagePicker('Add Flier', 'jp-flier-add', '')}
        <button type="button" class="btn btn-sm btn-outline" style="margin-top:6px;"
                onclick="_attachJobFlier()">➕ Attach This Image</button>
      </div>

      <!-- ── Actions ── -->
      <div style="display:flex;gap:10px;margin-top:24px;padding-top:20px;border-top:1px solid var(--border);flex-wrap:wrap;">
        ${isEdit ? `<button class="btn btn-danger btn-sm" id="jp-delete" style="margin-right:auto;">🗑 Delete</button>
                    <button class="btn btn-outline btn-sm" id="jp-archive">${j.active ? 'Archive' : 'Unarchive'}</button>` : ''}
        <button class="btn btn-ghost" id="jp-cancel">Cancel</button>
        <button class="btn btn-primary" id="jp-save">${isEdit ? '💾 Save Changes' : '💾 Save Job'}</button>
      </div>
    </div>
  `;

  document.body.appendChild(panel);

  // Init SmartFields (org autocomplete, image pickers)
  SmartFields.initAll(panel);
  _renderJobPanelTags();
  _renderJobFliers();
  _renderPayInputs(payData);

  // Load contacts for auto-fill
  _loadJobContacts().then(() => {
    const nameInput = document.getElementById('jp-contact-name');
    if (nameInput) {
      nameInput.addEventListener('change', () => _tryFillContact(nameInput.value));
    }
  });

  // Tag suggestions
  fetch('/api/jobs/tags').then(r => r.json()).then(j => {
    const dl = document.getElementById('jp-tag-suggestions');
    if (dl && j.ok) dl.innerHTML = (j.data || []).map(t => `<option value="${esc(t)}">`).join('');
  }).catch(() => {});

  // Tag input: enter to add
  const tagInp = panel.querySelector('#jp-tag-input');
  if (tagInp) {
    tagInp.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        _addJobTag(tagInp.value);
        tagInp.value = '';
      }
    });
  }

  // Icon changes → update left preview
  const iconInp = panel.querySelector('#jp-icon');
  if (iconInp) iconInp.addEventListener('input', _updatePanelPreview);

  // Translate button
  panel.querySelector('#jp-translate-btn')?.addEventListener('click', _translateJobPanel);

  // Close / cancel
  panel.querySelector('#jp-close')?.addEventListener('click',  () => panel.remove());
  panel.querySelector('#jp-cancel')?.addEventListener('click', () => panel.remove());

  // Save
  panel.querySelector('#jp-save')?.addEventListener('click', () => _jobPanelSave(panel, imgCtx));

  // Delete / Archive (edit only)
  if (isEdit) {
    panel.querySelector('#jp-delete')?.addEventListener('click', () => _jobPanelDelete(panel));
    panel.querySelector('#jp-archive')?.addEventListener('click', () => _jobPanelArchive(panel, j.active));
  }
};

// ── Attach flier ──────────────────────────────────────────────────────────────

window._attachJobFlier = function() {
  const url = document.getElementById('jp-flier-add')?.value?.trim();
  if (!url) { toast('Choose an image first', 'info'); return; }
  if (!_jobFliers.includes(url)) {
    _jobFliers.push(url);
    _renderJobFliers();
    _updatePanelPreview();
  }
  // Clear the picker
  const inp = document.getElementById('jp-flier-add');
  const prev = document.getElementById('jp-flier-add_preview');
  if (inp) inp.value = '';
  if (prev) prev.innerHTML = '<div class="sf-img-placeholder">No image</div>';
};

// ── Translate ──────────────────────────────────────────────────────────────────

async function _translateJobPanel() {
  if (!_editingJobId) {
    toast('Save the job first before translating', 'info');
    return;
  }
  const btn = document.getElementById('jp-translate-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Translating…'; }
  try {
    const res = await jobApiFetch(`/api/jobs/${_editingJobId}/translate`, {
      method: 'POST',
      body: JSON.stringify({ to_lang: 'es' }),
    });
    const es = res.data?.translations?.es || {};
    const titleEl = document.getElementById('jp-title-es');
    const descEl  = document.getElementById('jp-desc-es');
    if (titleEl) titleEl.value = es.title       || '';
    if (descEl)  descEl.value  = es.description || '';
    // Update local cache
    const idx = (_jobs||[]).findIndex(j => j.id === _editingJobId);
    if (idx >= 0) _jobs[idx] = res.data;
    toast('Translated to Spanish!', 'success');
  } catch (err) {
    toast('Translation failed: ' + err.message, 'error');
  } finally {
    const btn2 = document.getElementById('jp-translate-btn');
    if (btn2) { btn2.disabled = false; btn2.textContent = '⟷ Translate to ES'; }
  }
}

// ── Save ──────────────────────────────────────────────────────────────────────

async function _jobPanelSave(panel, imgCtx) {
  const title = document.getElementById('jp-title')?.value?.trim() || '';
  if (!title) { toast('Job title is required', 'info'); document.getElementById('jp-title')?.focus(); return; }

  const titleEs = document.getElementById('jp-title-es')?.value?.trim() || '';
  const descEs  = document.getElementById('jp-desc-es')?.value?.trim()  || '';

  const payload = {
    title,
    description:   document.getElementById('jp-desc')?.value?.trim() || '',
    org:           document.getElementById('jp-org')?.value?.trim() || '',
    job_type:      document.getElementById('jp-job-type')?.value || 'full-time',
    availability:  document.getElementById('jp-availability')?.value || 'open',
    close_date:    document.getElementById('jp-close-date')?.value?.trim() || '',
    pay:           _buildPayString(),
    location:      document.getElementById('jp-location')?.value?.trim() || '',
    contact_name:  document.getElementById('jp-contact-name')?.value?.trim() || '',
    contact_email: document.getElementById('jp-contact-email')?.value?.trim() || '',
    contact_phone: document.getElementById('jp-contact-phone')?.value?.trim() || '',
    contact_row_index: parseInt(document.getElementById('jp-contact-row')?.value) || null,
    icon_url:      document.getElementById('jp-icon')?.value?.trim() || '',
    flier_urls:    [..._jobFliers],
    tags:          [..._jobTags],
  };

  // Merge ES translation if provided
  const existingTranslations = _editingJobId
    ? ((_jobs||[]).find(j => j.id === _editingJobId)?.translations || {})
    : {};
  if (titleEs || descEs) {
    payload.translations = { ...existingTranslations, es: { title: titleEs, description: descEs } };
  }

  const saveBtn = panel.querySelector('#jp-save');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    let res;
    if (_editingJobId) {
      res = await jobApiFetch(`/api/jobs/${_editingJobId}`, {
        method: 'PUT', body: JSON.stringify(payload),
      });
      const idx = (_jobs||[]).findIndex(j => j.id === _editingJobId);
      if (idx >= 0) _jobs[idx] = res.data;
    } else {
      res = await jobApiFetch('/api/jobs', {
        method: 'POST', body: JSON.stringify(payload),
      });
      _jobs.unshift(res.data);
      // If launched from image lightbox, link this image to the new job
      if (imgCtx?.imageId && res.data?.id) {
        await fetch(`/api/images/${encodeURIComponent(imgCtx.imageId)}/link-job`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ job_id: res.data.id }),
        });
      }
    }
    // Refresh tags
    const tRes = await jobApiFetch('/api/jobs/tags');
    _allJobTags = tRes.data || [];
    renderJobTagChips();
    renderJobsTable();
    panel.remove();
    toast(_editingJobId ? 'Job updated' : 'Job created!', 'success');
    if (typeof loadImages === 'function') loadImages();
  } catch (err) {
    toast('Save failed: ' + err.message, 'error');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = _editingJobId ? '💾 Save Changes' : '💾 Save Job'; }
  }
}

// ── Delete / Archive ──────────────────────────────────────────────────────────

async function _jobPanelDelete(panel) {
  if (!_editingJobId) return;
  if (!confirm('Permanently delete this job? This cannot be undone.')) return;
  try {
    await jobApiFetch(`/api/jobs/${_editingJobId}`, { method: 'DELETE' });
    _jobs = (_jobs||[]).filter(j => j.id !== _editingJobId);
    renderJobsTable();
    panel.remove();
    toast('Job deleted', 'success');
  } catch (err) {
    toast('Delete failed: ' + err.message, 'error');
  }
}

async function _jobPanelArchive(panel, isCurrentlyActive) {
  if (!_editingJobId) return;
  try {
    const res = await jobApiFetch(`/api/jobs/${_editingJobId}`, {
      method: 'PUT', body: JSON.stringify({ active: !isCurrentlyActive }),
    });
    const idx = (_jobs||[]).findIndex(j => j.id === _editingJobId);
    if (idx >= 0) _jobs[idx] = res.data;
    renderJobsTable();
    panel.remove();
    toast(isCurrentlyActive ? 'Job archived' : 'Job unarchived', 'success');
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

// ── Public: job picker for builder.js ─────────────────────────────────────────

window.jobLoadAll = async function() {
  if ((_jobs||[]).filter(j => j && j.active).length) return _jobs.filter(j => j && j.active);
  await loadJobs();
  return (_jobs||[]).filter(j => j && j.active);
};

window.jobLoadByTag = async function(tagFilter) {
  const all = await window.jobLoadAll();
  if (!tagFilter) return all;
  const tags = tagFilter.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  return all.filter(j => (j.tags||[]).some(t => tags.includes(t.toLowerCase())));
};

window.jobOpenById = function(id) {
  const job = (_jobs || []).find(j => j && j.id === id);
  if (job) jobOpenPanel(job);
};

// ── Event wiring ──────────────────────────────────────────────────────────────

jobAddBtn.addEventListener('click', () => jobOpenPanel(null));

jobSearchInput.addEventListener('input', () => {
  _jobSearchQ = jobSearchInput.value.trim();
  jobFilterClear.style.display = (_activeJobTags.size || _jobSearchQ) ? '' : 'none';
  renderJobsTable();
});

jobFilterClear.addEventListener('click', () => {
  _jobSearchQ = '';
  _activeJobTags.clear();
  jobSearchInput.value = '';
  jobFilterClear.style.display = 'none';
  renderJobTagChips();
  renderJobsTable();
});

jobShowArchived.addEventListener('change', () => {
  _showArchived = jobShowArchived.checked;
  renderJobsTable();
});

// ── Init ──────────────────────────────────────────────────────────────────────

loadJobs();
