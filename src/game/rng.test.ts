import { describe, expect, it } from 'vitest';
import { makeRng } from './rng.ts';

describe('seeded rng', () => {
  it('gives the same sequence for the same seed', () => {
    const a = makeRng({ seed: 12345, calls: 0 });
    const b = makeRng({ seed: 12345, calls: 0 });

    const draw = (r: ReturnType<typeof makeRng>) => Array.from({ length: 20 }, () => r.die(6));
    expect(draw(a)).toEqual(draw(b));
  });

  it('gives different sequences for different seeds', () => {
    const a = Array.from({ length: 20 }, ((r) => () => r.die(6))(makeRng({ seed: 1, calls: 0 })));
    const b = Array.from({ length: 20 }, ((r) => () => r.die(6))(makeRng({ seed: 2, calls: 0 })));
    expect(a).not.toEqual(b);
  });

  it('resumes exactly where a snapshot left off', () => {
    // This is what makes a host reload safe: restoring mid-match must not
    // re-roll anything that has already been rolled.
    const original = makeRng({ seed: 999, calls: 0 });
    const before = Array.from({ length: 5 }, () => original.die(6));
    const rest = Array.from({ length: 5 }, () => original.die(6));

    const restored = makeRng({ seed: 999, calls: before.length });
    expect(Array.from({ length: 5 }, () => restored.die(6))).toEqual(rest);
  });

  it('counts every draw in its snapshot', () => {
    const rng = makeRng({ seed: 7, calls: 3 });
    rng.next();
    rng.int(10);
    rng.die(6);
    expect(rng.snapshot()).toEqual({ seed: 7, calls: 6 });
  });

  it('stays inside the bounds it promises', () => {
    const rng = makeRng({ seed: 42, calls: 0 });

    for (let i = 0; i < 5000; i++) {
      const f = rng.next();
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThan(1);

      const d = rng.die(6);
      expect(d).toBeGreaterThanOrEqual(1);
      expect(d).toBeLessThanOrEqual(6);

      const n = rng.int(4);
      expect(n).toBeGreaterThanOrEqual(0);
      expect(n).toBeLessThan(4);
    }
  });

  it('rolls all six faces over enough dice', () => {
    const rng = makeRng({ seed: 3, calls: 0 });
    const seen = new Set(Array.from({ length: 600 }, () => rng.die(6)));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
