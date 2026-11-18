// The problems we claim, in the brief's exact words. FROZEN after Tue 2026-11-17.
// Source: "Patriot HackFest Fall 2026 Event Information.pdf", section "What to build".
// Cut for good: 3, 5, 6, 10, 11, 12, 15.

/** Keys for the numbers that prove each problem. src/sim produces them; src/ui shows them. */
export type ProofMetric =
  | 'blackoutWarningLeadHours'
  | 'deepLevelPowerSharePct'
  | 'badWaterWarnedPct'
  | 'networkDownReachPct'
  | 'familiesReconnectedPct'
  | 'outbreakUndercountRatio'
  | 'witnessesToAgreement'
  | 'lotteryRecheckMatchPct';

/** Values from one simulation run. A missing key means "not measured yet"; never fill it by hand. */
export type ProofValues = Partial<Record<ProofMetric, number>>;

export interface Problem {
  /** The brief's number. */
  id: 1 | 2 | 4 | 7 | 8 | 9 | 13 | 14;
  /** Short label for the problem rail. */
  title: string;
  /** The brief's exact wording. */
  brief: string;
  status: 'full' | 'partial';
  /** The brief's two paths: make life underground sustainable, or get back to the surface. */
  path: 'underground' | 'surface';
  /** What we claim to solve, said plainly. For a partial problem, also what we leave out. */
  claim: string;
  /** What the viewer sees on screen when this problem is answered. */
  moment: string;
  /** The number that proves it. Its value comes from ProofValues, never from this file. */
  proof: { metric: ProofMetric; label: string; unit: 'hours' | 'percent' | 'ratio' | 'count' };
}

/** In story order (the chain in note 11), not number order. */
export const PROBLEMS: readonly Problem[] = [
  {
    id: 7,
    title: 'Pass it on',
    brief:
      'The Directorate controls the network and can shut it down whenever it wants. How would people organize, share information or call for help without it?',
    status: 'full',
    path: 'underground',
    claim: 'Phones pass signed notes hand to hand by sound and QR, with every radio off.',
    moment: 'Two real phones in airplane mode. A signed message crosses by sound.',
    proof: { metric: 'networkDownReachPct', label: 'Residents reached with the network down', unit: 'percent' },
  },
  {
    id: 8,
    title: 'Family',
    brief:
      'When a blackout hits, families split across levels have no way to know if each other are okay. How would you reconnect them?',
    status: 'full',
    path: 'underground',
    claim: 'Family notes locked to a family key, carried by anyone, newest wins.',
    moment: '"Safe, level 11" reaches a mother on level 3.',
    proof: { metric: 'familiesReconnectedPct', label: 'Families who got a "safe" note during the blackout', unit: 'percent' },
  },
  {
    id: 1,
    title: 'Warning',
    brief:
      'Blackouts in the deep levels now last for days, and no one knows when the next one will hit. How would you warn people before the power or air cuts out?',
    status: 'full',
    path: 'underground',
    claim: 'Plugged-in devices write power notes. Rising flickers, or an area going silent, raise a warning.',
    moment: 'The charger is pulled, a power note is written, flicker notes pile up and the warning fires hours early.',
    proof: { metric: 'blackoutWarningLeadHours', label: 'Hours of warning before the blackout', unit: 'hours' },
  },
  {
    id: 2,
    title: 'Fair split',
    brief:
      'When power runs short, the Directorate decides who keeps the lights, and the deep levels always lose. How would you share power, water and food fairly when there isn’t enough to go around?',
    status: 'full',
    path: 'underground',
    claim: 'The same notes, added up per level, prove the split is unfair and give a fair plan to demand.',
    moment: 'Deep levels got a fraction of the hours. The fair alternative sits next to it.',
    proof: { metric: 'deepLevelPowerSharePct', label: 'Deepest level’s power hours as a share of the top level’s', unit: 'percent' },
  },
  {
    id: 4,
    title: 'Water',
    brief:
      'Water recyclers in the lower levels are breaking down, and what comes through the taps is making people sick. How would you catch bad water before people drink it?',
    status: 'full',
    path: 'underground',
    claim: 'Bad tap reports on the pipe map trace back to the broken recycler, and a "do not drink" warning goes out.',
    moment: 'Water reports trace to one recycler and a "do not drink" warning spreads.',
    proof: { metric: 'badWaterWarnedPct', label: 'Residents on the bad line warned before drinking', unit: 'percent' },
  },
  {
    id: 9,
    title: 'Outbreak',
    brief:
      'Lung sickness is spreading through the lower levels, and the Directorate’s numbers don’t match what people see. How would you track the real outbreak and get supplies where they’re needed?',
    status: 'full',
    path: 'underground',
    claim: 'Self reports and clinic tallies overlap to estimate the true case count, set against the official number.',
    moment: 'Two lists reveal the real case count against the official one. A rewrite of the notebook fails.',
    proof: { metric: 'outbreakUndercountRatio', label: 'Estimated real cases per official case', unit: 'ratio' },
  },
  {
    id: 13,
    title: 'The surface',
    brief:
      'Many residents believe the surface has healed, and the Directorate insists the air up there would kill you in minutes. How would you prove whether it’s safe, and get the true answer to everyone?',
    status: 'full',
    path: 'surface',
    claim: 'Rules published first, witnessed readings, a doubter and a believer who agree, and the verdict passed on.',
    moment: 'Readings arrive, witnesses sign, doubter and believer meet. The verdict spreads phone to phone.',
    proof: { metric: 'witnessesToAgreement', label: 'Independent witnesses before doubter and believer agree', unit: 'count' },
  },
  {
    id: 14,
    title: 'First up',
    brief:
      'Going back up will not happen all at once, and the first people to try will need suits, domes or sealed outposts. How would you figure out which option works and who should try it first?',
    status: 'partial',
    path: 'surface',
    claim: 'Who goes first: a lottery anyone can re-run and check. We do not compare suits, domes and outposts.',
    moment: 'The lottery is drawn and anyone can check it.',
    proof: { metric: 'lotteryRecheckMatchPct', label: 'Re-runs of the draw that pick the same crew', unit: 'percent' },
  },
];

export function problemById(id: Problem['id']): Problem {
  const p = PROBLEMS.find((x) => x.id === id);
  if (!p) throw new Error(`unknown problem ${id}`);
  return p;
}
