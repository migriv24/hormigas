/**
 * syntax_engine.js — Pluggable field syntax parser.
 *
 * Mini-API
 * --------
 *   SyntaxEngine.addRule(rule)        Register a SyntaxRule; returns SyntaxEngine (chainable)
 *   SyntaxEngine.removeRule(id)       Unregister by id; returns SyntaxEngine
 *   SyntaxEngine.getRules()           Array of registered rules (copy)
 *   SyntaxEngine.detect(text)         {rule, match} | null — first rule whose trigger matches
 *   SyntaxEngine.getCandidates(text)  async → {rule, candidates} | null
 *   SyntaxEngine.install(inputEl)     Wire one <input> to the engine (returns {remove})
 *   SyntaxEngine.installAll(container)Wire all [data-se] inputs inside container
 *
 * Rule shape
 * ----------
 *   {
 *     id:               string        — unique identifier
 *     label:            string        — shown as a hint badge in the UI
 *     description:      string        — tooltip / help text (optional)
 *     trigger:          RegExp        — tested against current field value; match[1] is the fragment
 *     fetchCandidates:  async (match, fullText) => Candidate[]
 *     resolve:          (candidate, fullText) => string   — returns new field value
 *   }
 *
 * Candidate shape
 * ---------------
 *   { value, label, sublabel?, badge?, badgeType?, meta?, _mode? }
 *
 * Default rules (registered at bottom of this file)
 * ------------------------------------------------
 *   "tag-filter"  — #fragment  and  #tag1 #tag2 entity_fragment
 *   "name-link"   — [[fragment    → resolves to contact name
 *   "org-link"    — [fragment     → resolves to org name
 *
 * Adding a custom rule
 * --------------------
 *   SyntaxEngine.addRule({
 *     id: 'my-rule',
 *     label: 'My Rule',
 *     trigger: /@@(\w*)$/,
 *     fetchCandidates: async (match) => [{ value: 'foo', label: 'Foo' }],
 *     resolve: (candidate, text) => text.replace(/@@\w*$/, candidate.value),
 *   });
 */

