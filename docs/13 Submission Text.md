# Submission form answers

One section per field on the judging platform, in the form's order. Each text answer is under the 200-word limit. Paste the text under each heading, not the heading itself.

---

## Project name
Groundtruth

## What is your project?

Groundtruth is a group chat for the people of the Hollow that keeps working when the Directorate shuts the network down, where nobody can fake or delete a message, and that adds everyone's messages up to find the truth.

Residents write short signed notes and pass them phone to phone by sound or QR code, with every radio off. Every note goes into a shared notebook nobody can secretly change. Then the notes are counted, answering seven of the brief's problems fully and one partly:

- Power notes warn a level about 1.5 hours before its blackout (1).
- The same notes prove the deep levels get far less power, and show a fair split (2).
- Tap tests flag a bad water line before people drink it (4).
- Families split across levels learn who is safe (8).
- Two incomplete sick lists reveal about 4 real cases per official one, and where supplies should go (9).
- Witnessed probe readings let a doubter and a believer agree whether the surface is safe (13).
- A lottery anyone can re-check picks who goes up first (14).

Residents stop depending on the Directorate's word: they hold proof it cannot fake.

## How did you build it?

An offline-first web app (PWA): Vite, React, TypeScript and Tailwind, deployed on Vercel. After one load it runs with no network on any phone or laptop.

Every note is at most 140 bytes, the most one ggwave sound message carries: a 17-byte header, up to 59 bytes of content, and an Ed25519 signature (@noble/ed25519, strict verification). One gate checks every incoming note: signature, duplicates, replays, stale and future times. Notes travel by sound (ggwave, 9 to 14 seconds each) or by animated QR (qr, qr-scanner, bc-ur fountain codes, 40 notes per bundle), with store and forward. Family notes are sealed with AES-GCM through the browser's Web Crypto.

The notebook is an append-only Merkle log in the style of Certificate Transparency, with inclusion and consistency proofs, so a rewritten history fails visibly. The math: flicker-rate and silence detection, a maximin fair split (javascript-lp-solver), Chapman capture-recapture, a Bayesian doubter and believer, and a commit, fixed-close, reveal lottery.

Every number comes from seeded simulations (pure-rand), measured over hundreds of runs. 321 automated tests, a security review with a threat model, and a real test on a Mac and an iPhone in airplane mode.

## Why did you choose to build this? What was your thinking?

The brief describes a Hollow where the Directorate controls the network and publishes numbers that do not match what people see. The obvious project is a better dashboard for the Directorate. I built the opposite: tools for residents that work without the Directorate's permission.

Most of the problems share one root: people cannot share information they can trust. So I built three shared pieces (signed notes, passing them hand to hand, and a notebook nobody can erase) and made every answer one kind of note plus one calculation. That is what connects the problems. Notes that survive a network shutdown (7) carry family news (8) and power reports, which predict blackouts (1) and prove the unfair split (2). Water and sick reports in the same notebook catch bad water (4) and the true outbreak (9). By then residents trust the notebook enough to believe a surface reading (13) and a fair lottery (14).

I chose depth over breadth: seven problems answered fully and one partly, each with a number measured in simulation, rather than thin answers to all fifteen. I also stated the limits plainly: residents cannot flip the Directorate's switches, but they can prove what is happening.

## Who built what? How did you collaborate?

Solo project by Hadi Marabe. I came up with the concept, chose the scope and the plan, ran the device tests on real phones, and directed and reviewed every part. I used Claude Code (AI tools are allowed under rule 4) as a pair programmer: one session per module, each checked with tests and merged one at a time, plus an AI-assisted code review and security review whose fixes I approved.

## Submit your Github Repository Link
https://github.com/hadhudu10-maker/groundtruth

## Submit your Demo Video Link (must be available to view); 3 Minutes Maximum
TODO: paste the link after uploading. Set it to Public or Unlisted (YouTube) or "Anyone with the link" (Google Drive), and check it plays in a private browser window.

## Submit a Demo URL (Optional)
https://groundtruth-one-flame.vercel.app
