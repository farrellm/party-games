import { describe, expect, it } from 'vitest';
import { BLACK, WHITE } from './family.ts';
import { BLANK } from './cards.ts';

/*
 * The same guard deck.test.ts puts on the Main Deck, plus one the Main Deck
 * cannot make. Transcribed content has no compiler; this is what stands in for
 * one, and it is why the counts are asserted rather than trusted.
 */

describe('the Family Edition', () => {
  it('is the whole deck', () => {
    expect(BLACK).toHaveLength(95);
    expect(WHITE).toHaveLength(505);
  });

  it('has no card twice', () => {
    // Uniqueness is not just tidiness: the secrecy test identifies a player's
    // cards by their text, and two identical cards would make it lie.
    expect(new Set(WHITE).size).toBe(WHITE.length);
    expect(new Set(BLACK.map((c) => c.text)).size).toBe(BLACK.length);
  });

  it('takes exactly one card for every prompt', () => {
    // The one structural difference from the Main Deck. This edition prints no
    // PICK badge, and no prompt in it has a second blank — so a card that
    // arrived here with pick 2 would be a transcription error, not a variant.
    for (const card of BLACK) {
      expect(card.pick, card.text).toBe(1);
      expect(card.text.split(BLANK).length - 1, card.text).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the prompts that are questions, with no gap to fill', () => {
    // Seven prompts ask outright rather than leaving a blank. They are correct
    // as they stand, and this is what stops a future pass from "fixing" them
    // into the eight whose blanks really were lost in extraction.
    const gapless = BLACK.filter((c) => !c.text.includes(BLANK));
    expect(gapless).toHaveLength(7);
    for (const card of gapless) expect(card.text).toMatch(/\?$/);
  });

  it('kept the blanks that are drawn rather than typed', () => {
    // Eight cards draw their gap as a rule instead of underscores, so no
    // extractor can see it and each was put back by hand off the rendered page.
    // A regenerated deck that lost them again would still have 95 cards, so the
    // counts above would not notice. These would.
    const sample = [
      'When I look in the mirror, I see ____.',
      'Did you hear about the new Avenger? She’s ____!',
      'New from McDonald’s: it’s the Mc____ Burger.',
      'You’re grounded, young lady! No ____ for a whole week.',
      'Alright, kids. The votes are in, and the new school mascot will be ____!',
    ];
    for (const text of sample) expect(BLACK.map((c) => c.text)).toContain(text);
  });

  it('carries no empty cards', () => {
    for (const card of BLACK) expect(card.text.trim()).not.toBe('');
    for (const card of WHITE) expect(card.trim()).not.toBe('');
  });

  it('fetches nothing, whatever the cards say', () => {
    // One card names a website as part of a joke about a fake product. It is
    // inert text and no-network.test.ts is about what the browser would go and
    // get (§10) — but a card carrying a real scheme-relative URL would be worth
    // knowing about, so draw the line here rather than nowhere.
    for (const card of WHITE) expect(card).not.toMatch(/(?:https?:)?\/\//);
  });
});
