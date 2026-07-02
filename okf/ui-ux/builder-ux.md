---
type: Concept
title: Builder UX
description: The newsletter-building flow — a section list canvas with per-section forms, paired EN/ES editing tabs, live preview, and project save/load.
resource: static/js/builder.js
tags: [status:current, audience:dev, audience:user, confidence:asserted]
timestamp: 2026-07-01T00:00:00Z
---

The Newsletter tab is a three-zone flow:

1. **Section canvas** — the newsletter as an ordered, reorderable list of
   [typed sections](/concepts/sections.md); add-section picker, select to edit,
   visible selection state.
2. **Section editor** — a form per section type. Data-driven sections (event
   grid, flyer grid, job grid) take a **tag filter** instead of hand-picked
   rows — the user expresses *what belongs here* and the render resolves it
   ([tags](/concepts/tags.md)). Authored sections take rich text and image
   pickers wired to the Images tab's library.
3. **Preview + export** — rendered EN/ES HTML, exportable for email sending.

Language handling per [principles](/ui-ux/principles.md) #2: EN/ES are paired
tabs inside each section editor (`.lang-tab`), with machine translation
([bilingual](/concepts/bilingual.md)) as an editable draft.

Known UX debts, carried openly: form-heavy editing is the least teachable part
of the app (the argument for [Studio](/ui-ux/studio-vision.md)); bulk tag
operations are missing from list views; undo is not yet surfaced in the
builder (arrives with the dispatcher in Phase 3–4, [roadmap](/roadmap.md)).
In the [convergence](/concepts/voidcore-convergence.md), every canvas action
becomes a dispatcher verb — same flow, replayable spine.
