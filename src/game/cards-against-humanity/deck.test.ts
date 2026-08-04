import { describe, expect, it } from 'vitest';
import { BLACK, WHITE } from './deck.ts';
import { BLANK } from './cards.ts';

/*
 * The deck was transcribed by eye from rendered PDF pages, because the source
 * has its text outlined and nothing can extract it. A typo in a card is a
 * cosmetic bug; a dropped or doubled card is a real one, and these counts are
 * what catch it.
 */

describe('the Main Deck', () => {
  it('is the whole deck', () => {
    expect(BLACK).toHaveLength(100);
    expect(WHITE).toHaveLength(500);
  });

  it('has no card twice', () => {
    // Uniqueness is not just tidiness: the secrecy test identifies a player's
    // cards by their text, and two identical cards would make it lie.
    expect(new Set(WHITE).size).toBe(WHITE.length);
    expect(new Set(BLACK.map((c) => c.text)).size).toBe(BLACK.length);
  });

  it('takes at least as many cards as it prints gaps', () => {
    for (const card of BLACK) {
      const gaps = card.text.split(BLANK).length - 1;
      expect(card.pick, card.text).toBeGreaterThanOrEqual(Math.max(gaps, 1));
      expect(card.pick, card.text).toBeLessThanOrEqual(3);
    }
  });

  it('keeps the prompts that are questions, with no gap to fill', () => {
    // These are answered underneath rather than inside, so the component has
    // to keep handling both shapes.
    const questions = BLACK.filter((c) => !c.text.includes(BLANK));
    expect(questions.length).toBeGreaterThan(0);
    expect(questions.every((c) => c.pick === 1)).toBe(true);
  });

  it('carries no empty cards', () => {
    expect(WHITE.every((c) => c.trim().length > 0)).toBe(true);
    expect(BLACK.every((c) => c.text.trim().length > 0)).toBe(true);
  });
});
