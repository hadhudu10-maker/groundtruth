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

In the Hollow, people die from what they don't know in time: that the power and air are about to fail, that the tap water is bad, that the outbreak is far bigger than announced, whether their family on another level is alive. The Directorate holds that knowledge and controls the network. So I asked what keeps people alive when they cannot trust or reach the Directorate.

My answer: survival information must travel, be trusted and be counted without permission. A note passed phone to phone still arrives when the network is cut. A signature means nobody can plant a false "the water is safe". A notebook nobody can erase means evidence cannot vanish. Counting the notes turns scattered fear into actions: leave the level before the blackout, stop drinking from one line, send medicine where the real cases are, find your family.

Each answer is one kind of note plus one calculation, so every problem strengthens the next. Residents still cannot flip the Directorate's switches, but they are no longer kept in the dark. They gain proof to demand a fair share, and one day to decide whether the surface is safe to go home to.

## Who built what? How did you collaborate?

Solo project by Hadi Marabe. I came up with the concept, chose the scope and the plan, ran the device tests on real phones, and directed and reviewed every part. I used Claude Code (AI tools are allowed under rule 4) as a pair programmer: one session per module, each checked with tests and merged one at a time, plus an AI-assisted code review and security review whose fixes I approved.

## Submit your Github Repository Link
https://github.com/hadhudu10-maker/groundtruth

## Submit your Demo Video Link (must be available to view); 3 Minutes Maximum
TODO: paste the link after uploading. Set it to Public or Unlisted (YouTube) or "Anyone with the link" (Google Drive), and check it plays in a private browser window.

## Submit a Demo URL (Optional)
https://groundtruth-one-flame.vercel.app
