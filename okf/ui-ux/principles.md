---
type: Design
title: UX Principles
description: The design commitments every Hormiga surface answers to — teachable to volunteers, bilingual by default, no dead ends offline, terminal and GUI as equals.
tags: [status:current, audience:dev, audience:user, confidence:asserted, foundation]
timestamp: 2026-07-01T00:00:00Z
---

Hormiga's users are community-org staff and **volunteers without technical
backgrounds**, often on borrowed time and borrowed laptops. Every UI decision
answers to these commitments:

1. **Teachable in one sitting.** A volunteer should produce a correct newsletter
   section after being shown once. Prefer recognition over recall: visible
   section lists, previews, and forms over abstract configuration. This is the
   driving argument for [Studio](/ui-ux/studio-vision.md)'s tactile blocks.
2. **Bilingual is not a mode.** EN/ES appear as paired tabs, side by side, in
   the [builder](/ui-ux/builder-ux.md) — never a global language switch that
   hides one audience while you edit the other.
3. **No dead ends.** Offline, a paused backend, a failed upload — every failure
   degrades to something usable (read-only view, retry affordance, visible
   banner), per [offline-first](/concepts/offline-first.md). An error state the
   user cannot leave is a bug by definition.
4. **The terminal is a peer surface.** The [CLI](/concepts/cli.md) is a
   first-class UI for agents and power users — same verbs, same capabilities as
   the GUI, by construction. GUI affordances are projections of dispatcher
   verbs, not extra powers.
5. **Sensitive data looks different.** Fields that never leave the machine or
   never render publicly (contact internal notes) are visually separated from
   public fields — the interface teaches the privacy boundary.
6. **One window, many contexts.** Tabs ([the tab model](/ui-ux/tabs.md)) keep a
   single-window mental model; heavyweight contexts (the Antfarm editor,
   Studio) may eventually earn their own windows, but never a modal maze.

These principles are the contract for the Phase-4/5 UI revamp: layouts and
frameworks may change; these do not, without a decision recorded here.
