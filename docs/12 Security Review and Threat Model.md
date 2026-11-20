# 12 Security Review and Threat Model

Friday 2026-11-20, step "Code review, cleanup, security review, threat model" from note 10 (top model, high effort).
Scope reviewed: `src/world` (note format, signing, replay rules), `src/murmur` (store, forward with HAVE and WANT, family sealing, card and family code QR, sound framing, bundle decoding), `src/ledger` (Merkle notebook, audit, rewrite check), `src/ascent/lottery.ts` (commit, fixed close, reveal). Outcome counts and outbreak and surface code were read only where they trust signed fields.

Fixes in this review are on branch `claude/nifty-wright-3c5155`, one commit each, each with a test that fails on the old code:

| Commit | Finding |
|---|---|
| `c0fd7f2` | H1 family status replay |
| `c9b592b` | H2 unverified notes skipped the clock rules |
| `a9c8d49` | H3 organizer could grind the lottery alone |

## What we protect (assets)

1. **Authorship.** A note says who wrote it, and nobody else can write in their name.
2. **Integrity.** Nobody can change a note after it is signed.
3. **History.** A published notebook head commits to every note before it; a later copy that changed or dropped one of them fails the check.
4. **Family privacy.** Only people holding the family key can read a family status.
5. **Delivery.** Notes keep moving hand to hand with every radio off, and the ones that matter (family) go first.
6. **Fair draws.** Nobody, including the organizer, can choose who goes up first.
7. **Each resident's secret key**, on their own phone.

## How the design protects them

* Every note is signed with Ed25519, strict RFC 8032 checking (`zip215: false`, so no signature malleability), with a domain string (`groundtruth/note/v1`) so a note signature can never be reused for anything else (`src/world/note.ts:443`).
* The signer's 8 byte key ID is checked against the full public key on every verify (`src/world/note.ts:444`). Public keys only arrive in person, by QR card.
* One door for every incoming note: decode, find key, verify, then the clock and replay rules (`src/world/note.ts:523`). The store uses only that door, also for notes read back from disk (`src/murmur/store.ts`).
* Duplicates are dropped quietly; a second, different note with the same author and seq is refused and flagged; notes far behind the author's newest seq are refused as replays; notes more than an hour in the future or a week old are refused.
* Family statuses are sealed with AES-GCM (Web Crypto) under a 32 byte family key, with the family tag, the author key ID, and (since H1) the note's seq and time as additional data.
* The notebook is an RFC 6962 Merkle log. Inclusion and consistency checks follow RFC 9162 step by step (`src/ledger/merkle.ts:133`, `:158`). The audit re-checks every signature and recomputes the root from raw bytes.
* The lottery is commit, fixed close, reveal. The close time is fixed at commit time plus one hour, so the organizer cannot pick the moment.

## Attackers: what each can and cannot do

### The Directorate (controls the infrastructure, can listen, jam, and seize)

Can:
* **Jam sound.** ggwave is audible; loud noise on the right band stops it. QR still works at arm's length, which is why every transfer has a QR path.
* **Listen.** Sound carries further than you think. Every note sent by sound is heard by anyone nearby. Text notes are not secret. For every note, including family notes, the author key ID, the time, the kind and the family tag are in clear.
* **Inject junk.** It can make its own keys and sign anything with them. Nobody who has not scanned its card accepts those notes as verified; they are only carried, marked unchecked.
* **Flood relays** with unverifiable notes (finding M2) and **poison** a relay's copy of a note it overheard (finding M1).
* **Seize phones** (see "a stolen phone").
* **Keep its own notebook and lie about it.** It can show any history it likes to someone who never saw an earlier head.

Cannot:
* Forge or change a resident's note. That needs the resident's secret key.
* Read a family status without the family key.
* Rewrite a notebook history that a resident already saved a head of: the consistency check fails (`src/ledger/rewrite.ts`, tested).
* Make an old family status look current any more (H1, fixed).
* Pin junk to the front of every offer with a far-future date any more (H2, fixed).

### A malicious resident (has a real key, is paired with people)

Can:
* Sign false content. Signatures prove who said it, not that it is true. That is why outcomes add many notes up (outbreak estimate, witnessed surface readings) instead of trusting one.
* Equivocate: sign two different notes with the same seq and show each to different people. Each receiver keeps the first it saw and flags the second (`src/world/note.ts:502`), so the lie is visible wherever both meet.
* As a clinic volunteer, list case tags for people who are not sick (`src/ledger/outbreak.ts:129`). A self report only counts for its own author's tag (`:127`), so they cannot report someone else sick on their own.
* Claim any name and level on their card (`src/murmur/card.ts:45`). A card that says "Mum" only proves someone made a card that says "Mum". The surface witness rule trusts card levels (`src/ascent/surfaceNotes.ts:70`).
* Make many keys (Sybils). They only count where people paired with each of them in person.
* As a family member, write a status that claims to be from another family member. Readers who hold that member's key reject it (bad signature). Readers who do not see it marked unchecked; only the family key vouches for it.

