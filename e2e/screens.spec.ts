import { expect, test } from '@playwright/test';

/*
 * The two screens the broadcast play-through can't reach: home, and a lobby
 * showing a real generated code. This is also the only test that renders an
 * actual QR from an actual RTCPeerConnection.
 */

const SHOTS = 'test-results/screens';

test.use({ viewport: { width: 390, height: 844 } });

test('home lists the games once you have a name', async ({ page }) => {
  await page.goto('');

  await expect(page.getByText("Liar's Dice")).toBeVisible();
  // Nothing is reachable until the table knows who you are.
  await expect(page.getByText('Put your name in first')).toBeVisible();

  await page.getByLabel('You').fill('Matt');
  await expect(page.getByText('Put your name in first')).toBeHidden();
  await page.screenshot({ path: `${SHOTS}/home.png` });

  // The name persists, so nobody retypes it every party.
  await page.reload();
  await expect(page.getByLabel('You')).toHaveValue('Matt');
});

test('the lobby shows a real, scannable code', async ({ page }) => {
  await page.goto('#/host/liars-dice');

  const qr = page.getByRole('img', { name: 'Code for a player to scan' });
  await expect(qr).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Scan me')).toBeVisible();

  await page.screenshot({ path: `${SHOTS}/lobby.png` });

  // The same string is available as text, for desktops and broken cameras.
  await page.getByRole('button', { name: 'No camera?' }).click();
  const code = await page.getByTestId('code-out').textContent();
  expect(code).toMatch(/^[0-9A-Z $%*+\-./:]+$/);

  // The claim §3.2 rests on, measured against a code this app actually
  // generated on this machine's real network interfaces — not a fixture.
  const version = await page.evaluate(async (text) => {
    const { encodeQr, qrVersion } = await import('/party-games/src/qr/encode.ts');
    return qrVersion(encodeQr(text!));
  }, code);

  expect(version).toBeLessThanOrEqual(8);
});
