"""
scry/projection.py — the Scry projection layer: selectors, context, materialize.

Scry is the **read-side** verb (sibling of Reduce / Temper). It derives *views* from
owned state, an optional holiday **snapshot**, and a **context** — purely. Same inputs
⇒ byte-identical output, so live-preview == final render == archived send.

This module formalizes what was previously scattered across apps and the C dispatcher:

- `tag_match(rune, expr)` — the **one shared tag-expression evaluator**, a pure-Python
  twin of the C core's `vc_filter_eval` (same grammar, same name/glyph-as-tag rules).
  Conformance-tested against the C core in `scry/conformance_test.py`.
- `Context` — `{locale, audience, date, role}`, the resolution environment.
- `scry(runes, where=, select=, sort=, limit=, context=)` — the projection itself.
- `Selector` — a projection *as data* (where/select/sort/limit), so it can live in a
  mantle or be parameterized by context, and be applied with `sel.run(runes, context)`.
- `materialize(runes, resolved, into=)` — the *one* explicit, undoable action that
  freezes a resolved projection (e.g. holiday-snapshot data) back into owned state.
  Pure (returns new runes; source untouched) — the host commits the result through the
  dispatcher / holiday save, which is where undo + persistence live.

Invariants honored (notes/reducer.md "Consensus invariants"): pure (no I/O / clock /
RNG), functional (never mutates the source), identity is the default (no `where`/`select`
⇒ the runes themselves), and effects never fire here.
"""
from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Optional

# ── rune tag membership — the exact rule from C `vc_rune_has_tag` ─────────────────
# A rune matches a TAG if the tag equals its spirit.name, OR equals "glyph:<glyph>",
# OR is present in its `tags` array. (Name-as-tag + glyph-as-tag are reserved tags.)


def rune_name(rune: dict) -> str:
    return str(rune.get("spirit", {}).get("name", ""))


def rune_has_tag(rune: dict, tag: str) -> bool:
    if not tag:
        return False
    if rune_name(rune) == tag:
        return True
    glyph = rune.get("glyph")
    if isinstance(glyph, str) and tag.startswith("glyph:") and tag[6:] == glyph:
        return True
    return tag in (rune.get("tags") or [])


# ── tag-expression grammar (mirror of core/src/tags/tag.c) ───────────────────────
#   or   := and ( ("OR"|"||") and )*
#   and  := not ( ("AND"|"&&") not | <atom> )*        # adjacency = implicit AND
#   not  := ("NOT"|"!") not | atom
#   atom := "(" or ")" | TAG
# Operators are case-insensitive; an empty expression matches all runes.
_SPECIAL = set("()!&|")


def _tokenize(expr: str) -> list[str]:
    toks: list[str] = []
    i, n = 0, len(expr)
    while i < n:
        c = expr[i]
        if c.isspace():
            i += 1
            continue
        if c in "()!":
            toks.append(c)
            i += 1
            continue
        if c == "&" and i + 1 < n and expr[i + 1] == "&":
            toks.append("&&")
            i += 2
            continue
        if c == "|" and i + 1 < n and expr[i + 1] == "|":
            toks.append("||")
            i += 2
            continue
        j = i
        while j < n and not expr[j].isspace() and expr[j] not in _SPECIAL:
            j += 1
        toks.append(expr[i:j])
        i = j
    return toks


def _is_or(s: str) -> bool:
    return s == "||" or s.upper() == "OR"


def _is_and(s: str) -> bool:
    return s == "&&" or s.upper() == "AND"


def _is_not(s: str) -> bool:
    return s == "!" or s.upper() == "NOT"


def _starts_atom(s: str) -> bool:
    return not _is_or(s) and not _is_and(s) and s != ")"


class _Parser:
    def __init__(self, toks: list[str], rune: dict):
        self.t, self.p, self.rune = toks, 0, rune

    def _peek(self) -> Optional[str]:
        return self.t[self.p] if self.p < len(self.t) else None

    def atom(self) -> bool:
        s = self._peek()
        if s is None:
            return False
        if s == "(":
            self.p += 1
            r = self.or_()
            if self._peek() == ")":
                self.p += 1
            return r
        self.p += 1
        return rune_has_tag(self.rune, s)

    def not_(self) -> bool:
        if self._peek() is not None and _is_not(self._peek()):
            self.p += 1
            return not self.not_()
        return self.atom()

    def and_(self) -> bool:
        r = self.not_()
        while (s := self._peek()) is not None:
            if _is_and(s):
                self.p += 1
                r = self.not_() and r
            elif _starts_atom(s):
                r = self.not_() and r
            else:
                break
        return r

    def or_(self) -> bool:
        r = self.and_()
        while (s := self._peek()) is not None and _is_or(s):
            self.p += 1
            r = self.and_() or r
        return r


def tag_match(rune: dict, expr: Optional[str]) -> bool:
    """True if `rune` satisfies the tag-expression `expr`. Empty/None matches all.
    Pure-Python twin of the C core's `vc_filter_eval` (same grammar)."""
    if not expr:
        return True
    toks = _tokenize(expr)
    if not toks:
        return True
    return _Parser(toks, rune).or_()


# ── context: the resolution environment ──────────────────────────────────────────
@dataclass(frozen=True)
class Context:
    """The environment a projection resolves against. All optional — identity scry
    ignores it. Carried explicitly (never read from a clock/locale) so scry stays
    pure and reproducible: same (state, snapshot, context) ⇒ identical view."""
    locale: Optional[str] = None
    audience: Optional[str] = None
    date: Optional[str] = None          # ISO string; injected, never `now()`
    role: Optional[str] = None
    extra: dict = field(default_factory=dict)


