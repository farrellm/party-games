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

/** Whoever the shuffle put in the chair, and the three who owe a card. */
async function split(pages: { page: Page; name: string }[]) {
  const czarName = (await pages[0]!.page.locator('.cah-czar').first().textContent())!.trim();
  const czar = pages.find((p) => p.name === czarName)!;
  return { czar, players: pages.filter((p) => p !== czar) };
}

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
    await page.getByRole('button', { name: 'Play' }).click();
  }

  // The table finishing is the trigger; nobody pressed "start reading".
  await expect(czar.page.getByText(/Read it out/)).toBeVisible();
  await shoot(czar.page, 'cah-reading');

  // Everyone else is listening, and their screens hold no submissions at all.
  for (const { page } of players) {
    await expect(page.getByText(`${czar.name} is reading`)).toBeVisible();
    await expect(page.getByRole('button', { name: 'This one wins' })).toHaveCount(0);
  }

  // The Czar can page through three answers and none of them is signed.
  await expect(czar.page.getByText('1 of 3')).toBeVisible();
  await czar.page.getByRole('button', { name: 'Next' }).click();
  await expect(czar.page.getByText('2 of 3')).toBeVisible();
  for (const { name } of players) {
    await expect(czar.page.locator('.cah-sentence')).not.toContainText(name);
  }

  await czar.page.getByRole('button', { name: 'This one wins' }).click();

  for (const { page } of everyone) {
    await expect(page.getByText(/takes it/)).toBeVisible();
  }
  await shoot(host, 'cah-scored');

  // Somebody scored, and the round moves on to a new Czar and a full hand.
  const scores = await host.locator('.roster-count').allTextContents();
  expect(scores.map(Number).reduce((a, b) => a + b, 0)).toBe(1);

  await host.getByRole('button', { name: 'Next round' }).click();
  await expect(host.getByText('Round 2')).toBeVisible();

  const next = await split(everyone);
  expect(next.czar.name).not.toBe(czar.name);
  await expect(next.players[0]!.page.locator('.cah-card')).toHaveCount(10);

  await context.close();
});
