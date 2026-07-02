---
type: Concept
title: Section Templates
description: The typed section vocabulary — Jinja partials (hero, event_grid, flyer_grid, job_grid, narrative, presenter_cta, …) that render a section payload to email-safe HTML.
resource: templates/newsletter_sections
tags: [status:current, audience:dev, confidence:asserted]
timestamp: 2026-07-01T00:00:00Z
---

Each section type is a Jinja partial in `templates/newsletter_sections/` that
takes a section payload and emits **email-safe HTML** (table layout, inline
styles — the constraint that shapes everything here). Current vocabulary:
`hero`, `event_grid`, `highlight_event`, `flyer_grid`, `job_grid`, `narrative`,
`meeting_highlights`, `meeting_schedule`, `presenter_cta`, `attendee_list`,
`actions_list`, `directory_cta`, `attached_resource`, `footer`.

A section type = payload schema + renderer. In the
[Void Core convergence](/concepts/voidcore-convergence.md) each becomes a
**glyph**: the payload is rune content, the partial is the glyph's
`render(rune, ctx)`. The vocabulary carries over unchanged — this directory is
the seed of the block system, not something the convergence replaces.

The [builder](/concepts/newsletter-builder.md) instantiates these; the
[bilingual](/concepts/bilingual.md) pass renders each twice (EN/ES).
