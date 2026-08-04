import { expect, test, type Page } from '@playwright/test';

/*
 * A full round of Cards Against Humanity across four tabs, over
 * BroadcastChannelTransport — the same pattern as play.spec.ts.
 *
 * The claim worth testing in a browser rather than in the reducer: the Czar's
 * device is the only one that ever renders the submissions, and it renders them
 * without authorship. That is a projection guarantee, but it is also a wiring
 * guarantee, and this is where the wiring gets exercised.
 */

const SHOTS = 'test-results/screens';

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function open(page: Page, path: string, as: string) {
  await page.goto(`?transport=broadcast&as=${as}#${path}`);
  await expect(page.locator('#root')).not.toBeEmpty();
}

/*
 * Controls are located by class, not by accessible name. The hand is made of
 * buttons carrying 500 possible strings, and enough of them contain the words
 * "play", "back" or "next" that name-based lookups here are a coin flip
 * decided by the shuffle.
 */
const primary = (page: Page) => page.locator('.btn.primary');
const flip = (page: Page, which: 'Back' | 'Next') =>
  page.locator('.cah-flip .btn').nth(which === 'Back' ? 0 : 1);

/** Whoever the shuffle put in the chair, and the three who owe a card. */
async function split(pages: { page: Page; name: string }[]) {
  const czarName = (await pages[0]!.page.locator('.cah-czar').first().textContent())!.trim();
  const czar = pages.find((p) => p.name === czarName)!;
  return { czar, players: pages.filter((p) => p !== czar) };
}

/** Opens the lobby's setup and picks one choice by the words on its label. */
async function choose(page: Page, choice: string | RegExp) {
  const setup = page.locator('summary.setup-head');
  if ((await page.locator('details.setup[open]').count()) === 0) await setup.click();
  await page.locator('.opt-choice', { hasText: choice }).click();
}

/** Everyone plays, the Czar judges, and the table lands on the scored round. */
async function playARound(everyone: { page: Page; name: string }[]) {
  const { czar, players } = await split(everyone);
  const pick = await players[0]!.page.locator('.cah-blank').count();

  for (const { page } of players) {
    for (let i = 0; i < Math.max(pick, 1); i++) {
      const card = page.locator('.cah-card').nth(i);
      if ((await card.getAttribute('aria-pressed')) !== 'true') await card.click();
    }
    await primary(page).click();
  }

  await primary(czar.page).click();
  await expect(everyone[0]!.page.locator('.loud')).toContainText('takes it');
  return { czar, players };
}

test('the host picks the deck, and the game is dealt from it', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await context.newPage();
  const ann = await context.newPage();
  const bo = await context.newPage();
  const cy = await context.newPage();

  await open(host, '/host/cards-against-humanity', 'Host');
  await open(ann, '/join', 'Ann');
  await open(bo, '/join', 'Bo');
  await open(cy, '/join', 'Cy');
  await expect(host.getByText('In (4)')).toBeVisible();

  // Collapsed, the setup still says which deck this is going to be — the one
  // thing somebody with a child in the room needs off a glance.
  await expect(host.locator('.setup-line')).toHaveText(/Standard · first to 5/);

  await choose(host, 'Family Edition');
  await expect(host.locator('.setup-line')).toHaveText(/Family Edition/);
  await shoot(host, 'cah-setup');

  await host.getByRole('button', { name: 'Start game' }).click();

  await playARound([
    { page: host, name: 'Host' },
    { page: ann, name: 'Ann' },
    { page: bo, name: 'Bo' },
    { page: cy, name: 'Cy' },
  ]);

  // Attribution is a licence term, so the credit names the edition in play —
  // and does not claim CC BY-NC-SA for this one, which nothing grants.
  const credit = host.locator('.cah-credit');
  await expect(credit).toHaveText('Cards Against Humanity: Family Edition');
  await expect(credit).not.toContainText('CC BY-NC-SA');

  await context.close();
});

test('anyone can stop the game between rounds', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await context.newPage();
  const ann = await context.newPage();
  const bo = await context.newPage();
  const cy = await context.newPage();

  await open(host, '/host/cards-against-humanity', 'Host');
  await open(ann, '/join', 'Ann');
  await open(bo, '/join', 'Bo');
  await open(cy, '/join', 'Cy');
  await expect(host.getByText('In (4)')).toBeVisible();

  // Endless has no finish line of its own — this is the only way out of it.
  await choose(host, 'Endless');
  await host.getByRole('button', { name: 'Start game' }).click();

  const everyone = [
    { page: host, name: 'Host' },
    { page: ann, name: 'Ann' },
    { page: bo, name: 'Bo' },
    { page: cy, name: 'Cy' },
  ];
  const { players } = await playARound(everyone);

  // Not the host, not the Czar: a game only one person can end is a game that
  // does not end when that person's phone is asleep.
  await players[0]!.page.getByRole('button', { name: 'Stop here' }).click();

  // Every device lands on the shell's results, not just the one that pressed it.
  for (const { page } of everyone) {
    await expect(page.getByText('Match score, all games')).toBeVisible();
  }
  await expect(host.getByRole('button', { name: 'Play again' })).toBeVisible();

  await context.close();
});

