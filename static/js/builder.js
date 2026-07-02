/**
 * builder.js — Newsletter Builder tab.
 * Handles section palette, drag-and-drop canvas, section editor, image upload,
 * live preview, and HTML export.
 */

// ── Section metadata ──────────────────────────────────────────────────────────

const DEFAULT_EVENT_ICON = 'https://i.ibb.co/FLvxMqfJ/10691802.png';

// Registry drives the palette, canvas badges, and domain grouping.
// domain: 'content' | 'data' | 'meta'
const SECTION_REGISTRY = [
  { id: 'hero',               label: '📸 Header',               domain: 'content', desc: 'Opening image with title and body text' },
  { id: 'meeting_highlights', label: '📋 Recap',                domain: 'content', desc: 'Bulleted summary of key meeting points' },
  { id: 'narrative',          label: '📝 Narrative Section',    domain: 'content', desc: 'Long-form paragraphs with optional callout' },
  { id: 'actions_list',       label: '✅ Actions for Network',  domain: 'content', desc: 'Action items and todos' },
  { id: 'highlight_event',    label: '📌 Highlight Event',      domain: 'data',    desc: 'Single featured event from your dataset' },
  { id: 'event_grid',         label: '📅 Event Grid',           domain: 'data',    desc: 'Grid of events selected from your dataset' },
  { id: 'attendee_list',      label: '👥 People in the Room',   domain: 'data',    desc: 'Meeting attendance list from contacts' },
  { id: 'flyer_grid',         label: '🖼 Image Gallery',         domain: 'data',    desc: 'Images from your library — filter by tag to show only fliers, headshots, etc.' },
  { id: 'job_grid',           label: '💼 Job Opportunities',     domain: 'data',    desc: 'Grid of job listings from your Jobs board — filter by tag or pick specific jobs' },
  { id: 'attached_resource',  label: '📎 Attached Resource',    domain: 'data',    desc: 'Display a PDF attachment with a generated page preview graphic' },
  { id: 'presenter_cta',      label: '🎤 Present at a Meeting', domain: 'data',    desc: 'Speaker recruitment with contacts' },
  { id: 'directory_cta',      label: '🔗 Link / Button',        domain: 'meta',    desc: 'Call-to-action linking to network directory' },
  { id: 'footer',             label: '📧 Footer',               domain: 'meta',    desc: 'Email footer from settings' },
];

const DOMAIN_META = {
  content: { label: 'Content',          color: '#2563eb' },
  data:    { label: 'Data-Driven',      color: '#0f766e' },
  meta:    { label: 'Meta & Structure', color: '#7c3aed' },
};

// Flat label map (includes legacy meeting_schedule for loaded old projects)
const SECTION_LABELS = Object.fromEntries(SECTION_REGISTRY.map(r => [r.id, r.label]));
SECTION_LABELS['meeting_schedule'] = '🗓 Meeting Schedule (legacy)';

// ── State ─────────────────────────────────────────────────────────────────────

// Dual-canvas state — each language has its own independent editable section list.
// _sections is always the LIVE editing array for the active language.
// Call _syncActiveLang() before any operation that reads _sectionsEn/_sectionsEs directly.
let _sections        = [];   // Live editing array (active canvas)
let _sectionsEn      = [];   // Stored EN canvas snapshot
let _sectionsEs      = [];   // Stored ES canvas snapshot
let _activeLang      = 'en'; // 'en' | 'es'
let _selected        = null; // id of selected section
let _presets         = [];   // Loaded from /api/presets
let _builderEvents   = [];   // Cached from /api/events for pickers
let _builderContacts = [];   // Cached from /api/contacts for pickers
let _lastRender      = { html_en: null, html_es: null }; // Cached render output
let _builderResources = [];  // Cached from /api/resources for the attached_resource picker

// ── DOM refs ──────────────────────────────────────────────────────────────────

const palette     = document.getElementById('sectionPalette');
const canvas      = document.getElementById('builderCanvas');
const canvasHint  = document.getElementById('canvasHint');
const editor      = document.getElementById('sectionEditor');
const nlMonth     = document.getElementById('nlMonth');
const nlSubtitle  = document.getElementById('nlSubtitle');
const nlLang      = document.getElementById('nlLang');

// ── Build palette ─────────────────────────────────────────────────────────────

function buildPalette() {
  palette.innerHTML = '';

  // Group registry entries by domain
  const grouped = {};
  for (const reg of SECTION_REGISTRY) {
    (grouped[reg.domain] ??= []).push(reg);
  }

  for (const [domain, entries] of Object.entries(grouped)) {
    const meta = DOMAIN_META[domain];
    const groupLabel = document.createElement('div');
    groupLabel.className = 'palette-section-label';
    groupLabel.innerHTML = `<span class="palette-domain-dot" style="background:${meta.color};"></span>${meta.label}`;
    palette.appendChild(groupLabel);

    for (const reg of entries) {
      const item = document.createElement('div');
      item.className = 'palette-item';
      item.draggable = true;
      item.title = reg.desc;
      item.innerHTML = `${reg.label}<span class="palette-domain-badge" style="background:${meta.color}22;color:${meta.color};">${domain}</span>`;
      item.dataset.sectionType = reg.id;
      item.addEventListener('dragstart', e => {
        e.dataTransfer.setData('palette/section-type', reg.id);
        e.dataTransfer.effectAllowed = 'copy';
      });
      item.addEventListener('dblclick', () => addSection(reg.id));
      palette.appendChild(item);
    }
  }

  // Presets
  if (_presets.length > 0) {
    const presetsLabel = document.createElement('div');
    presetsLabel.className = 'palette-section-label';
    presetsLabel.textContent = 'My Presets';
    palette.appendChild(presetsLabel);

    _presets.forEach(preset => {
      const item = document.createElement('div');
      item.className = 'palette-item palette-item-preset';
      item.draggable = true;
      item.innerHTML = `${esc(preset.name)} <span class="preset-del" title="Delete preset" data-id="${preset.id}">✕</span>`;
      item.dataset.presetId = preset.id;

      item.addEventListener('dragstart', e => {
        e.dataTransfer.setData('palette/preset-id', preset.id);
        e.dataTransfer.effectAllowed = 'copy';
      });
      item.addEventListener('dblclick', () => addSectionFromPreset(preset));
      item.querySelector('.preset-del').addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm(`Delete preset "${preset.name}"?`)) return;
        await fetch(`/api/presets/${preset.id}`, { method: 'DELETE' });
        await loadPresets();
      });
      palette.appendChild(item);
    });
  }
}

async function loadPresets() {
  try {
    const res = await fetch('/api/presets');
    const json = await res.json();
    if (json.ok) { _presets = json.data; buildPalette(); }
  } catch (e) { console.error('loadPresets:', e); }
}

function addSectionFromPreset(preset) {
  const section = {
    id: uid(),
    section_type: preset.section_type,
    data: JSON.parse(JSON.stringify(preset.data)), // deep clone
  };
  _sections.push(section);
  renderCanvas();
  selectSection(section.id);
}

buildPalette();

// ── Canvas drag/drop ──────────────────────────────────────────────────────────

canvas.addEventListener('dragover', e => {
  e.preventDefault();
  // Canvas sections use effectAllowed='move'; palette items use 'copy'.
  // Mismatching dropEffect causes the browser to silently refuse the drop.
  e.dataTransfer.dropEffect = e.dataTransfer.types.includes('canvas/section-id') ? 'move' : 'copy';
});

canvas.addEventListener('drop', e => {
  e.preventDefault();
  const type     = e.dataTransfer.getData('palette/section-type');
  const presetId = e.dataTransfer.getData('palette/preset-id');
  const fromId   = e.dataTransfer.getData('canvas/section-id');

  if (type) {
    addSection(type);
  } else if (presetId) {
    const preset = _presets.find(p => p.id === presetId);
    if (preset) addSectionFromPreset(preset);
  } else if (fromId) {
    const target = e.target.closest('.canvas-section');
    if (target && target.dataset.id !== fromId) {
      const rect = target.getBoundingClientRect();
      const insertBefore = e.clientY < rect.top + rect.height / 2;
      reorderSection(fromId, target.dataset.id, insertBefore);
    } else if (!target) {
      // Dropped on empty canvas area below all cards — move to end
      const from = _sections.findIndex(s => s.id === fromId);
      if (from >= 0) { const [item] = _sections.splice(from, 1); _sections.push(item); renderCanvas(); }
    }
  }
});

// ── Section management ────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function addSection(type) {
  const section = { id: uid(), section_type: type, data: defaultData(type) };
  _sections.push(section);
  renderCanvas();
  selectSection(section.id);
}

function removeSection(id) {
  const idx = _sections.findIndex(s => s.id === id);
  if (idx >= 0) _sections.splice(idx, 1);
  if (_selected === id) { _selected = null; renderEditor(null); }
  renderCanvas();
}

// insertBefore=true → place before target, false → place after
function reorderSection(fromId, targetId, insertBefore = true) {
  const from = _sections.findIndex(s => s.id === fromId);
  if (from < 0) return;
  const [item] = _sections.splice(from, 1);
  const to = _sections.findIndex(s => s.id === targetId);
  if (to < 0) { _sections.push(item); } // dropped past last card
  else { _sections.splice(insertBefore ? to : to + 1, 0, item); }
  renderCanvas();
}

function selectSection(id) {
  _selected = id;
  document.querySelectorAll('.canvas-section').forEach(el => {
    el.classList.toggle('selected', el.dataset.id === id);
  });
  const section = _sections.find(s => s.id === id);
  renderEditor(section);
}

// ── Canvas render ─────────────────────────────────────────────────────────────

