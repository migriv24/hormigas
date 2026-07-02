---
type: Reference
title: Void Core
description: The host-agnostic engine Hormiga is converging onto — C core + Python binding, rune/mantle/holiday model, one dispatcher, tag system, Voidscript, and its own OKF bundle.
resource: https://github.com/migriv24/void-core
tags: [status:current, audience:dev, confidence:asserted, reference]
timestamp: 2026-07-01T00:00:00Z
---

Void Core is developed in its own repo (locally `../VoidCore`, public at the
resource link — the public mirror may lag the local repo). Hormiga consumes it
as a library: the C engine (`libvoidcore.dll`) through the Python ctypes
binding, plus the Python dispatcher seam (scry/temper/materialize/reduce) and
holidays (MeshDB, localjson). Its own OKF bundle (`okf/` in that repo) is the
model this bundle follows — including the honesty convention (`status:` tags
backed by `resource:` links) and the validator this bundle is checked with.
See [convergence](/concepts/voidcore-convergence.md) for the mapping.
