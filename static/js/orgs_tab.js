/**
 * orgs_tab.js — Organizations tab.
 *
 * Architecture:
 *   • The Detection Wizard works entirely in JS memory.
 *     No sheet writes happen until the user explicitly clicks "Write to Sheet".
 *   • The main table reads from / writes to the Organizations Google Sheet
 *     via standard CRUD routes (/api/organizations).
 *   • Merge in the main table = update the keeper row + delete the absorbed row.
 */

// ── State ─────────────────────────────────────────────────────────────────────

let _orgs          = [];   // current sheet data
let _wizardOrgs    = [];   // working list inside wizard (draft, never saved until Step 4)
let _wizardStep    = 1;
let _mergeMode     = false;
let _selectedRows  = new Set();

// ── DOM refs ──────────────────────────────────────────────────────────────────

const orgsBody         = document.getElementById('orgsBody');
const orgCount         = document.getElementById('orgCount');
const orgModal         = document.getElementById('orgModal');
const orgModalTitle    = document.getElementById('orgModalTitle');
const orgModalBody     = document.getElementById('orgModalBody');
const orgModalSave     = document.getElementById('orgModalSave');
const orgModalClose    = document.getElementById('orgModalClose');
const orgModalCancel   = document.getElementById('orgModalCancel');
const orgWizard        = document.getElementById('orgWizard');
const wizardBody       = document.getElementById('wizardBody');
const wizardTitle      = document.getElementById('wizardTitle');
const wizardNextBtn    = document.getElementById('wizardNextBtn');
const wizardBackBtn    = document.getElementById('wizardBackBtn');
const wizardCancelBtn  = document.getElementById('wizardCancelBtn');
const wizardSkipBtn    = document.getElementById('wizardSkipBtn');
const wizardClose      = document.getElementById('wizardClose');
const orgMergeBanner   = document.getElementById('orgMergeBanner');
const orgMergeMsg      = document.getElementById('orgMergeMsg');
const orgMergeBtn      = document.getElementById('orgMergeBtn');
const orgSelectHeader  = document.getElementById('orgSelectHeader');

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

async function apiFetch(url, opts = {}) {
  const res  = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...opts });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'API error');
  return json;
}

// ── Load organizations from sheet ─────────────────────────────────────────────

async function loadOrgs() {
  orgsBody.innerHTML = '<tr><td colspan="9" class="loading">Loading…</td></tr>';
  try {
    const json = await apiFetch('/api/organizations');
    _orgs = json.data || [];
    renderOrgsTable();
  } catch (err) {
    orgsBody.innerHTML = `<tr><td colspan="9" class="loading" style="color:var(--danger);">Error: ${esc(err.message)}</td></tr>`;
    toast('Failed to load organizations: ' + err.message, 'error');
  }
}

function renderOrgsTable() {
  orgCount.textContent = `${_orgs.length} organization${_orgs.length !== 1 ? 's' : ''}`;
  if (!_orgs.length) {
    orgsBody.innerHTML = `
      <tr><td colspan="9" class="loading">
        No organizations yet.
        <button class="btn btn-sm btn-outline" onclick="document.getElementById('orgDetectBtn').click()"
                style="margin-left:10px;">🔍 Detect from contacts & events</button>
      </td></tr>`;
    return;
  }
  orgsBody.innerHTML = _orgs.map(o => `
    <tr data-row="${o.row_index}">
      <td class="org-select-cell hidden">
        <input type="checkbox" class="org-select-check" data-row="${o.row_index}"
               onchange="orgToggleSelect(${o.row_index})">
      </td>
      <td><strong>${esc(o.name)}</strong></td>
      <td>${o.abbreviation ? `<span class="badge badge-blue">${esc(o.abbreviation)}</span>` : ''}</td>
      <td style="color:var(--text-muted);font-size:12px;">${esc(o.alternate_name)}</td>
      <td>${esc(o.primary_contact)}</td>
      <td><a href="mailto:${esc(o.contact_email)}" style="color:var(--accent);font-size:12px;">${esc(o.contact_email)}</a></td>
      <td>${o.website ? `<a href="${esc(o.website)}" target="_blank" style="color:var(--accent);font-size:12px;">Website ↗</a>` : ''}</td>
      <td style="font-size:12px;">${esc(o.location)}</td>
      <td style="display:flex;gap:4px;">
        <button class="btn btn-sm btn-ghost" onclick="openOrgEdit(${o.row_index})">✏ Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteOrg(${o.row_index})">Del</button>
      </td>
    </tr>
  `).join('');
}