test('four phones play a round of cards against humanity', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await context.newPage();
  const ann = await context.newPage();
  const bo = await context.newPage();
  const cy = await context.newPage();

  await open(host, '/host/cards-against-humanity', 'Host');
  await open(ann, '/join', 'Ann');
  await open(bo, '/join', 'Bo');
  await open(cy, '/join', 'Cy');

  await expect(host.getByText('In (4)')).toBeVisible();
  await host.getByRole('button', { name: 'Start game' }).click();

  const everyone = [
    { page: host, name: 'Host' },
    { page: ann, name: 'Ann' },
    { page: bo, name: 'Bo' },
    { page: cy, name: 'Cy' },
  ];

  // Everyone has a prompt. Only the three who are not judging have a hand.
  for (const { page } of everyone) {
    await expect(page.locator('.cah-prompt').first()).toBeVisible();
  }

  const { czar, players } = await split(everyone);
  await expect(czar.page.locator('.cah-card')).toHaveCount(0);
  for (const { page } of players) {
    await expect(page.locator('.cah-card')).toHaveCount(10);
  }

  // No two players were dealt the same hand.
  const hands = await Promise.all(
    players.map(({ page }) => page.locator('.cah-card').first().textContent()),
  );
  expect(new Set(hands).size).toBe(hands.length);

  const pick = await players[0]!.page.locator('.cah-blank').count();
  await shoot(players[0]!.page, 'cah-picking');

  // Tapping a card lands it in the sentence, in the game's hue.
  await players[0]!.page.locator('.cah-card').first().click();
  await expect(players[0]!.page.locator('.cah-filled, .cah-said').first()).toBeVisible();
  await shoot(players[0]!.page, 'cah-composing');

  for (const { page } of players) {
    const needed = Math.max(pick, 1);
    for (let i = 0; i < needed; i++) {
      const card = page.locator('.cah-card').nth(i);
      if ((await card.getAttribute('aria-pressed')) !== 'true') await card.click();
    }
    await primary(page).click();
  }

  // The table finishing is the trigger; nobody pressed "start reading".
  await expect(czar.page.getByText(/Read it out/)).toBeVisible();
  await shoot(czar.page, 'cah-reading');

  // Everyone else is listening, and their screens hold no submissions at all.
  for (const { page } of players) {
    await expect(page.getByText(`${czar.name} is reading`)).toBeVisible();
    await expect(primary(page)).toHaveCount(0);
  }

  // The Czar can page through all three answers.
  await expect(czar.page.getByText('1 of 3')).toBeVisible();
  await flip(czar.page, 'Next').click();
  await expect(czar.page.getByText('2 of 3')).toBeVisible();

  // Nothing on the Czar's screen attributes an answer: names live in the
  // roster and nowhere near the sentence. Checking for the players' names as
  // substrings would be worse than useless here — "Boneless" contains "Bo"
  // and "Cyanide" contains "Cy" — so this is structural.
  await expect(czar.page.locator('.cah-sentence .roster-name')).toHaveCount(0);

  // And the answer the Czar is reading reached no other device at all.
  const reading = (await czar.page.locator('.cah-filled, .cah-said').allTextContents())
    .join(' ')
    .trim();
  expect(reading.length).toBeGreaterThan(0);
  for (const { page } of players) {
    await expect(page.locator('.game')).not.toContainText(reading);
  }

  await primary(czar.page).click();

  for (const { page } of everyone) {
    await expect(page.locator('.loud')).toContainText('takes it');
  }
  await shoot(host, 'cah-scored');

  // Somebody scored, and the round moves on to a new Czar and a full hand.
  const scores = await host.locator('.roster-count').allTextContents();
  expect(scores.map(Number).reduce((a, b) => a + b, 0)).toBe(1);

  await primary(host).click();
  await expect(host.getByText('Round 2')).toBeVisible();

  const next = await split(everyone);
  expect(next.czar.name).not.toBe(czar.name);
  await expect(next.players[0]!.page.locator('.cah-card')).toHaveCount(10);

  await context.close();
});
