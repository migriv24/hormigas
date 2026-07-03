"""
voidcore/spec.py — data-authored transformation specs (JSON ⇄ tested layer objects).

The transformation layers are configured by *code* (a `Temper([...])`, a `Selector(...)`).
This module lets the same configuration be expressed as **JSON data**, so it can live in
the state document (a mantle's / manager's `config`), be authored or edited by a user or
another app, be serialized and shared — and then **compile** to the exact same tested
objects. Code stays the reference; data is a serialization of it.

This is the foundation the app agents converged on (notes/handoff-transform-layers.md):
- DAW wants routing/normalization rules to be user-editable **data**, not code.
- Portfolio Manager wants its record↔rune mapping to be one declared spec, not triplicated.
- The reserved `reduce` dispatcher verb needs rules authored as mantle data.

Spec formats
------------
Temper spec — a list of rule objects (each has a `rule` name + that rule's args):

    [{"rule": "dedupe", "field": "images"},
     {"rule": "member_or_default", "target": "thumb", "source": "images"},
     {"rule": "default_tag", "namespace": "status", "value": "complete"},
     {"rule": "single_tag", "namespace": "status"},
     {"rule": "normalize_tags"}]

Selector spec — a dict (the data-expressible subset of `Selector`; a callable `select`
stays code):

    {"where": "status:active", "sort": "title", "reverse": false, "limit": 10}
"""
from __future__ import annotations

from projection import Selector
from reduce import Reducer, annihilate, commute
from temper import (
    Temper, dedupe, default_content, default_tag, member_or_default,
    normalize_tags, single_tag,
)

# Each entry: rule name -> (constructor, required arg keys). The constructor reads the
# spec dict; required keys are checked first so errors name the missing field.
_TEMPER_RULES = {
    "dedupe": (lambda s: dedupe(s["field"]), ("field",)),
    "member_or_default": (
        lambda s: member_or_default(s["target"], s["source"],
                                    index=s.get("index", 0), empty=s.get("empty")),
        ("target", "source")),
    "default_content": (lambda s: default_content(s["field"], s["value"]), ("field", "value")),
    "default_tag": (lambda s: default_tag(s["namespace"], s["value"]), ("namespace", "value")),
    "single_tag": (lambda s: single_tag(s["namespace"]), ("namespace",)),
    "normalize_tags": (lambda s: normalize_tags(sort=bool(s.get("sort", False))), ()),
}


def temper_from_spec(spec: list[dict]) -> Temper:
    """Compile a Temper rule-list spec into a `Temper` pass. Raises `ValueError` on an
    unknown rule or a missing required argument (with the offending index named)."""
    if not isinstance(spec, list):
        raise ValueError("temper spec must be a list of rule objects")
    rules = []
    for i, item in enumerate(spec):
        name = item.get("rule")
        entry = _TEMPER_RULES.get(name)
        if entry is None:
            raise ValueError(f"temper spec [{i}]: unknown rule {name!r} "
                             f"(known: {', '.join(sorted(_TEMPER_RULES))})")
        ctor, required = entry
        missing = [k for k in required if k not in item]
        if missing:
            raise ValueError(f"temper spec [{i}] ({name}): missing {', '.join(missing)}")
        rules.append(ctor(item))
    return Temper(rules)


def selector_from_spec(spec: dict) -> Selector:
    """Compile a selector spec (`where`/`sort`/`reverse`/`limit`) into a `Selector`."""
    if not isinstance(spec, dict):
        raise ValueError("selector spec must be an object")
    return Selector(where=spec.get("where"), sort_key=spec.get("sort"),
                    reverse=bool(spec.get("reverse", False)), limit=spec.get("limit"))


def temper_rule_names() -> list[str]:
    """The temper rules expressible as data (for editors / validation / docs)."""
    return sorted(_TEMPER_RULES)


# Reduce rule kinds expressible as data. `expand` needs a custom build fn, so it stays
# code-registered (not data) — these are the two confluent interaction-combinator rules.
_REDUCE_RULES = {"annihilate": annihilate, "commute": commute}


def reducer_from_spec(spec: dict) -> tuple[Reducer, dict]:
    """Compile a reducer spec into `(Reducer, signatures)` — the data-authored form of an
    interaction-net rewriter (the mantle authoring its own rules + port arities). Returns the
    `signatures` (glyph → aux-port count) alongside, since `to_net` needs them.

        {"signatures": {"con": 2, "dup": 2, "era": 0},
         "rules": [{"glyphs": ["con", "con"], "rule": "annihilate"},
                   {"glyphs": ["con", "dup"],  "rule": "commute"}]}

    The conflict guard still applies (≤1 rule per glyph pair → `Reducer.rule` raises on a
    duplicate). Raises `ValueError` on an unknown rule kind or malformed glyph pair."""
    if not isinstance(spec, dict):
        raise ValueError("reducer spec must be an object")
    signatures = {str(k): int(v) for k, v in (spec.get("signatures") or {}).items()}
    reducer = Reducer()
    for i, item in enumerate(spec.get("rules") or []):
        glyphs = item.get("glyphs")
        if not (isinstance(glyphs, (list, tuple)) and len(glyphs) == 2):
            raise ValueError(f"reducer spec rule [{i}]: `glyphs` must be a [a, b] pair")
        kind = item.get("rule")
        ctor = _REDUCE_RULES.get(kind)
        if ctor is None:
            raise ValueError(f"reducer spec rule [{i}]: unknown rule {kind!r} "
                             f"(known: {', '.join(sorted(_REDUCE_RULES))})")
        reducer.rule(glyphs[0], glyphs[1], ctor())
    return reducer, signatures


def reduce_rule_names() -> list[str]:
    """The reduce rule kinds expressible as data (for editors / validation / docs)."""
    return sorted(_REDUCE_RULES)
