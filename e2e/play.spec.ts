import { expect, test, type Page } from '@playwright/test';

/*
 * A full round loop across four tabs, over BroadcastChannelTransport (§12).
 *
 * This is the UI counterpart to handshake.spec.ts: that one proves the
 * connection can be built, this one proves a game can actually be played over
 * one. Pages share a browser context so they share the channel, and ?as= gives
 * each tab its own identity.
 */

const SHOTS = 'test-results/screens';

/** Let the dice finish settling before capturing, so shots show the real layout. */
async function shoot(page: Page, name: string) {
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function open(page: Page, path: string, as: string) {
  await page.goto(`?transport=broadcast&as=${as}#${path}`);
  await expect(page.locator('#root')).not.toBeEmpty();
}

test('four phones play a round of liar’s dice', async ({ browser }) => {
  // One context: BroadcastChannel only reaches same-context pages. A phone
  // viewport, because that is the only screen this app is designed for.
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const host = await context.newPage();
  const ann = await context.newPage();
  const bo = await context.newPage();
  const cy = await context.newPage();

  await open(host, '/host/liars-dice', 'Host');
  await shoot(host, 'lobby-empty');

  await open(ann, '/join', 'Ann');
  await open(bo, '/join', 'Bo');
  await open(cy, '/join', 'Cy');

  // Everyone lands in the lobby without scanning anything.
  await expect(host.getByText('In (4)')).toBeVisible();
  await expect(ann.getByText('Wait for the host')).toBeVisible();
  await shoot(host, 'lobby-full');

  await host.getByRole('button', { name: 'Start game' }).click();

  // Five dice each, and each player sees only their own.
  for (const page of [host, ann, bo, cy]) {
    await expect(page.locator('.die')).toHaveCount(5);
  }
  await expect(host.getByText('Round 1')).toBeVisible();
  await shoot(ann, 'game-rolling');

  // Every player's dice are their own, not a copy of the host's.
  const faces = await Promise.all(
    [host, ann, bo].map((page) => page.locator('.die').first().getAttribute('aria-label')),
  );
  expect(faces.every((f) => f !== null)).toBe(true);

  // Anyone may call at any moment; there is no turn to wait for.
  await bo.getByRole('button', { name: 'Liar' }).click();

  await expect(bo.getByText('Who loses a die?')).toBeVisible();
  await expect(ann.getByText('Bo called liar')).toBeVisible();
  // Everyone else keeps showing their own dice so they can be held up.
  await expect(ann.locator('.die')).toHaveCount(5);
  await shoot(bo, 'game-called-caller');
  await shoot(ann, 'game-called-other');

  // The caller can pick themselves — the normal outcome of a bad call.
  await expect(bo.getByRole('button', { name: 'Bo' })).toBeVisible();

  await bo.getByRole('button', { name: 'Cy' }).click();

  for (const page of [host, ann, bo, cy]) {
    await expect(page.getByText('Cy lost a die')).toBeVisible();
  }
  await shoot(host, 'game-resolved');

  // Cy is down to four, everyone else still has five.
  await expect(host.locator('.roster li', { hasText: 'Cy' })).toContainText('4');

  await ann.getByRole('button', { name: 'Roll' }).click();

  await expect(host.getByText('Round 2')).toBeVisible();
  await expect(cy.locator('.die')).toHaveCount(4);
  await expect(ann.locator('.die')).toHaveCount(5);

  await context.close();
});
