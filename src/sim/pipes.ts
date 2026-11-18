// The Hollow's water pipe map. Upper levels each have their own recycler. Below SHARED_FROM,
// one recycler feeds a pair of levels, so a bad tap on one level can trace to a recycler on another.
import type { LevelId, PipeNodeId } from '../world';
import type { PipeMap, PipeNode } from './types';

/** First level whose recycler is shared with the level below it. */
export const SHARED_FROM = 7;

export const recyclerNode = (level: LevelId): PipeNodeId => level * 100;
export const junctionNode = (level: LevelId): PipeNodeId => level * 100 + 50;
export const tapNode = (level: LevelId, zone: number): PipeNodeId => level * 100 + 1 + zone;

/** The level whose recycler feeds `level`. */
export function sourceLevelOf(level: LevelId): LevelId {
  if (level < SHARED_FROM) return level;
  return level - ((level - SHARED_FROM) % 2);
}

/** Recycler levels, top to bottom, and the levels each one feeds. */
export function recyclerLayout(levels: number): { level: LevelId; feeds: LevelId[] }[] {
  const out = new Map<LevelId, LevelId[]>();
  for (let l = 1; l <= levels; l++) {
    const src = sourceLevelOf(l);
    const list = out.get(src) ?? [];
    list.push(l);
    out.set(src, list);
  }
  return [...out.entries()].map(([level, feeds]) => ({ level, feeds }));
}

export function buildPipeMap(levels: number, zonesPerLevel: number): PipeMap {
  const nodes: PipeNode[] = [];
  const edges: { from: PipeNodeId; to: PipeNodeId }[] = [];
  for (const { level } of recyclerLayout(levels)) nodes.push({ id: recyclerNode(level), kind: 'recycler', level });
  for (let l = 1; l <= levels; l++) {
    nodes.push({ id: junctionNode(l), kind: 'junction', level: l });
    edges.push({ from: recyclerNode(sourceLevelOf(l)), to: junctionNode(l) });
    for (let z = 0; z < zonesPerLevel; z++) {
      nodes.push({ id: tapNode(l, z), kind: 'tap', level: l, zone: z });
      edges.push({ from: junctionNode(l), to: tapNode(l, z) });
    }
  }
  return { nodes, edges };
}
