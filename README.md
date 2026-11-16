# Markdown Render Speed — markdown-render-speed-02

[![make.fun](https://make.fun/badge/markdown-render-speed-02.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![rank](https://make.fun/badge/markdown-render-speed-02/Lawlliet655/markdown-render-speed-02/rank.svg)](https://make.fun/bounty/markdown-render-speed-02)
[![reward](https://make.fun/badge/markdown-render-speed-02/Lawlliet655/markdown-render-speed-02/reward.svg)](https://make.fun/bounty/markdown-render-speed-02)

A fast, dependency-free drop-in replacement for marked 18.1.3, built for
[make.fun's markdown-render-speed-02](https://make.fun/bounty/markdown-render-speed-02).

`parse.js` renders Markdown to exactly the HTML marked 18.1.3 produces
with its default options (GFM on, breaks off, pedantic off) — byte-identical
on all 720 practice cases (680 CommonMark/GFM spec examples + 40 generated
documents) — and runs about 1.2× faster than marked itself on this machine.

## How it works

`main.ts` (Node 22, standard library only) reads `/input/cases.json` and
writes `/output/html.json`, a JSON array of the rendered HTML strings, one
per case and in the cases' order.

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<cases dir> MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Files

- `parse.js` — the parser (dependency-free ES module)
- `main.ts` — the driver
- `LICENSE` — MIT
