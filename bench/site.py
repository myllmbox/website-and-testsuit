#!/usr/bin/env python3
"""site.py — the site's throughput matrix for one serve: c = 1 2 4 6 8 12 16 × {mixed, prose, code, structured} × --runs,
thinking off, the model's own sampling (test.py sends none).

  c=1  = one full answer (--seconds 0), warm-up 30 s excluded;
  c>1  = --refill, 30 s warm-up + --seconds measured (default 300), a finished stream is replaced at once.
One test.py log + json per cell: bench/results/<model>--<lane>/<ts>-site/<content>-c<c>-r<n>.{log,json} (bench/matrix.py
layout). Runs are the OUTER loop, so drift over the hours spreads across every cell instead of piling onto one. Re-running
with --out <that folder> skips the cells already done (a crash resumes where it stopped).

  ./bench/site.py --lane fp4l-dyn5 --tag fp4l
  ./bench/site.py --lane fp4l-dyn5 --out bench/results/nvidia-GLM-5.3-Flash-FP4-Local--fp4l-dyn5/20261019-010000-site
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONTENTS = {"full": 20000, "story": 20000, "code-ts": 20000, "structured": 20000}   # prompt → max_tokens per stream


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    ap.add_argument("--token", default="", help="Bearer token, if the endpoint needs one")
    ap.add_argument("--lane", required=True)
    ap.add_argument("--tag", default="site")
    ap.add_argument("--cs", default="1,2,4,6,8,12,16")
    ap.add_argument("--contents", default=",".join(CONTENTS))
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--seconds", type=int, default=300)
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    req = urllib.request.Request(a.url + "/v1/models", headers={"Authorization": f"Bearer {a.token}"} if a.token else {})
    model = json.load(urllib.request.urlopen(req, timeout=30))["data"][0]["id"]
    out = Path(a.out) if a.out else HERE / "results" / f"{model.replace('/', '-')}--{a.lane}" / time.strftime("%Y%m%d-%H%M%S-site")
    out.mkdir(parents=True, exist_ok=True)
    cs = [int(c) for c in a.cs.split(",")]
    contents = a.contents.split(",")
    cells = [(r, p, c) for r in range(1, a.runs + 1) for p in contents for c in cs]
    print(f"site · {model} · {len(cells)} cells → {out}", flush=True)
    for i, (r, p, c) in enumerate(cells, 1):
        stem = out / f"{p}-c{c}-r{r}"
        if Path(f"{stem}.json").exists():
            continue
        cmd = [sys.executable, str(HERE / "test.py"), "--url", a.url, "--token", a.token, "--lane", a.lane, "--c", str(c), "--thinking", "off",
               "--prompt", p, "--warmup", "30", "--max-tokens", str(CONTENTS.get(p, 20000)),
               "--tag", f"{a.tag} {p} c{c} r{r}", "--json", f"{stem}.json"]
        cmd += ["--seconds", "0"] if c == 1 else ["--seconds", str(a.seconds), "--refill"]
        t0 = time.time()
        with open(f"{stem}.log", "w") as log:
            rc = subprocess.call(cmd, stdout=log, stderr=subprocess.STDOUT)
        if rc:
            Path(f"{stem}.log").rename(f"{stem}.failed.log")
        print(f"[{i}/{len(cells)}] {p} c={c} r{r}: {'FAILED rc=' + str(rc) if rc else 'ok'} ({time.time() - t0:.0f} s)", flush=True)
    print("done →", out, flush=True)


if __name__ == "__main__":
    main()
