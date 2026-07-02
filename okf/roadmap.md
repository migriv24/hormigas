---
type: Roadmap
title: Roadmap
description: Forward-looking index of planned work and its order — the Void Core convergence phases. Completed work moves to log.md, not here.
tags: [status:current, audience:dev, confidence:asserted, roadmap]
timestamp: 2026-07-01T00:00:00Z
---

What is **planned** and the order we intend to build it, mirroring
`VOIDCORE_INTEGRATION.md` §4 (see [the reference](/references/voidcore-integration-doc.md)).
When something ships it moves to [log.md](/log.md) and out of here.

# Phase 0 — Data rescue (URGENT, hard deadline 2026-08-02)
Resume the paused Supabase project, `pg_dump` everything, land the data locally.
Prerequisite to every phase below.

# Phase 1 — Embed the Void Core engine *(mostly done, 2026-07-02)*
Done: `hormiga_core/` adapter, the engine + Dispatcher seam, the
[CLI](/concepts/cli.md) and Void Console (read + mutation verbs, `effect query`
over live data). **Remaining slice:** bundle `voidcore` + `libvoidcore.dll` into
the PyInstaller build so the console works in packaged releases, not just dev
(see `hormiga.spec` note).

# Phase 2 — Local-first holidays (the [Antfarm](/concepts/antfarm.md) becomes real)
MeshDB as the primary data holiday + snapshot fallback
([offline-first](/concepts/offline-first.md) read MVP); local-FS asset holiday;
`.miga` v2 = the holiday registry with mandatory-passphrase crypto (replacing
[.miga v1](/concepts/miga-file.md)); tag-hygiene `temper` pass over
[the tag system](/concepts/tags.md); ingestion verbs (`effect insert-event`,
`effect upload-image`).

# Phase 3 — Newsletter as mantle
Block glyphs with `render → HTML` reusing the
[section renderers](/concepts/sections.md); query-backed blocks
(`set source "@month:june AND type:event"`); mutation verbs + undo bridged onto
`core/command.py`. The agent builds a newsletter from the CLI.

# Phase 4 — UI convergence + Antfarm editor v0
[Builder](/ui-ux/builder-ux.md) actions emit dispatcher commands (UI ⇄ CLI parity
by construction); [developer tab](/ui-ux/developer-tab.md) shows the dispatcher
log; Antfarm editor v0 = card list of registered holidays with live status. This
bundle grows alongside (it is the app's self-description).

# Phase 5 — Futures (order flexible)
[Studio](/ui-ux/studio-vision.md) block UI · The Queen (LLM holiday) · The
Courier (email dispatch) · Mound (static sites) · Territory/maps via the
Neighborhood convergence (see `VOIDCORE_INTEGRATION.md` §8). Mobile is
deliberately off the radar.
