/** Pip positions on a 3x3 grid, per face. */
const PIPS: Record<number, [number, number][]> = {
  1: [[1, 1]],
  2: [
    [0, 0],
    [2, 2],
  ],
  3: [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  4: [
    [0, 0],
    [2, 0],
    [0, 2],
    [2, 2],
  ],
  5: [
    [0, 0],
    [2, 0],
    [1, 1],
    [0, 2],
    [2, 2],
  ],
  6: [
    [0, 0],
    [2, 0],
    [0, 1],
    [2, 1],
    [0, 2],
    [2, 2],
  ],
};

type Props = {
  face: number;
  /** Distinguishes dice in one roll, so each settles at its own angle. */
  index: number;
};

/**
 * Real dice land at angles. A row of perfectly square dice reads as a form
 * control; a few degrees of tilt reads as something that was thrown.
 *
 * The angle is derived from the face and position rather than random, so a
 * re-render never twitches an unchanged die.
 */
export function Die({ face, index }: Props) {
  const angle = (((face * 7 + index * 13) % 9) - 4) * 1.1;

  return (
    <svg
      className="die"
      viewBox="0 0 100 100"
      style={{ transform: `rotate(${angle}deg)` }}
      role="img"
      aria-label={`${face}`}
    >
      <rect x="4" y="4" width="92" height="92" rx="18" fill="var(--game-hue)" />
      {(PIPS[face] ?? []).map(([col, row]) => (
        <circle
          key={`${col}-${row}`}
          cx={24 + col * 26}
          cy={24 + row * 26}
          r="9"
          fill="var(--game-ink)"
        />
      ))}
    </svg>
  );
}
