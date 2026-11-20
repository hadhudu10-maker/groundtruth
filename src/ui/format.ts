import type { Problem } from '../world'

/** A proof value with its unit, the same way the problem rail shows it. */
export function formatProof(p: Pick<Problem, 'proof'>, value: number): string {
  const n = Number.isInteger(value) ? String(value) : value.toFixed(1)
  switch (p.proof.unit) {
    case 'percent':
      return `${n}%`
    case 'hours':
      return `${n} h`
    case 'ratio':
      return `${n}x`
    case 'count':
      return n
  }
}