// ── Add/Edit org modal ────────────────────────────────────────────────────────

function orgModalFields(o = {}) {
  return `
    <div class="form-field">
      <label>Organization Name <span style="color:var(--danger);">*</span></label>
      <input type="text" id="of-name" value="${esc(o.name || '')}">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">
      <div class="form-field">
        <label>Abbreviation</label>
        <input type="text" id="of-abbrev" value="${esc(o.abbreviation || '')}" placeholder="e.g. LCIDN">
      </div>
      <div class="form-field">
        <label>Alternate / Full Name</label>
        <input type="text" id="of-altname" value="${esc(o.alternate_name || '')}">
      </div>
    </div>
    ${SmartFields.autocomplete('Primary Contact', 'of-contact', o.primary_contact || '', 'names')}
    ${SmartFields.autocomplete('Contact Email', 'of-email', o.contact_email || '', 'emails')}
    <div class="form-field">
      <label>Website</label>
      <input type="url" id="of-website" value="${esc(o.website || '')}" placeholder="https://…">
    </div>
    ${SmartFields.location('Location / Address', 'of-location', o.location || '')}
    <div class="form-field">
      <label>Description / Notes</label>
      <textarea id="of-desc" style="min-height:60px;">${esc(o.description || '')}</textarea>
    </div>
    ${SmartFields.imagePicker('Logo / Image', 'of-image', o.image_url || '')}
  `;
}

function openOrgAdd() {
  orgModalTitle.textContent = 'Add Organization';
  orgModalBody.innerHTML = orgModalFields();
  SmartFields.initAll(orgModalBody);
  orgModal.classList.remove('hidden');
  orgModalSave.onclick = async () => {
    const name = document.getElementById('of-name')?.value?.trim();
    if (!name) { toast('Organization name is required', 'error'); return; }
    try {
      await apiFetch('/api/organizations', {
        method: 'POST',
        body: JSON.stringify(orgPayload()),
      });
      orgModal.classList.add('hidden');
      toast('Organization added', 'success');
      EventBus.emit('orgs:changed');
      loadOrgs();
    } catch (err) { toast('Add failed: ' + err.message, 'error'); }
  };
}

window.openOrgEdit = function(rowIndex) {
  const o = _orgs.find(x => x.row_index === rowIndex);
  if (!o) return;
  orgModalTitle.textContent = `Edit: ${o.name}`;
  orgModalBody.innerHTML = orgModalFields(o);
  SmartFields.initAll(orgModalBody);
  orgModal.classList.remove('hidden');
  orgModalSave.onclick = async () => {
    try {
      await apiFetch(`/api/organizations/${o.row_index}`, {
        method: 'PUT',
        body: JSON.stringify(orgPayload()),
      });
      orgModal.classList.add('hidden');
      toast('Organization updated', 'success');
      EventBus.emit('orgs:changed');
      loadOrgs();
    } catch (err) { toast('Update failed: ' + err.message, 'error'); }
  };
};

window.deleteOrg = async function(rowIndex) {
  const o = _orgs.find(x => x.row_index === rowIndex);
  if (!o || !confirm(`Delete "${o.name}"? This removes it from the sheet.`)) return;
  try {
    await apiFetch(`/api/organizations/${rowIndex}`, { method: 'DELETE' });
    toast('Organization deleted', 'success');
    EventBus.emit('orgs:changed');
    loadOrgs();
  } catch (err) { toast('Delete failed: ' + err.message, 'error'); }
};

