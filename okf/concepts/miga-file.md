---
type: Concept
title: The .miga File
description: The encrypted, shareable configuration bundle — one file configures an entire Hormiga installation for a team; v1 is credentials, v2 becomes the holiday-registry topology.
resource: electron/credentials.js
tags: [status:current, audience:dev, audience:user, confidence:asserted, foundation]
timestamp: 2026-07-01T00:00:00Z
---

A `.miga` file is Hormiga's unit of deployment: an AES-256-GCM encrypted bundle
an admin exports and a teammate loads to get a fully configured installation —
no central server. **v1** (current, `electron/credentials.js`) stores flat
credentials (database keys, image-host key, sheet id, Google credentials) with
optional password protection; without a password it derives its key from a
deployment-specific app secret supplied via environment or an untracked local
file (never committed — the reason this repo's history was rebooted for
open-sourcing).

**v2** (planned — [roadmap](/roadmap.md) Phase 2) is the
[Antfarm](/concepts/antfarm.md)'s save file: the full holiday-registry topology
(which nodes exist, their wiring, per-node credentials field-encrypted), with a
**mandatory user passphrase** — the password-less mode dies with v1. v2 should
also carry per-node *security posture* (whether a node's data may leave the
device), the requirement inherited from the Neighborhood convergence
(`VOIDCORE_INTEGRATION.md` §8).

Roles: the admin builds the topology; users load it read-only and just use
the app.
