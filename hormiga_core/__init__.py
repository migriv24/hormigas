"""
hormiga_core — Hormiga's Void Core adapter (VOIDCORE_INTEGRATION.md §3).

The one spine: the Void Core dispatcher backs the Developer-tab console, the
terminal CLI, and (progressively) the UI. Vocabulary per SPEC.md:

  rune    — a newsletter block (owned) / an entity reached via a holiday (backed)
  glyph   — a block type (the newsletter section vocabulary)
  mantle  — a newsletter document
  holiday — a backend Hormiga does not own (an Antfarm node): contacts, events,
            images, jobs behind their stores/repositories
"""
from .engine import get_engine, HormigaEngine

__all__ = ["get_engine", "HormigaEngine"]
