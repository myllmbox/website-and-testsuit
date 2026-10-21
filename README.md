# myllmbox.com — model report

The source of [myllmbox.com](https://myllmbox.com): a head-to-head report of local LLM stacks. Pick any two entries and the
page scores them side by side on four blocks: spec sheet, gauntlet speed, visual quality and throughput, all from measured
data.

Anyone can add an entry: run the same two scripts against your serve, build the entry, open a pull request.
**How: [CONTRIBUTING.md](CONTRIBUTING.md).**

## What's here

| path | what |
|---|---|
| `static/` | the site: `index.html`, `app.js` (scores and draws everything in the browser), `styles.css`, `report.json` (all the data), `report.js` (the same data as a script), `runs/<id>/` (every gauntlet page), `prompts/` |
| `bench/` | the measuring tools: `gauntlet.py`, `site.py`, `test.py` (the engine both use), `make-entry.py`, `prompts/` |
| `results/<id>/` | the raw runs behind each contributed entry (every number can be recomputed from them) |
| `AGENTS.md` | how it all works, for people and coding agents |

## View it locally

```bash
python3 -m http.server 8400 -d static     # → http://localhost:8400
```

`?a=<id>&b=<id>` picks the two entries (ids are in `static/report.json`).

## The tests in one paragraph

**Gauntlet**: two one-shot prompts ([pasture](bench/prompts/pasture-text.txt), [fish](bench/prompts/fish-text.txt)) ask
for a self-contained animated HTML scene, with thinking on, 6 runs each, one request at a time. The 12 rendered pages are the
quality score; the speed while thinking and while writing the code is the gauntlet speed. **Throughput**: four prompt types
(mixed, prose, code, structured JSON) at c = 1, 2, 4, 6, 8, 12, 16 concurrent requests, thinking off, 3 runs per cell.
