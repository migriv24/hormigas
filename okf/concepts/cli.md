---
type: Concept
title: The CLI
description: The hormiga command — the agent/human terminal surface where every UI action is possible and every CLI action has a UI equivalent, by construction (both call one dispatcher).
resource: hormiga_core/cli.py
tags: [status:current, audience:dev, audience:user, confidence:verified, foundation]
timestamp: 2026-07-02T00:00:00Z
---

> **Built (2026-07-02, Phase 1 slice):** the dispatcher spine is live. Two callers
> exist today — the **Void Console** in the [Developer tab](/ui-ux/developer-tab.md)
> (`POST /api/dev/cli`) and the terminal (`python -m hormiga_core.cli`) — both over
> the same [engine](/concepts/voidcore-convergence.md), state file, and holidays.
> Read verbs, rune/mantle mutation, tagging, undo/redo, `effect query <holiday>`,
> and Voidscript all work. Packaged builds ship the engine vendored
> (`vendor/voidcore/`, Windows native lib; mac/linux degrade gracefully until
> their libs are vendored). Remaining: newsletter render/save glyphs (Phase 3),
> full UI-action → verb conversion (Phase 4).

The founding requirement of the whole [convergence](/concepts/voidcore-convergence.md):
**an AI agent should interact with Hormiga the way a human uses the UI** — all UI
actions possible in the CLI, all CLI actions possible in the UI. This is achieved
structurally, not by parallel implementation: UI and CLI are two callers of the
same Void Core dispatcher, so parity cannot drift.

Two workload families, both tag-driven ([tags](/concepts/tags.md)):

1. **Ingestion + tagging** (the original want): add events, upload images, and
   tag them correctly from the terminal — `effect insert-event`,
   `effect upload-image` with context-driven tag suggestion. Data-driven card
   mechanics: content enters the system correctly classified.
2. **Newsletter assembly**: place blocks carrying tag queries
   (`rune new event-grid june-events`, `set june-events source "@month:june"`),
   `describe` to see what a block *will* resolve without listing the database,
   then `save` to render.

Read verbs land first ([roadmap](/roadmap.md) Phase 1), mutations in Phases 2–3.
Voidscript makes routines repeatable (`monthly-newsletter.void`). The CLI is
also the baseline [UI/UX surface](/ui-ux/principles.md) — the terminal is a
first-class user interface here, not a debug door.
