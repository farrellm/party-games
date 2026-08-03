/**
 * A seeded PRNG, threaded through init and reduce.
 *
 * All randomness in a game comes from here, so the same seed and the same
 * action sequence produce the same game. That makes bug reports reproducible
 * and reducer tests trivial (§5).
 *
 * The cursor is part of the state that gets snapshotted, not a hidden global —
 * otherwise a host reload would silently re-roll everyone's dice.
 */
export type RngState = {
  seed: number;
  /** How many values have been drawn. Replayed on restore. */
  calls: number;
};

export interface Rng {
  /** A float in [0, 1). */
  next(): number;
  /** An integer in [0, n). */
  int(n: number): number;
  /** An integer in [1, sides]. */
  die(sides: number): number;
  snapshot(): RngState;
}

export function randomSeed(): number {
  const b = new Uint32Array(1);
  crypto.getRandomValues(b);
  return b[0]!;
}

/**
 * mulberry32. Small, fast, and good enough for dice — this is a party game,
 * not a lottery, and §1 already says every player is trusted.
 */
export function makeRng({ seed, calls }: RngState): Rng {
  let n = calls;

  const draw = () => {
    n++;
    let t = (seed + Math.imul(n, 0x6d2b79f5)) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next: draw,
    int: (max) => Math.floor(draw() * max),
    die: (sides) => Math.floor(draw() * sides) + 1,
    snapshot: () => ({ seed, calls: n }),
  };
}
