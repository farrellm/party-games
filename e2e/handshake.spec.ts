import { expect, test, type Page } from '@playwright/test';

/*
 * The gate.
 *
 * DESIGN.md §13.1 calls template-reconstructed SDP the highest-risk item in the
 * whole design: browsers can be strict about SDP they did not generate, and the
 * three engines disagree at the margins. If this fails, §3.2 needs a different
 * compression strategy and no amount of game code matters.
 *
 * So this drives the real modules in two real browser contexts and asserts that
 * a connection built entirely out of ~150 bytes of base45 actually opens and
 * carries traffic. It runs on Chromium, WebKit and Firefox.
 */

/** Load the app so the dev server's module graph is available to evaluate against. */
async function open(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(document.querySelector('#root')?.firstChild));
}

test.describe('QR-signaled handshake', () => {
  test('an offer and answer under 250 characters open a working data channel', async ({
    browser,
  }) => {
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();

    await open(host);
    await open(player);

    // 1. Host mints an offer and encodes it the way the QR would.
    const offerText = await host.evaluate(async () => {
      const { encodeHandshake, fromSdp } = await import('/party-games/src/net/sdp-codec.ts');
      const { gather, newPeerConnection, randomNonce, CHANNEL_LABEL } = await import(
        '/party-games/src/net/webrtc.ts'
      );

      const pc = newPeerConnection();
      const dc = pc.createDataChannel(CHANNEL_LABEL, { ordered: true });

      await pc.setLocalDescription(await pc.createOffer());
      await gather(pc);

      const w = globalThis as unknown as { __host: { pc: RTCPeerConnection; dc: RTCDataChannel } };
      w.__host = { pc, dc };

      return encodeHandshake(fromSdp(pc.localDescription!.sdp, 'offer', randomNonce()));
    });

    expect(offerText).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
    expect(offerText.length).toBeLessThan(250);

    // 2. Player answers it — this is the step that hands a rebuilt SDP to
    //    setRemoteDescription for the first time.
    const answerText = await player.evaluate(async (offer) => {
      const { answerOffer } = await import('/party-games/src/net/webrtc.ts');

      const { answerText, pc, channel } = await answerOffer(offer, {
        playerId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        name: 'Ann',
      });

      const w = globalThis as unknown as {
        __player: { pc: RTCPeerConnection; channel: Promise<RTCDataChannel> };
      };
      w.__player = { pc, channel };

      return answerText;
    }, offerText);

    expect(answerText.length).toBeLessThan(250);

    // 3. Host takes the answer back, and both sides wait for the channel.
    await host.evaluate(async (answer) => {
      const { decodeHandshake, toSdp } = await import('/party-games/src/net/sdp-codec.ts');
      const w = globalThis as unknown as { __host: { pc: RTCPeerConnection } };
      await w.__host.pc.setRemoteDescription({ type: 'answer', sdp: toSdp(decodeHandshake(answer)) });
    }, answerText);

    // Arm the host to echo before anyone sends, so neither side can miss the
    // other's first message.
    await host.evaluate(() => {
      const w = globalThis as unknown as { __host: { dc: RTCDataChannel } };
      w.__host.dc.addEventListener('message', (e: MessageEvent<string>) => {
        w.__host.dc.send(`host heard: ${e.data}`);
      });
    });

    const reply = await player.evaluate(async () => {
      const { waitForOpen } = await import('/party-games/src/net/webrtc.ts');
      const w = globalThis as unknown as { __player: { channel: Promise<RTCDataChannel> } };

      const dc = await w.__player.channel;
      await waitForOpen(dc);

      const heard = new Promise<string>((resolve) => {
        dc.addEventListener('message', (e: MessageEvent<string>) => resolve(e.data), { once: true });
      });
      dc.send('hello from the player');
      return heard;
    });

    // The assertion the whole design rests on: a connection negotiated entirely
    // through two ~200-character strings carries real traffic both ways.
    expect(reply).toBe('host heard: hello from the player');

    expect(await host.evaluate(() => {
      const w = globalThis as unknown as { __host: { pc: RTCPeerConnection } };
      return w.__host.pc.connectionState;
    })).toBe('connected');

    await hostContext.close();
    await playerContext.close();
  });

  test('a second answer to a spent offer is reported as stale, not as a failure', async ({
    page,
  }) => {
    await open(page);

    // §3.1: if two players scan the same code, the first wins and the second is
    // told to rescan. That has to be a legible message, not a dead end.
    const result = await page.evaluate(async () => {
      const { OfferPool } = await import('/party-games/src/net/offer-pool.ts');
      const { answerOffer } = await import('/party-games/src/net/webrtc.ts');

      const pool = new OfferPool(2);
      await pool.start();

      const live = pool.current();
      if (!live) throw new Error('pool produced no offer');

      const first = await answerOffer(live.text, {
        playerId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        name: 'Ann',
      });
      const second = await answerOffer(live.text, {
        playerId: '11111111-2222-3333-4444-555555555555',
        name: 'Bo',
      });

      const a = await pool.accept(first.answerText);
      const b = await pool.accept(second.answerText);

      const rotated = pool.current();
      pool.close();

      return {
        firstOk: a.ok,
        secondReason: b.ok ? null : b.reason,
        rotated: rotated !== null && rotated.nonce !== live.nonce,
      };
    });

    expect(result.firstOk).toBe(true);
    expect(result.secondReason).toBe('stale');
    // The displayed code must already have moved on, with no pause for ICE.
    expect(result.rotated).toBe(true);
  });
});
