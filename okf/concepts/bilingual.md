---
type: Concept
title: Bilingual Rendering
description: Every newsletter renders in English and Spanish — authored EN content is machine-translated to ES (Google Cloud Translation) with per-section manual override.
resource: services/translation/google_translate.py
tags: [status:current, audience:dev, audience:user, confidence:asserted]
timestamp: 2026-07-01T00:00:00Z
---

Hormiga's audience is bilingual community organizations; EN/ES is not a feature
but a constraint on everything. The pipeline: authored English section content →
Google Cloud Translation (behind `services/translation/base.py`, so the provider
is swappable) → editable Spanish variant → both rendered through the same
[section templates](/concepts/sections.md). The user can override any
translation per-section — machine output is a draft, not an answer.

The translation provider interface is the pattern the
[Antfarm](/concepts/antfarm.md) generalizes: it was Hormiga's first
protocol-behind-an-interface seam. A future embedding-guided, context-aware
translation pass is noted in [futures](/references/futures-doc.md) §D.

The UI's language handling (EN/ES tab pairs in the builder) is described in
[builder UX](/ui-ux/builder-ux.md).