function orgPayload() {
  return {
    name:           document.getElementById('of-name')?.value?.trim() || '',
    abbreviation:   document.getElementById('of-abbrev')?.value?.trim() || '',
    alternate_name: document.getElementById('of-altname')?.value?.trim() || '',
    primary_contact:document.getElementById('of-contact')?.value?.trim() || '',
    contact_email:  document.getElementById('of-email')?.value?.trim() || '',
    website:        document.getElementById('of-website')?.value?.trim() || '',
    location:       document.getElementById('of-location')?.value?.trim() || '',
    description:    document.getElementById('of-desc')?.value?.trim() || '',
    image_url:      document.getElementById('of-image')?.value?.trim() || '',
  };
}

[orgModalClose, orgModalCancel].forEach(btn =>
  btn.addEventListener('click', () => orgModal.classList.add('hidden'))
);
orgModal.addEventListener('click', e => { if (e.target === orgModal) orgModal.classList.add('hidden'); });
document.getElementById('addOrgBtn').addEventListener('click', openOrgAdd);

// ── Merge mode (main table) ───────────────────────────────────────────────────

window.orgToggleSelect = function(rowIndex) {
  if (_selectedRows.has(rowIndex)) _selectedRows.delete(rowIndex);
  else _selectedRows.add(rowIndex);
  const count = _selectedRows.size;
  orgMergeMsg.textContent = count === 0 ? 'Select 2 organizations to merge'
    : count === 1 ? '1 selected — select one more'
    : count === 2 ? '2 selected — ready to merge'
    : `${count} selected (max 2)`;
  orgMergeBtn.disabled = count !== 2;
};

document.getElementById('orgMergeSelectBtn').addEventListener('click', () => {
  _mergeMode = true;
  _selectedRows.clear();
  orgMergeBanner.classList.remove('hidden');
  orgSelectHeader.classList.remove('hidden');
  document.querySelectorAll('.org-select-cell').forEach(el => el.classList.remove('hidden'));
  orgMergeMsg.textContent = 'Select 2 organizations to merge';
  orgMergeBtn.disabled = true;
});

document.getElementById('orgMergeCancelBtn').addEventListener('click', exitMergeMode);
function exitMergeMode() {
  _mergeMode = false;
  _selectedRows.clear();
  orgMergeBanner.classList.add('hidden');
  orgSelectHeader.classList.add('hidden');
  document.querySelectorAll('.org-select-cell').forEach(el => el.classList.add('hidden'));
  document.querySelectorAll('.org-select-check').forEach(cb => cb.checked = false);
}

orgMergeBtn.addEventListener('click', () => {
  if (_selectedRows.size !== 2) return;
  const [rowA, rowB] = [..._selectedRows];
  const orgA = _orgs.find(o => o.row_index === rowA);
  const orgB = _orgs.find(o => o.row_index === rowB);
  if (!orgA || !orgB) return;
  openMergeConfirmModal(orgA, orgB);
});

