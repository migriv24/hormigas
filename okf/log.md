# Hormiga — Bundle Log

Dated history of the project and this bundle. Newest first. The forward-looking
counterpart is [roadmap.md](/roadmap.md).

## 2026-07-03 — Void Core 0.2.0: shared tag grammar + POSIX verbs
- Upgraded to Void Core 0.2.0 (vendored). Void Core acted on the Hormiga handoff:
  a `vc_tag_match` FFI (the one C implementation of the SPEC §5 tag grammar), a
  POSIX command surface (`cd`/`pwd`/`rm`/`mv`/`cp`/`mkdir`/`grep`/`man`, root-`ls`
  lists mantles), the `--json` capture bug fixed, and CI that publishes native
  libs for all three platforms.
- Hormiga now filters [holiday](/concepts/antfarm.md) entities through
  `tag_match` — deleted the host-side grammar copy (`hormiga_core/tagexpr.py`),
  so `effect query events "june AND healthcare"` provably means the same as the
  core's `ls --tag`. The [CLI](/concepts/cli.md) inherits the POSIX verbs for
  free (agents can use terminal muscle memory).

## 2026-07-03 — Phase 1 packaging: Void Core ships in the installer
- v1.4.17 exposed the gap: the packaged app's Void Console asked users to
  `pip install` — never acceptable in an installed app. Fixed by **vendoring**:
  `scripts/vendor_voidcore.py` copies Void Core's runtime (python layers +
  `libvoidcore.dll`) into `vendor/voidcore/`, preserving the repo layout the
  package resolves against; the engine falls back to it when the editable
  install is absent (always, in a frozen build).
- `void_state.json` now persists to the Electron data dir
  (`HORMIGA_DATA_DIR`) in packaged builds — never the ephemeral `_MEIPASS`.
- Verified against the real frozen `hormiga-server.exe` before release.

## 2026-07-02 — Void Core Phase 1: the dispatcher spine
- `hormiga_core/` added: the Void Core adapter. `engine.py` (single manager +
  Dispatcher seam + state persistence), `glyphs.py` (14 section glyphs),
  `holidays.py` (contacts/events/images/jobs as data holidays), `effects.py`
  (the effect-handler boundary), `tagexpr.py` (host-side SPEC §5 evaluator),
  `cli.py` (the `hormiga` terminal).
- **Void Console** added to the [Developer tab](/ui-ux/developer-tab.md): a live
  Void Core REPL over `POST /api/dev/cli` — same engine/state as the terminal CLI.
- Verified end-to-end: rune/mantle CRUD, tag filtering, undo/redo, `effect query`
  over live data (contacts 69, events 30, images 65, jobs 8), Voidscript, and
  save through the effect handler. See [the CLI](/concepts/cli.md).

## 2026-07-01 — Fresh public history + this bundle
- Repo rebooted with a clean single-commit history for open-sourcing (MIT). The
  private development history (2025–2026, v0.1.0 → v1.4.15) is archived privately;
  its hardcoded `.miga` app secret is why it was never published.
- Releases + auto-updater rerouted to GitHub Releases on the public repo itself
  (`migriv24/hormigas`), replacing the separate `hormiga-releases` repo.
- This OKF bundle created, validated with Void Core's OKF engine.
- `VOIDCORE_INTEGRATION.md` reworked (v2): convergence onto Void Core decided —
  strangler migration, MeshDB as primary data holiday, phased plan.

## 2026-06 — v1.4.x stable line
- v1.4.15: resources overlay fix, contact internal notes, feature docs.
- Apr+May newsletter template; June 2026 newsletter shipped from the app.
- `ANTFARM.md` and the first Void Core integration brainstorm written.

## 2026-05 — The Supabase pause (the architectural trigger)
- The free-tier Supabase project paused (2026-05-03); contacts/events/orgs/jobs
  returned 503. Exposed the single-point-of-failure risk that drives the
  [Antfarm](/concepts/antfarm.md) local-first shift.

## 2025→2026-04 — Private development (summary)
- v0.1: Electron shell, PyInstaller-bundled Flask server, auto-updater.
- v1.0: Supabase migration (REST repository), three-tier storage model.
- v1.2: `.miga` credential files (AES-256-GCM), landing page, recent databases.
- v1.3–1.4: images/resources/jobs/orgs tabs, connections graph, developer tab,
  bilingual section renderer, monthly LON newsletters in production use.
