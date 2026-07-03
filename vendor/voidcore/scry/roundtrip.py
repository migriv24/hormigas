"""
scry/roundtrip.py — the round-trip law for Scry projections.

Any Scry that backs persistence (a rune⇄record mapping, a mantle⇄bundle export) must
satisfy the **round-trip law**:

    unscry(scry(x)) == x        (up to a declared canonicalization)

Violating it is the silent-data-loss class: a lossy projection drops a field, so what
you read back differs from what you stored. The Portfolio Manager shipped exactly this
(a namespaced tag not declared as a field got dropped). This harness makes that class
**structurally testable** — point it at a holiday's project/unproject and your samples,
and it pinpoints the offending field.

    from voidcore import check_roundtrip
    rep = check_roundtrip(holiday.record_to_rune, holiday.rune_to_record, records,
                          normalize=lambda r: {**r, "tags": sorted(r.get("tags", []))})
    assert rep.ok, rep.render()
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Iterable

_MISSING = "<missing>"


@dataclass
class RoundTripReport:
    label: str
    checked: int = 0
    mismatches: list = field(default_factory=list)  # (index, key, expected, got)

    @property
    def ok(self) -> bool:
        return not self.mismatches

    def render(self) -> str:
        lines = [f"round-trip [{self.label}]: {self.checked} checked, "
                 f"{len(self.mismatches)} mismatch(es)"]
        for i, k, e, g in self.mismatches:
            where = f"key '{k}'" if k else "value"
            lines.append(f"  #{i} {where}: stored {e!r} -> read back {g!r}")
        lines.append("  RESULT: " + ("LOSSLESS" if self.ok else "LOSSY"))
        return "\n".join(lines)


def _diff(a: Any, b: Any):
    """Yield (key, expected, got) for where a (stored) and b (read-back) differ."""
    if isinstance(a, dict) and isinstance(b, dict):
        for k in dict.fromkeys(list(a) + list(b)):
            av, bv = a.get(k, _MISSING), b.get(k, _MISSING)
            if av != bv:
                yield (k, av, bv)
    elif a != b:
        yield ("", a, b)


def check_roundtrip(
    scry: Callable[[Any], Any],
    unscry: Callable[[Any], Any],
    samples: Iterable[Any],
    *,
    normalize: Callable[[Any], Any] | None = None,
    label: str = "scry",
) -> RoundTripReport:
    """Check `unscry(scry(x)) == x` over `samples`. `normalize` canonicalizes both
    sides before comparison (e.g. sort order-insensitive list fields like tags)."""
    norm = normalize or (lambda x: x)
    rep = RoundTripReport(label=label)
    for i, x in enumerate(samples):
        rep.checked += 1
        back = unscry(scry(x))
        for k, e, g in _diff(norm(x), norm(back)):
            rep.mismatches.append((i, k, e, g))
    return rep


# ── self-test: a lossless projection passes; a lossy one is caught ───────────────
if __name__ == "__main__":
    samples = [{"id": "a", "title": "A", "tags": ["x", "y"]},
               {"id": "b", "title": "B", "tags": ["y", "x"]}]
    norm = lambda r: {**r, "tags": sorted(r.get("tags", []))}

    # lossless: identity-ish projection
    ok = check_roundtrip(lambda r: dict(r), lambda r: dict(r), samples,
                         normalize=norm, label="lossless")
    print(ok.render())
    assert ok.ok

    # lossy: a projection that forgets to carry `title` back (the PM bug class)
    def lossy_unscry(r):
        return {k: v for k, v in r.items() if k != "title"}
    bad = check_roundtrip(lambda r: dict(r), lossy_unscry, samples,
                          normalize=norm, label="lossy-drops-title")
    print(bad.render())
    assert not bad.ok and any(k == "title" for _, k, _, _ in bad.mismatches)
    print("\nSCRY ROUND-TRIP HARNESS: OK (passes lossless, catches lossy)")