function openMergeConfirmModal(orgA, orgB) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" style="width:480px;">
      <div class="modal-header">
        <h2>Merge Organizations</h2>
        <button class="modal-close" id="_mergeClose">✕</button>
      </div>
      <div class="modal-body">
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px;">
          Choose which name to keep as the primary. The other becomes the alternate name.
        </p>
        <div class="form-field">
          <label>Keep as primary name</label>
          <select id="_mergeKeeper">
            <option value="${orgA.row_index}">${esc(orgA.name)}</option>
            <option value="${orgB.row_index}">${esc(orgB.name)}</option>
          </select>
        </div>
        <div class="form-field">
          <label>Abbreviation (optional)</label>
          <input type="text" id="_mergeAbbrev"
                 value="${esc(orgA.abbreviation || orgB.abbreviation || '')}">
        </div>
        <div class="form-field">
          <label>Primary Contact</label>
          <input type="text" id="_mergeContact"
                 value="${esc(orgA.primary_contact || orgB.primary_contact || '')}"
                 list="_mergeContactList">
          <datalist id="_mergeContactList"></datalist>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="_mergeCancel">Cancel</button>
        <button class="btn btn-primary" id="_mergeSave">Merge</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Populate contact datalist
  fetch('/api/autocomplete/names').then(r => r.json()).then(j => {
    if (j.ok) {
      document.getElementById('_mergeContactList').innerHTML =
        j.data.map(n => `<option value="${esc(n)}">`).join('');
    }
  });

  overlay.querySelector('#_mergeClose').addEventListener('click', () => overlay.remove());
  overlay.querySelector('#_mergeCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelector('#_mergeSave').addEventListener('click', async () => {
    const keepRow   = parseInt(document.getElementById('_mergeKeeper').value);
    const absorbRow = keepRow === orgA.row_index ? orgB.row_index : orgA.row_index;
    const keeper    = _orgs.find(o => o.row_index === keepRow);
    const absorbed  = _orgs.find(o => o.row_index === absorbRow);
    if (!keeper || !absorbed) return;

    const abbrev  = document.getElementById('_mergeAbbrev').value.trim();
    const contact = document.getElementById('_mergeContact').value.trim();

    try {
      // Update keeper with merged info
      await apiFetch(`/api/organizations/${keepRow}`, {
        method: 'PUT',
        body: JSON.stringify({
          ...keeper,
          abbreviation:   abbrev || keeper.abbreviation || absorbed.abbreviation,
          alternate_name: absorbed.name,
          primary_contact:contact || keeper.primary_contact || absorbed.primary_contact,
          contact_email:  keeper.contact_email || absorbed.contact_email,
          website:        keeper.website || absorbed.website,
          location:       keeper.location || absorbed.location,
          description:    keeper.description || absorbed.description,
          image_url:      keeper.image_url || absorbed.image_url,
        }),
      });
      // Delete absorbed row
      await apiFetch(`/api/organizations/${absorbRow}`, { method: 'DELETE' });
      overlay.remove();
      exitMergeMode();
      toast(`Merged "${absorbed.name}" into "${keeper.name}"`, 'success');
      EventBus.emit('orgs:changed');
      loadOrgs();
    } catch (err) { toast('Merge failed: ' + err.message, 'error'); }
  });
}

// ── Detection Wizard ──────────────────────────────────────────────────────────

document.getElementById('orgDetectBtn').addEventListener('click', openWizard);
[wizardClose, wizardCancelBtn].forEach(btn =>
  btn.addEventListener('click', () => orgWizard.classList.add('hidden'))
);

async function openWizard() {
  _wizardStep = 1;
  _wizardOrgs = [];
  orgWizard.classList.remove('hidden');
  wizardNextBtn.style.display = '';
  wizardSkipBtn.style.display = 'none';
  wizardTitle.textContent = 'Step 1 — Detected Organizations';
  wizardBody.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-muted);">Scanning contacts & events…</div>';
  updateWizardNav();

  try {
    const json = await apiFetch('/api/organizations/detect');
    // Convert detected list to wizard org objects
    _wizardOrgs = json.data.map((d, i) => ({
      _id:             i,                   // local wizard ID
      name:            d.name,
      abbreviation:    _guessAbbrev(d),
      alternate_name:  '',
      primary_contact: d.suggested_contacts?.[0]?.name  || '',
      contact_email:   d.suggested_contacts?.[0]?.email || '',
      website:         '',
      location:        '',
      description:     '',
      image_url:       '',
      // wizard metadata (not sent to sheet)
      _count:          d.count,
      _sources:        d.sources,
      _suggested:      d.suggested_contacts || [],
      _similar_to:     d.similar_to || [],
      _included:       true,
    }));
    renderWizardStep1();
  } catch (err) {
    wizardBody.innerHTML = `<div style="color:var(--danger);padding:20px;">Error: ${esc(err.message)}</div>`;
  }
}

function _guessAbbrev(detected) {
  const name = detected.name;
  // If name is all-caps and short it IS the abbreviation (we don't duplicate it)
  if (/^[A-Z]{2,8}(-\w+)?$/.test(name.trim())) return name.trim();
  return '';
}