Cannot:
* Sign as anyone else, change anyone's note, or get a duplicate counted twice.

### A malicious relay (carries notes it cannot check)

Can:
* Drop notes, or say in a HAVE message that it already holds everything, so the sender skips it. That costs time, not truth: the notes still travel by other hands.
* Carry junk, or keep a damaged copy of a note (M1).
* Learn metadata: who wrote, when, which family tag, and from WANT, which families the person in front of it belongs to (M4).

Cannot:
* Change a note without the change being caught by anyone who holds the author's key.
* Read family statuses.

### A lying organizer (runs the lottery)

Can:
* Refuse to reveal the seed and so cancel a draw. Everyone sees that.
* Grind the draw with an accomplice: the accomplice signs many versions of their volunteer note, the organizer (who knows the seed) picks the one that gives the crew it wants, and only that one is spread (H4, open).
* Leave a volunteer out of the close if their note has not spread. That volunteer's own copy then fails with `roll-mismatch`, so they can see it.
* Publish two different closes to two groups and have it go unnoticed once copies meet (M6, fixed: the draw is refused).

Cannot:
* Pick the seed after seeing the volunteers (the commit comes first).
* Pick the close moment (fixed at commit plus one hour, tested).
* Swap the seed at reveal time (hash check, tested).
* Grind alone with volunteer notes of its own (H3, fixed: the organizer's own notes no longer count).

### A stolen phone

The thief gets everything (H5, open). The secret key, the family keys and every note sit in the browser's local storage as plain text (`src/murmur/device.ts:61`, `src/murmur/family.ts:264`). There is no PIN, no key revocation and no way to rotate a family key. The thief can sign as the owner and read every family status the owner could. What they still cannot do: change notes already in other people's notebooks, or erase them from other phones.

## Findings

Severity is about our own design and code. "Open" means not fixed in this review; the reason is given.

| ID | Severity | Where | Finding | Status |
|---|---|---|---|---|
| H1 | High | `src/murmur/family.ts:82`, `:155` | **Old family status replayed as new.** The seal bound the author but not the note's time. A reader not paired with the author cannot check the signature, and "newest wins" picks by time. Anyone who overheard an old "hurt" note could copy its sealed bytes into a header with a newer time and a junk signature, and it showed as the current status. | **Fixed** `c0fd7f2`. Seq and time are now in the additional data (`family/v2`). Test: the replay end to end. Side effect: family notes sealed before this commit no longer open; write fresh ones before filming. |
| H2 | High | `src/murmur/store.ts:111` | **Unverified notes skipped the clock rules.** Parked notes (author unknown) were carried without the future and stale checks. Offers go newest first, so anyone, with no key, could date junk years ahead and it would lead every offer on every relay that picked it up, city wide. | **Fixed** `c9b592b`. Parked notes get the same future and stale checks. Junk dated within the hour still sorts high; see M2. |
| H3 | High | `src/ascent/lottery.ts:74` | **The organizer could choose the crew alone.** Every note in the roll changes the close digest, and the organizer knows the seed before the close. It could sign its own volunteer note with thousands of different seqs and publish the one that gave the crew it wanted. Nobody could tell. | **Fixed** `a9c8d49`. The organizer's own notes are left out of the roll and the entrants. Test: 30 organizer variants, one crew. |
| H4 | High | `src/ascent/lottery.ts:81` | **Organizer plus one accomplice can still grind the draw** (same mechanism as H3, with the accomplice's notes). | Open, not small. Needs every volunteer to add a secret of their own (commit at entry, reveal after the close) or a public random value after the close. Stated in the code comment and in the limits below. |
| H5 | High | `src/murmur/device.ts:61`, `src/murmur/family.ts:264` | **A stolen or seized phone gives away the secret key and every family key.** Stored as plain text, no lock, no revocation. | Open, design limit. A real version would wrap keys with a passcode (WebAuthn or a PIN based key) and add a signed "my key is lost" note. |
| M1 | Medium | `src/murmur/store.ts:114` | **Poisoned relay copy.** Parked notes are keyed by note ID, which covers the signed part but not the signature. Someone who overheard a note can send a relay a copy with a junk signature first; the relay keeps that copy and drops the real one as "already held". People with the author's key reject the copy, so the note is lost along that path, never falsified. | Open. Fix would key parked notes by the full bytes and offer both copies. Not small enough for today. |
| M2 | Medium | `src/murmur/store.ts:22`, `:117` | **Relay flooding.** Parked notes are capped at 200, oldest out first. Anyone can push 200 junk notes (five QR bundles) and push out the real unverified notes a relay was carrying, such as family notes from strangers. | Open, design limit of carrying what you cannot check. The WANT priority still lets a relative pull their family's notes first. |
| M3 | Medium | `src/murmur/card.ts:45`, `src/murmur/device.ts:94` | **Cards are trusted on first scan.** Name and level are whatever the card says. Scanning a new card for a known key renames it. Witness levels in the surface verdict come from cards. | Open, design limit: trust comes from meeting in person. |
| M4 | Medium | `src/murmur/forward.ts:53` | **WANT tells everyone in earshot which families you belong to.** The comment says it "reveals nothing new"; that is true for the tags, but it now ties the tags to the person standing there, even one who never wrote a note. | Open. It is opt in per tap. Wording to fix in the README rather than the code. |
| M5 | Medium | `src/murmur/family.ts:191` | **The family code QR is the raw family key.** Anyone who photographs the screen can read the family forever. There is no key rotation. | Open, design limit. Show the code only face to face. |
| M6 | Medium | `src/ascent/lottery.ts:156` | **Two closes.** The organizer can sign two different closes and spread each to a different group. Each group computes its own crew until the copies meet. | Fixed (lead, 2026-11-20): a copy that holds two different closes refuses the draw (`two-closes`), tested. Each group can still compute its own crew until copies meet. |
| M7 | Medium | `src/world/identity.ts:33`, `src/ledger/outbreak.ts:129` | **Case tags and family tags are linkable.** Anyone who knows your key ID can tell a sick report is yours, and every note with the same family tag is from the same family. A clinic volunteer can list tags of people who are not sick. | Open, accepted for the demo and already noted in the code. |
| L1 | Low | `src/world/note.ts:503` | A note more than 1024 seqs behind its author's newest is refused even if it was never seen. A very active author's old notes can be lost to someone who meets them late. | Open, deliberate trade off against replays. |
| L2 | Low | `src/world/note.ts:496` | The clock rules use the receiver's phone clock. A phone with a wrong clock refuses good notes as future or stale. | Open. |
| L3 | Low | `src/murmur/sound.ts:54`, `:88` | The base64 sound fallback joins parts by a one byte random ID. Anyone can send a part with the same ID and spoil the join. The signature check catches the result, so this is only jamming. | Open. |
| L4 | Low | `src/murmur/bundle.ts:89` | The bc-ur fountain decoder parses frames from any QR in view. We did not fuzz it. | Open, not checked. |
| L5 | Low | `src/ledger/notebook.ts:100` | The audit reports bytes that do not decode as `bad-signature`; the frozen interface has no `malformed` reason. Cosmetic. | Open, `src/world` is frozen. |

Checked and fine: strict Ed25519 with domain separation; key ID bound to the key on every verify; payload decoding rejects trailing bytes, unknown kinds and bad UTF-8; Merkle code matches RFC 6962 and RFC 9162 (empty tree, power of two sizes, odd sizes, wrong size or root rejected); AES-GCM nonces are random 12 bytes, safe at this volume; a 4 byte family tag collision only costs a failed decrypt; lottery seed, reveal and fixed close rules are all tested; store and loaders survive garbage storage.

## Honest limits (what we do not solve)

* **A signature proves who, not what.** A resident can sign a false reading. We defend by counting many independent notes, not by trusting one.
* **"Nobody can erase it" means "nobody can erase every copy".** Anyone can wipe their own phone. The check only catches a rewrite against a head someone saved earlier.
* **Trust starts in person.** We only verify notes from people whose card we scanned. Strangers' notes are carried but marked unchecked.
* **Sound is public and jammable.** Everything sent by sound is heard by anyone nearby, and the Directorate can drown it out. QR is the fallback.
* **Metadata is visible:** author key ID, time, kind, family tag and case tag.
* **A stolen phone is a stolen identity.** No lock, no revocation, no family key rotation.
* **The lottery stops a lone organizer, not an organizer with an accomplice.**
* **Unchecked family statuses rest on the family key alone.** Any family member can fake one for another member; it shows as unchecked.

## Security and limits (for README.md)

```markdown
## Security and limits
- Every note is signed (Ed25519, strict checking). Nobody can write in your name or change a note without it being caught.
- Every note goes through one door: signature, then duplicate, replay, stale and future checks. Notes from people you have not met are carried for others but shown as unchecked.
- Family statuses are sealed with AES-GCM under a family key swapped in person. Strangers carry them but cannot read them, and cannot replay an old status as new.
- The notebook is a Merkle log (RFC 6962). If anyone rewrites history after you saved a head, the check fails.
- The lottery is commit, fixed close, reveal: the organizer cannot pick the seed, the closing moment, or (alone) the crew.
- Limits: a signature proves who wrote a note, not that it is true. Sound can be overheard and jammed. Author IDs, times and family and case tags are visible to anyone. Names and levels on cards are trusted on first scan.
- Limits: a stolen phone gives away its keys (no lock or revocation yet), and an organizer working with an accomplice could still bias the lottery.
- Full threat model: docs/12 Security Review and Threat Model.md.
```
