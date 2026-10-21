#!/usr/bin/env python3
"""gauntlet.py — the site's gauntlet runs for one serve: N pastures + N fish, thinking on, one request at a time.

Each run is one bench/test.py call (c=1, the model's own sampling — nothing is sent but the prompt, the thinking switch and
max_tokens), so the speed samples and the saved pages come from the same request:

  <out>/pasture-<i>.json, fish-<i>.json            test.py results (10-s samples, peak, tokens)
  <out>/gauntlet/pasture-s0-<i>.{txt,html}          the answer as generated + the page extracted from it
  <out>/gauntlet/pasture-s0-<i>-reasoning.txt       the thinking (counted for the thinking/code speed split)

  ./bench/gauntlet.py --lane my-stack                       # 6 + 6 against http://127.0.0.1:8000
  ./bench/gauntlet.py --lane my-stack --url http://host:8000 --token sk-… --n 6
  ./bench/gauntlet.py --lane my-stack --out <that folder>   # resume: finished runs are skipped

Stdlib only. Run it on the serving machine or next to it: the 10-s speed samples read the server's /metrics.
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://127.0.0.1:8000")
    ap.add_argument("--token", default="", help="Bearer token, if the endpoint needs one")
    ap.add_argument("--lane", required=True, help="a short name for this stack (results folder suffix)")
    ap.add_argument("--n", type=int, default=6, help="runs per scene (default 6)")
    ap.add_argument("--max-tokens", type=int, default=100000)
    ap.add_argument("--reasoning-effort", default="", help="only if the stack's chat template needs it to think at its "
                    "stock level (sent as chat_template_kwargs.reasoning_effort); empty = not sent")
    ap.add_argument("--out", default="")
    a = ap.parse_args()
    req = urllib.request.Request(a.url + "/v1/models", headers={"Authorization": f"Bearer {a.token}"} if a.token else {})
    model = json.load(urllib.request.urlopen(req, timeout=30))["data"][0]["id"]
    out = Path(a.out) if a.out else HERE / "results" / f"{model.replace('/', '-')}--{a.lane}" / time.strftime("%Y%m%d-%H%M%S-gauntlet")
    (out / "gauntlet").mkdir(parents=True, exist_ok=True)
    print(f"gauntlet · {model} · {a.n} pastures + {a.n} fish → {out}", flush=True)
    for scene in ("pasture", "fish"):
        for i in range(1, a.n + 1):
            stem = out / f"{scene}-{i}"
            if Path(f"{stem}.json").exists():
                continue
            cmd = [sys.executable, str(HERE / "test.py"), "--url", a.url, "--token", a.token, "--lane", a.lane, "--c", "1",
                   "--thinking", "on", "--prompt", scene, "--seconds", "0", "--warmup", "30", "--max-tokens", str(a.max_tokens),
                   "--tag", f"gauntlet {scene} {i}", "--json", f"{stem}.json", "--save-text", str(out / "gauntlet")]
            if a.reasoning_effort:
                cmd += ["--reasoning-effort", a.reasoning_effort]
            t0 = time.time()
            with open(f"{stem}.log", "w") as log:
                rc = subprocess.call(cmd, stdout=log, stderr=subprocess.STDOUT)
            if rc:
                Path(f"{stem}.json").unlink(missing_ok=True)
                Path(f"{stem}.log").rename(f"{stem}.failed.log")
            print(f"{scene} {i}/{a.n}: {'FAILED rc=' + str(rc) if rc else 'ok'} ({time.time() - t0:.0f} s)", flush=True)
    print("done →", out, flush=True)


if __name__ == "__main__":
    main()