function updateWizardNav() {
  wizardSkipBtn.style.display = 'none';
  wizardNextBtn.style.display = _wizardStep === 4 ? 'none' : '';
  wizardBackBtn.style.display = _wizardStep > 1 ? '' : 'none';
  document.querySelectorAll('.wizard-step-dot').forEach(dot => {
    const s = parseInt(dot.dataset.step);
    dot.classList.toggle('active', s === _wizardStep);
    dot.classList.toggle('done',   s < _wizardStep);
  });
  const labels = ['', 'Step 1 — Detected Organizations', 'Step 2 — Merge Similar',
                       'Step 3 — Assign Primary Contacts', 'Step 4 — Confirm & Write to Sheet'];
  wizardTitle.textContent = labels[_wizardStep];
  wizardNextBtn.textContent = _wizardStep === 4 ? '✓ Done' : 'Next →';
}

wizardNextBtn.addEventListener('click', () => {
  if (_wizardStep === 1) { saveStep1(); goToStep(2); }
  else if (_wizardStep === 2) { goToStep(3); }
  else if (_wizardStep === 3) { saveStep3(); goToStep(4); }
  else if (_wizardStep === 4) { /* handled by write buttons */ }
});

wizardBackBtn.addEventListener('click', () => {
  if (_wizardStep > 1) goToStep(_wizardStep - 1);
});

function goToStep(n) {
  _wizardStep = n;
  updateWizardNav();
  if (n === 1) renderWizardStep1();
  else if (n === 2) renderWizardStep2();
  else if (n === 3) renderWizardStep3();
  else if (n === 4) renderWizardStep4();
}

// ── Wizard Step 1: Review detected list ───────────────────────────────────────

function renderWizardStep1() {
  const hasSimilar = _wizardOrgs.some(o => o._similar_to.length > 0);

  wizardBody.innerHTML = `
    <div class="wizard-step-header">
      <div style="font-size:13px;color:var(--text-muted);">
        Found <strong>${_wizardOrgs.length}</strong> unique organization names across contacts &amp; events.
        Uncheck any you want to exclude. Rename inline if needed.
        ${hasSimilar ? '<span style="color:#f59e0b;font-weight:600;"> ⚠ Some similar names detected — review in Step 2.</span>' : ''}
      </div>
      <label style="font-size:12px;display:flex;align-items:center;gap:6px;cursor:pointer;">
        <input type="checkbox" id="wizardCheckAll" checked> Select all
      </label>
    </div>
    <div class="wizard-detect-list">
      ${_wizardOrgs.map(o => `
        <div class="wizard-detect-row ${o._similar_to.length ? 'has-similar' : ''}" data-wid="${o._id}">
          <input type="checkbox" class="wd-check" data-wid="${o._id}"
                 ${o._included ? 'checked' : ''} onchange="wizardToggle(${o._id})">
          <div class="wd-main">
            <input type="text" class="wd-name" data-wid="${o._id}" value="${esc(o.name)}"
                   style="font-weight:600;border:1px solid transparent;background:transparent;padding:3px 6px;border-radius:4px;width:100%;"
                   onchange="wizardRename(${o._id}, this.value)"
                   onfocus="this.style.borderColor='var(--accent)';this.style.background='#fff'"
                   onblur="this.style.borderColor='transparent';this.style.background='transparent'">
          </div>
          <div class="wd-meta">
            <span class="badge badge-blue" title="Appears in ${o._count} record${o._count!==1?'s':''}">×${o._count}</span>
            ${o._sources.map(s => `<span class="badge">${esc(s)}</span>`).join('')}
            ${o._similar_to.length ? `<span class="badge badge-warning" title="May be same as: ${o._similar_to.map(j=>_wizardOrgs[j]?.name||'?').join(', ')}">⚠ similar</span>` : ''}
          </div>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('wizardCheckAll').addEventListener('change', e => {
    _wizardOrgs.forEach(o => o._included = e.target.checked);
    document.querySelectorAll('.wd-check').forEach(cb => cb.checked = e.target.checked);
    document.querySelectorAll('.wizard-detect-row').forEach(row =>
      row.classList.toggle('wd-excluded', !e.target.checked)
    );
  });
}

window.wizardToggle = function(wid) {
  const o = _wizardOrgs.find(x => x._id === wid);
  if (o) {
    o._included = !o._included;
    document.querySelector(`.wizard-detect-row[data-wid="${wid}"]`)
      ?.classList.toggle('wd-excluded', !o._included);
  }
};

