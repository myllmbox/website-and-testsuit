# Adding your stack to myllmbox.com

You run two scripts against your own serve, build the entry with a third, and open a pull request. We render and judge the
12 gauntlet pages, then merge and publish.

## What you need

- An **OpenAI-compatible server** with streaming and a Prometheus **`/metrics`** endpoint carrying vLLM's counters
  (`vllm:generation_tokens_total`, `vllm:num_requests_running`, `vllm:prompt_tokens_total`; the
  `vllm:spec_decode_*` counters add steps/s and acceptance). vLLM has them out of the box. Other engines: see
  [Other engines](#other-engines).
- The thinking switch: `chat_template_kwargs.enable_thinking` must turn thinking on and off.
- Python 3.10+. The bench scripts use the standard library only; `make-entry.py` needs `pip install tokenizers`.
- Time: the gauntlet takes ~2–6 h (12 long answers, one at a time); the throughput matrix ~6 h (84 cells × up to 5.5 min).
- The serve configured **exactly as you ship it** to users (same image, flags, context, seats). Nothing else running on the
  machine while you measure.

## 1. Gauntlet: 6 pastures + 6 fish

```bash
./bench/gauntlet.py --lane <short-name> [--url http://127.0.0.1:8000] [--token <key>]
```

Thinking on, c = 1, `max_tokens` 100,000, the **model's own sampling** (no temperature / top-p is sent, so the checkpoint's
`generation_config` decides). Each answer is saved as generated; the page is the largest HTML block in it. Don't edit
the pages. If a run fails, re-run with `--out <that folder>`: finished runs are skipped.

Output: `bench/results/<model>--<lane>/<timestamp>-gauntlet/`.

## 2. Throughput: the matrix

```bash
./bench/site.py --lane <short-name> [--url …] [--token …]
```

Thinking off, c = 1 2 4 6 8 12 16 × {mixed, prose, code, structured} × 3 runs. c = 1 is one full answer; c > 1 holds c streams
for 30 s warm-up + 300 s measured, replacing every finished stream at once. Structured sends a strict `json_schema`
`response_format` (`bench/prompts/structured-schema.json`).

- **Default stack vs extended stack.** Spec, gauntlet and quality describe the stack **as it ships**. For the matrix you may
  extend or tune it (at least 16 seats, so every rung really holds c streams); write down what you changed with
  `--note-seats` / `--note` (e.g. "ships with 4 seats; c = 6–16 ran with 16"). A rung that never reaches c running requests
  fails review.
- More seats than 16 (a cluster)? Add rungs: `--cs 1,2,4,6,8,12,16,24,32,48,64`.
- Your server can't do something (e.g. no `json_schema`)? Leave it out with `--contents full,story,code-ts` and pass
  `--unsupported structured` to `make-entry.py`; the site shows that column as unsupported.

Output: `bench/results/<model>--<lane>/<timestamp>-site/`.

## 3. Build the entry

```bash
pip install tokenizers
./bench/make-entry.py --id <id> --name "<you or the stack> (TP=1)" --model "<Model> <quant>" --stack "<engine> · <drafting> · <hardware>" \
    --hf <weights url> --link <recipe url> --image <image:tag> \
    --max-context <tokens> --kv-pool <tokens> --kv-dtype <fp8|bf16|…> --seats <max concurrent requests> \
    --gauntlet <gauntlet folder> --site <site folder> --tokenizer <the model's tokenizer.json> --write
```

- `--id`: lower-case, digits, `.` and `-` (it ends up in the URL).
- `--kv-pool`: the KV cache size in tokens your serve reports at boot (vLLM: `GPU KV cache size: N tokens`).
- `--link` is required for a merge: a page that says how to reproduce the serve (image, flags, weights).

`--write` adds the entry to `static/report.json`, regenerates `static/report.js`, copies the 12 pages to `static/runs/<id>/`
and the raw runs to `results/<id>/`. Check it locally (`python3 -m http.server 8400 -d static`, then `?a=<id>&b=mbx-v53`).

## 4. Pull request

Commit `static/report.json`, `static/report.js`, `static/runs/<id>/` and `results/<id>/`, and say in the PR:

- the hardware (machine, GPU, memory, how many boxes) and the exact serve command or recipe;
- anything that differs from the protocol above, and why.

The quality verdicts start as `pending`. We render every page and judge it by the rules on the site (clean 1 · one small fix
or one element off 0.5 · broken 0), write the verdicts and notes, and publish. Numbers are never edited by hand: if
something is off, the run is redone.

## Other engines

`test.py` also reads TensorFold's `/metrics` and `/health` counters. A server with no token counters at all can be measured
on the client with `--tokenizer <tokenizer.json>` passed to `test.py` (re-tokenized stream; no acceptance numbers). Open an
issue first if your engine needs anything else, so every entry stays measured the same way.