function renderCanvas() {
  const items = canvas.querySelectorAll('.canvas-section');
  items.forEach(el => el.remove());
  canvasHint.style.display = _sections.length ? 'none' : '';

  _sections.forEach(section => {
    const el = document.createElement('div');
    el.className = 'canvas-section' + (_selected === section.id ? ' selected' : '');
    el.dataset.id = section.id;
    el.draggable = true;

    const reg = SECTION_REGISTRY.find(r => r.id === section.section_type);
    const domainColor = reg ? DOMAIN_META[reg.domain]?.color : '#6b7280';
    const typeLabel = SECTION_LABELS[section.section_type] || section.section_type;
    const contentTitle = section.data?.title || section.data?.event_title || section.data?.text || null;
    el.innerHTML = `
      <span class="canvas-section-handle" title="Drag to reorder">⠿</span>
      <span style="flex:1;min-width:0;overflow:hidden;">
        <div class="canvas-section-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${contentTitle ? esc(contentTitle) : typeLabel}</div>
        ${contentTitle ? `<div class="canvas-section-type">${typeLabel}</div>` : ''}
      </span>
      <span class="canvas-domain-badge" style="background:${domainColor}22;color:${domainColor};">${reg?.domain ?? ''}</span>
      <button class="canvas-section-del" title="Remove" onclick="event.stopPropagation();removeSection('${section.id}')">✕</button>
    `;

    el.addEventListener('click', () => selectSection(section.id));

    // StatusBar hint on hover
    if (reg) {
      el.addEventListener('mouseenter', () => StatusBar.set(`${reg.label} — ${reg.desc}`));
      el.addEventListener('mouseleave', () => StatusBar.reset());
    }

    el.addEventListener('dragstart', e => {
      e.dataTransfer.setData('canvas/section-id', section.id);
      e.dataTransfer.effectAllowed = 'move';
    });

    el.addEventListener('dragover', e => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      el.classList.toggle('drag-over-top',    before);
      el.classList.toggle('drag-over-bottom', !before);
    });

    el.addEventListener('dragleave', () => {
      el.classList.remove('drag-over-top', 'drag-over-bottom');
    });
    el.addEventListener('drop', e => {
      el.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    canvas.appendChild(el);
  });
}

// ── Default data per section type ────────────────────────────────────────────

function defaultData(type) {
  const d = {
    hero:               { image_url: '', title: 'What this meeting was about', body_paragraphs: [''], group_email: '' },
    meeting_highlights: { title: 'Meeting highlights', items: [''] },
    event_grid:         { title: 'Upcoming Events', subtitle: '', events: [], source_row_indexes: [], include_recurring: false, cta_url: '', cta_label: 'View or Add Events', sort_by_date: true, compact_blocks: false, show_org: true, show_address: true, show_time: true, show_notes: true, shorten_address: false, columns: 2 },
    highlight_event:    { row_index: null, event_title: '', event_days: '', event_time: '', event_location: '', event_virtual_location: '', event_icon_url: DEFAULT_EVENT_ICON, title_override: '', subtitle: '', cta_url: '', cta_label: 'Join Now', note: '' },
    meeting_schedule:   { title: 'Upcoming Network Meetings', subtitle: '', meetings: [{ format: '', date: '' }], zoom_url: '', note: '' },
    narrative:          { icon_url: '', title: '', body_paragraphs: [''], items: [], callout: null, rich_content: '' },
    attendee_list:      { meeting_date: '', attendees: [], note: 'Listing based on combined notes.', footer_note: '' },
    flyer_grid:         { title: 'Flyers & Community Resources', subtitle: '', images: [], layout: 'grid', tag_filter: '' },
    job_grid:           { title: 'Job Opportunities', subtitle: '', job_ids: [], tag_filter: '', show_pay: true, show_close_date: true, show_contact: true, cta_url: '', cta_label: '' },
    attached_resource:  { resource_id: '', title: '', subtitle: '', caption: 'Full PDF attached below', show_graphic: true, graphic_image_id: null, graphic_url: '', pages_shown: [0, 1] },
    actions_list:       { title: 'Actions for the network', items: [''] },
    directory_cta:      { text: '', url: '', btn_label: 'Open Network Directory' },
    presenter_cta:      { contacts: [], signup_url: '' },
    footer:             {},
  };
  return d[type] || {};
}

// ── Event data helpers ────────────────────────────────────────────────────────

async function loadBuilderEvents() {
  try {
    const res = await fetch('/api/events?per_page=9999&page=1&q=');
    const json = await res.json();
    _builderEvents = json.data || [];
  } catch (e) { console.error('loadBuilderEvents:', e); }
}

async function loadBuilderContacts() {
  try {
    const json = await fetch('/api/contacts?per_page=9999').then(r => r.json());
    _builderContacts = json.data || [];
  } catch (e) { console.error('loadBuilderContacts:', e); }
}

async function loadBuilderResources() {
  try {
    const json = await fetch('/api/resources').then(r => r.json());
    _builderResources = json.ok ? json.data : [];
  } catch (e) { console.error('loadBuilderResources:', e); }
}

/**
 * Parse a date from an event's "days" label string.
 * Handles formats like "March 5, 2026", "Monday, March 5, 2026", "Sat, Apr 12 2026".
 * Returns a Date object, or null if the string has no recognisable date.
 */
function _parseDateFromLabel(label) {
  if (!label) return null;
  // Strip leading day-of-week ("Monday, " / "Mon, ")
  const clean = label.replace(/^[A-Za-z]+,?\s+/, '');
  const d = new Date(clean);
  return isNaN(d.getTime()) ? null : d;
}

// Remove ZIP code, state (Oregon/OR), and country from an address string
function shortenAddress(addr) {
  if (!addr) return addr;
  return addr
    .replace(/,?\s*\d{5}(-\d{4})?/g, '')           // ZIP / ZIP+4
    .replace(/,?\s*(Oregon|OR)\b/gi, '')             // Oregon or OR
    .replace(/,?\s*(United States|USA?)\b/gi, '')    // US/USA/United States
    .replace(/,\s*,/g, ',')                          // double commas
    .replace(/,\s*$/,'')                             // trailing comma
    .trim();
}

// Convert a raw event (from API) into the display-ready shape the jinja template expects
function eventToDisplayItem(ev, shorten = false) {
  const time = [ev.start_time, ev.end_time].filter(Boolean).join(' – ');
  const location = shorten ? shortenAddress(ev.location || '') : (ev.location || '');
  return {
    row_index:  ev.row_index,
    date_label: ev.days,
    title:      ev.title,
    org:        ev.organization,
    time_range: time,
    location,
    description: ev.description || '',
    link:       ev.virtual_location || '',
    link_label: ev.virtual_location ? 'Join' : '',
    icon_url:   ev.icon_url || DEFAULT_EVENT_ICON,
    color:      ev.color || '#2563eb',
  };
}

// Snapshot an event into the highlight_event section data shape
function eventToHighlightData(ev) {
  const time = [ev.start_time, ev.end_time].filter(Boolean).join(' – ');
  return {
    row_index:              ev.row_index,
    event_title:            ev.title,
    event_days:             ev.days,
    event_time:             time,
    event_location:         ev.location || '',
    event_virtual_location: ev.virtual_location || '',
    event_icon_url:         ev.icon_url || DEFAULT_EVENT_ICON,
    title_override:         '',
    subtitle:               '',
    cta_url:                ev.virtual_location || '',
    cta_label:              'Join Now',
    note:                   '',
  };
}

// ── Section editor ────────────────────────────────────────────────────────────

function renderEditor(section) {
  if (!section) {
    editor.innerHTML = '<div class="editor-placeholder">Select a section on the canvas to edit it</div>';
    return;
  }
  editor.innerHTML = `
    <div class="editor-section-title">${SECTION_LABELS[section.section_type]}</div>
    <div id="editorFields">${buildEditorFields(section)}</div>
    <div style="margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn btn-outline btn-sm" onclick="saveEditorFields()">Apply</button>
      <button class="btn btn-ghost btn-sm" onclick="previewSection()">Preview</button>
      <button class="btn btn-ghost btn-sm" onclick="saveAsPreset()">⭐ Save as Preset</button>
    </div>
  `;
  SmartFields.initAll(editor);
  if (section.section_type === 'flyer_grid')       _populateFlyerTagSuggestions();
  if (section.section_type === 'job_grid')         _populateJobTagSuggestions();
  if (section.section_type === 'attendee_list')    _populateAttendeeTagSuggestions();
  if (section.section_type === 'attached_resource') _initResourceEditor(section);
}

function buildEditorFields(section) {
  const d = section.data;
  switch (section.section_type) {
    case 'hero': return `
      ${SmartFields.imagePicker('Hero Image', 'ed-image_url', d.image_url)}
      ${edField('Title', 'ed-title', d.title)}
      ${edTextarea('Body (one paragraph per line)', 'ed-body_paragraphs', (d.body_paragraphs || []).join('\n'))}
      ${edField('Group Email', 'ed-group_email', d.group_email)}
    `;
    case 'meeting_highlights': return `
      ${edField('Section Title', 'ed-title', d.title)}
      ${edTextarea('Bullet Points (one per line)', 'ed-items', (d.items || []).join('\n'))}
    `;
    case 'highlight_event': {
      const selected = d.row_index;
      const isRecurring = ev => !ev.days || !/\d{4}/.test(ev.days);
      const evList = _builderEvents.filter(ev => !isRecurring(ev));
      return `
        <div class="form-field">
          <label>Pick Event from Dataset</label>
          <input type="text" id="ed-event-search" placeholder="Search events…" oninput="filterHighlightEventList(this.value)"
                 style="margin-bottom:6px;">
          <div id="ed-highlight-list" class="event-pick-list">
            ${evList.length === 0
              ? `<div class="event-pick-empty">No dated events loaded. Save and reopen to refresh.</div>`
              : evList.map(ev => `
                  <label class="event-pick-item${ev.row_index === selected ? ' selected' : ''}" data-row="${ev.row_index}">
                    <input type="radio" name="ed-highlight-pick" value="${ev.row_index}" ${ev.row_index === selected ? 'checked' : ''}>
                    <img src="${esc(ev.icon_url || DEFAULT_EVENT_ICON)}" width="32" height="32" style="border-radius:6px;flex-shrink:0;">
                    <div style="min-width:0;">
                      <div class="event-pick-name">${esc(ev.title)}</div>
                      <div class="event-pick-meta">${esc(ev.days)} · ${esc(ev.organization)}</div>
                    </div>
                  </label>`).join('')}
          </div>
        </div>
        <hr style="border:none;border-top:1px solid var(--border);margin:12px 0;">
        <div style="font-size:11px;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;">Override / Customize</div>
        ${edField('Title Override (leave blank to use event title)', 'ed-title_override', d.title_override)}
        ${edField('Subtitle', 'ed-subtitle', d.subtitle)}
        ${edField('CTA URL (leave blank to use event join link)', 'ed-cta_url', d.cta_url)}
        ${edField('CTA Label', 'ed-cta_label', d.cta_label)}
        ${edField('Note (shown below CTA)', 'ed-note', d.note)}
      `;
    }
    case 'event_grid': {
      const selected = new Set(d.source_row_indexes || []);
      const includeRec   = d.include_recurring || false;
      const showNotes    = d.show_notes !== false;       // default true
      const shortenAddr  = d.shorten_address || false;
      const cols         = d.columns || 2;
      return `
        ${edField('Section Title', 'ed-title', d.title)}
        ${edField('Subtitle', 'ed-subtitle', d.subtitle)}
        ${edField('CTA URL', 'ed-cta_url', d.cta_url)}
        ${edField('CTA Label', 'ed-cta_label', d.cta_label)}
        <div class="form-field">
          <label>Display Options</label>
          <div style="display:flex;flex-direction:column;gap:6px;">
            <label style="font-size:13px;display:flex;align-items:center;gap:6px;">
              <input type="checkbox" id="ed-sort-by-date" ${(d.sort_by_date !== false) ? 'checked' : ''}>
              Sort events by date (undated / recurring go last)
            </label>
            <label style="font-size:13px;display:flex;align-items:center;gap:6px;">
              <input type="checkbox" id="ed-compact-blocks" ${d.compact_blocks ? 'checked' : ''}>
              Compact blocks (fixed card height — clips overflow text)
            </label>
            <div style="height:1px;background:var(--border);margin:2px 0;"></div>
            <label style="font-size:13px;display:flex;align-items:center;gap:6px;">
              <input type="checkbox" id="ed-show-org" ${(d.show_org !== false) ? 'checked' : ''}>
              Show organization
            </label>
            <label style="font-size:13px;display:flex;align-items:center;gap:6px;">
              <input type="checkbox" id="ed-show-time" ${(d.show_time !== false) ? 'checked' : ''}>
              Show time
            </label>
            <label style="font-size:13px;display:flex;align-items:center;gap:6px;">
              <input type="checkbox" id="ed-show-address" ${(d.show_address !== false) ? 'checked' : ''}>
              Show address / location
            </label>
            <label style="font-size:13px;display:flex;align-items:center;gap:6px;padding-left:18px;color:var(--text-muted);">
              <input type="checkbox" id="ed-shorten-addr" ${shortenAddr ? 'checked' : ''}>
              Shorten address (remove ZIP, state, country)
            </label>
            <label style="font-size:13px;display:flex;align-items:center;gap:6px;">
              <input type="checkbox" id="ed-show-notes" ${showNotes ? 'checked' : ''}>
              Show notes / description
            </label>
          </div>
        </div>
        <div class="form-field">
          <label>Columns</label>
          <select id="ed-columns">
            <option value="1" ${cols===1?'selected':''}>1 column</option>
            <option value="2" ${cols===2?'selected':''}>2 columns</option>
            <option value="3" ${cols===3?'selected':''}>3 columns</option>
          </select>
        </div>
        <div class="form-field">
          <label>Select Events</label>
          <div style="display:flex;gap:10px;align-items:center;margin-bottom:8px;">
            <input type="text" id="ed-grid-search" placeholder="Filter…" oninput="filterEventGridList(this.value)" style="flex:1;">
            <label style="font-size:12px;display:flex;align-items:center;gap:4px;white-space:nowrap;">
              <input type="checkbox" id="ed-include-recurring" ${includeRec ? 'checked' : ''}> Recurring
            </label>
          </div>
          <div id="ed-grid-list" class="event-pick-list">
            ${_builderEvents.length === 0
              ? `<div class="event-pick-empty">No events loaded yet. Save and reopen to refresh.</div>`
              : _builderEvents.map(ev => `
                  <label class="event-pick-item${selected.has(ev.row_index) ? ' selected' : ''}" data-row="${ev.row_index}">
                    <input type="checkbox" name="ed-grid-pick" value="${ev.row_index}" ${selected.has(ev.row_index) ? 'checked' : ''}>
                    <img src="${esc(ev.icon_url || DEFAULT_EVENT_ICON)}" width="28" height="28" style="border-radius:4px;flex-shrink:0;">
                    <div style="min-width:0;">
                      <div class="event-pick-name">${esc(ev.title)}</div>
                      <div class="event-pick-meta">${esc(ev.days || 'Recurring')} · ${esc(ev.organization)}</div>
                    </div>
                  </label>`).join('')}
          </div>
          <div id="ed-grid-count" style="font-size:11px;color:var(--text-muted);margin-top:4px;">
            ${selected.size} selected
          </div>
        </div>
      `;
    }
    case 'meeting_schedule': return `
      ${edField('Section Title', 'ed-title', d.title)}
      ${edField('Zoom URL', 'ed-zoom_url', d.zoom_url)}
      ${edTextarea('Meetings JSON [{format, date}]', 'ed-meetings', JSON.stringify(d.meetings || [], null, 2))}
      ${edField('Footer Note', 'ed-note', d.note)}
    `;
    case 'narrative': return `
      ${SmartFields.imagePicker('Icon / Image', 'ed-icon_url', d.icon_url)}
      ${edField('Section Title', 'ed-title', d.title)}
      <div class="form-field">
        <label>Rich Content</label>
        ${d.rich_content
          ? `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">✅ Rich content set — simple fields below are ignored on export.</div>`
          : `<div style="font-size:12px;color:var(--text-muted);margin-bottom:6px;">Using simple fields. Click Customize to build rich content.</div>`}
        <input type="hidden" id="ed-rich_content" value="${(d.rich_content || '').replace(/"/g, '&quot;')}">
        <button type="button" class="btn btn-outline btn-sm" onclick="openNarrativeCustomizer()">
          ✏ Customize content…
        </button>
        ${d.rich_content ? `<button type="button" class="btn btn-ghost btn-sm" style="margin-left:6px;color:var(--danger);"
          onclick="document.getElementById('ed-rich_content').value='';this.closest('.form-field').querySelector('[style*=✅]')?.remove();toast('Rich content cleared — using simple fields','info')">
          ✕ Clear rich content
        </button>` : ''}
      </div>
      <div style="border-top:1px solid var(--border);margin:10px 0 8px;opacity:.5;"></div>
      <div style="font-size:11px;color:var(--text-muted);margin-bottom:8px;font-weight:600;">SIMPLE FIELDS (used only when no rich content is set)</div>
      ${edTextarea('Body Paragraphs (one per line)', 'ed-body_paragraphs', (d.body_paragraphs || []).join('\n'))}
      ${edTextarea('Bullet Items (one per line)', 'ed-items', (d.items || []).join('\n'))}
      ${edTextarea('Callout JSON {title, body, bg, border, title_color, body_color}', 'ed-callout', d.callout ? JSON.stringify(d.callout, null, 2) : '')}
    `;
    case 'attendee_list': return `
      ${edField('Meeting Date', 'ed-meeting_date', d.meeting_date)}
      ${edField('Note', 'ed-note', d.note)}
      <div class="form-field">
        <label>Add People from Database</label>
        <div style="display:flex;gap:6px;margin-bottom:6px;">
          <input type="text" id="ed-attendee-search" placeholder="Search by name, org…"
                 style="flex:1;font-size:13px;" oninput="attendeeSearch(this.value)">
          <input type="text" id="ed-attendee-tag" placeholder="Tag filter (e.g. march)"
                 style="width:130px;font-size:13px;" list="ed-attendee-tag-suggestions">
          <datalist id="ed-attendee-tag-suggestions"></datalist>
          <button type="button" class="btn btn-sm btn-outline" onclick="attendeeLoadByTag()">🏷 Tag</button>
        </div>
        <div id="ed-attendee-pick-list" style="max-height:180px;overflow-y:auto;border:1px solid var(--border);
             border-radius:6px;font-size:13px;background:var(--surface);">
          <div style="padding:8px 12px;color:var(--text-muted);">Search or filter by tag to find people</div>
        </div>
        <button type="button" class="btn btn-sm btn-outline" style="margin-top:6px;"
                onclick="attendeeAddChecked()">➕ Add selected to list</button>
      </div>
      ${edTextarea('Attendees [{name, org}]', 'ed-attendees', JSON.stringify(d.attendees || [], null, 2))}
      ${edField('Footer Note', 'ed-footer_note', d.footer_note)}
    `;
    case 'flyer_grid': return `
      ${edField('Section Title', 'ed-title', d.title)}
      ${edField('Subtitle', 'ed-subtitle', d.subtitle)}
      <div class="form-field"><label>Layout</label>
        <select id="ed-layout">
          <option value="grid" ${d.layout==='grid'?'selected':''}>2-column grid</option>
          <option value="stack" ${d.layout==='stack'?'selected':''}>Single column stack</option>
        </select>
      </div>
      <div class="form-field">
        <label>Images</label>
        <div style="display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap;align-items:center;">
          <button type="button" class="btn btn-sm btn-outline" onclick="flyerPickImage()">📷 Add from Library</button>
          <button type="button" class="btn btn-sm btn-ghost" onclick="flyerLoadAll()">📥 Load all from Library</button>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:8px;align-items:center;">
          <input type="text" id="ed-tag-filter" placeholder="Tags: march, +march +2026, march -draft"
                 value="${esc(d.tag_filter || '')}"
                 style="flex:1;font-size:13px;"
                 list="ed-tag-filter-suggestions">
          <datalist id="ed-tag-filter-suggestions"></datalist>
          <button type="button" class="btn btn-sm btn-outline" onclick="flyerLoadByTag()">🏷 Load by Tag</button>
        </div>
        <textarea id="ed-images" style="font-size:12px;font-family:monospace;min-height:120px;">${JSON.stringify(d.images || [], null, 2)}</textarea>
      </div>
    `;
    case 'job_grid': return `
      ${edField('Section Title', 'ed-title', d.title)}
      ${edField('Subtitle', 'ed-subtitle', d.subtitle)}
      <div class="form-field">
        <label>Filter by Tag</label>
        <div style="display:flex;gap:6px;align-items:center;">
          <input type="text" id="ed-tag-filter" placeholder="e.g. bilingual, health, +hiring"
                 value="${esc(d.tag_filter || '')}" style="flex:1;font-size:13px;"
                 list="ed-tag-filter-suggestions">
          <datalist id="ed-tag-filter-suggestions"></datalist>
          <button type="button" class="btn btn-sm btn-outline" onclick="jobGridLoadByTag()">🏷 Preview</button>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:4px;">
          Leave blank to show all active jobs. Filter overrides specific job IDs.
        </div>
      </div>
      <div class="form-field">
        <label>Specific Job IDs <span style="font-weight:400;color:var(--text-muted);">(optional — overridden by tag filter)</span></label>
        <div style="display:flex;gap:6px;margin-bottom:6px;">
          <button type="button" class="btn btn-sm btn-outline" onclick="jobGridPickJobs()">💼 Pick Jobs…</button>
        </div>
        <textarea id="ed-job_ids" style="font-size:12px;font-family:monospace;min-height:60px;">${JSON.stringify(d.job_ids || [], null, 2)}</textarea>
      </div>
      <div class="form-field" style="display:flex;gap:16px;flex-wrap:wrap;">
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
          <input type="checkbox" id="ed-show_pay" ${d.show_pay !== false ? 'checked' : ''}> Show pay
        </label>
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
          <input type="checkbox" id="ed-show_close_date" ${d.show_close_date !== false ? 'checked' : ''}> Show deadline
        </label>
        <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
          <input type="checkbox" id="ed-show_contact" ${d.show_contact !== false ? 'checked' : ''}> Show contact
        </label>
      </div>
      ${edField('CTA URL', 'ed-cta_url', d.cta_url)}
      ${edField('CTA Label', 'ed-cta_label', d.cta_label)}
    `;
    case 'actions_list': return `
      ${edField('Section Title', 'ed-title', d.title)}
      ${edTextarea('Action Items (one per line)', 'ed-items', (d.items || []).join('\n'))}
    `;
    case 'directory_cta': return `
      ${edTextarea('Text', 'ed-text', d.text)}
      ${edField('URL', 'ed-url', d.url)}
      ${edField('Button Label', 'ed-btn_label', d.btn_label)}
    `;
    case 'presenter_cta': {
      return `
      ${edField('Signup URL', 'ed-signup_url', d.signup_url)}
      <div class="form-field">
        <label>Add Contacts from Database</label>
        <div style="display:flex;gap:6px;margin-bottom:6px;">
          <input type="text" id="ed-pres-search" placeholder="Search by name, org…"
                 style="flex:1;font-size:13px;" oninput="presContactSearch(this.value)">
          <button type="button" class="btn btn-sm btn-ghost" onclick="presContactSearch('')">Clear</button>
        </div>
        <div id="ed-pres-pick-list" style="max-height:160px;overflow-y:auto;border:1px solid var(--border);
             border-radius:6px;font-size:13px;background:var(--surface);">
          ${_builderContacts.length === 0
            ? '<div style="padding:8px 12px;color:var(--text-muted);">No contacts loaded yet</div>'
            : _builderContacts.map(c => `
                <label style="display:flex;align-items:center;gap:8px;padding:5px 10px;cursor:pointer;
                               border-bottom:1px solid var(--border);user-select:none;">
                  <input type="checkbox" name="pres-contact-pick"
                         data-name="${esc(c.name)}" data-email="${esc(c.email || '')}">
                  <span>
                    <span style="font-weight:600;">${esc(c.name)}</span>
                    ${c.email ? `<span style="color:var(--text-muted);font-size:12px;"> (${esc(c.email)})</span>` : ''}
                  </span>
                </label>`).join('')}
        </div>
        <button type="button" class="btn btn-sm btn-outline" style="margin-top:6px;"
                onclick="presContactAddChecked()">➕ Add selected as contacts</button>
      </div>
      ${edTextarea('Contacts [{name, email}]', 'ed-contacts', JSON.stringify(d.contacts || [], null, 2))}
    `; }
    case 'attached_resource': return `
      <div class="form-field">
        <label>Attached Resource</label>
        <select id="ed-resource_id" style="width:100%;">
          <option value="">— select a resource —</option>
          ${_builderResources.map(r =>
            `<option value="${esc(r.id)}" ${r.id === d.resource_id ? 'selected' : ''}>
              ${esc(r.display_name)} (${r.resource_type.toUpperCase()}${r.page_count ? ', ' + r.page_count + ' pp.' : ''})
            </option>`
          ).join('')}
        </select>
        ${_builderResources.length === 0
          ? `<div style="font-size:11px;color:var(--text-muted);margin-top:4px;">No resources yet — upload one in the Resources tab of Data Manager.</div>`
          : ''}
      </div>
      ${edField('Section Title', 'ed-title', d.title)}
      ${edField('Subtitle', 'ed-subtitle', d.subtitle)}
      ${edField('Caption text', 'ed-caption', d.caption || 'Full PDF attached below')}
      <div class="form-field" style="display:flex;align-items:center;gap:8px;">
        <input type="checkbox" id="ed-show_graphic" ${d.show_graphic !== false ? 'checked' : ''}>
        <label for="ed-show_graphic" style="margin:0;cursor:pointer;">Show page preview graphic in newsletter</label>
      </div>
      <div class="form-field">
        <label>Pages to preview <span style="font-weight:400;color:var(--text-muted);">(0-based indices, comma-separated)</span></label>
        <input type="text" id="ed-pages_shown" value="${esc((d.pages_shown || [0,1]).join(', '))}"
               placeholder="0, 1" style="width:120px;">
      </div>
      <div class="form-field">
        <button type="button" class="btn btn-outline" id="ed-gen-graphic-btn"
                onclick="generateResourceGraphic()" style="width:100%;">
          🎨 Generate Section Graphic
        </button>
        <div id="ed-graphic-status" style="font-size:12px;color:var(--text-muted);margin-top:4px;">
          ${d.graphic_url
            ? `<span style="color:var(--success,#16a34a);">✔ Graphic ready</span>`
            : 'No graphic generated yet.'}
        </div>
        ${d.graphic_url
          ? `<img src="${esc(d.graphic_url)}" alt="Preview"
                  style="width:100%;border-radius:8px;margin-top:8px;border:1px solid var(--border);">`
          : ''}
      </div>
    `;
    case 'footer': return `<div style="font-size:13px;color:var(--text-muted);">Footer uses values from settings.json.</div>`;
    default: return window._appSettings?.developer_mode
      ? `<div style="font-size:11px;color:var(--text-muted);margin-bottom:4px;">Raw data (developer mode)</div><textarea id="ed-raw" style="width:100%;height:200px;font-size:12px;font-family:monospace;">${JSON.stringify(d, null, 2)}</textarea>`
      : `<div style="font-size:13px;color:var(--text-muted);padding:16px 0;">No editor available for this block type.</div>`;
  }
}

function edField(label, id, value = '') {
  return `<div class="form-field"><label>${label}</label>
    <input type="text" id="${id}" value="${(value??'').toString().replace(/"/g,'&quot;')}">
  </div>`;
}
function edTextarea(label, id, value = '') {
  return `<div class="form-field"><label>${label}</label>
    <textarea id="${id}" style="font-size:12px;font-family:monospace;min-height:100px;">${value}</textarea>
  </div>`;
}

function getEdVal(id) {
  const el = document.getElementById(id);
  return el ? el.value.trim() : null;
}
function tryJSON(str, fallback) {
  try { return JSON.parse(str); } catch { return fallback; }
}

window.saveEditorFields = function() {
  const section = _sections.find(s => s.id === _selected);
  if (!section) return;
  const d = section.data;
  switch (section.section_type) {
    case 'hero':
      d.image_url = getEdVal('ed-image_url') ?? d.image_url;
      d.title = getEdVal('ed-title') ?? d.title;
      d.body_paragraphs = (getEdVal('ed-body_paragraphs') || '').split('\n').filter(Boolean);
      d.group_email = getEdVal('ed-group_email') ?? d.group_email;
      break;
    case 'meeting_highlights':
      d.title = getEdVal('ed-title') ?? d.title;
      d.items = (getEdVal('ed-items') || '').split('\n').filter(Boolean);
      break;
    case 'highlight_event': {
      const picked = document.querySelector('input[name="ed-highlight-pick"]:checked');
      if (picked) {
        const ev = _builderEvents.find(e => e.row_index === +picked.value);
        if (ev) Object.assign(d, eventToHighlightData(ev));
      }
      d.title_override = getEdVal('ed-title_override') ?? d.title_override;
      d.subtitle       = getEdVal('ed-subtitle') ?? d.subtitle;
      d.cta_url        = getEdVal('ed-cta_url') ?? d.cta_url;
      d.cta_label      = getEdVal('ed-cta_label') ?? d.cta_label;
      d.note           = getEdVal('ed-note') ?? d.note;
      break;
    }
    case 'event_grid': {
      d.title    = getEdVal('ed-title') ?? d.title;
      d.subtitle = getEdVal('ed-subtitle') ?? d.subtitle;
      d.cta_url  = getEdVal('ed-cta_url') ?? d.cta_url;
      d.cta_label = getEdVal('ed-cta_label') ?? d.cta_label;
      d.include_recurring  = document.getElementById('ed-include-recurring')?.checked  || false;
      d.sort_by_date       = document.getElementById('ed-sort-by-date')?.checked       !== false;
      d.compact_blocks     = document.getElementById('ed-compact-blocks')?.checked     || false;
      d.show_org           = document.getElementById('ed-show-org')?.checked           !== false;
      d.show_time          = document.getElementById('ed-show-time')?.checked          !== false;
      d.show_address       = document.getElementById('ed-show-address')?.checked       !== false;
      d.show_notes         = document.getElementById('ed-show-notes')?.checked         !== false;
      d.shorten_address    = document.getElementById('ed-shorten-addr')?.checked       || false;
      d.columns = parseInt(document.getElementById('ed-columns')?.value || '2', 10);
      const checked = [...document.querySelectorAll('input[name="ed-grid-pick"]:checked')];
      d.source_row_indexes = checked.map(cb => +cb.value);
      d.events = d.source_row_indexes
        .map(ri => _builderEvents.find(e => e.row_index === ri))
        .filter(Boolean)
        .filter(ev => d.include_recurring || (ev.days && /\d{4}/.test(ev.days)))
        .map(ev => eventToDisplayItem(ev, d.shorten_address));
      if (d.sort_by_date) {
        d.events.sort((a, b) => {
          const da = _parseDateFromLabel(a.date_label);
          const db = _parseDateFromLabel(b.date_label);
          if (!da && !db) return 0;
          if (!da) return 1;   // undated/recurring → last
          if (!db) return -1;
          return da - db;
        });
      }
      break;
    }
    case 'meeting_schedule':
      d.title = getEdVal('ed-title') ?? d.title;
      d.zoom_url = getEdVal('ed-zoom_url') ?? d.zoom_url;
      d.meetings = tryJSON(getEdVal('ed-meetings'), d.meetings);
      d.note = getEdVal('ed-note') ?? d.note;
      break;
    case 'narrative':
      d.icon_url = getEdVal('ed-icon_url') ?? d.icon_url;
      d.title = getEdVal('ed-title') ?? d.title;
      d.rich_content = document.getElementById('ed-rich_content')?.value || '';
      d.body_paragraphs = (getEdVal('ed-body_paragraphs') || '').split('\n').filter(Boolean);
      d.items = (getEdVal('ed-items') || '').split('\n').filter(Boolean);
      d.callout = tryJSON(getEdVal('ed-callout'), null);
      break;
    case 'attendee_list':
      d.meeting_date = getEdVal('ed-meeting_date') ?? d.meeting_date;
      d.note = getEdVal('ed-note') ?? d.note;
      d.attendees = tryJSON(getEdVal('ed-attendees'), d.attendees);
      d.footer_note = getEdVal('ed-footer_note') ?? d.footer_note;
      break;
    case 'flyer_grid':
      d.title = getEdVal('ed-title') ?? d.title;
      d.subtitle = getEdVal('ed-subtitle') ?? d.subtitle;
      d.layout = document.getElementById('ed-layout')?.value || 'grid';
      d.tag_filter = getEdVal('ed-tag-filter') ?? d.tag_filter ?? '';
      d.images = tryJSON(getEdVal('ed-images'), d.images);
      break;
    case 'job_grid':
      d.title = getEdVal('ed-title') ?? d.title;
      d.subtitle = getEdVal('ed-subtitle') ?? d.subtitle;
      d.tag_filter = getEdVal('ed-tag-filter') ?? d.tag_filter ?? '';
      d.job_ids = tryJSON(getEdVal('ed-job_ids'), d.job_ids);
      d.show_pay = document.getElementById('ed-show_pay')?.checked ?? true;
      d.show_close_date = document.getElementById('ed-show_close_date')?.checked ?? true;
      d.show_contact = document.getElementById('ed-show_contact')?.checked ?? true;
      d.cta_url = getEdVal('ed-cta_url') ?? d.cta_url;
      d.cta_label = getEdVal('ed-cta_label') ?? d.cta_label;
      break;
    case 'actions_list':
      d.title = getEdVal('ed-title') ?? d.title;
      d.items = (getEdVal('ed-items') || '').split('\n').filter(Boolean);
      break;
    case 'directory_cta':
      d.text = getEdVal('ed-text') ?? d.text;
      d.url = getEdVal('ed-url') ?? d.url;
      d.btn_label = getEdVal('ed-btn_label') ?? d.btn_label;
      break;
    case 'presenter_cta':
      d.signup_url = getEdVal('ed-signup_url') ?? d.signup_url;
      d.contacts = tryJSON(getEdVal('ed-contacts'), d.contacts);
      break;
    case 'attached_resource':
      d.resource_id  = document.getElementById('ed-resource_id')?.value || d.resource_id;
      d.title        = getEdVal('ed-title') ?? d.title;
      d.subtitle     = getEdVal('ed-subtitle') ?? d.subtitle;
      d.caption      = getEdVal('ed-caption') ?? d.caption;
      d.show_graphic = document.getElementById('ed-show_graphic')?.checked ?? true;
      d.pages_shown  = (getEdVal('ed-pages_shown') || '0, 1')
        .split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n));
      break;
  }
  toast('Section updated', 'success');
};

window.removeSection = removeSection;

// ── Attached Resource editor helpers ─────────────────────────────────────────

function _initResourceEditor(section) {
  // If resources haven't loaded yet, reload them then re-render editor
  if (_builderResources.length === 0) {
    loadBuilderResources().then(() => {
      if (_selected === section.id) renderEditor(section);
    });
  }
}

window.generateResourceGraphic = async function() {
  const section = _sections.find(s => s.id === _selected);
  if (!section || section.section_type !== 'attached_resource') return;

  // Save current field values first so resource_id and pages are fresh
  saveEditorFields();

  const resourceId = section.data.resource_id;
  if (!resourceId) {
    toast('Pick a resource first', 'error');
    return;
  }

  const pages = section.data.pages_shown || [0, 1];
  const btn    = document.getElementById('ed-gen-graphic-btn');
  const status = document.getElementById('ed-graphic-status');

  if (btn) btn.disabled = true;
  if (status) status.innerHTML = '<span style="color:var(--text-muted);">⏳ Generating graphic…</span>';
  StatusBar.setTemp('Generating PDF preview graphic…', 8000);

  try {
    const res = await fetch(`/api/resources/${resourceId}/generate-graphic`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pages }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error || 'Generation failed');

    const rec = json.data;
    section.data.graphic_url      = rec.generated_image_url || '';
    section.data.graphic_image_id = rec.generated_image_id  || null;

    if (status) {
      status.innerHTML = `<span style="color:var(--success,#16a34a);">✔ Graphic ready — uploaded to image library</span>`;
    }
    // Show the fresh graphic inline
    const existing = document.querySelector('#editorFields img[alt="Preview"]');
    if (existing) {
      existing.src = section.data.graphic_url;
    } else {
      const img = document.createElement('img');
      img.src = section.data.graphic_url;
      img.alt = 'Preview';
      img.style.cssText = 'width:100%;border-radius:8px;margin-top:8px;border:1px solid var(--border);';
      status.insertAdjacentElement('afterend', img);
    }
    StatusBar.setTemp('Graphic generated and uploaded to image library', 4000);
    toast('Graphic generated', 'success');
  } catch (err) {
    if (status) status.innerHTML = `<span style="color:var(--error,#dc2626);">✗ ${esc(err.message)}</span>`;
    toast(`Error: ${err.message}`, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
};

// ── Preview / Export helpers ──────────────────────────────────────────────────

/**
 * Starts a crawling progress animation in the StatusBar.
 * Increments toward `ceil` in small exponential-decay steps so it visually
 * slows down as it gets closer — never actually reaches the ceiling.
 * Returns a stop() function; call it before setting 100%.
 */
function _startProgressCrawl(ceil = 88, intervalMs = 100) {
  let cur = 10;
  StatusBar.progress(cur);
  const timer = setInterval(() => {
    // Each tick closes ~6 % of the remaining gap to the ceiling
    cur += (ceil - cur) * 0.06;
    StatusBar.progress(cur);
  }, intervalMs);
  return function stop() { clearInterval(timer); };
}

// ── Dual-canvas helpers ───────────────────────────────────────────────────────

/** Push live _sections back into the active language store. Call before any multi-lang read. */
function _syncActiveLang() {
  if (_activeLang === 'en') _sectionsEn = _sections.slice();
  else                      _sectionsEs = _sections.slice();
}

/** Show/hide the structural diff banner when EN and ES canvases differ. */
function _checkStructuralDiff() {
  if (_sectionsEn.length === 0 || _sectionsEs.length === 0) {
    document.getElementById('nlStructDiffWarning')?.classList.add('hidden');
    return;
  }
  const typesEn = _sectionsEn.map(s => s.section_type).join(',');
  const typesEs = _sectionsEs.map(s => s.section_type).join(',');
  const differs = typesEn !== typesEs;
  const banner  = document.getElementById('nlStructDiffWarning');
  const msgEl   = document.getElementById('nlStructDiffMsg');
  if (!banner) return;
  if (differs) {
    if (msgEl) msgEl.textContent =
      `Structural difference between canvases — EN has ${_sectionsEn.length} section(s), ES has ${_sectionsEs.length}. Make sure they match before downloading.`;
    banner.classList.remove('hidden');
  } else {
    banner.classList.add('hidden');
  }
}

/** Switch the active editing canvas between 'en' and 'es'. */
window.switchBuilderLang = function(lang) {
  if (lang === _activeLang) return;
  _syncActiveLang();                             // save current
  _activeLang = lang;

  // Update hidden nlLang so other code (flyerLoad, section preview) sees the right lang
  const nlLangEl = document.getElementById('nlLang');
  if (nlLangEl) nlLangEl.value = lang;

  // Load the other canvas (copy so mutations don't accidentally cross)
  _sections.length = 0;
  const store = lang === 'en' ? _sectionsEn : _sectionsEs;
  store.forEach(s => _sections.push(s));

  _lastRender = { html_en: null, html_es: null };
  _updateRenderButtons();
  _selected = null;
  renderCanvas();
  renderEditor(null);

  // Update tab button states
  document.getElementById('nlLangEn')?.classList.toggle('lang-tab--active', lang === 'en');
  document.getElementById('nlLangEs')?.classList.toggle('lang-tab--active', lang === 'es');

  // Update translate button label
  _updateTranslateBtn();
  _checkStructuralDiff();
};

function _updateTranslateBtn() {
  const btn = document.getElementById('nlTranslateBtn');
  if (!btn) return;
  btn.textContent = `⟷ Translate to ${_activeLang === 'en' ? 'ES' : 'EN'}`;
}

/** Enable/disable Preview Latest + Download buttons based on cache state. */
function _updateRenderButtons() {
  const hasAny  = !!((_lastRender.html_en || _lastRender.html_es));
  const previewBtn = document.getElementById('nlPreviewBtn');
  const exportBtn  = document.getElementById('nlExportBtn');
  if (previewBtn) previewBtn.disabled = !hasAny;
  if (exportBtn)  exportBtn.disabled  = !hasAny;
}

/** Switch the preview modal iframe to a different language. */
window.switchPreviewLang = function(lang) {
  const html = lang === 'es' ? _lastRender.html_es : _lastRender.html_en;
  if (!html) return;
  document.getElementById('previewFrame').srcdoc = html;
  const enBtn = document.getElementById('previewLangEn');
  const esBtn = document.getElementById('previewLangEs');
  if (enBtn) { enBtn.className = lang === 'en' ? 'btn btn-sm btn-outline' : 'btn btn-sm btn-ghost'; }
  if (esBtn) { esBtn.className = lang === 'es' ? 'btn btn-sm btn-outline' : 'btn btn-sm btn-ghost'; }
};

// ── Translate button ──────────────────────────────────────────────────────────

document.getElementById('nlTranslateBtn').addEventListener('click', async () => {
  _syncActiveLang();
  const toLang     = _activeLang === 'en' ? 'es' : 'en';
  const toLangName = toLang === 'es' ? 'Spanish' : 'English';
  const fromSecs   = _activeLang === 'en' ? _sectionsEn : _sectionsEs;

  if (fromSecs.length === 0) { toast('Nothing to translate — add sections first', 'info'); return; }

  const targetStore = toLang === 'en' ? _sectionsEn : _sectionsEs;
  if (targetStore.length > 0 &&
      !confirm(`Replace the ${toLangName} canvas with a fresh translation? This cannot be undone.`)) return;

  StatusBar.set(`Translating to ${toLangName}…`, 'syncing');
  const stopCrawl = _startProgressCrawl(85, 150);
  try {
    const res = await fetch('/api/newsletter/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sections: fromSecs.map(s => ({ id: s.id, section_type: s.section_type, data: s.data })),
        to_lang: toLang,
      }),
    });
    const json = await res.json();
    stopCrawl();
    if (!json.ok) throw new Error(json.error);

    const translated = json.data.sections.map(s => ({
      id: s.id, section_type: s.section_type, data: s.data,
    }));
    if (toLang === 'en') _sectionsEn = translated;
    else                  _sectionsEs = translated;

    StatusBar.progress(100);
    setTimeout(() => StatusBar.reset(), 600);

    // Switch to the newly translated canvas so the user can review it
    switchBuilderLang(toLang);
    _checkStructuralDiff();
    toast(`Translated to ${toLangName} — review and edit as needed`, 'success');
  } catch (err) {
    stopCrawl();
    StatusBar.reset();
    toast('Translation failed: ' + err.message, 'error');
  }
});

// ── Preview ───────────────────────────────────────────────────────────────────

window.previewSection = async function() {
  const section = _sections.find(s => s.id === _selected);
  if (!section) return;
  StatusBar.set('Rendering section preview…', 'syncing');
  const stopCrawl = _startProgressCrawl();
  try {
    saveEditorFields();
    const res = await fetch('/api/newsletter/preview-section', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...section.to_dict?.() ?? section, lang: nlLang.value }),
    });
    const json = await res.json();
    stopCrawl();
    if (!json.ok) throw new Error(json.error);
    StatusBar.progress(100);
    setTimeout(() => StatusBar.reset(), 600);
    const win = window.open('', '_blank', 'width=720,height=600');
    win.document.write(`<html><body style="background:#f3f5f7;padding:16px;font-family:Arial,sans-serif;">
      <table width="680" style="margin:auto;">${json.data.html}</table></body></html>`);
  } catch (err) { stopCrawl(); StatusBar.reset(); toast('Preview failed: ' + err.message, 'error'); }
};

// ── Render button — builds HTML and caches it ─────────────────────────────────

document.getElementById('nlRenderBtn').addEventListener('click', async () => {
  if (_sections.length === 0) { toast('Add some sections first', 'info'); return; }
  saveEditorFields();
  const doc = buildDoc();
  const renderBoth = window._appSettings?.render_both_languages ?? false;
  const langs = renderBoth ? 'both' : doc.language;

  StatusBar.set('Rendering newsletter…', 'syncing');
  const stopCrawl = _startProgressCrawl();
  try {
    const res = await fetch('/api/newsletter/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...doc, languages: langs }),
    });
    const json = await res.json();
    stopCrawl();
    if (!json.ok) throw new Error(json.error);
    _lastRender = json.data;
    _updateRenderButtons();

    // Show language toggle in preview modal only when both are cached
    const toggle = document.getElementById('previewLangToggle');
    if (toggle) toggle.style.display = (_lastRender.html_en && _lastRender.html_es) ? 'flex' : 'none';

    StatusBar.progress(100);
    setTimeout(() => StatusBar.setTemp('Render complete — click Preview Latest to view', 'ready', 3000), 400);
  } catch (err) { stopCrawl(); StatusBar.reset(); toast('Render failed: ' + err.message, 'error'); }
});

// ── Preview Latest Render — opens cached output instantly ─────────────────────

document.getElementById('nlPreviewBtn').addEventListener('click', () => {
  // Default to the currently active canvas language, fall back to whatever is cached
  const preferred = (_activeLang === 'es' && _lastRender.html_es) ? 'es' : 'en';
  const html = preferred === 'es' ? _lastRender.html_es : (_lastRender.html_en ?? _lastRender.html_es);
  if (!html) { toast('Nothing rendered yet — click Render first', 'info'); return; }
  document.getElementById('previewFrame').srcdoc = html;
  switchPreviewLang(preferred);
  document.getElementById('previewModal').classList.remove('hidden');
});

document.getElementById('previewClose').addEventListener('click', () => {
  document.getElementById('previewModal').classList.add('hidden');
});

document.getElementById('previewCopyBtn').addEventListener('click', () => {
  const html = document.getElementById('previewFrame').srcdoc;
  if (!html) { toast('Nothing to copy', 'info'); return; }
  navigator.clipboard.writeText(html).then(() => toast('HTML copied to clipboard!', 'success'));
});

// ── Download Full Render — uses cache when possible ───────────────────────────

document.getElementById('nlExportBtn').addEventListener('click', async () => {
  if (_sections.length === 0) { toast('Add some sections first', 'info'); return; }
  const doc = buildDoc();
  const slug = doc.month.replace(/\s+/g, '-') || 'newsletter';

  // Fast path: both languages already in cache
  if (_lastRender.html_en && _lastRender.html_es) {
    downloadHtml(_lastRender.html_en, `newsletter-${slug}-en.html`);
    downloadHtml(_lastRender.html_es, `newsletter-${slug}-es.html`);
    toast('Downloaded EN + ES HTML files', 'success');
    return;
  }

  // Need to render both (single-language render was cached, or nothing rendered yet)
  saveEditorFields();
  StatusBar.set('Rendering both languages for download…', 'syncing');
  const stopCrawl = _startProgressCrawl();
  try {
    const res = await fetch('/api/newsletter/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...buildDoc(), languages: 'both' }),
    });
    const json = await res.json();
    stopCrawl();
    if (!json.ok) throw new Error(json.error);
    _lastRender = json.data;
    _updateRenderButtons();
    StatusBar.progress(100);
    downloadHtml(_lastRender.html_en, `newsletter-${slug}-en.html`);
    downloadHtml(_lastRender.html_es, `newsletter-${slug}-es.html`);
    setTimeout(() => StatusBar.reset(), 800);
    toast('Downloaded EN + ES HTML files', 'success');
  } catch (err) { stopCrawl(); StatusBar.reset(); toast('Download failed: ' + err.message, 'error'); }
});

function buildDoc() {
  _syncActiveLang();
  const toRaw = arr => arr.map(s => ({ id: s.id, section_type: s.section_type, data: s.data }));
  return {
    month:        nlMonth.value || 'Newsletter',
    subtitle:     nlSubtitle.value,
    language:     _activeLang,
    sections_en:  toRaw(_sectionsEn),
    sections_es:  toRaw(_sectionsEs),
    // Legacy "sections" field = active canvas (backward compat for old endpoints)
    sections:     toRaw(_activeLang === 'en' ? _sectionsEn : _sectionsEs),
  };
}

function downloadHtml(html, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = filename;
  a.click();
}

// ── Presets ───────────────────────────────────────────────────────────────────

window.saveAsPreset = async function() {
  const section = _sections.find(s => s.id === _selected);
  if (!section) { toast('Select a section first', 'info'); return; }
  saveEditorFields();
  const name = prompt('Name this preset:', SECTION_LABELS[section.section_type] || section.section_type);
  if (!name) return;
  try {
    const res = await fetch('/api/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, section_type: section.section_type, data: section.data }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    toast(`Preset "${name}" saved!`, 'success');
    await loadPresets();
  } catch (err) { toast('Save preset failed: ' + err.message, 'error'); }
};

// ── Project management ────────────────────────────────────────────────────────

const projectNameInput    = document.getElementById('projectName');
const projectSavedIndicator = document.getElementById('projectSavedIndicator');

function markUnsaved() { projectSavedIndicator.textContent = '● unsaved'; }
function markSaved()   { projectSavedIndicator.textContent = '✓ saved'; }

// Intercept section mutations to mark unsaved
const _origAddSection = addSection;
const _origRemoveSection = removeSection;

document.getElementById('projectSaveBtn').addEventListener('click', async () => {
  const name = projectNameInput.value.trim() || 'Untitled Newsletter';
  saveEditorFields();
  const doc = { ...buildDoc(), month: nlMonth.value || name, subtitle: nlSubtitle.value };
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    markSaved();
    toast(`Project "${name}" saved`, 'success');
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
});

document.getElementById('projectNewBtn').addEventListener('click', () => {
  if (_sections.length > 0 && !confirm('Start a new canvas? Unsaved changes will be lost.')) return;
  _sections.length = 0;
  _sectionsEn = [];
  _sectionsEs = [];
  _activeLang = 'en';
  document.getElementById('nlLangEn')?.classList.add('lang-tab--active');
  document.getElementById('nlLangEs')?.classList.remove('lang-tab--active');
  const nlLangEl = document.getElementById('nlLang');
  if (nlLangEl) nlLangEl.value = 'en';
  _updateTranslateBtn();
  _selected = null;
  _lastRender = { html_en: null, html_es: null };
  _updateRenderButtons();
  document.getElementById('nlStructDiffWarning')?.classList.add('hidden');
  renderCanvas();
  renderEditor(null);
  projectNameInput.value = 'Untitled Newsletter';
  nlMonth.value = '';
  nlSubtitle.value = '';
  markUnsaved();
  toast('New canvas ready', 'info');
});

document.getElementById('projectOpenBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/projects');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    const projects = json.data;
    if (projects.length === 0) { toast('No saved projects yet', 'info'); return; }
    showPickerModal(
      'Open Project',
      projects.map(p => ({
        label: p.month || p.filename,
        sublabel: `${p.section_count} sections`,
        value: p.filename,
      })),
      async (filename) => {
        const r = await fetch(`/api/projects/${encodeURIComponent(filename)}`);
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        loadDocIntoBuilder(j.data, filename);
        toast(`Opened: ${filename}`, 'success');
      }
    );
  } catch (err) { toast('Open failed: ' + err.message, 'error'); }
});

document.getElementById('templatePickBtn').addEventListener('click', async () => {
  try {
    const res = await fetch('/api/templates');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    showPickerModal(
      'Choose a Template',
      json.data.map(t => ({
        label: t.name,
        sublabel: t.description,
        value: t.filename,
      })),
      async (filename) => {
        const r = await fetch(`/api/templates/${encodeURIComponent(filename)}`);
        const j = await r.json();
        if (!j.ok) throw new Error(j.error);
        loadDocIntoBuilder(j.data, '');
        nlMonth.value = '';
        toast(`Template loaded: ${filename}`, 'success');
      }
    );
  } catch (err) { toast('Templates failed: ' + err.message, 'error'); }
});

document.getElementById('importFileBtn')?.addEventListener('click', async () => {
  if (!window.hormiga?.showOpenDialog) { toast('File import unavailable outside Electron', 'error'); return; }
  if (_sections.length > 0 && !confirm('Import from file? Unsaved changes will be lost.')) return;
  const filePath = await window.hormiga.showOpenDialog({
    title:   'Import newsletter JSON',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!filePath) return;
  const result = await window.hormiga.readTextFile(filePath);
  if (!result.ok) { toast('Could not read file: ' + result.error, 'error'); return; }
  try {
    const doc = JSON.parse(result.text);
    const name = filePath.split(/[/\\]/).pop().replace(/\.json$/i, '');
    loadDocIntoBuilder(doc, name);
    toast(`Imported: ${name}`, 'success');
  } catch (err) { toast('Invalid JSON: ' + err.message, 'error'); }
});

document.getElementById('exportFileBtn')?.addEventListener('click', async () => {
  if (!window.hormiga?.showSaveDialog) { toast('File export unavailable outside Electron', 'error'); return; }
  saveEditorFields();
  const name = projectNameInput.value.trim() || 'newsletter';
  const doc  = { ...buildDoc(), month: nlMonth.value || name, subtitle: nlSubtitle.value };
  const filePath = await window.hormiga.showSaveDialog({
    title:       'Export newsletter JSON',
    defaultPath: name.toLowerCase().replace(/\s+/g, '-') + '.json',
    filters:     [{ name: 'JSON', extensions: ['json'] }],
  });
  if (!filePath) return;
  const result = await window.hormiga.writeTextFile(filePath, JSON.stringify(doc, null, 2));
  if (!result.ok) { toast('Export failed: ' + result.error, 'error'); return; }
  toast(`Exported to ${filePath.split(/[/\\]/).pop()}`, 'success');
});

function loadDocIntoBuilder(doc, projectName) {
  const toSection = s => ({ id: s.id || uid(), section_type: s.section_type, data: s.data || {} });

  // New format: sections_en / sections_es. Old format: sections (load into EN only).
  _sectionsEn = (doc.sections_en || doc.sections || []).map(toSection);
  _sectionsEs = (doc.sections_es || []).map(toSection);
  _activeLang = 'en';

  // Load EN canvas into live _sections (copy so mutations don't bleed into store)
  _sections.length = 0;
  _sectionsEn.forEach(s => _sections.push(s));

  // Sync lang tab UI
  document.getElementById('nlLangEn')?.classList.add('lang-tab--active');
  document.getElementById('nlLangEs')?.classList.remove('lang-tab--active');
  const nlLangEl = document.getElementById('nlLang');
  if (nlLangEl) nlLangEl.value = 'en';
  _updateTranslateBtn();

  _selected = null;
  _lastRender = { html_en: null, html_es: null };
  _updateRenderButtons();
  renderCanvas();
  renderEditor(null);
  if (doc.month)    nlMonth.value    = doc.month;
  if (doc.subtitle) nlSubtitle.value = doc.subtitle;
  if (projectName)  projectNameInput.value = projectName;
  _checkStructuralDiff();
  markSaved();
}

// ── Generic picker modal ──────────────────────────────────────────────────────

function showPickerModal(title, items, onSelect) {
  const existing = document.getElementById('_pickerModal');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = '_pickerModal';
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box" style="width:420px;">
      <div class="modal-header">
        <h2>${esc(title)}</h2>
        <button class="modal-close" id="_pickerClose">✕</button>
      </div>
      <div class="modal-body" style="padding:12px;">
        ${items.map(item => `
          <div class="picker-item" data-value="${esc(item.value)}"
               style="padding:10px 12px;border:1px solid var(--border);border-radius:8px;
                      margin-bottom:8px;cursor:pointer;transition:.15s;">
            <div style="font-weight:600;font-size:13px;">${esc(item.label)}</div>
            ${item.sublabel ? `<div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${esc(item.sublabel)}</div>` : ''}
          </div>
        `).join('')}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.querySelector('#_pickerClose').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  overlay.querySelectorAll('.picker-item').forEach(el => {
    el.addEventListener('mouseenter', () => el.style.background = '#f1f5f9');
    el.addEventListener('mouseleave', () => el.style.background = '');
    el.addEventListener('click', async () => {
      overlay.remove();
      try { await onSelect(el.dataset.value); }
      catch (err) { toast('Error: ' + err.message, 'error'); }
    });
  });
}

// ── Event picker helpers (called from inline oninput) ─────────────────────────

window.filterHighlightEventList = function(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('#ed-highlight-list .event-pick-item').forEach(el => {
    const text = el.textContent.toLowerCase();
    el.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
};

window.filterEventGridList = function(query) {
  const q = query.toLowerCase();
  document.querySelectorAll('#ed-grid-list .event-pick-item').forEach(el => {
    const text = el.textContent.toLowerCase();
    el.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
};

// ── Flyer image picker ────────────────────────────────────────────────────────

window.flyerPickImage = function() {
  // Use a hidden proxy input as the "target" so the image picker can write into it
  let proxy = document.getElementById('_flyerPickProxy');
  if (!proxy) {
    proxy = document.createElement('input');
    proxy.type = 'hidden';
    proxy.id   = '_flyerPickProxy';
    document.body.appendChild(proxy);
  }
  proxy.value = '';
  SmartFields.openImagePickerModal('_flyerPickProxy');

  // Poll until the picker writes a URL, then append it to the flyer images textarea
  const t = setInterval(() => {
    if (proxy.value) {
      clearInterval(t);
      const ta = document.getElementById('ed-images');
      if (ta) {
        const arr = (() => { try { return JSON.parse(ta.value); } catch { return []; } })();
        arr.push({ url: proxy.value, alt: '' });
        ta.value = JSON.stringify(arr, null, 2);
        proxy.value = '';
        toast('Image added to flyer list', 'success');
      }
    }
  }, 150);
  setTimeout(() => clearInterval(t), 60000); // safety cleanup
};

// ── Language-aware flier selection ───────────────────────────────────────────

/**
 * Given a flat list of images, return only the language-appropriate version of
 * each paired image, deduplicating by pair_id.
 *
 * Rules:
 *  - Unpaired images (no pair_id) are always included.
 *  - For paired images, prefer the version whose `language` matches `lang`.
 *    If no match exists, fall back to the other version (don't drop the pair).
 */
function _selectLangImages(images, lang) {
  const preferred = lang === 'es' ? 'es' : 'en';
  const seen = new Map();  // pair_id → best candidate so far

  const out = [];
  for (const img of images) {
    if (!img.pair_id) { out.push(img); continue; }
    const existing = seen.get(img.pair_id);
    if (!existing) {
      seen.set(img.pair_id, img);
    } else {
      // Keep whichever matches `preferred`; if neither does, keep first
      const currMatch = img.language === preferred;
      const prevMatch = existing.language === preferred;
      if (currMatch && !prevMatch) seen.set(img.pair_id, img);
    }
  }
  seen.forEach(img => out.push(img));
  return out;
}

// ── flyerLoadAll ──────────────────────────────────────────────────────────────

window.flyerLoadAll = async function() {
  try {
    const res = await fetch('/api/images');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    const lang = nlLang?.value || 'en';
    const images = _selectLangImages(json.data || [], lang);
    if (images.length === 0) { toast('No images in library yet', 'info'); return; }
    const ta = document.getElementById('ed-images');
    if (!ta) return;
    const existing = (() => { try { return JSON.parse(ta.value); } catch { return []; } })();
    const existingUrls = new Set(existing.map(i => i.url));
    const newItems = images.filter(i => !existingUrls.has(i.url)).map(i => ({ url: i.url, alt: i.name || '' }));
    ta.value = JSON.stringify([...existing, ...newItems], null, 2);
    toast(`Added ${newItems.length} image(s) from library (${lang.toUpperCase()} version preferred)`, 'success');
  } catch (err) { toast('Failed to load library: ' + err.message, 'error'); }
};

// ── flyerLoadByTag ────────────────────────────────────────────────────────────

/**
 * Parse a tag filter expression into { require, exclude } arrays.
 *
 * Syntax (space or comma separated):
 *   march          → OR — item must have at least one non-excluded tag
 *   march,april    → OR — item has "march" OR "april"
 *   +march +april  → AND — item must have BOTH "march" AND "april"
 *   -vip           → item must NOT have "vip"
 *   march -vip     → has "march" but not "vip"
 *
 * When any `+` tags are present, only items matching ALL of them pass.
 * When only plain (no prefix) tags are present, any match passes (OR).
 */
function parseTagFilter(expr) {
  const tokens = expr.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const require = [], optional = [], exclude = [];
  for (const t of tokens) {
    if (t.startsWith('+')) require.push(t.slice(1));
    else if (t.startsWith('-')) exclude.push(t.slice(1));
    else optional.push(t);
  }
  return { require, optional, exclude };
}

/** Returns true if the item's tag array passes the parsed filter. */
function matchesTagFilter(itemTags, filter) {
  const tags = (itemTags || []).map(t => t.toLowerCase());
  // Must not have any excluded tag
  if (filter.exclude.some(ex => tags.includes(ex))) return false;
  // Required tags (AND) — all must match
  if (filter.require.length && !filter.require.every(r => tags.includes(r))) return false;
  // Optional tags (OR) — at least one must match, unless there are only require/exclude
  if (filter.optional.length && !filter.optional.some(o => tags.includes(o))) return false;
  return true;
}

window.flyerLoadByTag = async function() {
  const tagInput = document.getElementById('ed-tag-filter');
  const expr = tagInput ? tagInput.value.trim() : '';
  if (!expr) { toast('Enter a tag to filter by', 'info'); return; }
  const filter = parseTagFilter(expr);
  try {
    const res = await fetch('/api/images');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    const lang = nlLang?.value || 'en';
    // Filter by tag first (both partners of a pair may have the tag), then select language version
    const tagMatched = (json.data || []).filter(i => matchesTagFilter(i.tags, filter));
    const matched = _selectLangImages(tagMatched, lang);
    if (matched.length === 0) { toast(`No images matched "${expr}"`, 'info'); return; }
    const ta = document.getElementById('ed-images');
    if (!ta) return;
    const existing = (() => { try { return JSON.parse(ta.value); } catch { return []; } })();
    const existingUrls = new Set(existing.map(i => i.url));
    const newItems = matched.filter(i => !existingUrls.has(i.url)).map(i => ({ url: i.url, alt: i.name || '' }));
    ta.value = JSON.stringify([...existing, ...newItems], null, 2);
    toast(`Added ${newItems.length} image(s) matching "${expr}" (${lang.toUpperCase()})${newItems.length < matched.length ? ` · ${matched.length - newItems.length} already in list` : ''}`, 'success');
  } catch (err) { toast('Failed to load library: ' + err.message, 'error'); }
};

// ── Attendee list helpers ─────────────────────────────────────────────────────

function _renderAttendeePickList(contacts) {
  const list = document.getElementById('ed-attendee-pick-list');
  if (!list) return;
  if (!contacts.length) {
    list.innerHTML = '<div style="padding:8px 12px;color:var(--text-muted);">No contacts found</div>';
    return;
  }
  list.innerHTML = contacts.map(c => `
    <label style="display:flex;align-items:center;gap:8px;padding:6px 10px;cursor:pointer;
                  border-bottom:1px solid var(--border);user-select:none;">
      <input type="checkbox" name="attendee-pick" value="${esc(c.row_index)}"
             data-name="${esc(c.name)}" data-org="${esc(c.organization || '')}">
      <span style="flex:1;">
        <span style="font-weight:600;">${esc(c.name)}</span>
        ${c.organization ? `<span style="color:var(--text-muted);font-size:12px;"> — ${esc(c.organization)}</span>` : ''}
      </span>
      ${(c.tags || []).length ? `<span style="font-size:11px;color:var(--text-muted);">${c.tags.slice(0,3).map(t => `#${esc(t)}`).join(' ')}</span>` : ''}
    </label>`).join('');
}

window.attendeeSearch = async function(query) {
  if (!query.trim()) {
    const list = document.getElementById('ed-attendee-pick-list');
    if (list) list.innerHTML = '<div style="padding:8px 12px;color:var(--text-muted);">Search or filter by tag to find people</div>';
    return;
  }
  try {
    const json = await fetch(`/api/contacts?q=${encodeURIComponent(query)}&per_page=50`).then(r => r.json());
    _renderAttendeePickList(json.data || []);
  } catch { /* non-critical */ }
};

window.attendeeLoadByTag = async function() {
  const expr = document.getElementById('ed-attendee-tag')?.value?.trim() || '';
  if (!expr) { toast('Enter a tag to filter by', 'info'); return; }
  try {
    const json = await fetch(`/api/contacts?tags=${encodeURIComponent(expr)}&per_page=200`).then(r => r.json());
    _renderAttendeePickList(json.data || []);
    toast(`Found ${(json.data || []).length} contact(s) matching "${expr}"`, 'info');
  } catch (err) { toast('Failed to load contacts: ' + err.message, 'error'); }
};

window.attendeeAddChecked = function() {
  const checked = [...document.querySelectorAll('input[name="attendee-pick"]:checked')];
  if (!checked.length) { toast('Check at least one person first', 'info'); return; }
  const ta = document.getElementById('ed-attendees');
  if (!ta) return;
  const existing = (() => { try { return JSON.parse(ta.value); } catch { return []; } })();
  const existingNames = new Set(existing.map(a => a.name.toLowerCase()));
  const toAdd = checked
    .filter(cb => !existingNames.has(cb.dataset.name.toLowerCase()))
    .map(cb => ({ name: cb.dataset.name, org: cb.dataset.org }));
  ta.value = JSON.stringify([...existing, ...toAdd], null, 2);
  toast(`Added ${toAdd.length} person(s)${toAdd.length < checked.length ? ` (${checked.length - toAdd.length} already in list)` : ''}`, 'success');
  checked.forEach(cb => { cb.checked = false; });
};

async function _populateAttendeeTagSuggestions() {
  try {
    const json = await fetch('/api/tags').then(r => r.json());
    if (!json.ok) return;
    const dl = document.getElementById('ed-attendee-tag-suggestions');
    if (dl) dl.innerHTML = (json.data || []).map(t => `<option value="${esc(t)}">`).join('');
  } catch { /* non-critical */ }
}

// ── Presenter CTA helpers ─────────────────────────────────────────────────────

window.presContactSearch = function(query) {
  const q = query.trim().toLowerCase();
  document.querySelectorAll('#ed-pres-pick-list label').forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = (!q || text.includes(q)) ? '' : 'none';
  });
};

window.presContactAddChecked = function() {
  const checked = [...document.querySelectorAll('input[name="pres-contact-pick"]:checked')];
  if (!checked.length) { toast('Check at least one contact first', 'info'); return; }
  const ta = document.getElementById('ed-contacts');
  if (!ta) return;
  const existing = (() => { try { return JSON.parse(ta.value); } catch { return []; } })();
  const existingNames = new Set(existing.map(c => c.name.toLowerCase()));
  const toAdd = checked
    .filter(cb => !existingNames.has(cb.dataset.name.toLowerCase()))
    .map(cb => ({ name: cb.dataset.name, email: cb.dataset.email }));
  ta.value = JSON.stringify([...existing, ...toAdd], null, 2);
  toast(`Added ${toAdd.length} contact(s)`, 'success');
  checked.forEach(cb => { cb.checked = false; });
};

// ── Flyer grid helpers ────────────────────────────────────────────────────────

// Populate tag suggestions datalist whenever the flyer_grid editor is rendered
async function _populateFlyerTagSuggestions() {
  try {
    const res  = await fetch('/api/tags');
    const json = await res.json();
    if (!json.ok) return;
    const dl = document.getElementById('ed-tag-filter-suggestions');
    if (!dl) return;
    dl.innerHTML = (json.data || []).map(t => `<option value="${esc(t)}">`).join('');
  } catch { /* non-critical */ }
}

// ── Job grid helpers ──────────────────────────────────────────────────────────

async function _populateJobTagSuggestions() {
  try {
    const res  = await fetch('/api/jobs/tags');
    const json = await res.json();
    if (!json.ok) return;
    const dl = document.getElementById('ed-tag-filter-suggestions');
    if (!dl) return;
    dl.innerHTML = (json.tags || []).map(t => `<option value="${esc(t)}">`).join('');
  } catch { /* non-critical */ }
}

window.jobGridLoadByTag = async function() {
  const tagInput = document.getElementById('ed-tag-filter');
  const expr = tagInput ? tagInput.value.trim() : '';
  const ta = document.getElementById('ed-job_ids');
  if (!ta) return;
  try {
    const jobs = expr ? await window.jobLoadByTag(expr) : await window.jobLoadAll();
    ta.value = JSON.stringify((jobs || []).map(j => j.id), null, 2);
    toast(`Loaded ${(jobs||[]).length} job(s)`, 'success');
  } catch (err) { toast('Failed to load jobs: ' + err.message, 'error'); }
};

window.jobGridPickJobs = async function() {
  let all;
  try { all = await window.jobLoadAll(); } catch (err) {
    toast('Could not load jobs: ' + err.message, 'error'); return;
  }
  if (!all.length) { toast('No active jobs found', 'info'); return; }

  // Read current selection from textarea
  const ta = document.getElementById('ed-job_ids');
  const currentIds = new Set(tryJSON(ta?.value, []));

  // Build a simple picker modal in a confirm dialog substitute
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;';
  container.innerHTML = `
    <div style="background:var(--surface);border-radius:16px;padding:20px;width:480px;max-height:80vh;display:flex;flex-direction:column;box-shadow:0 8px 32px rgba(0,0,0,.2);">
      <div style="font-weight:700;font-size:16px;margin-bottom:12px;">Pick Jobs</div>
      <div style="overflow-y:auto;flex:1;border:1px solid var(--border);border-radius:8px;">
        ${all.map(j => `
          <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);user-select:none;">
            <input type="checkbox" name="job-pick" value="${esc(j.id)}" ${currentIds.has(j.id) ? 'checked' : ''}>
            <span style="font-size:20px;">${j.icon_url && j.icon_url.length <= 4 ? esc(j.icon_url) : '💼'}</span>
            <span>
              <span style="font-weight:600;">${esc(j.title)}</span>
              ${j.org ? `<span style="color:var(--text-muted);font-size:12px;"> · ${esc(j.org)}</span>` : ''}
              ${j.pay ? `<span style="color:var(--text-muted);font-size:12px;"> · ${esc(j.pay)}</span>` : ''}
            </span>
          </label>`).join('')}
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px;">
        <button id="_jobPickCancel" class="btn btn-ghost">Cancel</button>
        <button id="_jobPickConfirm" class="btn btn-primary">Apply Selection</button>
      </div>
    </div>`;
  document.body.appendChild(container);

  container.querySelector('#_jobPickCancel').addEventListener('click', () => container.remove());
  container.querySelector('#_jobPickConfirm').addEventListener('click', () => {
    const checked = [...container.querySelectorAll('input[name="job-pick"]:checked')].map(c => c.value);
    if (ta) ta.value = JSON.stringify(checked, null, 2);
    container.remove();
    toast(`${checked.length} job(s) selected`, 'success');
  });
};

// ── Init ──────────────────────────────────────────────────────────────────────

EventBus.on('app:ready', () => {
  loadPresets(); loadBuilderEvents(); loadBuilderContacts();
  _updateTranslateBtn();
  wireTooltips(document.querySelector('.newsletter-tab'));
});
// Refresh data whenever the newsletter builder tab is opened
EventBus.on('tab:changed', ({ tab }) => {
  if (tab === 'newsletter') { loadBuilderEvents(); loadBuilderContacts(); }
});

// ── Palette + editor panel toggles ────────────────────────────────────────────

const _PALETTE_KEY = 'lon_palette_hidden';
const _EDITOR_KEY  = 'lon_editor_hidden';
const _workspace   = document.querySelector('.builder-workspace');
const _paletteEl   = document.querySelector('.section-palette');
const _editorEl    = document.getElementById('sectionEditor');

function _applyPanelState(key, el, hidden) {
  if (!el) return;
  el.classList.toggle('panel--hidden', hidden);
  localStorage.setItem(key, hidden ? '1' : '0');
}

document.getElementById('paletteToggleBtn')?.addEventListener('click', () => {
  const hidden = !_paletteEl.classList.contains('panel--hidden');
  _applyPanelState(_PALETTE_KEY, _paletteEl, hidden);
});

document.getElementById('editorToggleBtn')?.addEventListener('click', () => {
  const hidden = !_editorEl.classList.contains('panel--hidden');
  _applyPanelState(_EDITOR_KEY, _editorEl, hidden);
});

// Restore from session
if (localStorage.getItem(_PALETTE_KEY) === '1') _applyPanelState(_PALETTE_KEY, _paletteEl, true);
if (localStorage.getItem(_EDITOR_KEY)  === '1') _applyPanelState(_EDITOR_KEY,  _editorEl,  true);

// ── Narrative Rich Content Customizer ─────────────────────────────────────────

window.openNarrativeCustomizer = function() {
  const hiddenInput = document.getElementById('ed-rich_content');
  if (!hiddenInput) { toast('Select a narrative section first', 'info'); return; }

  const existing = hiddenInput.value || '';

  const overlay = document.createElement('div');
  overlay.id = '_narrativeCustomizer';
  overlay.style.cssText = `
    position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.6);
    display:flex;align-items:stretch;justify-content:center;padding:24px;box-sizing:border-box;`;

  overlay.innerHTML = `
    <div style="background:var(--bg,#f8fafc);border-radius:14px;width:100%;max-width:860px;
                display:flex;flex-direction:column;box-shadow:0 16px 60px rgba(0,0,0,.35);overflow:hidden;">

      <!-- Header -->
      <div style="background:var(--surface,#fff);border-bottom:1px solid var(--border,#e5e7eb);
                  padding:14px 20px;display:flex;align-items:center;gap:12px;flex-shrink:0;">
        <div style="font-weight:700;font-size:15px;flex:1;">✏ Customize Narrative Content</div>
        <button id="_ncSave"   class="btn btn-primary btn-sm">✓ Save</button>
        <button id="_ncCancel" class="btn btn-ghost btn-sm">✕ Cancel</button>
      </div>

      <!-- Toolbar -->
      <div id="_ncToolbar" style="background:var(--surface,#fff);border-bottom:1px solid var(--border,#e5e7eb);
                  padding:8px 14px;display:flex;gap:4px;flex-wrap:wrap;flex-shrink:0;align-items:center;">
        <button class="nc-tool-btn" data-cmd="bold"        title="Bold (Ctrl+B)"><strong>B</strong></button>
        <button class="nc-tool-btn" data-cmd="italic"      title="Italic (Ctrl+I)"><em>I</em></button>
        <button class="nc-tool-btn" data-cmd="underline"   title="Underline (Ctrl+U)"><u>U</u></button>
        <span class="nc-tool-sep"></span>
        <button class="nc-tool-btn" data-cmd="insertUnorderedList" title="Bullet list">• List</button>
        <button class="nc-tool-btn" data-cmd="insertOrderedList"   title="Numbered list">1. List</button>
        <button class="nc-tool-btn" data-cmd="outdent"  title="Outdent">⇤</button>
        <button class="nc-tool-btn" data-cmd="indent"   title="Indent">⇥</button>
        <span class="nc-tool-sep"></span>
        <select id="_ncHeading" title="Heading level" style="font-size:12px;padding:3px 6px;border:1px solid var(--border);border-radius:5px;cursor:pointer;">
          <option value="">— Paragraph —</option>
          <option value="h2">Heading 2</option>
          <option value="h3">Heading 3</option>
          <option value="h4">Subheading</option>
        </select>
        <span class="nc-tool-sep"></span>
        <button class="nc-tool-btn" id="_ncInsertTable"    title="Insert table">⊞ Table</button>
        <button class="nc-tool-btn" id="_ncInsertBlock"    title="Insert color block section">🎨 Color Block</button>
        <span class="nc-tool-sep"></span>
        <button class="nc-tool-btn" data-cmd="removeFormat" title="Clear formatting" style="color:var(--danger,#dc2626);">✕ Format</button>
      </div>

      <!-- Editor -->
      <div id="_ncEditor"
           contenteditable="true"
           style="flex:1;overflow-y:auto;padding:24px 32px;font-family:Arial,Helvetica,sans-serif;
                  font-size:14px;line-height:1.7;color:#111827;outline:none;
                  min-height:300px;">
      </div>

      <!-- Footer hint -->
      <div style="background:var(--surface,#fff);border-top:1px solid var(--border,#e5e7eb);
                  padding:8px 20px;font-size:11px;color:var(--text-muted,#6b7280);flex-shrink:0;">
        Tip: Color blocks are email-safe &lt;div&gt; containers. Tables use plain HTML. Ctrl+B/I/U for formatting.
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const edEl = overlay.querySelector('#_ncEditor');

  // Load existing content
  if (existing) {
    edEl.innerHTML = existing;
  } else {
    edEl.innerHTML = '<p>Write your section content here…</p>';
  }

  // Focus and select placeholder
  edEl.focus();
  if (!existing) {
    const range = document.createRange();
    range.selectNodeContents(edEl);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  // ── Toolbar button commands ───────────────────────────────────────────────
  overlay.querySelector('#_ncToolbar').addEventListener('mousedown', e => {
    const btn = e.target.closest('[data-cmd]');
    if (!btn) return;
    e.preventDefault();   // don't blur editor
    document.execCommand(btn.dataset.cmd, false, null);
  });

  // Heading select
  overlay.querySelector('#_ncHeading').addEventListener('change', function() {
    const val = this.value;
    if (val) {
      document.execCommand('formatBlock', false, val);
    } else {
      document.execCommand('formatBlock', false, 'p');
    }
    this.value = '';
    edEl.focus();
  });

  // Insert table
  overlay.querySelector('#_ncInsertTable').addEventListener('click', () => {
    const rows = parseInt(prompt('Rows:', '3') || '3', 10);
    const cols = parseInt(prompt('Columns:', '3') || '3', 10);
    if (!rows || !cols || rows < 1 || cols < 1) return;
    const headerCells = Array.from({ length: cols }, (_, i) =>
      `<th style="border:1px solid #d1d5db;padding:7px 10px;background:#f9fafb;font-size:13px;text-align:left;">Header ${i + 1}</th>`
    ).join('');
    const bodyRow = Array.from({ length: cols }, () =>
      `<td style="border:1px solid #d1d5db;padding:7px 10px;font-size:13px;">&nbsp;</td>`
    ).join('');
    const bodyRows = Array.from({ length: rows - 1 }, () => `<tr>${bodyRow}</tr>`).join('');
    const tableHtml = `
      <table style="border-collapse:collapse;width:100%;margin:12px 0;font-family:Arial,sans-serif;">
        <thead><tr>${headerCells}</tr></thead>
        <tbody>${bodyRows}</tbody>
      </table><p></p>`;
    document.execCommand('insertHTML', false, tableHtml);
    edEl.focus();
  });

  // Insert color block
  overlay.querySelector('#_ncInsertBlock').addEventListener('click', () => {
    const colors = [
      { label: 'Blue (info)',    bg: '#eff6ff', border: '#bfdbfe', text: '#1e40af' },
      { label: 'Green (success)',bg: '#f0fdf4', border: '#bbf7d0', text: '#166534' },
      { label: 'Yellow (note)',  bg: '#fefce8', border: '#fde68a', text: '#92400e' },
      { label: 'Red (alert)',    bg: '#fef2f2', border: '#fecaca', text: '#991b1b' },
      { label: 'Purple (highlight)', bg: '#faf5ff', border: '#e9d5ff', text: '#6b21a8' },
      { label: 'Gray (neutral)', bg: '#f9fafb', border: '#e5e7eb', text: '#374151' },
    ];
    const choice = prompt(
      'Choose a color block style:\n' +
      colors.map((c, i) => `${i + 1}. ${c.label}`).join('\n') +
      '\n\nEnter a number (1-6):',
      '1'
    );
    const idx = parseInt(choice || '1', 10) - 1;
    const c = colors[Math.max(0, Math.min(idx, colors.length - 1))];
    const blockHtml = `
      <div style="margin:12px 0;padding:14px 16px;border-radius:10px;
                  background:${c.bg};border:1px solid ${c.border};color:${c.text};
                  font-family:Arial,Helvetica,sans-serif;">
        <p style="margin:0 0 6px;font-size:14px;font-weight:700;">${c.label} heading</p>
        <p style="margin:0;font-size:13px;line-height:1.6;">Block content goes here. Click to edit.</p>
      </div><p></p>`;
    document.execCommand('insertHTML', false, blockHtml);
    edEl.focus();
  });

  // ── Save ─────────────────────────────────────────────────────────────────
  overlay.querySelector('#_ncSave').addEventListener('click', () => {
    const html = edEl.innerHTML.trim();
    // Don't save placeholder text as real content
    if (hiddenInput) {
      hiddenInput.value = html === '<p>Write your section content here…</p>' ? '' : html;
    }
    overlay.remove();
    // Re-render the editor panel so the status indicator updates
    const section = _sections.find(s => s.id === _selected);
    if (section) {
      section.data.rich_content = hiddenInput?.value || '';
      renderEditor(section);
    }
    toast('Rich content saved — click Apply to commit', 'success');
  });

  overlay.querySelector('#_ncCancel').addEventListener('click', () => overlay.remove());
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
};