window.wizardRename = function(wid, newName) {
  const o = _wizardOrgs.find(x => x._id === wid);
  if (o) o.name = newName.trim() || o.name;
};

function saveStep1() {
  // Collect any renamed values from inputs
  document.querySelectorAll('.wd-name').forEach(inp => {
    const wid = parseInt(inp.dataset.wid);
    const o   = _wizardOrgs.find(x => x._id === wid);
    if (o && inp.value.trim()) o.name = inp.value.trim();
  });
}

// ── Wizard Step 2: Merge similar pairs ───────────────────────────────────────

function renderWizardStep2() {
  const included = _wizardOrgs.filter(o => o._included);
  const pairs = [];
  const seen  = new Set();

  included.forEach(o => {
    o._similar_to.forEach(j => {
      const other = _wizardOrgs[j];
      if (!other?._included) return;
      const key = [Math.min(o._id, other._id), Math.max(o._id, other._id)].join('-');
      if (!seen.has(key)) { seen.add(key); pairs.push([o, other]); }
    });
  });

  if (!pairs.length) {
    wizardBody.innerHTML = `
      <div style="text-align:center;padding:40px;">
        <div style="font-size:28px;margin-bottom:10px;">✅</div>
        <div style="font-weight:600;margin-bottom:6px;">No similar organizations detected</div>
        <div style="color:var(--text-muted);font-size:13px;">All ${included.length} organizations appear to be distinct. Continue to Step 3.</div>
      </div>
    `;
    return;
  }

  wizardBody.innerHTML = `
    <div class="wizard-step-header">
      <div style="font-size:13px;color:var(--text-muted);">
        <strong>${pairs.length}</strong> potential duplicate pair${pairs.length!==1?'s':''} detected.
        Decide whether to keep both or merge each pair.
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:12px;padding:4px 0;">
      ${pairs.map(([a, b], i) => `
        <div class="wizard-merge-pair" id="wp-${i}">
          <div class="wmp-names">
            <span class="wmp-name">${esc(a.name)}</span>
            <span class="wmp-vs">vs</span>
            <span class="wmp-name">${esc(b.name)}</span>
          </div>
          <div class="wmp-actions">
            <button class="btn btn-sm btn-ghost" onclick="wizardMerge(${a._id},${b._id},'${a._id}',${i})">
              Keep "${esc(a.name.length > 20 ? a.name.slice(0,20)+'…' : a.name)}"
            </button>
            <button class="btn btn-sm btn-ghost" onclick="wizardMerge(${a._id},${b._id},'${b._id}',${i})">
              Keep "${esc(b.name.length > 20 ? b.name.slice(0,20)+'…' : b.name)}"
            </button>
            <button class="btn btn-sm btn-outline" onclick="wizardKeepBoth(${i})">
              Keep Both
            </button>
          </div>
          <div class="wmp-resolved hidden" id="wmp-res-${i}"></div>
        </div>
      `).join('')}
    </div>
  `;
}

window.wizardMerge = function(aId, bId, keepIdStr, pairIdx) {
  const keepId   = parseInt(keepIdStr);
  const absorbId = keepId === aId ? bId : aId;
  const keeper   = _wizardOrgs.find(o => o._id === keepId);
  const absorbed = _wizardOrgs.find(o => o._id === absorbId);
  if (!keeper || !absorbed) return;

  // Merge: absorbed name → alternate_name of keeper
  if (!keeper.alternate_name) keeper.alternate_name = absorbed.name;
  if (!keeper.abbreviation && absorbed.name.length <= 8) keeper.abbreviation = absorbed.name;
  // Merge contacts
  absorbed._suggested.forEach(c => {
    if (!keeper._suggested.some(x => x.name === c.name)) keeper._suggested.push(c);
  });
  if (!keeper.primary_contact && absorbed.primary_contact) {
    keeper.primary_contact = absorbed.primary_contact;
    keeper.contact_email   = absorbed.contact_email;
  }
  absorbed._included = false;

  // Update UI
  const pairEl = document.getElementById(`wp-${pairIdx}`);
  if (pairEl) {
    pairEl.style.opacity = '0.5';
    const res = document.getElementById(`wmp-res-${pairIdx}`);
    if (res) {
      res.textContent = `✓ Merged "${absorbed.name}" into "${keeper.name}"`;
      res.classList.remove('hidden');
    }
    pairEl.querySelectorAll('button').forEach(b => b.disabled = true);
  }
};

