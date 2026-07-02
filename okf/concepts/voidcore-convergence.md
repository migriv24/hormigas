---
type: Concept
title: Void Core Convergence
description: Hormiga's foundation is being rebuilt on Void Core — hormiga_core embeds the C engine, entities/blocks become runes, the newsletter a mantle, Antfarm nodes holidays.
resource: hormiga_core/engine.py
tags: [status:current, audience:dev, confidence:verified, foundation]
timestamp: 2026-07-02T00:00:00Z
---

> **Phase 1 landed (2026-07-02):** `hormiga_core` embeds the Void Core C engine
> via its Python binding + the `Dispatcher` seam. `engine.py` holds the single
> manager (glyphs registered, holiday registry wired, effect handler bound onto
> Hormiga's [logger](/ui-ux/developer-tab.md), state in `data/void_state.json`).
> The [CLI](/concepts/cli.md) drives it. Remaining phases below.

The decided architectural direction (plan: the
[integration reference](/references/voidcore-integration-doc.md)): a
strangler-fig migration where a new headless core (`hormiga_core`, embedding
Void Core's C engine through its Python binding) grows inside the existing app
until the old data paths are deleted. Not a rewrite — the Electron shell,
renderer, and [section vocabulary](/concepts/sections.md) carry over.

The conceptual mapping:

| Void Core | Hormiga |
|---|---|
| rune | a newsletter block; an event/contact (behind a holiday) |
| glyph | a [section type](/concepts/sections.md) |
| mantle | a newsletter document |
| domain | an output target (HTML export, email send) |
| holiday | an [Antfarm](/concepts/antfarm.md) node |
| tag | [the existing tag system](/concepts/tags.md), axis-typed |

The killer workflow this exists for: an agent builds a newsletter through the
[CLI](/concepts/cli.md) by placing blocks that carry **tag queries**
(`set source "@month:june AND type:event"`), resolved through a holiday at
render — never dumping the database. Owned content is materialized; backed data
stays behind holidays. One spine rule: the dispatcher binds onto Hormiga's
existing logger, undo stack, and tag store — never two copies.
