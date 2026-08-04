# Cards Against Humanity — deck attribution

The card text in `deck.ts` and `family.ts` is **not** covered by this repository's
BSD-3-Clause licence. The two decks come from two different PDFs on two different footings,
so they are described separately below. Each lives in its own file, and `cards.ts` holds the
shape they share, so neither can drag the other's terms along with it.

## The Main Deck — `deck.ts`

Cards Against Humanity is distributed by its publisher under the Creative Commons
**BY-NC-SA 2.0** licence, and the deck here keeps that licence. The terms, quoted from the
publisher's own print-and-play PDF:

> **Attribution:** If you distribute our game, give us credit for the content.
>
> **Noncommercial:** You can't sell our game or any derivative of our game for money or
> sexual favors.
>
> **Share Alike:** If you modify and/or distribute our game, you must use the Creative
> Commons BY-NC-SA 2.0 License.

How this project satisfies them:

- **Attribution** — the game is named "Cards Against Humanity", the credit line appears on
  the game's own screens, and this file names the publisher as the source.
- **Noncommercial** — party-games is free, has no server, sells nothing, and carries no
  advertising or analytics.
- **Share Alike** — the deck stays under CC BY-NC-SA 2.0. It lives in this one directory,
  separate from the surrounding code, so the two licences do not get tangled.

Source: the Main Deck (v2.4) print-and-play PDF, published free by Cards Against Humanity
LLC. Licence text: creativecommons.org/licenses/by-nc-sa/2.0/

The cards are deliberately offensive; that is the game. Nothing in `deck.ts` is an
expression of the maintainers' views.

## The Family Edition — `family.ts`

**This deck's PDF states no licence at all.** That is the honest position and it is worth
being plain about, because the Main Deck's PDF is explicit and this one is not: it carries
no Creative Commons text, no copyright line, and no terms of any kind. It closes by
advertising the retail box in shops.

It is published free by Cards Against Humanity LLC for anyone to download, print and play,
and it is included here on the same footing this project already meets for the Main Deck:

- **Attribution** — the deck is named "Cards Against Humanity: Family Edition" on the game's
  own credit line, and this file names the publisher as the source. The credit line
  deliberately does **not** claim CC BY-NC-SA for this edition, because nothing grants it.
- **Noncommercial** — party-games is free, has no server, sells nothing, and carries no
  advertising or analytics.
- **Separable** — it is one file in one directory, easy to remove whole if the publisher
  ever asks.

Source: `CAH_FamilyGame-1.1-SmallCards.pdf`, the Family Edition print-and-play PDF published
free by Cards Against Humanity LLC.

This edition is written for children and their parents. It is cruder than it is offensive,
but it is still the same game, and nothing in `family.ts` is an expression of the
maintainers' views either.
