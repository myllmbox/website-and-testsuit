#!/usr/bin/env python3
"""drift.py — loop / degeneration detector for model output (the same rules as the kit's front proxy loop guard).

  · 2-char runs: any `size`-char window that is one 2-char pattern repeated ("?!?!?!", "2222…"); markdown rules,
    underlines and whitespace (--, ==, spaces, tabs, blank lines, CRLF) are exempt; a run of digits only fires at
    `digit_size` chars (nil UUIDs, zero-padded SKUs and IDs are legit 12–16 digit runs)
  · phrase loops: the text's tail is one unit of 3..`period` chars (with at least one letter) repeated `repeats` times

Used live by test.py (every streamed request, reasoning and answer separately: a hit prints ⚠ DRIFT and lands in the run
json) and offline here:

  bench/drift.py <dir|file> [...]    # scans *-reasoning.txt / *.txt answers under the given folders (test.py --save-text,
                                     # full.py gauntlet/), prints every hit and a per-folder count
"""
import argparse, os, sys

ALLOW = ("--", "==", "  ", "\t\t", "\n\n", "\r\n")


def periodic2(window: str) -> bool:
    n = len(window)
    return n >= 2 and window == (window[:2] * (n // 2 + 1))[:n]


class Detector:
    """Feed text per field (streamed deltas or a whole text); `hits` = {field: sample} for every field that drifted."""

    def __init__(self, size=12, period=64, repeats=8, allow=ALLOW, digit_size=24):
        self.size, self.period, self.repeats = size, max(3, period), repeats
        self.digit_size = max(size, digit_size)
        self.allow = frozenset(a for p in allow if len(p) == 2 for a in (p, p[1] + p[0]))
        self.text: dict[str, str] = {}
        self.hits: dict[str, str] = {}

    def _loop(self, t: str):
        for p in range(3, self.period + 1):
            span = p * self.repeats
            if len(t) < span:
                return None
            unit = t[-p:]
            if not any(c.isalpha() for c in unit) or not unit.strip():
                continue
            if t[-span:] == unit * self.repeats:
                return unit
        return None

    def feed(self, field: str, delta: str) -> str | None:
        """Append `delta`; return the sample if this delta made `field` drift for the first time."""
        if not delta:
            return None
        old = self.text.get(field, "")
        new = old + delta
        self.text[field] = new
        if field in self.hits:
            return None
        if self.size >= 2:
            for end in range(max(self.size, len(old) + 1), len(new) + 1):
                w = new[end - self.size:end]
                if periodic2(w) and w[:2] not in self.allow:
                    if w.isdigit():
                        if end < self.digit_size or not periodic2(new[end - self.digit_size:end]):
                            continue
                        w = new[end - self.digit_size:end]
                    self.hits[field] = w
                    return w
        if self.repeats >= 2:
            # the tail check per delta catches a loop while it runs; scanning every end point would cost O(n·period)
            unit = self._loop(new)
            if unit is not None:
                self.hits[field] = unit * self.repeats
                return self.hits[field]
        return None


def longest_run(text: str, allow=ALLOW) -> tuple[int, str]:
    """Longest stretch that is one 2-char pattern repeated ("2222", "?!?!"), allowed patterns skipped → (length, sample).
    Period 1 ("222") is the degenerate case of period 2. Early-warning metric: escalation shows as 9 → 17 → 30 … turn by turn."""
    al = frozenset(a for p in allow if len(p) == 2 for a in (p, p[1] + p[0]))
    best, best_s, start, n = 0, "", 0, len(text)
    for i in range(2, n + 1):
        if i < n and text[i] == text[i - 2]:
            continue
        L = i - start if i - start >= 2 else 0                # stretch text[start:i] keeps period 2
        if L > best and text[start:start + 2] not in al:
            best, best_s = L, text[start:start + min(L, 40)]
        start = i - 1
    return best, best_s


def scan_text(text: str, **kw) -> str | None:
    """Whole-text scan (offline): stream it through in chunks so loops in the middle are seen, not just the tail."""
    d = Detector(**kw)
    for i in range(0, len(text), 16):
        s = d.feed("t", text[i:i + 16])
        if s:
            return s
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--size", type=int, default=12)
    ap.add_argument("--period", type=int, default=64)
    ap.add_argument("--repeats", type=int, default=8)
    ap.add_argument("--digit-size", type=int, default=24)
    a = ap.parse_args()
    files = []
    for p in a.paths:
        if os.path.isfile(p):
            files.append(p)
        else:
            for root, _, names in os.walk(p):
                files += [os.path.join(root, n) for n in names if n.endswith(".txt")]
    per_dir: dict[str, list[int]] = {}
    for f in sorted(files):
        try:
            text = open(f, errors="replace").read()
        except OSError:
            continue
        kind = "reasoning" if f.endswith("-reasoning.txt") else "answer"
        hit = scan_text(text, size=a.size, period=a.period, repeats=a.repeats, digit_size=a.digit_size)
        c = per_dir.setdefault(os.path.dirname(f), [0, 0])
        c[0] += 1
        if hit:
            c[1] += 1
            print(f"⚠ DRIFT {kind:9s} {f}  {hit[:70]!r}")
    for d, (n, h) in per_dir.items():
        print(f"{h}/{n} texts drifted  {d}")
    sys.exit(1 if any(h for _, h in per_dir.values()) else 0)


if __name__ == "__main__":
    main()
