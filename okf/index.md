---
okf_version: "0.1"
---

# Hormiga — Knowledge Bundle (dev)

An [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog)
bundle describing **Hormiga**: bilingual data management and newsletter publishing
for small community organizations. This is the **dev** bundle — it includes
`status:planned` concepts (future work).

Honesty convention (inherited from [Void Core](/references/void-core.md)'s bundle):
every concept is tagged `status:current` (built & in the code) or `status:planned`
(designed, not built). A concept may not claim `current` without a `resource:` link
to the code that backs it. Validated with Void Core's OKF engine
(`python holidays/okf --bundle <this dir> validate`).

# This app

* [App manifest](/app.md) - Hormiga's structured self-description (identity + palette)

# Planned work

* [Roadmap](/roadmap.md) - the Void Core convergence phases, in build order
* [Log](/log.md) - dated history (newest first)

# Concepts — what Hormiga is

* [Data Manager](/concepts/data-manager.md) - contacts/events/jobs/orgs CRUD; the data the newsletter projects
* [Newsletter Builder](/concepts/newsletter-builder.md) - section-based bilingual composition
* [Section Templates](/concepts/sections.md) - the typed section vocabulary; the seed of the block/glyph system
* [Bilingual Rendering](/concepts/bilingual.md) - EN/ES as a constraint, not a feature
* [Tag System](/concepts/tags.md) - the load-bearing organizational mechanism
* [The .miga File](/concepts/miga-file.md) - the encrypted unit of deployment
* [Connections Graph](/concepts/connections-graph.md) - the org's relationships, visualized; future Antfarm editor home
* [The Antfarm](/concepts/antfarm.md) - protocol-node backend topology — planned
* [Void Core Convergence](/concepts/voidcore-convergence.md) - the foundation rebuild — Phase 1 landed
* [The CLI](/concepts/cli.md) - the agent/human terminal surface, UI-equal by construction — current
* [Offline-First](/concepts/offline-first.md) - usable without internet — planned

# UI / UX — the user surface (first-class here)

* [UX Principles](/ui-ux/principles.md) - the commitments every surface answers to
* [App Shell](/ui-ux/shell.md) - splash → landing → main window → menu
* [The Tab Model](/ui-ux/tabs.md) - one window, nine contexts, event-bus wiring
* [Design Language](/ui-ux/design-language.md) - variable-driven theming, two visual domains
* [Builder UX](/ui-ux/builder-ux.md) - the newsletter-building flow, with its known debts
* [Developer Tab](/ui-ux/developer-tab.md) - debuggability as a user surface
* [Studio Vision](/ui-ux/studio-vision.md) - the block-based successor — planned

# References

* [ANTFARM.md](/references/antfarm-doc.md) - the Antfarm planning document (repo root)
* [VOIDCORE_INTEGRATION.md](/references/voidcore-integration-doc.md) - the convergence plan v2 (repo root)
* [FUTURES.md](/references/futures-doc.md) - the feature-vision document (repo root)
* [Void Core](/references/void-core.md) - the engine repo this app builds on
