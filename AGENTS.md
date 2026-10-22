# AGENTS.md — how this repo works

For anyone (person or coding agent) changing the site, adding an entry, or reviewing a contribution. User-facing steps are
in [CONTRIBUTING.md](CONTRIBUTING.md); this file is the why and the mechanics.

## Layout

```
static/                 the deployed site: plain files, no build step
  index.html            shell; loads report.js then app.js (both with a ?v=<timestamp> cache-buster)
  app.js                reads window.REPORT (or fetches report.json), picks A/B, scores, draws SVG charts
  styles.css
  report.json           THE data: {title, date, box, models: [entry, …]}; the menu groups entries by model name
  report.js             `window.REPORT = <report.json>;\n` (works from file://); always regenerated, never hand-edited
  runs/<id>/<test>/r<n>.html     gauntlet page n (test = pasture | fish); r<n>.orig.html = the page before a fix
  prompts/{pasture,fish}.txt, prompts.md     the gauntlet prompts as shown on the site
  assets/logos/         creator avatars (256 px), referenced by an entry's "logo"
bench/
  test.py               the measuring engine: holds c streams, samples /metrics every 10 s, writes one json per run
  drift.py              loop detector test.py runs on every stream (flags degenerate output in the json)
  gauntlet.py           6 pastures + 6 fish via test.py (c=1, thinking on)
  site.py               the throughput matrix via test.py (thinking off)
  make-entry.py         run folders → report.json entry + pages + results/
  prompts/              every prompt the scripts send (the gauntlet prompts are the canonical copies)
results/<id>/           raw runs behind a contributed entry (gauntlet/ + site/)
```

## An entry (`static/report.json` → `models[]`)

| field | meaning |
|---|---|
| `id` | url-safe, unique; `?a=` / `?b=` |
| `name`, `model`, `stack` | header line: who/what, model + quant, engine · drafting · hardware; `model`'s first word groups the menu |
| `hf`, `link`, `image`, `logo` | weights, recipe, container, avatar (all optional on the page; `link` required for contributions) |
| `spec` | `max_context`, `kv_pool` (tokens), `kv_dtype`, `kv_shared`, `seats`, `notes.{model,kv_pool,seats}` (one-liners shown under the rows) |
| `gauntlet` | `thinking_tps`, `code_tps`, `peak_tps`, `avg_tps` (shown, not scored), `runs`, `avg_thinking_tokens`, `avg_code_tokens` |
| `quality.{pasture,fish}[]` | per page in run order: `verdict` (clean · fixed · anomaly · broken · pending), `tokens.{thinking,code}`, `note`, `fix.{chars,what}` + `orig: true` when a fix was applied |
| `speed["<c>"].<col>` | col = mixed · prose · code · structured: `{status: measured, tps, runs[], peak}`, or `{status: unsupported}` / `{status: pending}` |

## How numbers are made (make-entry.py is the reference implementation)

- **test.py sample**: every 10 s, Δ`vllm:generation_tokens_total` / Δt = aggregate gen tok/s. A sample is *steady* when it is
  past the warm-up, all c streams run and no prompt tokens were processed in it (with `--refill`: past the warm-up).
  `gen_tps.avg` = mean of steady samples; `peak_clean` = best clean sample.
- **Gauntlet speed**: all samples of each run. A sample is *thinking* when its midpoint (cumulative tokens) lies before the
  run's thinking-token count, else *code*. Per-run means → mean over the 12 runs. Peak = best sample of any run. Thinking
  tokens = the model's tokenizer over `<stem>-reasoning.txt`, code tokens over `<stem>.txt`.
- **Speed cell**: tps = mean of the 3 runs' `gen_tps.avg`; peak = max `peak_clean`. A run with no steady sample (an answer
  shorter than the warm-up) is left out of its cell.
- Sampling: bench tools never send temperature / top-p (the checkpoint's `generation_config` decides) unless a flag asks.

## Scoring (app.js; also printed in the site footer)

- spec: max context longest = 1, other = ratio · KV pool = min(1, pool / (3 × max context)) · seats = min(1, seats / 8)
- gauntlet: thinking, code, peak: faster = 1, other = ratio
- quality per page: clean 1 · fixed 0.5 · anomaly 0.5 · broken 0 (pending counts 0 until judged)
- throughput per c and column: faster = 1, other = ratio; a column only one side can run = 1 vs 0; untested = not scored

## Judging a page (maintainers)

Open `static/runs/<id>/<test>/r<n>.html` in a browser and judge what renders against the prompt's checklist.
- **clean**: every required element present and right.
- **fixed** (0.5): a script error fixable in ONE place with ≤ 3 characters or one missing HTML tag, never by commenting code
  out. Save the original as `r<n>.orig.html`, the fixed page as `r<n>.html`, and record `fix.{chars,what}` + `orig: true`.
- **anomaly** (0.5): one element off (e.g. grass drawn over the animals, a malformed head). Say which in `note`.
- **broken** (0): anything bigger, hallucinated code, an empty scene, wrong anatomy across the scene.
Judge visually; code style is not scored.

## Reviewing a contribution

**Default stack evaluated, extended stack measured.** Spec, gauntlet and quality describe the stack as it ships. For the
throughput matrix the contributor may extend or tune the stack (at least 16 seats, so every rung holds c streams); whatever
they changed goes in `spec.notes.seats` / `spec.notes.model`.

1. The maintainers verify the data against `results/<id>/` with their own tooling. Problems go back to the contributor.
2. Judge the 12 pages, write verdicts + notes.
3. Merge, regenerate `report.js`, bump the `?v=` timestamps in `index.html`, deploy.

## Rules

- Measured numbers only; never round, average or "fix" a number by hand. A wrong number means re-running the test.
- Each stack runs as it ships: same image, flags and seats a user gets.
- Pages are saved as generated; only the one-place fix above is allowed, with the original kept.
- `report.js` and `static/runs/<id>/` are generated: change the inputs, regenerate.
