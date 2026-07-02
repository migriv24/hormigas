# Void Core × Hormiga — Convergence Plan (v2)

> **Status: reworked 2026-07-01.** This replaces the earlier brainstorm, which was
> written before Void Core became what it is now. The old doc's central problem —
> "Void Core is Node.js, Hormiga is Python, so we must *port* Void Core to Python" —
> **no longer exists**. Void Core today is a C core (`libvoidcore.dll`) with a Python
> ctypes binding, a Python transform seam (`voidcore.Dispatcher`), a conformance
> suite, and working holidays (MeshDB, localjson, graph, OKF). Hormiga can embed it
> directly.
>
> Companion docs: `ANTFARM.md` (this repo), `../VoidCore/SPEC.md` (the contract,
> §10 is the Hormiga extension), `../VoidCore/okf/` (the knowledge bundle).

---

## 0. The decision: integrate, rewrite, or both?

Three options were on the table:

| Option | What it means | Verdict |
|---|---|---|
| **A. Integrate in place** | Bolt Void Core onto Hormiga as-is; routes keep doing what they do | Too timid. Mutations would keep bypassing the dispatcher; the CLI⇄UI parity goal never lands. |
| **B. New application from scratch** | Greenfield app on Void Core; Hormiga is retired | Too expensive. Freezes user value for months, discards working assets (Electron shell, updater, CI, newsletter renderer, translation, compositor plans), and invites another scope balloon. |
| **C. New core, same organism** (chosen) | Build the *new foundation* as a headless, Void Core-hosted package (`hormiga_core` + a real `hormiga` CLI). The existing Flask/Electron app becomes a **client** of that core and delegates to it route by route. | Gets ~90% of the rewrite's benefit at ~30% of the cost, and the newsletter keeps shipping every month. |

**Why C:** the part of Hormiga that is actually broken or mis-founded is the **data
and command layer** — Supabase coupling, mutations scattered across 1,500 lines of
Flask routes, free-text tag drift, no single authoritative command spine. That layer
gets replaced *in either scenario*. The parts a rewrite would rebuild from scratch —
Electron shell, auto-updater, release CI, bilingual rendering, the tab UI — are
Hormiga's *working assets*, not its mistakes. A "new app" would spend its first three
months converging back to what already exists.

This is a strangler-fig migration: the new core grows inside the old body until the
old data paths are dead, then the old paths are deleted. If, at the end, the UI gets
rebuilt too (see §6), what remains is indistinguishable from "a new application" —
but at no point was there a months-long gap with nothing shippable.

### 0.5 Open-sourcing: new *repo*, not new *app*

Hormiga is going open source (OSI-approved license). This resolves the last pull
toward "start a new application": we get the clean break **at the repository level**
while keeping the strangler migration at the code level.

**Decision: a fresh public repo. The current repo's history is never published.**

Why history can't ship, even though the audit looks decent:
- `.gitignore` correctly excludes credentials, `.miga`, HTML/XLSX exports, backups,
  and `mid_june_2026_mats/` (all currently untracked — verified). A file-name scan
  of full history shows no data files were ever committed.
- **But `electron/credentials.js` hardcodes `APP_SECRET`** — the passphrase that
  encrypts every password-less `.miga` v1 file — and its comment explicitly states
  the security model is "source is private." It is in history and cannot be
  scrubbed retroactively from clones. Publishing history = every circulating
  `.miga` v1 without a user password becomes decryptable.

The publish path (folds into Phase 1, since the new repo is where `hormiga_core`
gets built anyway):
1. **New repo** (public from day one keeps us honest): app code copied over
   file-by-file — code only, never data. Old repo stays private as the archive +
   the record of the LON deployment.
2. **Secrets gate before first push**: run gitleaks/trufflehog over the copied
   tree; `settings.example.json` only; grep for the org's real names/emails in
   comments and fixtures.
