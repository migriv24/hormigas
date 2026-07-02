# Hormiga — Bundle Log

Dated history of the project and this bundle. Newest first. The forward-looking
counterpart is [roadmap.md](/roadmap.md).

## 2026-07-01 — Fresh public history + this bundle
- Repo rebooted with a clean single-commit history for open-sourcing (MIT). The
  private development history (2025–2026, v0.1.0 → v1.4.15) is archived privately;
  its hardcoded `.miga` app secret is why it was never published.
- Releases + auto-updater rerouted to GitHub Releases on the public repo itself
  (`migriv24/hormigas`), replacing the separate `hormiga-releases` repo.
- This OKF bundle created, validated with Void Core's OKF engine.
- `VOIDCORE_INTEGRATION.md` reworked (v2): convergence onto Void Core decided —
  strangler migration, MeshDB as primary data holiday, phased plan.

## 2026-06 — v1.4.x stable line
- v1.4.15: resources overlay fix, contact internal notes, feature docs.
- Apr+May newsletter template; June 2026 newsletter shipped from the app.
- `ANTFARM.md` and the first Void Core integration brainstorm written.

## 2026-05 — The Supabase pause (the architectural trigger)
- The free-tier Supabase project paused (2026-05-03); contacts/events/orgs/jobs
  returned 503. Exposed the single-point-of-failure risk that drives the
  [Antfarm](/concepts/antfarm.md) local-first shift.

## 2025→2026-04 — Private development (summary)
- v0.1: Electron shell, PyInstaller-bundled Flask server, auto-updater.
- v1.0: Supabase migration (REST repository), three-tier storage model.
- v1.2: `.miga` credential files (AES-256-GCM), landing page, recent databases.
- v1.3–1.4: images/resources/jobs/orgs tabs, connections graph, developer tab,
  bilingual section renderer, monthly LON newsletters in production use.
