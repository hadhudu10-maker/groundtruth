---
tags: [hackfest, groundtruth, explainer, team]
---

# 11 Plain English Guide and Team Brief

Back to [[Groundtruth Overview]]

> **Status: confirmed by Hadi on 2026-11-17.** The plan is cut to 7 problems plus half of 14. Note 10 has the matching schedule.

## The whole project in one sentence
Residents write **signed notes**, **pass them hand to hand** with no network, keep them in a **notebook nobody can erase**, and **do math on the pile**.

That is all Groundtruth is. Three shared parts, and every feature is just a different kind of note plus a different calculation.

| Shared part | Plain meaning | Old module name |
|---|---|---|
| **Signed notes** | Anything a resident reports gets a digital signature, so nobody can fake it or change it later | (used everywhere) |
| **Pass it on** | Phones hand notes to each other by sound and QR code, so the Directorate cannot cut it off | Murmur |
| **The notebook** | Every note is kept in a record where erasing or editing shows up immediately | Ledger |

## Each angle, explained simply

| # | The problem | The note residents write | The math on the pile | What it gives people |
|---|---|---|---|---|
| 7 | The Directorate can shut the network down | Any message | None. This is the delivery system itself. | Messages still get through, phone to phone |
| 8 | Families cannot find each other in a blackout | "I am safe, level 11", locked so only family can read it | Newest note wins | Anyone walking between levels carries it. Family sees "safe, 12 minutes ago". |
| 1 | Nobody knows when the next blackout hits | "My power flickered at 3:02" (a plugged-in device notices this by itself) | Count flickers per area. A sudden rise means a blackout is coming. Also: if an area goes silent, that is a warning too. | A warning hours ahead, delivered by pass-it-on so it survives the blackout |
| 2 | The deep levels always lose when power is short | The same power notes, plus water and food notes | Add up hours of power per level. Compare with a split where the worst-off level is raised first. | Proof the split is unfair, and a fair plan to demand |
| 4 | Bad water makes people sick | "My tap water tested bad" | Mark the notes on the pipe map and follow the pipes back to the one broken recycler | "Do not drink" warning before more people get sick |
| 9 | The official sick count is too low | "Someone here is sick" from residents, plus tallies from clinic volunteers | Two incomplete lists. How much they overlap tells you how many cases both missed. | The real outbreak size, and where to send supplies |
| 13 | Is the surface safe? Nobody believes anybody. | "I witnessed this probe reading", signed by several independent people | Rules for "safe" are published before any reading comes in. A doubter and a believer both update on the same evidence until they agree. | An answer nobody can fake, delivered to everyone by pass-it-on |
| 14 (half) | Who goes up first? | "Here is the lottery seed", published in the notebook before the draw | A draw anyone can re-run and check | A first crew nobody can accuse of being rigged |

## How they connect (the chain)
1. **Pass it on** exists first. Nothing else works without it, because the Directorate owns the network.
2. Because notes can travel, families can **find each other** (8).
3. Because devices write **power notes**, the pile predicts **blackouts** (1).
4. The same power notes, added up per level, **prove unfairness** (2).
5. Add **water notes** and **sick notes** to the same notebook and you get the **broken recycler** (4) and the **real outbreak** (9).
6. By now residents have a notebook they trust more than the Directorate. So when a **surface reading** arrives, the same notebook is what makes people believe it (13), and the same notebook makes the **lottery** fair (14).

Remove any earlier step and the later ones stop working. That is what "connected" means, and it is what the brief rewards.

## Honest audit: what belongs and what is padding
| # | Verdict | Honest reason |
|---|---|---|
| 7, 8 | **Keep, the heart** | Real, filmed, and everything depends on it |
| 1 | **Keep, with a change** | Hole: with no Directorate sensors, where does data come from? Fix: a plugged-in device is a power sensor. Cut the "listen to the hum" idea. It is a gimmick that probably will not work on phones. |
| 2 | **Keep, pitched honestly** | Residents cannot flip the Directorate's switches. The real value is proof of unfairness plus a fair plan, not control. |
| 4 | **Keep** | Same notes and notebook as 9, so it is cheap. The pipe tracing is the first thing to cut if short on time. |
| 9 | **Keep, with a change** | Hole: the Directorate publishes one number, not a list, so there is nothing to overlap with. Fix: use two resident sources (self reports and clinic volunteer tallies), then compare the estimate with the official number. |
| 13 | **Keep, the finale** | Hole: we do not solve how a probe gets past the machines. We solve how everyone comes to believe a reading. Say that out loud. |
| 14 | **Keep half** | The lottery is ten lines on top of the notebook. The suits vs domes vs outposts comparison is a separate model with no link to the rest. Cut it and claim 14 as partial. |
| 15 | **Cut** | A migration timeline nobody can check, with no link to notes or the notebook. Padding. |
| 3 | **Cut** | Cooling schedules were added to raise the count. Cooling stays as one resource inside the fair split, nothing more. |
| 5 | **Cut** | Tunnel routing is a separate app that happens to use reports. Padding. |
| 6, 10, 11, 12 | **Cut for good** | Unrelated to the core. No more "stretch" list. |

**Proposed final scope: 7 problems fully (1, 2, 4, 7, 8, 9, 13) and 14 partially.** Both paths are still covered. The brief says "several" problems in one connected solution, not "most". This frees roughly 9 to 10 build hours for the real-device demo and polish.

## Working with a teammate

