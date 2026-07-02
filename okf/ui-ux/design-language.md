---
type: Concept
title: Design Language
description: The visual system — CSS-variable theming (default teal on near-white), user-selectable themes, plain HTML/CSS with no framework, email-safe rendering as a separate visual domain.
resource: static/css/app.css
tags: [status:current, audience:dev, confidence:asserted]
timestamp: 2026-07-01T00:00:00Z
---

All app styling lives in one stylesheet (`static/css/app.css`) driven by CSS
variables, so a theme is a variable block, not a rewrite. Default theme:
teal accent `#0f766e` on near-white `#f8fafc`, ink `#1e293b` — calm,
high-contrast, form-friendly. Additional user-selectable themes redefine the
same variables (a deep-red LON theme `#A4031F`, a crimson variant, a blue
variant); the [app manifest](/app.md) carries the default palette for external
tools.

Structural choices:
- **No CSS framework, no bundler.** Class names are semantic
  (`.canvas-section`, `.btn-primary`, `.lang-tab`); anyone can open the file
  and find the rule.
- **Two visual domains.** App chrome (this stylesheet) and **email output**
  ([sections](/concepts/sections.md): table layout, inline styles) never share
  CSS — email clients are the constraint, and mixing the domains breaks both.
- **State is visible.** Active tab, selected section, dirty indicators, and
  connection status all have explicit visual states — no invisible modes
  ([principles](/ui-ux/principles.md) #3).

The Phase-4/5 revamp may replace the rendering stack; the variable-driven
theming contract and the two-domain rule carry forward. Extending this page
into a full token spec (spacing, type scale, component inventory) is part of
the revamp's definition of done.
