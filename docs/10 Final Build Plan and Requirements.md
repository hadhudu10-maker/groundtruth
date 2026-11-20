---
tags: [hackfest, groundtruth, plan, timeline]
---

# 10 Final Build Plan and Requirements

Back to [[Groundtruth Overview]]

**This is the current plan (revised 2026-11-17 after the scope cut).** It overrides anything different in notes 02, 03, 07 and 09. The plain-English explanation is in [[11 Plain English Guide and Team Brief]].

## Scope: locked
**7 problems fully: 1, 2, 4, 7, 8, 9, 13. Problem 14 partially (the lottery only). Both paths covered.**
Cut for good: 3, 5, 6, 10, 11, 12, 15, the suits vs domes comparison, and "listen to the hum".

## What we are building
Residents write **signed notes**, **pass them hand to hand** with no network, keep them in a **notebook nobody can erase**, and **do math on the pile**.

| Part | Folder | What it is |
|---|---|---|
| Notes and contract | `src/world` | The note format, shared types, the list of 15 problems and their status |
| The Hollow | `src/sim` | Simulated city that produces every number we quote |
| Pass it on | `src/murmur` | Real device-to-device transfer by sound and QR, plus family notes |
| Warning | `src/canary` | Power notes from plugged-in devices, flicker counting, silence alarm |
| Fair split | `src/fairshare` | Proof of unfairness and the fair alternative |
| The notebook | `src/ledger` | Tamper-evident record, outbreak estimate, pipe tracing |
| The surface | `src/ascent` | Witnessed readings, doubter and believer, the lottery |
| Screens | `src/ui` | City cross-section, resident app, problem rail, story mode |

"Real at human scale, simulated at city scale": the resident app really works on two devices, and the simulation shows the effect across the Hollow.

## The honest math
- Your time: about 5 hours today (Tue), 9 to 10 on Wed and Thu, 8 to 9 on Fri. Roughly 32 to 34 hours.
- Build work after the cut: roughly 37 agent-hours, down from 48. It fits with two agents in parallel on Wed and Thu. These are estimates.
- **If it slips, cut in this order:** pipe tracing, supply routing, the lottery, the city-scale message-spread animation.
- **Never cut:** offline transfer, family notes, the blackout warning, the unfairness proof, the notebook with the true outbreak count, the surface verdict.

