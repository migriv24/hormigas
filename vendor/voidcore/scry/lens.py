"""
scry/lens.py — a Lens: a bidirectional Scry projection that inherits the round-trip law.

A one-way [scry](projection.py) projects state → view. A **Lens** is the two-way case: a
`forward` projection and its `backward` inverse, bundled with the **round-trip law**
(`scry/roundtrip.py`) so a lossy mapping is structurally caught.

This is the shape a *persistence* mapping wants — e.g. a holiday's record⇄rune mapping. The
Portfolio Manager had that mapping written three times (persistence, the form read-side, the
form write-side) and shipped a lossy-tag bug between them. One `Lens` owns the mapping once,
the app reads/writes/persists through it, and `lens.check(records)` is the regression guard:

    lens = holiday.lens()                       # forward=record→rune, backward=rune→record
    rune   = lens.forward(record)               # persist / write-side
    record = lens.backward(rune)                # read-side (rune → form)
    assert lens.check(records).ok               # backward(forward(x)) == x, for every record

Pure (no I/O) — the holiday still does the file/network; the Lens is just the mapping + law.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable, Iterable, Optional

from roundtrip import RoundTripReport, check_roundtrip


@dataclass
class Lens:
    forward: Callable[[Any], Any]                 # x -> y   (e.g. record -> rune)
    backward: Callable[[Any], Any]                # y -> x   (e.g. rune -> record)
    normalize: Optional[Callable[[Any], Any]] = None   # canonicalize before comparison
    label: str = "lens"

    def check(self, samples: Iterable[Any]) -> RoundTripReport:
        """The round-trip law on `forward`'s domain: `backward(forward(x)) == x` for each
        sample (e.g. every record on disk survives record→rune→record). The persistence law."""
        return check_roundtrip(self.forward, self.backward, samples,
                               normalize=self.normalize, label=self.label)

    def check_inverse(self, samples: Iterable[Any]) -> RoundTripReport:
        """The other direction: `forward(backward(y)) == y` (e.g. rune→record→rune)."""
        return check_roundtrip(self.backward, self.forward, samples,
                               normalize=self.normalize, label=f"{self.label} (inverse)")

    def inverse(self) -> "Lens":
        """The same mapping read the other way (swaps forward/backward)."""
        return Lens(self.backward, self.forward, normalize=self.normalize,
                    label=f"{self.label} (inverse)")