const SyntaxEngine = (() => {

  // ── Internal state ─────────────────────────────────────────────────────────

  const _rules = [];

  // ── Public API ─────────────────────────────────────────────────────────────

  function addRule(rule) {
    _rules.push(rule);
    return pub;
  }

  function removeRule(id) {
    const idx = _rules.findIndex(r => r.id === id);
    if (idx >= 0) _rules.splice(idx, 1);
    return pub;
  }

  function getRules() {
    return [..._rules];
  }

  /** Return {rule, match} for the first rule whose trigger matches text, else null. */
  function detect(text) {
    for (const rule of _rules) {
      const m = text.match(rule.trigger);
      if (m) return { rule, match: m };
    }
    return null;
  }

  /** Async — returns {rule, candidates} or null if no rule active. */
  async function getCandidates(text) {
    const active = detect(text);
    if (!active) return null;
    const candidates = await active.rule.fetchCandidates(active.match, text);
    return { rule: active.rule, candidates: candidates || [] };
  }

  // ── Install on an input element ────────────────────────────────────────────

  /**
   * Wire the SyntaxEngine to `inputEl`.
   * When a syntax rule is active, a custom floating dropdown is shown.
   * When no rule is active, the native <datalist> (if any) takes over.
   * Returns { remove } to clean up listeners.
   */
  function install(inputEl) {
    let _dd = null;
    let _candidates = [];
    let _selIdx = -1;
    let _destroyed = false;

    // ── Dropdown rendering ─────────────────────────────────────────────────

    function _showDropdown(candidates, rule) {
      _clearDropdown();
      if (!candidates.length) return;
      _candidates = candidates;
      _selIdx = -1;

      _dd = document.createElement('div');
      _dd.className = 'se-dropdown';
      _positionDropdown();
      _renderItems();
      document.body.appendChild(_dd);
    }

    function _positionDropdown() {
      if (!_dd) return;
      const r = inputEl.getBoundingClientRect();
      _dd.style.cssText = [
        `position:fixed`,
        `top:${r.bottom + 3}px`,
        `left:${r.left}px`,
        `width:${Math.max(r.width, 300)}px`,
        `z-index:9999`,
      ].join(';');
    }

    function _renderItems() {
      if (!_dd) return;
      _dd.innerHTML = _candidates.slice(0, 24).map((c, i) => `
        <div class="se-option${i === _selIdx ? ' se-option-active' : ''}" data-idx="${i}">
          ${c.badge ? `<span class="se-option-badge se-badge-${_seEsc(c.badgeType || '')}">${_seEsc(c.badge)}</span>` : ''}
          <span class="se-option-label">${_seEsc(c.label)}</span>
          ${c.sublabel ? `<span class="se-option-sub">${_seEsc(c.sublabel)}</span>` : ''}
        </div>
      `).join('');
      _dd.querySelectorAll('.se-option').forEach(el => {
        el.addEventListener('mousedown', e => {
          e.preventDefault();
          _pick(_candidates[+el.dataset.idx]);
        });
      });
    }

    function _clearDropdown() {
      if (_dd) { _dd.remove(); _dd = null; }
      _candidates = [];
      _selIdx = -1;
    }

    function _highlight(idx) {
      _selIdx = idx;
      if (!_dd) return;
      _dd.querySelectorAll('.se-option').forEach((el, i) =>
        el.classList.toggle('se-option-active', i === idx)
      );
      // Scroll into view
      _dd.querySelectorAll('.se-option')[idx]?.scrollIntoView({ block: 'nearest' });
    }

    // ── Hint badge ────────────────────────────────────────────────────────

    function _showHint(rule) {
      let hint = inputEl._seHint;
      if (!hint) {
        const wrap = inputEl.parentNode;
        if (wrap) wrap.style.position = 'relative';
        hint = document.createElement('span');
        hint.className = 'se-hint';
        if (wrap) wrap.appendChild(hint);
        inputEl._seHint = hint;
      }
      hint.textContent = rule.label;
      hint.style.display = '';
    }

    function _hideHint() {
      if (inputEl._seHint) inputEl._seHint.style.display = 'none';
    }

    // ── Pick a candidate ─────────────────────────────────────────────────

    function _pick(candidate) {
      const active = detect(inputEl.value);
      if (!active) return;
      const newVal = active.rule.resolve(candidate, inputEl.value);
      inputEl.value = newVal;
      _clearDropdown();
      _hideHint();
      // Re-trigger: if the resolved value still matches a rule (e.g. after
      // selecting a tag the #tag mode continues), refresh immediately.
      setTimeout(_handleInput, 0);
    }

    // ── Input handler ─────────────────────────────────────────────────────

    async function _handleInput() {
      if (_destroyed) return;
      const text = inputEl.value;
      const result = await getCandidates(text);
      if (result && result.candidates.length) {
        _showDropdown(result.candidates, result.rule);
        _showHint(result.rule);
      } else {
        _clearDropdown();
        _hideHint();
      }
    }

    // ── Keyboard navigation ───────────────────────────────────────────────

    function _onKeyDown(e) {
      if (!_dd) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        _highlight(Math.min(_selIdx + 1, _candidates.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        _highlight(Math.max(_selIdx - 1, 0));
      } else if (e.key === 'Enter' && _selIdx >= 0) {
        e.preventDefault();
        e.stopPropagation();
        _pick(_candidates[_selIdx]);
      } else if (e.key === 'Escape') {
        _clearDropdown();
        _hideHint();
      }
    }

    function _onBlur() {
      setTimeout(() => { _clearDropdown(); _hideHint(); }, 160);
    }

    // Reposition on scroll/resize
    function _onScroll() { _positionDropdown(); }

    inputEl.addEventListener('input',   _handleInput);
    inputEl.addEventListener('keydown', _onKeyDown);
    inputEl.addEventListener('blur',    _onBlur);
    window.addEventListener('scroll',   _onScroll, { passive: true });
    window.addEventListener('resize',   _onScroll, { passive: true });

    return {
      remove() {
        _destroyed = true;
        _clearDropdown();
        _hideHint();
        inputEl.removeEventListener('input',   _handleInput);
        inputEl.removeEventListener('keydown', _onKeyDown);
        inputEl.removeEventListener('blur',    _onBlur);
        window.removeEventListener('scroll',   _onScroll);
        window.removeEventListener('resize',   _onScroll);
      }
    };
  }

  /** Wire all [data-se] inputs inside a container. */
  function installAll(container = document) {
    container.querySelectorAll('[data-se]').forEach(inp => install(inp));
  }

  // ── Shared escape helper (not exported) ───────────────────────────────────

  function _seEsc(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  const pub = { addRule, removeRule, getRules, detect, getCandidates, install, installAll };
  return pub;

})();


// ════════════════════════════════════════════════════════════════════════════
// Default Rules
// ════════════════════════════════════════════════════════════════════════════

// Node cache (shared across rules, TTL 30 s)
const _SE = (() => {
  let _cache = null;
  let _cacheTs = 0;

  async function nodes() {
    const now = Date.now();
    if (_cache && now - _cacheTs < 30_000) return _cache;
    try {
      const res  = await fetch('/api/graph/nodes');
      const json = await res.json();
      _cache  = json.ok ? json.data : [];
      _cacheTs = now;
    } catch { _cache = _cache || []; }
    return _cache;
  }

  function invalidate() { _cache = null; }

  /** Fetch neighbors of a node via the graph API. */
  async function neighbors(nodeId, relation, direction = 'both') {
    try {
      const params = new URLSearchParams({ relation, direction });
      const res  = await fetch(`/api/graph/neighbors/${encodeURIComponent(nodeId)}?${params}`);
      const json = await res.json();
      return json.ok ? json.data : [];
    } catch { return []; }
  }

  return { nodes, neighbors, invalidate };
})();

// Expose cache invalidation so connections_tab.js can call it after mutations.
window._seInvalidateCache = () => _SE.invalidate();


// ── Rule: #tag filter ──────────────────────────────────────────────────────
//
//  #serv           → show tags matching "serv"
//  #service_worker → (after space) still in tag mode, can add more tags
//  #service_worker Bob → show contacts/orgs with that tag, name starts "Bob"
//  #t1 #t2 Bob     → AND filter by both tags

SyntaxEngine.addRule({
  id: 'tag-filter',
  label: 'Tag filter — #tag …',
  description: 'Narrow suggestions by tag. Multiple #tags use AND logic. Select an entity name to resolve.',
  // Matches when the text contains at least one # token (complete or in-progress)
  trigger: /^((?:#\w+\s+)*)#?(\w*)$/,

  fetchCandidates: async (match, text) => {
    const allNodes = await _SE.nodes();
    const tags     = allNodes.filter(n => n.type === 'tag');

    // Is the cursor currently typing a #fragment?
    const typingTagM = text.match(/(?:^|\s)#(\w*)$/);
    if (typingTagM) {
      const frag = typingTagM[1].toLowerCase();
      return tags
        .filter(t => t.label.toLowerCase().startsWith(frag))
        .map(t => ({
          value:     t.id,
          label:     '#' + t.label,
          badge:     '🏷',
          badgeType: 'tag',
          meta:      t,
          _mode:     'tag',
        }));
    }

    // All tokens are complete #tags; show entities filtered by ALL of them
    const completeTags = [...text.matchAll(/#(\w+)\s/g)].map(m => m[1].toLowerCase());
    const entityFrag   = (text.match(/\s(\w+)$/) || [])[1]?.toLowerCase() || '';

    if (!completeTags.length) return [];

    const tagNodes = completeTags
      .map(tl => tags.find(t => t.label.toLowerCase() === tl))
      .filter(Boolean);

    // Intersect entity sets across tags (AND logic)
    const sets = await Promise.all(
      tagNodes.map(async tn => {
        const nb = await _SE.neighbors(tn.id, 'tagged', 'in');
        return new Set(nb.map(n => n.id));
      })
    );
    let intersection = sets[0] || new Set();
    for (let i = 1; i < sets.length; i++) {
      intersection = new Set([...intersection].filter(id => sets[i].has(id)));
    }

    return allNodes
      .filter(n => intersection.has(n.id))
      .filter(n => !entityFrag || n.label.toLowerCase().startsWith(entityFrag))
      .map(n => ({
        value:    n.label,
        label:    n.label,
        sublabel: n.type,
        badge:    n.type === 'contact' ? '👤' : '🏢',
        meta:     n,
        _mode:    'entity',
      }));
  },

  resolve: (candidate, text) => {
    if (candidate._mode === 'tag') {
      // Replace the trailing incomplete #fragment with the full tag + space
      return text.replace(/(?:^|\s)#(\w*)$/, m =>
        m.startsWith(' ') ? ' #' + candidate.meta.label + ' ' : '#' + candidate.meta.label + ' '
      );
    }
    // Entity selected — replace the entire #… query with just the entity name
    return candidate.value;
  },
});


// ── Rule: [[name link ──────────────────────────────────────────────────────
//
//  [[Sam        → show contacts whose name includes "Sam"
//  Resolves to: plain name (brackets removed)

SyntaxEngine.addRule({
  id: 'name-link',
  label: 'Name link — [[name',
  description: 'Search contacts by name. Resolves to plain name on select.',
  trigger: /\[\[([^\]]*)$/,

  fetchCandidates: async (match, _text) => {
    const frag = match[1].toLowerCase();
    const allNodes = await _SE.nodes();
    return allNodes
      .filter(n => n.type === 'contact' && n.label.toLowerCase().includes(frag))
      .map(n => ({
        value:    n.label,
        label:    n.label,
        sublabel: n.attrs?.org || 'contact',
        badge:    '👤',
        meta:     n,
        _mode:    'entity',
      }));
  },

  resolve: (candidate, text) =>
    // Strip everything from [[ onward and replace with resolved name
    text.replace(/\[\[[^\]]*$/, candidate.value),
});


// ── Rule: [org link ────────────────────────────────────────────────────────
//
//  [Lati        → show orgs whose name includes "Lati"
//  Resolves to: plain org name (bracket removed)
//  Note: must NOT match [[ (that is handled by name-link above)

SyntaxEngine.addRule({
  id: 'org-link',
  label: 'Org link — [org',
  description: 'Search organizations by name. Resolves to plain org name on select.',
  // Negative lookbehind ensures we don't steal [[ from name-link
  trigger: /(?<!\[)\[(?!\[)([^\[\]]*)$/,

  fetchCandidates: async (match, _text) => {
    const frag = match[1].toLowerCase();
    const allNodes = await _SE.nodes();
    return allNodes
      .filter(n => n.type === 'org' && n.label.toLowerCase().includes(frag))
      .map(n => ({
        value:    n.label,
        label:    n.label,
        sublabel: 'organization',
        badge:    '🏢',
        meta:     n,
        _mode:    'entity',
      }));
  },

  resolve: (candidate, text) =>
    text.replace(/(?<!\[)\[(?!\[)[^\[\]]*$/, candidate.value),
});
