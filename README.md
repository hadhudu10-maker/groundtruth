# Groundtruth

**A group chat that works with no internet, where nobody can fake or delete a message, and that adds everyone's messages up to find the truth.**

Live: https://groundtruth-one-flame.vercel.app (open it once online; after that it works offline)

Residents of the Hollow write **signed notes**, **pass them hand to hand** by sound and QR code with every radio off, keep them in a **notebook nobody can erase**, and **do math on the pile**. Every feature below is one kind of note plus one calculation.

Real at human scale, simulated at city scale: the phone app really works between two devices in airplane mode, and a seeded simulation of the Hollow shows what happens across the whole city. Every number on the site and in the video comes from that simulation, never typed in by hand.

## Problems we answer

| # | Problem (brief) | Status | What we built | The number that proves it |
|---|---|---|---|---|
| 1 | Blackouts hit with no warning | Full | Plugged-in devices write power notes. Rising flickers or an area going silent raise a warning, passed on phone to phone. | **1.5 hours** of warning (median over 500 seeded runs, 88% of blackouts warned) |
| 2 | The deep levels always lose when power is short | Full | The same power notes, added up per level, prove the split is unfair. A fair plan (worst-off level first) is computed next to it. | Deepest level got **63.3%** of the top level's power hours in a week of 10% less generation (a calm week gives about 98%) |
| 4 | Bad water reaches the taps | Full | Water test notes counted per recycler line. Once bad reports pass a threshold, that line gets a "do not drink" warning. | **67.2%** of residents on the bad line warned before the bad water reached them |
| 7 | The Directorate can shut the network down | Full | Signed 140-byte notes passed by sound (ggwave) and animated QR, store and forward, with every radio off. Tested on a Mac and an iPhone in airplane mode. | **61%** of residents hold a warning 24 hours after it is written, network down (median over 200 seeded runs) |
| 8 | Families split across levels cannot find each other | Full | Family notes locked to a family key (browser Web Crypto, AES-GCM), carried by anyone, opened only by family. "Ask for my family" makes carriers hand over your family's notes first. | **31%** of split families hear "safe" from a relative on another level within 48 hours, with everyone in the city writing at once (9% without "ask for my family") |
| 9 | The official sick count does not match what people see | Full | Self reports and clinic tallies, signed into the notebook, overlap to estimate the true case count (capture-recapture), plus a supply ranking by real cases. | **4.2 real cases** for every official one |
| 13 | Is the surface safe? Nobody believes anybody. | Full | Rules published first, probe readings signed by independent witnesses on different levels, a doubter and a believer updating on the same evidence until they agree. The verdict travels phone to phone. | **20** witness signatures until doubter and believer agree (500 seeded runs: 98% agree on the truth, 1.8% on the wrong answer) |
| 14 | Who goes up first? | Partial | Only the "who goes first" half: a commit, close, reveal lottery anyone can re-run from their own copy of the notebook. We do not compare suits, domes and outposts. | **100%** of 200 residents re-running the draw from notebooks in different orders get the same crew |

Cut on purpose: 3, 5, 6, 10, 11, 12 and 15. One connected system that answers seven problems well beat a thin answer to all fifteen.

## How it connects

1. **Pass it on** comes first: the Directorate owns the network, so nothing else works without it.
2. Because notes travel, **families** can reach each other (8).
3. Plugged-in devices write **power notes**, and the pile predicts **blackouts** (1).
4. The same power notes, added up per level, **prove the split is unfair** (2).
5. **Water** and **sick** notes in the same notebook find the **bad recycler line** (4) and the **real outbreak** (9).
6. By now residents trust their notebook more than the Directorate, so the same notebook makes a **surface reading** believable (13) and the **lottery** checkable (14).

## What is real and what is simulated

