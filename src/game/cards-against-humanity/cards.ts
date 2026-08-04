/*
 * The shape of a deck, with none of one in it.
 *
 * This file exists to keep the content files independent of each other. Each
 * deck is transcribed from a different PDF under different terms — see
 * NOTICE.md — so none of them may import from another, and a deck that is easy
 * to lift out whole is the point rather than a happy accident. They all import
 * from here instead, and decks.ts is the only file that knows they all exist.
 */

/** Where a white card goes. A prompt may have none, one, or several. */
export const BLANK = '____';

export type BlackCard = {
  text: string;
  /** How many white cards this prompt takes. The printed PICK badge. */
  pick: number;
};

/** The decks a game can be dealt from. */
export type DeckId = 'main';

/**
 * Position is identity. Every index in `CahState`, in every action, and in
 * every snapshot is an offset into one of these two arrays, so nothing may ever
 * reorder or splice them.
 */
export type Deck = {
  id: DeckId;
  /** As printed on the box, and as credited on the game's own screen. */
  name: string;
  black: BlackCard[];
  white: string[];
};
