#!/usr/bin/env python3
"""make-entry.py — turn a gauntlet folder + a site folder into one static/report.json entry, and copy the pages into static/runs/.

  pip install tokenizers        # the thinking/code split counts tokens with the model's own tokenizer.json
  ./bench/make-entry.py --id my-stack --name "My stack (TP=1)" --model "Org/Model FP8" --stack "vLLM 0.32 · MTP 3" \\
      --hf https://huggingface.co/org/model --link https://github.com/me/my-recipe --image me/image:tag \\
      --max-context 262144 --kv-pool 1200000 --kv-dtype fp8 --seats 16 \\
      --gauntlet bench/results/<model>--my-stack/<ts>-gauntlet --site bench/results/<model>--my-stack/<ts>-site \\
      --tokenizer /path/to/tokenizer.json --write

Without --write it prints the entry. With --write it adds (or replaces) the entry in static/report.json, regenerates
static/report.js, copies the pages to static/runs/<id>/{pasture,fish}/r<i>.html and the raw run folders to results/<id>/.

How the numbers are made (identical for every entry on the site):
  gauntlet  every 10-s sample of every run; a sample counts as THINKING when its midpoint lies before the run's thinking
            tokens (cumulative generated tokens), else CODE. thinking_tps / code_tps = mean of those samples per run, then the
            mean over runs; avg_tps = mean of all samples per run, then over runs; peak_tps = best sample of any run.
  tokens    the tokenizer over each page's <stem>-reasoning.txt (thinking) and <stem>.txt (answer).
  speed     one cell per (content, c): tps = mean of the runs' steady gen_tps.avg, runs = each run's value, peak = the best
            clean 10-s window. full → mixed, story → prose, code-ts → code, structured → structured.
  quality   every page starts as "pending"; the maintainers render and judge it (clean / fixed / anomaly / broken).
"""
import argparse
import json
import re
import shutil
import statistics as st
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CONTENT = {"full": "mixed", "story": "prose", "code-ts": "code", "structured": "structured"}


def gauntlet(folder, tok, n):
    count = lambda p: len(tok.encode(p.read_text(encoding="utf-8"), add_special_tokens=False).ids) if p.exists() else 0
    runs, quality = [], {"pasture": [], "fish": []}
    for scene in ("pasture", "fish"):
        for i in range(1, n + 1):
            stem = folder / "gauntlet" / f"{scene}-s0-{i}"
            res = folder / f"{scene}-{i}.json"
            if not res.exists() or not Path(f"{stem}.txt").exists():
                sys.exit(f"✗ missing run {scene} {i}: {res} / {stem}.txt")
            th, co = count(Path(f"{stem}-reasoning.txt")), count(Path(f"{stem}.txt"))
            j = json.loads(res.read_text())
            cum, t_tps, c_tps, all_tps = 0.0, [], [], []
            for s in j["samples"]:
                g = s.get("gen_tps") or 0
                nxt = cum + g * s["dt"]
                (t_tps if (cum + nxt) / 2 < th else c_tps).append(g)
                all_tps.append(g)
                cum = nxt
            runs.append({"thinking": st.mean(t_tps) if t_tps else None, "code": st.mean(c_tps) if c_tps else None,
                         "avg": st.mean(all_tps) if all_tps else None, "peak": j["summary"].get("peak_clean"),
                         "th": th, "co": co})
            quality[scene].append({"verdict": "pending", "tokens": {"thinking": th, "code": co}})
    mean = lambda k: round(st.mean(r[k] for r in runs if r[k] is not None), 1)
    g = {"thinking_tps": mean("thinking"), "code_tps": mean("code"),
         "peak_tps": round(max(r["peak"] or 0 for r in runs), 1), "avg_tps": mean("avg"), "runs": len(runs),
         "avg_thinking_tokens": round(st.mean(r["th"] for r in runs)), "avg_code_tokens": round(st.mean(r["co"] for r in runs))}
    return g, quality


def speed(folder):
    cells = {}
    for f in sorted(folder.glob("*-c*-r*.json")):
        m = re.fullmatch(r"(.+)-c(\d+)-r(\d+)\.json", f.name)
        if not m or m.group(1) not in CONTENT:
            continue
        s = json.loads(f.read_text())["summary"]
        if not (s.get("gen_tps") or {}).get("avg"):
            continue                       # no steady sample (e.g. an answer shorter than the warm-up): the cell keeps the other runs
        cells.setdefault((CONTENT[m.group(1)], int(m.group(2))), []).append((int(m.group(3)), s["gen_tps"]["avg"], s.get("peak_clean") or 0))
    out = {}
    for (kind, c), rs in sorted(cells.items(), key=lambda kv: (kv[0][1], kv[0][0])):
        rs.sort()
        out.setdefault(str(c), {})[kind] = {"status": "measured", "tps": round(st.mean(r[1] for r in rs), 1),
                                            "runs": [round(r[1], 1) for r in rs], "peak": round(max(r[2] for r in rs), 1)}
    return out


def me_cols():
    return set(CONTENT.values())


