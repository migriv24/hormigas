---
type: Concept
title: Newsletter Builder
description: Section-based bilingual email composition — the user assembles typed sections (hero, event grid, narrative, …) that render to EN/ES HTML email.
resource: static/js/builder.js
tags: [status:current, audience:dev, audience:user, confidence:asserted, foundation]
timestamp: 2026-07-01T00:00:00Z
---

The builder composes a newsletter as an ordered list of **typed sections** — each
a [section template](/concepts/sections.md) with a data payload (title, text,
tag filter, image refs). Rendering is a two-pass pipeline
(`services/newsletter_service.py`): resolve data-driven sections against the
[Data Manager](/concepts/data-manager.md) (an event grid pulls events by
[tag](/concepts/tags.md)), then render [bilingual](/concepts/bilingual.md)
EN/ES HTML email.

Some sections are **data-driven** (event grid, job grid, flyer grid resolve a
tag filter at render time — the seed of query-backed blocks); others are
**authored** (hero, narrative, highlights). This split maps exactly onto Void
Core's owned-vs-backed rune distinction, which is why the
[convergence](/concepts/voidcore-convergence.md) models the newsletter as a
mantle of block-runes.

Projects save as JSON documents (`schemas/newsletter.py`) — device-portable
because entity references resolve through the shared database. The builder's
user surface and flows are described in [builder UX](/ui-ux/builder-ux.md);
its planned successor is [Studio](/ui-ux/studio-vision.md).