3. **`.miga` v2 crypto is redesigned for a public world** (Phase 2): mandatory
   user passphrase (or OS keychain), PBKDF2/argon2 — **no hardcoded fallback
   secret, ever**. v1 files are imported (decrypted with the old secret locally)
   and re-encrypted; the old `APP_SECRET` is treated as burned.
4. **License: MIT**, matching Void Core (already MIT on GitHub) — free, permissive,
   OSI-approved, zero friction between the two repos. (If copyleft ever matters,
   that's a deliberate later conversation; default is consistency.)
5. Release infra carries over: `hormiga-releases` already exists as a separate
   repo; electron-updater works the same from a public source repo.

Working rule from here on: **the repo root is a public artifact.** Newsletter
exports, member spreadsheets, meeting materials live outside the repo (or in an
ignored `local/` directory), not beside the code.

### What "the core mistakes" actually are, and where each gets fixed

| Mistake in current Hormiga | Fixed by | Phase |
|---|---|---|
| Cloud backend is a hard dependency (Supabase pause = app death) | Holidays: SQLite + local FS as default nodes; cloud nodes optional | 2 |
| No single command spine — routes mutate stores directly; the action log is observational, not authoritative | Every mutation becomes a dispatcher verb: logged, undoable, dirty-tracked, replayable | 1–4 |
| CLI/agent access is an afterthought | The dispatcher IS the API; CLI and UI are two callers of the same verbs — parity by construction | 1 |
| Free-text tags drift (`may` / `May` / `may2026`) | Axis-typed tag system + `temper` normalization passes (tag hygiene as a registered, idempotent rule) | 2 |
| Section-based builder is rigid, form-driven | Newsletter = mantle; blocks = runes with block glyphs; query-backed sources | 3 |
| `.miga` v1 is a flat key bag | `.miga` v2 = the holiday registry (topology + encrypted credentials) | 2 |
| `app.py` is a 1,500-line route monolith | Routes shrink to thin `dispatch(...)` shims; logic lives in `hormiga_core` | 4 |
| Undo/redo, logging, events exist but are Hormiga-private | Reconciled with the core's spine (SPEC §9 explicitly requires binding onto them, not duplicating) | 1 |

---

## 1. What changed since the old doc (why the plan is different)

1. **No port needed.** The C core exists and builds (`core/build/bin/libvoidcore.dll`);
   the Python binding (`bindings/python/voidcore.py`) wraps it with everything crossing
   as JSON. `pip install -e ../VoidCore` + bundling one DLL into the PyInstaller spec
   replaces the entire "write voidcore_py" phase of the old plan.
2. **The transform layers exist.** `scry` / `temper` / `materialize` / `reduce` are
   built and tested in Python (`voidcore.Dispatcher`, a superset of the core dispatch).
   Hormiga gets projection (scry), normalization (temper — tag hygiene!), and
   derived mantles (reduce) for free.
3. **The holiday seam is real.** `VoidCore.set_effect_handler(fn)` is bound; the
   generic `effect <op> [args...]` verb routes arbitrary host operations through it.
   `effect query "<tagexpr>"` — the query-backed read the old doc called the killer
   feature — is reachable *today*.
4. **MeshDB exists** as a verified local graph BaaS holiday. The "Antfarm BaaS"
   concept Hormiga ballooned toward is already a working component on the Void Core
   side (see §5 for the SQLite-vs-MeshDB call).
5. **SPEC §10 already specifies the Hormiga extensions** (holiday interface,
   query-backed lazy mantle) as `[ext]`. The contract half of this integration is
   written; what remains is the implementation half — in Hormiga, not in Void Core.

**The conceptual mapping from the old doc stands unchanged** and is now partly
normative (SPEC §10): block/event/contact = rune, block type = glyph, newsletter
document = mantle, output target = domain, Antfarm node = **holiday**, `.miga`
topology = holiday registry. Owned content is materialized in state; backed data
(events, contacts) stays behind a holiday and is reached by tag query.

---

## 2. Language question, settled

**Keep Python as the host language. Do not rewrite Hormiga in Rust or C++.**

- Hormiga is **I/O-bound** — DB reads, image uploads, HTML rendering, translation
  API calls. Python is not the bottleneck anywhere a user can feel; a Rust rewrite
  would make the slow parts exactly as slow (they're network calls) and cost months.
- The performance-sensitive kernel **already is C** — that's what `libvoidcore.dll`
  is. The division of labor is right: fast frozen kernel in C, malleable host in
  Python, UI in the browser.
- MeshDB shows the pattern for wanting other languages: reach them **over a
  protocol** (Bolt), don't link them in. Rust lives in a child process; nobody
  rewrote anything.
- SPEC.md is deliberately language-agnostic with a conformance suite. If a future
  needs a different host (a Rust server binary, a mobile embed), that door stays
  open *because* the contract is the spec, not the Python code. That optionality is
  worth more than a speculative rewrite now.
- Real Python pain is **packaging** (PyInstaller), not speed. That pain is already
  paid and working in CI. Revisit only if it breaks.

---

## 3. Architecture

```
VoidCore/  (separate repo, unchanged role: stays isolated, spec-first)
  core/build/bin/libvoidcore.dll   ← the engine
  bindings/python/voidcore.py      ← ctypes binding (VoidCore class)
  voidcore/dispatch.py             ← Dispatcher seam (+ scry/temper/reduce verbs)
  holidays/                        ← meshdb, localjson, graph, okf
  conformance/                     ← both sides run this

Hormiga/
  hormiga_core/                    ← NEW: the adapter package (the real work)
    engine.py                      ← creates VoidCore + Dispatcher, loads state,
                                     binds core log → core/logger.py (SPEC §9 note)
    glyphs.py                      ← block glyphs: hero, event_grid, narrative,
                                     presenter_cta, image, jobs_grid, …
                                     each with describe / newContent / render→HTML
    effects.py                     ← the effect handler: routes save/query/insert/
                                     upload/render ops onto Hormiga services
    holidays/
      meshdb_data.py               ← PRIMARY data holiday (contacts/events/orgs/jobs
                                     as runes; tags as edges) — wraps VoidCore's
                                     MeshDBHoliday.local_baas()
      snapshot_data.py             ← localjson fallback: read-only mirror kept in
                                     sync, loads when meshdb-server can't spawn
      localfs_assets.py            ← AssetProtocol holiday (images/resources)
      supabase_data.py             ← existing repo wrapped as an *optional* holiday
      imgbb_assets.py              ← same, for images
      sheets_output.py             ← OutputProtocol holiday
    miga2.py                       ← .miga v2 = encrypted holiday-registry document
    undo_bridge.py                 ← reconcile core undo frames ↔ core/command.py
  cli.py → `hormiga <verb> …`      ← entry point; same dispatcher the UI calls
  app.py                           ← Flask routes progressively become
                                     `return dispatch(f"…")` shims
  static/js, templates/            ← UI unchanged at first; converges in Phase 4
```

Rules of the split:

- **Void Core repo gains nothing Hormiga-specific.** Hormiga-only behavior lives in
  `hormiga_core`. If a need turns out to be general (it keeps happening), it goes
  through SPEC.md first, as §10 did.
- **One spine.** Per SPEC §9: the dispatcher binds onto Hormiga's existing logger,
  undo stack (`core/command.py`), event bus, and tag store. Never two loggers, never
  two undo stacks. The `undo_bridge` makes a dispatcher undo frame and a legacy
  command-stack entry the same object.
- **Undo boundary** (old open question, now decided): undo covers **owned mantle
  state only**. Writes through a holiday (an event edited in SQLite/Supabase) are
  *not* undoable by the core — they are logged, and holidays MAY offer their own
  compensation later. Placing/removing a query-block is undoable; the data it
  queries is not. Snapshotting (`materialize`) is the explicit, undoable bake.

---

## 4. Phases

### Phase 0 — Rescue (now; hard deadline 2026-08-02)
- Resume the paused Supabase project, `pg_dump` everything, and land the data in a
  local SQLite file + raw JSON snapshot. **This is prerequisite to every plan and is
  overdue-urgent.**
- The stable branch keeps shipping monthly newsletters throughout all phases.

### Phase 1 — Embed the engine (≈1–2 weeks)
- **Stand up the fresh public repo** (§0.5): copy the app tree file-by-file (code
  only), gitleaks gate, MIT license, `settings.example.json`. This repo is where
  everything below is built; the old repo goes read-only as the private archive.
- `pip install -e ../VoidCore`; add `libvoidcore.dll` to `hormiga.spec` (PyInstaller)
  and verify it loads from the bundle. CI: build the DLL or vendor the built artifact.
- `hormiga_core/engine.py`: state document lives in userData; glyph registration;
  logger binding; effect handler stub.
- `hormiga` CLI with **read verbs only**: `describe`, `ls --tag`, `find`, `get`,
  `scry`, `axes`, plus `effect query "<tagexpr>"` reading through the *existing*
  repositories (even Supabase/snapshot, pre-SQLite). Model the current newsletter
  as a mantle read-only.
- **Deliverable: an agent can inspect Hormiga by tag without dumping the database.**
  Lowest risk; nothing user-facing changes.

### Phase 2 — Local-first holidays: the Antfarm becomes real (≈2–4 weeks)
- **MeshDB as the primary data holiday** (see §5): contacts/events/orgs/jobs land
  as runes with tags as edges; the recovered Supabase data is imported once.
  Packaging: ship `meshdb-server` as an electron-builder `extraResources` binary;
  `MeshDBHoliday.local_baas()` (already built & verified in VoidCore) owns
  spawn/attach lifecycle, tied to the Flask process lifetime.
- **Snapshot fallback holiday** (Antfarm principle: no single node kills the app):
  every successful session mirrors to a local JSON snapshot; if the server binary
  fails to spawn, the app opens read-only on the snapshot with an offline banner.
  This also delivers FUTURES §C's offline-read MVP as a side effect.
- `localfs_assets.py` for images/resources. Wrap Supabase/ImgBB/Sheets as optional
  holidays with the same interfaces.
- `.miga` v2 = the holiday registry (ANTFARM.md's node topology), field-level
  credential encryption with **mandatory user passphrase** (§0.5 — no app-level
  fallback secret); v1 files import via a one-way local shim.
- Flask data routes switch to reading/writing **through the holiday layer** (the
  repository interface becomes the holiday adapter). App works fully offline.
- Tag hygiene: define the namespace→axis map for Hormiga's existing tags
  (`month:`→when, `type:`→what, `status:`→state, …) and a `temper` pass that
  normalizes case/aliases. This *is* the Tag Management Panel's engine (FUTURES §D).
- **Ingestion verbs** land here: `effect insert-event`, `effect upload-image` with
  tag suggestion — the CLI-for-ingestion/tagging goal, usable by an agent.
- **Deliverable: Supabase can never kill the app again; ANTFARM.md's steps 1–5 done.**

### Phase 3 — Newsletter as mantle (the Studio engine + the killer workflow)
- Block glyphs with `render(rune, ctx) → HTML` reusing `newsletter_service`'s
  existing section renderers. One newsletter document = one mantle; the org = the
  host with many newsletter mantles.
- Query-backed blocks: `set june-events source "@month:june AND type:event"` —
  resolved through the data holiday at render, optionally `materialize`d (snapshot)
  at save. Mutation verbs + undo bridge wired.
- `save` = persist mantle + render HTML artifact; `deploy` = export (later: send).
- Voidscript: a `monthly-newsletter.void` script that scaffolds a month's issue
  (the "Quick Start from Month" of FUTURES §G, done properly).
- **Deliverable: an agent builds a newsletter from the CLI by placing tag-queried
  blocks — the workflow this whole convergence exists for.**

### Phase 4 — UI convergence + Antfarm editor v0
- Builder UI actions emit dispatcher commands (`window.hormiga.dispatch(...)`) instead
  of bespoke fetches; UI and CLI are now provably the same surface. Developer tab
  shows the dispatcher log — "copy for LLM" becomes "copy the actual command history."
- Antfarm editor v0 = card list of registered holidays with live `describe()` status
  (exactly ANTFARM.md's step 6). Canvas editor stays deferred.
- Delete the dead direct-mutation paths. This is where the strangler finishes.

### Phase 5 — Futures on the new spine (pick per need, order flexible)
- **Studio UI / UI-UX revamp** — block-based editing view over the Phase-3 mantle
  model. UI/UX is a first-class concern: when Hormiga gets its **own OKF bundle**
  (start it in Phase 4, alongside the editor work), the UI/UX concepts are
  documented extensively there — every view, interaction pattern, and design rule
  with `status:` honesty — feeding Void Core's planned `ui-ux` / app-manifest
  concept with a real consumer.
- **The Queen** — an LLM holiday; but note the *primary* Queen is now any agent
  driving the `hormiga` CLI. The holiday form is for in-app assistance.
- **The Courier / Mound** — OutputProtocol holidays (email dispatch, static site).
- **Maps / Territory ← Neighborhood** — see §8. Maps in newsletters, maps on Mound
  sites, geo-tagged entities. Grows out of the Neighborhood convergence, not built
  from scratch here.
- **Sharing/collab** — `.miga` v2 + MeshDB's multi-node/mesh path when a second
  simultaneous editor actually appears. (Mobile is explicitly off the radar —
  an eventual dream needing its own UI/UX, not a line item on this plan.)

---

## 5. The data holiday: MeshDB (decided)

**MeshDB is the primary local data backend.** This was Miguel's call over the
earlier SQLite-first draft, and the case for it is real, not just preference:

- **The data is graph-shaped.** Hormiga's Connections tab is literally a graph of
  contacts/orgs/events; tags-as-edges makes every tag query (`@month:june AND
  type:event`) a native traversal instead of a LIKE hack over a tags column. The
  weighted tag-graph in SPEC §5 has somewhere to grow.
- **It's the furthest-along holiday** — verified 2026-06-18: full CRUD + describe,
  tag-query parity 7/7 against the core's own `ls --tag`, lifecycle management
  (`local_baas()`) built. Hormiga wiring it end-to-end is exactly the "remaining
  step" the VoidCore component page names.
- **It's the long game**: MeshDB was chosen with mesh networking in mind, which is
  the eventual trust-your-peers sync story for both Hormiga (share with teammates
  you trust, no central server) and Neighborhood (§8 — where PII-grade privacy
  makes cloud BaaS a non-starter).

What making it work requires (the engineering bill, accepted):
1. **Bundle `meshdb-server`** as an electron-builder `extraResources` binary per
   platform; the holiday spawns/attaches (it's a Bolt client + lifecycle manager,
   not a linked dependency — no Rust enters our build).
2. **Lifecycle discipline**: server child process tied to the app's lifetime; port
   collision handling; clean kill on quit (same pattern as the existing Flask
   spawn/health-poll/kill flow — this is a solved problem in this codebase).
3. **The snapshot fallback holiday** (Phase 2) so a corrupted data dir or failed
   spawn degrades to read-only, never to a dead app.

Contingency, stated honestly: if per-platform distribution of `meshdb-server`
turns out to be painful (macOS signing/notarization of a sidecar binary is the
likely friction), the holiday interface means a SQLite data holiday can be slotted
in *for the affected platform* without touching anything above the seam. That is
the escape hatch, not the plan.

---

## 6. Open questions (carried forward, pruned)

- **UI future**: after Phase 4 the vanilla-JS tabs still work but the builder wants
  the Studio treatment. Rebuild builder-only, or the whole shell? Decide *after* the
  dispatcher convergence, with real usage of the CLI informing what the UI even
  needs to be.
- **Multi-app `.miga`**: one holiday registry serving Hormiga + Mound simultaneously
  (ANTFARM.md's multi-app section). Blocked on Mound existing; the registry design
  should just not preclude it.
- **Conflict resolution for sync** (FUTURES §C.5): still the hard problem; the
  holiday boundary localizes it (a `SyncedHoliday` wraps a local + remote pair) but
  does not solve it. Deliberately out of scope until Phase 5.
- **Bindings** (cross-mantle reactions): still deferred; revisit if a block ever
  needs to react to data-state changes rather than being re-rendered.

---

## 7. Relationship to the other documents

- **`ANTFARM.md`** — remains the product-level narrative ("nodes", "protocols",
  `.miga`). Terminology bridge: *Antfarm node = holiday; protocol type = holiday
  interface; `.miga` v2 = holiday registry.* Its "Immediate Next Steps" 1–6 are
  Phases 0–2 and 4 of this document.
- **`FUTURES.md`** — all six features become holidays and/or glyph packs on this
  spine (§4 Phase 5). The Stable-Branch backlog items A/B/E/F remain independent of
  this plan and can ship on the stable branch at any time; §D (tags) and §G
  (auto-constructor) are absorbed by Phases 2 and 3 respectively.
- **`../VoidCore/SPEC.md` §10** — the normative side of this integration. Anything
  this plan needs from Void Core that isn't in the spec goes through a spec change
  first, and Hormiga's implementation runs the `[ext]` conformance cases.

---

## 8. Neighborhood — the third sibling (context, not a work item yet)

`Projects/Neighborhood` is the **first application of this whole effort** — the
offline-first spatial platform (Electron + Leaflet; people/incidents/conditions on
a map; DatasetManager as single source of truth; a planned native core over stdio
IPC). It is currently semi-broken, and fixing it is *not* in this plan's phases.
It's documented here because it shapes three decisions already made above:

1. **It's why MeshDB, and why mesh networking matters.** Neighborhood holds
   directly identifying PII — where people live. That data can never sit in a
   cloud BaaS; it needs local-first storage with peer-to-peer sync among trusted
   devices. MeshDB (local graph BaaS now, mesh networking as its growth path) is
   the backend both apps converge on. Choosing it for Hormiga now means the
   harder app inherits a proven holiday later.
2. **It defines the privacy spectrum the holiday layer must express.** Hormiga's
   data is professional-networking info people chose to publish; Neighborhood's is
   sensitive PII; contacts' internal notes sit in between. Privacy is therefore a
   **property of the holiday** (where data lives, how it's encrypted, whether it
   may leave the device), not of the app — one more reason the registry (.miga v2)
   carries per-node security posture, not just credentials.
3. **It's the future of Territory.** FUTURES.md's Territory (geo layer, maps in
   newsletters, location-aware content) shouldn't be built inside Hormiga from
   scratch — Neighborhood already owns map rendering, geocoding abstraction, and
   spatial entities. The convergence shape, when its time comes: Neighborhood
   becomes a Void Core host app (person/incident/condition = runes; datasets
   behind holidays; its map = its UI over the same dispatcher), and Hormiga's
   Territory consumes a **geo holiday** that Neighborhood provides/shares.
   Neighborhood's own README already wants "engines describe state, UIs render
   it" — that *is* the dispatcher/UI split, independently arrived at.

Independently arrived-at is the pattern worth noticing: Neighborhood's
DatasetManager, Hormiga's Antfarm, and Void Core's holidays are three drafts of
the same idea. The convergence order is: Hormiga proves the spine (this plan),
then Neighborhood is rebuilt on it rather than repaired in place.