window.wizardKeepBoth = function(pairIdx) {
  const pairEl = document.getElementById(`wp-${pairIdx}`);
  if (pairEl) {
    pairEl.style.opacity = '0.5';
    const res = document.getElementById(`wmp-res-${pairIdx}`);
    if (res) { res.textContent = '✓ Keeping both'; res.classList.remove('hidden'); }
    pairEl.querySelectorAll('button').forEach(b => b.disabled = true);
  }
};

// ── Wizard Step 3: Assign primary contacts ────────────────────────────────────

let _namesCache = [];

async function renderWizardStep3() {
  const included = _wizardOrgs.filter(o => o._included);
  const missing  = included.filter(o => !o.primary_contact);

  // Pre-load names for autocomplete
  if (!_namesCache.length) {
    try {
      const j = await apiFetch('/api/autocomplete/names');
      _namesCache = j.data || [];
    } catch {}
  }

  wizardSkipBtn.style.display = missing.length ? '' : 'none';

  const listId = `sf-list-names`;
  wizardBody.innerHTML = `
    <div class="wizard-step-header">
      <div style="font-size:13px;color:var(--text-muted);">
        Each organization needs a primary contact.
        ${missing.length ? `<span style="color:var(--danger);font-weight:600;">${missing.length} still need one.</span>` : '<span style="color:#16a34a;">All have a contact ✓</span>'}
      </div>
    </div>
    <datalist id="${listId}">
      ${_namesCache.map(n => `<option value="${esc(n)}">`).join('')}
    </datalist>
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${included.map(o => `
        <div class="wizard-contact-row ${!o.primary_contact ? 'needs-contact' : ''}">
          <div class="wcr-name">
            <strong>${esc(o.name)}</strong>
            ${o.abbreviation ? `<span class="badge badge-blue" style="margin-left:6px;">${esc(o.abbreviation)}</span>` : ''}
          </div>
          <div class="wcr-fields">
            <input type="text" placeholder="Primary contact name…"
                   value="${esc(o.primary_contact)}" list="${listId}"
                   class="wiz-contact-inp" data-wid="${o._id}"
                   onchange="wizardSetContact(${o._id},'name',this.value)">
            <input type="email" placeholder="Email…"
                   value="${esc(o.contact_email)}"
                   class="wiz-email-inp" data-wid="${o._id}"
                   onchange="wizardSetContact(${o._id},'email',this.value)">
          </div>
          ${o._suggested.length ? `
            <div class="wcr-suggestions">
              Suggestions:
              ${o._suggested.slice(0,3).map(c => `
                <button class="btn btn-sm btn-ghost" style="font-size:11px;padding:2px 6px;"
                        onclick="wizardPickContact(${o._id},'${esc(c.name)}','${esc(c.email)}')">
                  ${esc(c.name)}
                </button>
              `).join('')}
            </div>
          ` : ''}
        </div>
      `).join('')}
    </div>
  `;
}

window.wizardSetContact = function(wid, field, value) {
  const o = _wizardOrgs.find(x => x._id === wid);
  if (!o) return;
  if (field === 'name') o.primary_contact = value.trim();
  if (field === 'email') o.contact_email = value.trim();
  // Update missing-contact highlight
  const row = document.querySelector(`.wizard-contact-row [data-wid="${wid}"]`)?.closest('.wizard-contact-row');
  if (row) row.classList.toggle('needs-contact', !o.primary_contact);
};

window.wizardPickContact = function(wid, name, email) {
  const o = _wizardOrgs.find(x => x._id === wid);
  if (!o) return;
  o.primary_contact = name;
  o.contact_email   = email;
  const row = document.querySelector(`.wiz-contact-inp[data-wid="${wid}"]`)?.closest('.wizard-contact-row');
  if (row) {
    row.querySelector('.wiz-contact-inp').value = name;
    row.querySelector('.wiz-email-inp').value   = email;
    row.classList.remove('needs-contact');
  }
};

