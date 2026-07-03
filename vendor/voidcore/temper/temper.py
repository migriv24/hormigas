"""
temper/temper.py — the Temper normalization layer: pure, idempotent canonicalization.

Temper is the middle transformation verb (sibling of Scry / Reduce). After an action,
it cleans **owned** state to a **canonical form**: derived-field defaults (thumb =
images[0]), de-duplication, tag normalization. It centralizes the invariants apps
currently hand-code on every mutation path (the Portfolio Manager's `core.py` does
exactly this by hand — add_image/remove_image's thumb juggling, `_sync_tags`' dedupe).

The law (notes/reducer.md): **`temper(temper(x)) == temper(x)`** — idempotent. And the
consensus invariants: pure (no I/O / clock / RNG), functional (returns new runes; never
mutates the source), identity is the default (no rules ⇒ a rune tempers to itself), and
no effects ever fire here.

A **rule** is a pure `rune -> rune`. `Temper(rules)` applies them in order to each rune.
Compose your own, or use the library below:

    from voidcore import Temper, dedupe, member_or_default, default_tag, normalize_tags
    t = Temper([dedupe("images"),
                member_or_default("thumb", "images"),
                default_tag("status", "complete"),
                normalize_tags()])
    clean_runes = t.runes(runes)        # canonical form, idempotently
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

Rule = Callable[[dict], dict]


def _content(rune: dict) -> dict:
    return dict(rune.get("content") or {})


def _with_content(rune: dict, content: dict) -> dict:
    return {**rune, "content": content}


# ── the engine ───────────────────────────────────────────────────────────────────
@dataclass(frozen=True)
class Temper:
    """A normalization pass: an ordered list of pure, idempotent rules. Applying it is
    itself idempotent provided each rule is (the library rules below are). Functional —
    `rune`/`runes` return new objects and never mutate the input."""
    rules: tuple[Rule, ...] = ()

    def __init__(self, rules: list[Rule] | tuple[Rule, ...] = ()):
        object.__setattr__(self, "rules", tuple(rules))

    def rune(self, rune: dict) -> dict:
        out = rune
        for r in self.rules:
            out = r(out)
        return out

    def runes(self, runes) -> list[dict]:
        return [self.rune(r) for r in runes]


# ── reusable rules (each pure + idempotent) ───────────────────────────────────────
def dedupe(field_name: str) -> Rule:
    """De-duplicate a content list field, preserving first-seen order."""
    def rule(rune: dict) -> dict:
        c = _content(rune)
        v = c.get(field_name)
        if isinstance(v, list):
            c[field_name] = list(dict.fromkeys(v))
            return _with_content(rune, c)
        return rune
    return rule


def member_or_default(target: str, source: str, *, index: int = 0,
                      empty: Any = None) -> Rule:
    """Canonicalize a derived pointer: `content[target]` must be a member of the list
    `content[source]`; if it isn't (unset, or pointing at a now-removed item), reset it
    to `content[source][index]` — or `empty` when the source list is empty. This is the
    'thumb = images[0]' invariant the Portfolio Manager hand-codes in two places."""
    def rule(rune: dict) -> dict:
        c = _content(rune)
        items = c.get(source) or []
        cur = c.get(target)
        if not isinstance(items, list):
            return rune
        if cur in items:
            return rune
        c[target] = items[index] if items else empty
        return _with_content(rune, c)
    return rule


def default_content(field_name: str, value: Any) -> Rule:
    """Set `content[field]` to `value` when it is missing or None/empty-string."""
    def rule(rune: dict) -> dict:
        c = _content(rune)
        if c.get(field_name) in (None, ""):
            c[field_name] = value
            return _with_content(rune, c)
        return rune
    return rule


def normalize_tags(*, sort: bool = False) -> Rule:
    """De-duplicate a rune's tags (preserving order, or sorted when `sort=True`)."""
    def rule(rune: dict) -> dict:
        tags = rune.get("tags")
        if not isinstance(tags, list):
            return rune
        out = list(dict.fromkeys(tags))
        if sort:
            out = sorted(out)
        return {**rune, "tags": out}
    return rule


def default_tag(namespace: str, value: Any) -> Rule:
    """Ensure a namespaced tag exists: if no `namespace:*` tag is present, add
    `namespace:value`. (e.g. every project gets a `status:` — defaults to complete.)"""
    prefix = f"{namespace}:"
    def rule(rune: dict) -> dict:
        tags = list(rune.get("tags") or [])
        if any(t.startswith(prefix) for t in tags):
            return rune
        tags.append(f"{prefix}{value}")
        return {**rune, "tags": tags}
    return rule


def single_tag(namespace: str) -> Rule:
    """Collapse a single-valued namespaced axis to one tag: if several `namespace:*` tags
    exist (a contradiction), keep the first and drop the rest. Canonicalizes axes like
    `status:` that must hold exactly one value."""
    prefix = f"{namespace}:"
    def rule(rune: dict) -> dict:
        tags = rune.get("tags") or []
        seen = False
        out = []
        for t in tags:
            if t.startswith(prefix):
                if seen:
                    continue
                seen = True
            out.append(t)
        return {**rune, "tags": out} if out != list(tags) else rune
    return rule