## What is required
- **People:** you. A teammate on their own Claude account in the shared repository is the legitimate way to get more usage. See note 11.
- **Hardware:** your Mac, one phone (two is better), a quiet room, a phone stand.
- **Accounts:** GitHub (already signed in), Vercel or Cloudflare Pages for HTTPS hosting from day one. Phones only allow the microphone and camera on an HTTPS site.
- **Software:** Node 22 (installed), Chrome on the Mac, Safari on the phone, QuickTime or OBS.
- **Skills:** all eight were installed on 2026-11-17. Install nothing else (superpowers, ECC and gstack were reviewed and rejected, Matt Pocock's skills are already installed).

### Libraries (source-checked in [[08 Library Feasibility Research]])
| Purpose | Library | Note |
|---|---|---|
| Data over sound | `ggwave`, audible protocol | 140 bytes per message, about 6 to 12 seconds each. iPhone Safari untested. |
| QR | paulmillr `qr` or `qr-scanner`, plus `@ngraveio/bc-ur` for multi-frame | iPhone needs a JavaScript decoder |
| Offline shell | `vite-plugin-pwa` | Works offline after one HTTPS load |
| Signatures | `@noble/ed25519`, `@noble/hashes` | |
| Fair split | `javascript-lp-solver` | |
| Simulation | `comlink`, `pure-rand` | |
| Graphs, statistics | `graphology`, `simple-statistics` | Pipe tracing. The outbreak estimate is five lines, hand-coded. |
| UI | Tailwind, shadcn/ui, Framer Motion, Lucide | |
| Tests, video | Vitest, Playwright, Remotion | |

### Design rules from the research
- Sound carries short beacons, QR carries bulk. Devices pair once by QR to swap keys, then sound messages carry a short key ID, a signature and about 60 bytes of content.
- Only sound and QR work with every radio off.
- The phone must load the app from the HTTPS site once before going offline.

## Model guide
"Top" means Fable 5.2, or Opus 5.5 if Fable's limit is the one you keep hitting. Start a fresh session for each module. Give Sonnet a written spec and tests first.

## Day by day

### Tuesday Nov 17: Foundation and device tests (5 hours)
| Time | Work | Model, effort |
|---|---|---|
| 45 min | Repo, app shell, deploy to an HTTPS address | Sonnet, low |
| 45 min | **The contract:** note format, shared types, notebook interface, `problems.ts` with the brief's exact wording. Frozen after today. | **Top, high** |
| 1h, hands-on | **Device tests** from the HTTPS site: (1) pair Mac and phone by QR, (2) signed message by sound in both directions with the phone in airplane mode, (3) multi-frame QR, (4) does a plugged-in device report when its charger is pulled (Chrome on the Mac first) | Sonnet, high |
| 2h, parallel | Simulation engine: levels, power, water, sickness, cascading failures, seeded | **Top, high** |
| 2h, parallel | City cross-section and the problem rail | Sonnet, medium |
| 30 min | Merge, failure buttons, redeploy | Top, medium |

**Gate, 11 PM:** a deep level visibly fails on the live site. Written results of all four device tests.
**If a test fails:** sound fails on iPhone, then sound runs Mac to Mac or one direction only and QR carries the rest. Charger sensing fails, then residents tap "my power flickered" by hand.

### Wednesday Nov 18: Pass it on, warning, fair split (9 to 10 hours)
| Block | Work | Problems | Model, effort |
|---|---|---|---|
| Morning, parallel | **Pass it on:** device identity, signed notes that fit 140 bytes, duplicates and replays rejected, store and forward, wired into the resident app | 7 | **Top, high** |
| Morning, parallel | **Warning:** power notes, flicker counting, silence alarm, tested over 500 simulated runs | 1 | Sonnet, high |
| Midday | Review, merge one at a time, check in the browser | | Top, high |
| Afternoon, parallel | **Family notes:** locked to a family key, carried by anyone, newest wins | 8 | **Top, high** |
| Afternoon, parallel | **Fair split:** hours per level from power, water and food notes, the fair alternative, side by side | 2 | Sonnet, high |
| Evening | Warnings travel by pass-it-on. "Directorate kills the network" switch in the city view. Nightly review, redeploy. | 1, 7 | Top, high |

**Gate, 6 PM:** a signed note crosses between two real devices with the network off. **Gate, 11 PM:** a family "safe" note arrives, and the warning and fair split show measured numbers.
If you stopped here you would have a real entry for 1, 2, 7 and 8.

### Thursday Nov 19: The notebook and the surface (9 to 10 hours)

| Block | Work | Problems | Model, effort |
|---|---|---|---|
| Morning, parallel | **The notebook:** tamper-evident record, proofs checked in the browser, a "rewrite history" button that visibly fails | all | **Top, high** |
| Morning, parallel | **Outbreak:** sick notes from residents and clinic volunteers, the true-count estimate against the official number, supply routing | 9 | Sonnet, medium |
| Midday | Review, merge, browser check | | Top, high |
| Afternoon, parallel | **Water:** water notes on the pipe map, trace back to the failing recycler, "do not drink" warning | 4 | Sonnet, high |
| Afternoon, parallel | **The surface:** rules published first, witnessed readings, doubter and believer curves, verdict sent by pass-it-on, verifiable lottery | 13, 14 | Sonnet, high. Top for the lottery check. |
| Evening | Fair-split results signed into the notebook, every number wired to the problem rail, nightly review | | Top, high |

**Gate, 6 PM:** the notebook catches a rewritten history and shows the true outbreak estimate. **Gate, 10 PM: feature freeze.** Nothing new after this.

### Friday Nov 20: Ship (8 to 9 hours)
| Time | Work | Model, effort |
|---|---|---|
| 9 to 11 AM | Story mode: one click plays the whole chain with the brief's wording as captions. Bug bash on the live site. | Sonnet, medium. Top for stuck bugs. |
| 11 AM to 12 PM | Code review, cleanup, security review, threat model | **Top, high** |
| 12 to 1:30 PM | README: coverage table first, what is real vs simulated, what we do not solve | Sonnet or Haiku, low |
| 1:30 to 4:30 PM | Film the airplane-mode demo on real devices, record story mode, edit to 3 minutes | You |
| 4:30 to 6 PM | Submission text in problem order, fresh-clone test, live link test logged out, roster check | Sonnet, low |
| 6 to 7 PM | Buffer | |
| **By 8 PM** | **Submit.** No edits afterward. Hard deadline 11 PM. | |

## The 3 minute story (replaces the script in note 06)
1. **The Hollow.** A deep level loses power. The Directorate's network goes dark.
2. **Pass it on (7).** Two real phones in airplane mode. A message crosses by sound.
3. **Family (8).** "Safe, level 11" reaches a mother on level 3.
4. **Warning (1).** Pull the Mac's charger. A power note is written. In the city view, flicker notes pile up and the warning fires hours early.
5. **Fair split (2).** The same notes, added up: deep levels got a fraction of the hours. The fair alternative next to it.
6. **Water and outbreak (4, 9).** Reports trace to one recycler. Two lists reveal the real case count against the official one. Someone tries to rewrite the notebook and it fails.
7. **The surface (13, 14).** Readings arrive, witnesses sign, doubter and believer meet. The verdict spreads phone to phone. The lottery is drawn and anyone can check it.
8. **Close.** "The notebook that proved the water was bad is the one that proved the air was good." Rail: 7 lit, 1 half lit.

## What we say we do not solve
Stated in the README and video: residents cannot flip the Directorate's switches (we give proof and a plan), we do not get a probe past the machines (we make a reading believable), the sound link is slow, and all city-scale data is simulated.

## Done means
- [ ] Live HTTPS link that works logged out and offline after first load
- [ ] Two real devices pass a signed note with every radio off, on video
- [ ] Each claimed problem shows its on-screen moment and its number
- [ ] Every number in the video came from the simulation harness
- [ ] Submitted with three hours to spare
