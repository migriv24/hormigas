"""
tagexpr — SPEC §5 tag-filter expressions, evaluated host-side over entity tags.

The C core evaluates this grammar over runes; holidays must evaluate the *same*
grammar over backend entities (contacts, events, images, jobs) so that
`effect query images "flier AND month:june"` means exactly what
`ls --tag "flier AND month:june"` means over runes.

    expr := or ; or := and (OR and)* ; and := not (AND? not)* ;
    not  := NOT not | atom ; atom := "(" or ")" | TAG

Operators case-insensitive (also && || !); adjacency = AND; empty expr matches all.
"""
from __future__ import annotations

from typing import Callable, Iterable

_KEYWORDS = {"AND", "OR", "NOT"}


def compile_expr(expr: str) -> Callable[[Iterable[str]], bool]:
    """Compile a filter expression to a predicate over a tag collection."""
    expr = (expr or "").strip()
    if expr.startswith("@"):
        expr = expr[1:].strip()
    if not expr:
        return lambda tags: True
    parser = _Parser(_tokenize(expr))
    node = parser.parse_or()
    parser.expect_end()
    return lambda tags: node({t for t in tags})


def matches(tags: Iterable[str], expr: str) -> bool:
    return compile_expr(expr)(tags)


def _tokenize(s: str) -> list[str]:
    out, i, n = [], 0, len(s)
    while i < n:
        ch = s[i]
        if ch.isspace():
            i += 1
        elif ch in "()":
            out.append(ch); i += 1
        elif ch == "&" and i + 1 < n and s[i + 1] == "&":
            out.append("AND"); i += 2
        elif ch == "|" and i + 1 < n and s[i + 1] == "|":
            out.append("OR"); i += 2
        elif ch == "!":
            out.append("NOT"); i += 1
        else:
            j = i
            while j < n and not s[j].isspace() and s[j] not in "()!":
                if s[j] in "&|" and j + 1 < n and s[j + 1] == s[j]:
                    break
                j += 1
            word = s[i:j]
            out.append(word.upper() if word.upper() in _KEYWORDS else word)
            i = j
    return out


class _Parser:
    def __init__(self, toks: list[str]):
        self.toks, self.pos = toks, 0

    def _peek(self):
        return self.toks[self.pos] if self.pos < len(self.toks) else None

    def _next(self):
        t = self.toks[self.pos]; self.pos += 1
        return t

    def parse_or(self):
        parts = [self.parse_and()]
        while self._peek() == "OR":
            self._next(); parts.append(self.parse_and())
        if len(parts) == 1:
            return parts[0]
        return lambda tags, p=parts: any(f(tags) for f in p)

    def parse_and(self):
        parts = [self.parse_not()]
        while True:
            t = self._peek()
            if t == "AND":
                self._next(); parts.append(self.parse_not())
            elif t is not None and t not in ("OR", ")"):
                parts.append(self.parse_not())
            else:
                break
        if len(parts) == 1:
            return parts[0]
        return lambda tags, p=parts: all(f(tags) for f in p)

    def parse_not(self):
        if self._peek() == "NOT":
            self._next(); inner = self.parse_not()
            return lambda tags, f=inner: not f(tags)
        return self.parse_atom()

    def parse_atom(self):
        t = self._peek()
        if t is None:
            raise ValueError("unexpected end of tag expression")
        if t == "(":
            self._next(); node = self.parse_or()
            if self._peek() != ")":
                raise ValueError("missing ')' in tag expression")
            self._next()
            return node
        if t in ("OR", "AND", ")"):
            raise ValueError(f"unexpected token '{t}'")
        tok = self._next()
        return lambda tags, tk=tok: tk in tags

    def expect_end(self):
        if self.pos != len(self.toks):
            raise ValueError(f"trailing tokens: {self.toks[self.pos:]}")