def write_report_js(report_path):
    data = json.loads(report_path.read_text(encoding="utf-8"))
    (report_path.parent / "report.js").write_text("window.REPORT = " + json.dumps(data, ensure_ascii=False) + ";\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--id", required=True, help="url-safe id, e.g. vllm-fp8-tp1 (the ?a= / ?b= value)")
    ap.add_argument("--name", required=True, help="who + what, e.g. 'Jane (TP=2)'")
    ap.add_argument("--model", required=True, help="model + quant as served, e.g. 'Qwen3.8-Flash-Next FP4-Local'")
    ap.add_argument("--stack", required=True, help="engine · drafting · hardware, e.g. 'vLLM 0.32 · MTP 1–7 · 2× DGX Spark'")
    ap.add_argument("--hf", default="", help="weights link")
    ap.add_argument("--link", default="", help="recipe / how-to-reproduce link (required for a merge)")
    ap.add_argument("--image", default="", help="container image (tag or digest)")
    ap.add_argument("--logo", default="", help="assets/logos/<you>.png (256 px), optional")
    ap.add_argument("--max-context", type=int, required=True, help="max tokens per request the serve accepts")
    ap.add_argument("--kv-pool", type=int, required=True, help="KV cache size in tokens (vLLM: 'GPU KV cache size' at boot)")
    ap.add_argument("--kv-dtype", required=True, help="fp8, bf16, …")
    ap.add_argument("--seats", type=int, required=True, help="max concurrent requests (max-num-seqs)")
    ap.add_argument("--note", default="", help="one line about the model / setup (shown under the spec)")
    ap.add_argument("--note-seats", default="", help="if the matrix ran with more seats than shipped, say so, e.g. "
                    "'ships with 4 seats; c = 6-16 ran with 16'")
    ap.add_argument("--unsupported", default="", help="comma list of columns the stack cannot run (mixed, prose, code, "
                    "structured): shown as unsupported at every c")
    ap.add_argument("--gauntlet", required=True, type=Path, help="bench/gauntlet.py output folder")
    ap.add_argument("--site", required=True, type=Path, help="bench/site.py output folder")
    ap.add_argument("--tokenizer", required=True, help="the model's tokenizer.json")
    ap.add_argument("--n", type=int, default=6, help="gauntlet runs per scene (default 6)")
    ap.add_argument("--write", action="store_true")
    a = ap.parse_args()
    if not re.fullmatch(r"[a-z0-9][a-z0-9.-]*", a.id):
        sys.exit("✗ --id: lower-case letters, digits, '.', '-'")
    try:
        from tokenizers import Tokenizer
    except ImportError:
        sys.exit("✗ pip install tokenizers")
    g, q = gauntlet(a.gauntlet, Tokenizer.from_file(a.tokenizer), a.n)
    entry = {"id": a.id, "name": a.name, "model": a.model, "hf": a.hf, "stack": a.stack, "image": a.image, "link": a.link,
             "spec": {"max_context": a.max_context, "kv_pool": a.kv_pool, "kv_dtype": a.kv_dtype, "kv_shared": True,
                      "seats": a.seats},
             "gauntlet": g, "quality": q, "speed": speed(a.site)}
    notes = {k: v for k, v in (("model", a.note), ("seats", a.note_seats)) if v}
    if notes:
        entry["spec"]["notes"] = notes
    for col in filter(None, (c.strip() for c in a.unsupported.split(","))):
        if col not in me_cols():
            sys.exit(f"✗ --unsupported: unknown column {col!r}")
        for c in ("1", "2", "4", "6", "8", "12", "16"):
            entry["speed"].setdefault(c, {})[col] = {"status": "unsupported"}
    if a.logo:
        entry["logo"] = a.logo
    entry = {k: v for k, v in entry.items() if v != ""}
    if not a.write:
        print(json.dumps(entry, indent=1, ensure_ascii=False))
        return
    report = ROOT / "static" / "report.json"
    data = json.loads(report.read_text(encoding="utf-8"))
    data["models"] = [m for m in data["models"] if m["id"] != a.id] + [entry]
    report.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    write_report_js(report)
    for scene in ("pasture", "fish"):
        dst = ROOT / "static" / "runs" / a.id / scene
        dst.mkdir(parents=True, exist_ok=True)
        for i in range(1, a.n + 1):
            src = a.gauntlet / "gauntlet" / f"{scene}-s0-{i}.html"
            if src.exists():
                shutil.copyfile(src, dst / f"r{i}.html")
            else:
                print(f"⚠ no page extracted for {scene} {i} (the answer had no HTML) — judged as broken", flush=True)
    # the evidence: every number above can be recomputed from these files
    for name, src in (("gauntlet", a.gauntlet), ("site", a.site)):
        dst = ROOT / "results" / a.id / name
        if dst.exists():
            shutil.rmtree(dst)
        shutil.copytree(src, dst, ignore=shutil.ignore_patterns("*.failed.log"))
    print(f"✓ {a.id} written: static/report.json, static/report.js, static/runs/{a.id}/, results/{a.id}/")


if __name__ == "__main__":
    main()
