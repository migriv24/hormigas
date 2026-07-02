---
type: Design
title: Studio Vision
description: The planned block-based builder — Scratch-inspired tactile content assembly replacing form-heavy section editing, rendered over the mantle/rune model.
tags: [status:planned, audience:dev, audience:user, confidence:exploratory]
timestamp: 2026-07-01T00:00:00Z
---

**Hormiga Studio** is the intended successor to the
[current builder UX](/ui-ux/builder-ux.md): content assembled by stacking and
nesting **blocks** (a heading, a contact card, an event listing, an image, a
narrative paragraph) with a side-panel inspector for parameters — Scratch as
the reference point for tactility and teachability
([principles](/ui-ux/principles.md) #1).

The convergence makes Studio a *view*, not an engine: blocks are runes, block
types are glyphs, the document is a mantle
([convergence](/concepts/voidcore-convergence.md)), so Studio renders and
manipulates the same model the [CLI](/concepts/cli.md) drives — a volunteer
stacking blocks and an agent issuing verbs produce literally the same edits.
Studio is therefore sequenced *after* the mantle model ships
([roadmap](/roadmap.md) Phases 3 → 5).

Open design questions, kept honest:
- Block granularity: does a block equal today's section, or sub-section pieces
  (paragraph, image, callout) with sections as groups?
- Bilingual blocks: EN/ES variants per block, or translation at render time as
  today ([bilingual](/concepts/bilingual.md))?
- Home: a tab, or Studio's own window (the same question the Antfarm editor
  faces)?
- How far the block metaphor extends toward site building (Mound), where a
  page, unlike an email, has layout freedom.