# ── the projection ───────────────────────────────────────────────────────────────
def scry(
    runes: Iterable[dict],
    *,
    where: Optional[str] = None,
    select: Optional[Callable[[dict, Context], Any]] = None,
    sort: Optional[Callable[[dict], Any]] = None,
    reverse: bool = False,
    limit: Optional[int] = None,
    context: Optional[Context] = None,
) -> list:
    """Project a view from `runes`: filter by tag-expression `where`, optionally map
    each surviving rune through `select(rune, context)`, sort, and cap at `limit`.

    Pure and functional: never mutates the inputs. With no arguments it returns the
    runes themselves (identity is the default). `select` receives the `Context` so views
    can be context-parameterized (locale/audience/date/role) without reading any clock."""
    ctx = context or Context()
    out = [r for r in runes if tag_match(r, where)]
    if sort is not None:
        out.sort(key=sort, reverse=reverse)
    elif reverse:
        out.reverse()
    if limit is not None:
        out = out[:limit]
    if select is not None:
        return [select(r, ctx) for r in out]
    return out


def dedupe_by(
    runes: Iterable[dict],
    key: Callable[[dict], Any],
    *,
    prefer: Optional[Callable[[dict, Context], Any]] = None,
    context: Optional[Context] = None,
) -> list[dict]:
    """Keep one rune per group — **context-aware** variant selection. `key(rune)` groups;
    within a group the kept rune **minimizes** `prefer(rune, context)` (lower = better;
    default keeps first-seen). Group order follows first appearance.

    This is the bilingual case (Hormiga): group by `pair`, prefer the locale-matched
    variant, fall back to neutral. It lives in **Scry**, not Temper, precisely because it
    depends on `Context` — Temper is context-blind owned-state normalization, so a
    locale-dependent tiebreak belongs here on the read side. Pure; never mutates input."""
    ctx = context or Context()
    rank = prefer or (lambda r, c: 0)
    best: dict[Any, dict] = {}
    order: list[Any] = []
    for r in runes:
        k = key(r)
        if k not in best:
            best[k] = r
            order.append(k)
        elif rank(r, ctx) < rank(best[k], ctx):
            best[k] = r
    return [best[k] for k in order]


@dataclass(frozen=True)
class Selector:
    """A projection expressed as **data** (so it can be stored in a mantle, versioned,
    or chosen by context). `where`/`sort`/`limit` are declarative; `select` stays a
    callable. Apply with `sel.run(runes, context)`."""
    where: Optional[str] = None
    sort_key: Optional[str] = None      # a content/tag field name to sort by
    reverse: bool = False
    limit: Optional[int] = None
    select: Optional[Callable[[dict, Context], Any]] = None

    def _sort(self) -> Optional[Callable[[dict], Any]]:
        if self.sort_key is None:
            return None
        key = self.sort_key
        return lambda r: (r.get("content", {}) or {}).get(key, rune_name(r))

    def run(self, runes: Iterable[dict], context: Optional[Context] = None) -> list:
        return scry(runes, where=self.where, select=self.select, sort=self._sort(),
                    reverse=self.reverse, limit=self.limit, context=context)


# ── provenance: a stable id for a snapshot of data ────────────────────────────────
def provenance(obj: Any) -> str:
    """A stable, order-independent content hash of any JSON-serializable value — the
    "snapshot id" of what was resolved. Same data ⇒ same id (keys sorted), so an archive
    can record *which* snapshot it captured, and a reader can tell whether the live data
    still matches. Pure (no clock/RNG): the id is a property of the data, nothing else."""
    blob = json.dumps(obj, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


# ── materialize: freeze a resolved projection into owned state ────────────────────
def materialize(
    runes: Iterable[dict],
    resolved: dict[str, dict],
    *,
    into: str = "content",
    stamp: Optional[str] = None,
) -> list[dict]:
    """Freeze resolved values into owned state — the *one* explicit, undoable bake.

    `resolved` maps `rune name -> {field: value}` (typically the output of resolving a
    holiday **snapshot** through a projection). For each matching rune a **new** rune is
    produced with those fields written into its `content` (`into="content"`) or appended
    as `field:value` tags (`into="tags"`). Source runes are never mutated; runes with no
    entry in `resolved` pass through unchanged.

    `stamp` (a content field name) records **provenance**: each baked rune gets
    `content[stamp] = provenance(its resolved fields)` — the snapshot id of what was frozen,
    so an archive carries proof of *what* it captured (Hormiga's "what did the April send
    contain"). Pure, so the stamp is reproducible.

    This is deliberately *not* automatic: holiday-backed data is resolved from a snapshot
    at read time (`scry`), and only ever folded into authoritative state by an explicit
    `materialize` call — which the host commits through the dispatcher / holiday save,
    where undo and persistence live. (Silent bake-into-state is the bug class this avoids.)"""
    if into not in ("content", "tags"):
        raise ValueError("into must be 'content' or 'tags'")
    out: list[dict] = []
    for rune in runes:
        name = rune_name(rune)
        fields = resolved.get(name)
        if not fields:
            out.append(rune)
            continue
        new = dict(rune)
        if into == "content":
            new["content"] = {**(rune.get("content") or {}), **fields}
        else:
            existing = list(rune.get("tags") or [])
            existing += [f"{k}:{v}" for k, v in fields.items()
                         if f"{k}:{v}" not in existing]
            new["tags"] = existing
        if stamp:
            new["content"] = {**(new.get("content") or {}), stamp: provenance(fields)}
        out.append(new)
    return out