function saveStep3() {
  document.querySelectorAll('.wiz-contact-inp').forEach(inp => {
    const wid = parseInt(inp.dataset.wid);
    const o   = _wizardOrgs.find(x => x._id === wid);
    if (o) o.primary_contact = inp.value.trim();
  });
  document.querySelectorAll('.wiz-email-inp').forEach(inp => {
    const wid = parseInt(inp.dataset.wid);
    const o   = _wizardOrgs.find(x => x._id === wid);
    if (o) o.contact_email = inp.value.trim();
  });
}

// ── Wizard Step 4: Confirm & write ───────────────────────────────────────────

function renderWizardStep4() {
  const included = _wizardOrgs.filter(o => o._included);
  const noContact = included.filter(o => !o.primary_contact);

  wizardBody.innerHTML = `
    <div class="wizard-step-header">
      <div style="font-size:13px;color:var(--text-muted);">
        Ready to write <strong>${included.length}</strong> organization${included.length!==1?'s':''} to the sheet.
        ${noContact.length ? `<span style="color:#f59e0b;"> ⚠ ${noContact.length} have no primary contact yet.</span>` : ''}
      </div>
    </div>
    <div style="overflow-x:auto;margin-bottom:16px;">
      <table class="data-table" style="font-size:12px;">
        <thead>
          <tr><th>Name</th><th>Abbrev.</th><th>Alternate Name</th><th>Primary Contact</th><th>Email</th></tr>
        </thead>
        <tbody>
          ${included.map(o => `
            <tr ${!o.primary_contact ? 'style="background:#fef9c3"' : ''}>
              <td><strong>${esc(o.name)}</strong></td>
              <td>${esc(o.abbreviation)}</td>
              <td>${esc(o.alternate_name)}</td>
              <td>${o.primary_contact ? esc(o.primary_contact) : '<span style="color:#f59e0b;">⚠ missing</span>'}</td>
              <td>${esc(o.contact_email)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:flex-end;padding:4px 0 8px;">
      <div style="flex:1;font-size:12px;color:var(--text-muted);align-self:center;">
        Choose how to write: <em>Append</em> adds only new orgs; <em>Replace</em> clears existing data and rewrites.
      </div>
      <button class="btn btn-outline" id="wizardAppendBtn">+ Append New Only</button>
      <button class="btn btn-primary" id="wizardReplaceBtn">↺ Replace All</button>
    </div>
  `;

  async function doWrite(appendOnly) {
    const payload = _wizardOrgs.filter(o => o._included).map(o => ({
      name:            o.name,
      abbreviation:    o.abbreviation,
      alternate_name:  o.alternate_name,
      primary_contact: o.primary_contact,
      contact_email:   o.contact_email,
      website:         o.website,
      location:        o.location,
      description:     o.description,
      image_url:       o.image_url,
    }));
    try {
      const res = await apiFetch('/api/organizations/populate', {
        method: 'POST',
        body: JSON.stringify({ organizations: payload, append_only: appendOnly }),
      });
      orgWizard.classList.add('hidden');
      toast(`Written ${res.data.written} organization${res.data.written!==1?'s':''} to sheet 🎉`, 'success');
      EventBus.emit('orgs:changed');
      loadOrgs();
    } catch (err) { toast('Write failed: ' + err.message, 'error'); }
  }

  document.getElementById('wizardAppendBtn').addEventListener('click', () => doWrite(true));
  document.getElementById('wizardReplaceBtn').addEventListener('click', () => {
    if (!confirm('This will clear all existing organization data in the sheet and rewrite. Continue?')) return;
    doWrite(false);
  });
}

// Skip button (step 3 only — continue with missing contacts)
wizardSkipBtn.addEventListener('click', () => {
  saveStep3();
  goToStep(4);
});

// ── Init ──────────────────────────────────────────────────────────────────────

EventBus.on('app:ready', loadOrgs);
EventBus.on('tab:changed', ({ tab }) => { if (tab === 'orgs') loadOrgs(); });
EventBus.on('data:synced', loadOrgs);
