// The fair split as a linear program: maximise the share of need that the worst-off level gets
// (maximin), with each level capped at its need and the total handed out never above the supply.
// Solved with javascript-lp-solver.
import solver from 'javascript-lp-solver';

export interface MaximinInput {
  /** Total available, in the same unit as `needs`. */
  supply: number;
  /** What each level needs, same order as the result. Zero or negative means the level takes nothing. */
  needs: number[];
}

export interface MaximinResult {
  /** What each level gets. Never more than its need. */
  allocation: number[];
  /** The lowest share of need any level gets (0..1). The thing the program maximised. */
  worstShare: number;
  /** Supply that nobody needed. Zero whenever supply is short. */
  leftover: number;
}

/**
 * Maximise t such that every level gets at least t of its need, no level gets more than its need,
 * and the total is at most `supply`. When supply is short every level ends at the same share of
 * need (the worst-off cannot be raised without lowering someone else below them); when supply
 * beats total need everyone gets exactly their need and the rest is left over.
 */
export function maximinSplit({ supply, needs }: MaximinInput): MaximinResult {
  const n = needs.length;
  const need = needs.map((x) => (x > 0 && Number.isFinite(x) ? x : 0));
  const totalNeed = need.reduce((a, b) => a + b, 0);
  const allocation = new Array<number>(n).fill(0);
  if (totalNeed === 0 || !(supply > 0)) return { allocation, worstShare: 0, leftover: Math.max(0, supply || 0) };

  // Work in units of total need so every coefficient is near 1 (keeps the simplex well conditioned).
  const S = supply / totalNeed;
  const constraints: Record<string, { min?: number; max?: number }> = { supply: { max: S } };
  const variables: Record<string, Record<string, number>> = { t: { score: 1 } };
  need.forEach((x, i) => {
    if (x === 0) return;
    const nn = x / totalNeed;
    constraints[`floor${i}`] = { min: 0 }; // X_i - nn * t >= 0
    constraints[`cap${i}`] = { max: nn }; // X_i <= nn
    variables.t![`floor${i}`] = -nn;
    variables[`x${i}`] = { score: 0, supply: 1, [`floor${i}`]: 1, [`cap${i}`]: 1 };
  });

  const sol = solver.Solve({ optimize: 'score', opType: 'max', constraints, variables }) as { feasible: boolean; [k: string]: number | boolean | undefined };
  let share: number[];
  if (sol.feasible) {
    // The solver leaves out variables that are zero.
    share = need.map((x, i) => {
      if (x === 0) return 0;
      const v = Math.min(1, Math.max(0, (((sol[`x${i}`] as number | undefined) ?? 0) * totalNeed) / x));
      return v > 1 - 1e-6 ? 1 : v; // the simplex is exact to about 1e-8; snap the full-need case
    });
  } else {
    const t = Math.min(1, supply / totalNeed);
    share = need.map((x) => (x === 0 ? 0 : t));
  }
  const used = need.map((x, i) => share[i]! * x);
  for (let i = 0; i < n; i++) allocation[i] = used[i]!;
  const live = share.filter((_, i) => need[i]! > 0);
  const total = used.reduce((a, b) => a + b, 0);
  return { allocation, worstShare: Math.min(...live), leftover: Math.max(0, supply - total) };
}
