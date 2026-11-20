# Groundtruth (Patriot HackFest Fall 2026)

Hard deadline: Fri 2026-11-20, 11 PM ET. Aim to submit by 8 PM. No edits after submitting.
Live site: https://groundtruth-one-flame.vercel.app (Vercel, auto-deploys from `main` on GitHub).

## What we are building
Residents of the Hollow write **signed notes**, **pass them hand to hand** with no network (sound and QR), keep them in a **notebook nobody can erase**, and **do math on the pile**.
Pitch: "a group chat that works with no internet, where nobody can fake or delete a message, and that adds everyone's messages up to find the truth."
"Real at human scale, simulated at city scale."

## Source of truth
- `docs/10 Final Build Plan and Requirements.md`: the plan, day by day, with model and effort per step. It overrides anything else.
- `docs/11 Plain English Guide and Team Brief.md`: the plain-English explanation.
- `docs/08 Library Feasibility Research.md`: source-checked library verdicts.

## Scope (locked)
Problems 1, 2, 4, 7, 8, 9, 13 fully; 14 partially (lottery only). Cut for good: 3, 5, 6, 10, 11, 12, 15.
If time slips, cut in order: pipe tracing, supply routing, the lottery, city-scale message-spread animation.
Never cut: offline transfer, family notes, blackout warning, unfairness proof, notebook with true outbreak count, surface verdict.

## Modules (`src/`)
world (note format, shared types, problems list; FROZEN after Tue), sim (the Hollow, seeded), murmur (sound and QR transfer, family notes), canary (power notes, flicker, silence alarm), fairshare (unfairness proof, fair split), ledger (tamper-evident notebook, outbreak estimate, pipe tracing), ascent (witnessed readings, doubter/believer, lottery), ui (city cross-section, resident app, problem rail, story mode).

## Rules
- Stack: Vite, React, TypeScript, Tailwind v4, vite-plugin-pwa, Vitest. Node 22.
- Libraries are fixed by note 10: ggwave, qr/qr-scanner, bc-ur, @noble/ed25519, @noble/hashes, javascript-lp-solver, comlink, pure-rand, graphology, simple-statistics. Install nothing else without asking.
- Every number shown in the demo must come from the simulation harness.
- Phones need the HTTPS site loaded once before going offline.
- Never use em or en dashes in prose.
- One module per session. Only touch the files of the module you were asked to build.
- Before each step, state the model and effort the plan lists for it.