### Do not use a friend's Claude login
Anthropic's terms do not allow sharing account logins, and the hackathon's rule 1 says only team members may contribute. The legitimate version gets you the same thing: **the friend joins the team and runs Claude Code on their own account, on their own computer, in the shared repository.** That doubles the usage available and breaks no rules.

### Setup (about 20 minutes)
1. Create a private GitHub repository and add them as a collaborator.
2. Copy this plan into the repository's `docs/` folder so they can read it (the Obsidian vault is only on your Mac).
3. Put the project rules in `CLAUDE.md` at the repository root. Both of your Claude sessions read it and follow the same contract.
4. Each person owns separate folders and works on their own branch. Merge through pull requests, one at a time.
5. Add them to the team roster before submitting. There are no edits afterward.

### The 60 second pitch
> "It is a hackathon about people stuck underground where the government controls the network and lies about the numbers. Everyone else will build the government's dashboard. We are building the opposite: an app for the residents. Phones pass signed messages to each other with no network, by sound and QR code, and we film that working in airplane mode. All the messages go in a record nobody can erase. From that record we predict blackouts, prove the rationing is unfair, find the real outbreak size, and finally prove whether the surface is safe. $2,000 prize, due Friday night. I have the full plan. I need you for [their part]."

### How they can help
| If they can | Give them |
|---|---|
| Code with Claude Code | The surface verdict and lottery (problems 13, 14) on Thursday, or the city view. A separate folder, so no collisions. |
| Not code, but are reliable | Second phone for device testing, filming and editing the video, README proofreading, watching the Discord for the rubric |
| Design | The look of the resident app and the video's title cards |

## The four tool repositories
| Repository | What it is | Verdict |
|---|---|---|
| **mattpocock/skills** | Small separate skills: grilling, test-first building, bug diagnosis, design | **Already installed.** You have `grill-me`, `grilling`, `tdd`, `domain-modeling`, `codebase-design`, `diagnosing-bugs`, `prototype`, `implement`, `code-review` and more. Do not install again: its own README warns that installing twice duplicates every skill. This is the one to use. |
| **obra/superpowers** | A full method that takes over: it interviews you, writes a spec, writes a plan, then runs subagents for hours | **Skip for this week.** Redundant with the plan and skills you have. Its long autonomous subagent runs are the fastest way to burn your usage limit. Good tool, wrong week. |
| **affaan-m/ECC** | 72 agents, 327 skills, 98 commands, plus hooks and memory | **Skip.** The largest overlap and the largest cost: hundreds more skill descriptions loaded into every session, and hooks that change how every session behaves. |
| **garrytan/gstack** | 23 role-play tools: CEO review, code review, a QA role that drives a real browser, shipping | **Skip.** Its one distinct piece, browser QA, is already covered by the built-in browser tools and Playwright. Also needs Bun installed. |

Bottom line: the limit this week is time and usage, not tooling. Each of these adds always-on instructions that compete with each other. Install none.

## Which model and effort for each step
"Top model" means Fable 5.2, or Opus 5.5 if Fable's limit is the one you keep hitting. I cannot measure how much each costs against your limit from here, so check your usage page as you go.

| Day | Step | Model | Effort | Why |
|---|---|---|---|---|
| Tue | Repo, app shell, deploy | Sonnet 5.5 | Low | Routine setup |
| Tue | The note format and shared types (the contract) | **Top model** | **High** | Everything is built on this. A mistake here costs a day. |
| Tue | Sound and QR device test page | Sonnet 5.5 | High | Unfamiliar library. Move to the top model if two attempts fail. |
| Tue | Simulation engine | **Top model** | **High** | Every number in the video comes from it |
| Tue | City view | Sonnet 5.5 | Medium | Visual work with the design skills |
| Wed | Pass-it-on protocol and message signing | **Top model** | **High** | Security logic packed into 140 bytes. Subtle. |
| Wed | Family notes (encryption) | **Top model** | **High** | Cryptography done wrong is worse than none |
| Wed | Blackout warning | Sonnet 5.5 | High | Clear spec, test-first |
| Wed | Fair split | Sonnet 5.5 | High | Small optimization. Top model only if the numbers look wrong. |
| Thu | The notebook (tamper-evident record and proofs) | **Top model** | **High** | The core of the trust claim |
| Thu | Outbreak estimate, supply routing | Sonnet 5.5 | Medium | Short, well-known math |
| Thu | Pipe tracing | Sonnet 5.5 | High | Graph logic, test-first |
| Thu | Surface verdict and lottery | Sonnet 5.5, top model for the lottery check | High | The lottery must be provably fair |
| Every night | Merge and code review | **Top model** | **High** | A weaker reviewer misses what the builder got wrong |
| Fri | Story mode and polish | Sonnet 5.5 | Medium | |
| Fri | Bugs that resist two attempts | **Top model** | High, extra high only if still stuck | Do not spend maximum effort anywhere else |
| Fri | Security review and threat model | **Top model** | High | It is your differentiator |
| Fri | README, submission text | Sonnet 5.5 or Haiku 5.5 | Low | Then your humanizer skill |

### Getting the most from each session
- **One fresh session per module.** Long sessions cost more per message because the whole history is re-read. This planning session is already long. Start the build in a new one.
- **Give Sonnet a written spec and tests first.** It performs close to the top model when the task is pinned down. The top model is for work where the task itself is unclear.
- **No research subagents on the top model.** That is what hit your limit on Monday night.
- **About seven top-model steps are not optional:** the contract, simulation, protocol, family encryption, notebook, nightly reviews and the security review. Budget for those first.