| Real, on devices | Simulated, seeded and repeatable |
|---|---|
| Signing and checking notes (Ed25519) | The Hollow: 12 levels, power, air, water, food, sickness |
| Passing notes by sound and by animated QR in airplane mode | How notes spread across the whole city |
| Pairing two phones by QR | Blackouts, failing recyclers, the outbreak |
| Family notes locked and opened with the browser's own encryption | Surface probe readings and witnesses |
| The notebook, its proofs, and the failed "rewrite history" | The lottery's 200 re-running residents |
| A plugged-in Mac noticing its charger is pulled (Chrome) | |

Device tests (Tue 2026-11-17, Mac Chrome and iPhone Safari, airplane mode): QR pairing passed both ways; a full 140-byte signed note crossed by sound in one message both ways (9 to 14 seconds); an animated QR delivered 20 of 20 notes; charger sensing works in Chrome on the Mac. Safari has no battery access, so phones use a "my power flickered" tap instead.

## The note

Every note is at most **140 bytes**, so one note is one sound message:

| Bytes | Field |
|---|---|
| 1 | version and kind (text, power, family, water, sick, surface, witness, commit) |
| 8 | author key ID |
| 4 | the author's own counter |
| 4 | time |
| up to 59 | content |
| 64 | Ed25519 signature |

A note is refused if it is malformed, from an unknown key, badly signed, from the future, more than 7 days old, a duplicate, reuses a counter value with different content, or is an old note played back after its window.

The notebook is an append-only Merkle log in the style of Certificate Transparency. Anyone holding an earlier fingerprint of the notebook can prove nothing was changed, removed or reordered since. The **Rewrite history** button on the site tries to change an old note and shows that check failing.

## What we do not solve

- Residents cannot flip the Directorate's switches. We give them proof and a fair plan to demand.
- We do not get a probe past the machines on the surface. We make a reading believable once one exists.
- Sound is slow: one note takes 9 to 14 seconds. Bulk moves by animated QR, 40 notes at a time.
- All city-scale numbers are simulated. The models' assumptions (how often people meet, how many walk between levels, how many families are split) are written at the top of each measuring file.
- When everyone writes at once, most families still do not hear back within two days (31%). Routing by family would help and is future work.

## Security and limits

See [docs/12 Security Review and Threat Model.md](docs/12%20Security%20Review%20and%20Threat%20Model.md).

<!-- SECURITY-SUMMARY: pasted from the security review -->

## Try it

- **Dashboard:** https://groundtruth-one-flame.vercel.app. Play the story, or use the red buttons to cut power, kill the network, or break a recycler, and watch the panels respond.
- **Phone app:** https://groundtruth-one-flame.vercel.app/#pass on two phones. Load it once online, turn on airplane mode, pair by QR, then pass notes by sound or QR. The Family tab makes or joins a family.
- **Device tests:** https://groundtruth-one-flame.vercel.app/#devtest

## Run it locally

Node 22.

```bash
npm ci
npm run dev        # http://localhost:5173
npm test           # Vitest, about 310 tests
npm run build      # type check and production build
```

The animated QR only works in the production build (`npm run build && npm run preview`), not in `npm run dev`.

## How it is built

| Folder | What it is |
|---|---|
| `src/world` | The contract: note format, signing, replay rules, shared types, the problem list |
| `src/sim` | The seeded Hollow simulation that produces every number |
| `src/murmur` | Sound and QR transfer, store and forward, family notes, the phone app, city-scale spread |
| `src/canary` | Power notes, flicker warning, silence alarm |
| `src/fairshare` | Unfairness proof and the fair split |
| `src/ledger` | The notebook, outbreak estimate, supply ranking, water warnings |
| `src/ascent` | Surface verdict and the lottery |
| `src/ui` | City view, problem rail, legend, story mode |

Vite, React, TypeScript, Tailwind, a PWA for offline use, and Vitest. Libraries: `@noble/ed25519` and `@noble/hashes` (signatures and hashing), `ggwave` (data over sound), `qr`, `qr-scanner` and `@ngraveio/bc-ur` (QR and animated QR), `javascript-lp-solver` (fair split), `pure-rand` (seeded randomness). Family encryption uses the browser's built-in Web Crypto.

Built for Patriot HackFest Fall 2026 with Claude Code.
