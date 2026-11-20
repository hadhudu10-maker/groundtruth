# Submission text (draft)

Fill in the two blanks marked TODO, read it once, then paste each section into the matching field on the judging platform. Numbers are the ones the live site shows; all come from the seeded simulation.

---

## Project name
Groundtruth

## One line
A group chat that works with no internet, where nobody can fake or delete a message, and that adds everyone's messages up to find the truth.

## Links
- Live site: https://groundtruth-one-flame.vercel.app (press "Play the story")
- Phone app: https://groundtruth-one-flame.vercel.app/#pass
- Code: https://github.com/hadhudu10-maker/groundtruth
- Video: TODO (link after upload)

## Team
TODO (names exactly as on the roster)

## Track and problems
Life underground. Both paths: life underground (1, 2, 4, 7, 8, 9) and the way back up (13, 14). Problems 1, 2, 4, 7, 8, 9 and 13 in full, 14 in part (who goes first).

## What it does
In the Hollow the Directorate owns the network and the numbers. Groundtruth gives that power to residents. They write signed notes, pass them hand to hand by sound and QR code with every radio off, keep them in a notebook nobody can erase, and do math on the pile. Every answer below is one kind of note plus one calculation, so each one builds on the last.

**1. Blackout warning.** A plugged-in device writes a power note when its charger loses power. Flicker notes rising on a level, or a level going silent, raise a warning that travels phone to phone. Measured over 500 seeded runs: a median of 1.5 hours of warning, 88% of blackouts warned.

**2. Fair split.** The same power notes, added up per level, prove the split is unfair, and a fair plan (the worst-off level first) is computed next to it. In a week with 10% less generation, the deepest level got 63.3% of the top level's power hours; a calm week gives about 98%.

**4. Bad water.** Tap test notes are counted per recycler line. Once bad reports pass a threshold, that line gets a "do not drink" warning. 67.2% of residents on the bad line are warned before the bad water reaches them.

**7. No network.** Signed 140-byte notes cross by sound (one note in 9 to 14 seconds) or by animated QR (40 at a time), stored and forwarded. Tested on a Mac and an iPhone in airplane mode. Across the simulated city, 61% of residents hold a warning 24 hours after it is written, with the network down.

**8. Families.** Family notes are locked to a family key swapped in person (the browser's own AES-GCM), carried by anyone and opened only by family. "Ask for my family" makes carriers hand over your family's notes first, which more than triples delivery: 31% of split families hear "safe" from a relative on another level within 48 hours, with the whole city writing at once (9% without it).

**9. The real outbreak.** Self reports and clinic tallies are signed into the notebook. How much the two lists overlap gives the true case count (capture-recapture): 4.2 real cases for every official one, and a ranking of where to send supplies.

**13. The surface.** The rules for "safe" are published first. Probe readings count only once independent witnesses on different levels sign them. A doubter and a believer update on the same evidence until they agree: 20 witness signatures on median, agreeing on the truth in 98% of 500 runs. The verdict travels phone to phone.

**14. Who goes first (partial).** A lottery anyone can re-run: the organizer commits to a secret seed, entries close at a time fixed in advance, then the seed is revealed. 200 residents re-running it from notebooks in different orders all get the same crew. We do not compare suits, domes and outposts.

Underneath all of it is the notebook: an append-only Merkle log. Someone tries to rewrite history on screen and the check fails.

## How we built it
Vite, React, TypeScript and Tailwind, as an offline-first web app (PWA) that works on any phone after one load. Ed25519 signatures (@noble/ed25519), data over sound (ggwave), animated QR (qr, qr-scanner, bc-ur), a fair split solver (javascript-lp-solver) and a seeded simulation of the Hollow (pure-rand) that produces every number we show. 320 automated tests. We froze one shared contract (the note format) on day one so the parts could be built in parallel.

## What is real and what is simulated
Real, on devices: signing, passing notes by sound and QR in airplane mode, pairing, family encryption, the notebook and its proofs, a Mac noticing its charger is pulled. Simulated, seeded and repeatable: the city of 12 levels, how notes spread across it, blackouts, recyclers, the outbreak, surface readings and the lottery's re-runs.

## Challenges
Fitting a signed note into 140 bytes, the most one sound message carries. Getting sound to work both ways on an iPhone in airplane mode. Finding that family notes drown when everyone writes at once (9%), and fixing it with "ask for my family" rather than by changing the model. Closing a way for the lottery organizer to choose the crew, found in our own review.

## What we are proud of
Two real phones passing a signed note with every radio off. Every number on screen traced to a seeded run, with the assumptions written down. An honest threat model with each finding fixed or stated.

## What we do not solve
Residents cannot flip the Directorate's switches; we give proof and a fair plan to demand. We do not get a probe past the machines; we make a reading believable. Sound is slow. City-scale numbers are simulated. A stolen phone gives away its keys, and an organizer with an accomplice could still bias the lottery.

## What is next
Routing family notes toward the right level, a lock and key revocation for lost phones, and volunteers adding their own randomness to the lottery.
