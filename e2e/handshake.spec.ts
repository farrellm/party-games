import { expect, test, type Page } from '@playwright/test';

/*
 * The gate.
 *
 * DESIGN.md §13.1 calls template-reconstructed SDP the highest-risk item in the
 * whole design: browsers can be strict about SDP they did not generate, and the
 * three engines disagree at the margins. If it fails, §3.2 needs a different
 * compression strategy and no amount of game code matters.
 *
 * That question — will an engine accept our rebuilt SDP — is separate from
 * whether two peers can then route packets to each other, which depends on the
 * network they are on. The two are tested separately, because only the first is
 * a question about our code.
 */

async function open(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(document.querySelector('#root')?.firstChild));
}

type Handshaken = {
  offerText: string;
  answerText: string;
  /** True when every gathered candidate is an unresolvable-by-default mDNS name. */
  mdnsOnly: boolean;
};

/** Runs the full two-code exchange and leaves both peers wired up. */
async function exchange(host: Page, player: Page): Promise<Handshaken> {
  const offer = await host.evaluate(async () => {
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

    const handshake = fromSdp(pc.localDescription!.sdp, 'offer', randomNonce());
    return {
      text: encodeHandshake(handshake),
      mdnsOnly:
        handshake.candidates.length > 0 && handshake.candidates.every((c) => c.kind === 'mdns'),
    };
  });

  const answerText = await player.evaluate(async (offerText) => {
    const { answerOffer } = await import('/party-games/src/net/webrtc.ts');

    const { answerText, pc, channel } = await answerOffer(offerText, {
      playerId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      name: 'Ann',
    });

    const w = globalThis as unknown as {
      __player: { pc: RTCPeerConnection; channel: Promise<RTCDataChannel> };
    };
    w.__player = { pc, channel };

    return answerText;
  }, offer.text);

  await host.evaluate(async (answer) => {
    const { decodeHandshake, toSdp } = await import('/party-games/src/net/sdp-codec.ts');
    const w = globalThis as unknown as { __host: { pc: RTCPeerConnection } };
    await w.__host.pc.setRemoteDescription({ type: 'answer', sdp: toSdp(decodeHandshake(answer)) });
  }, answerText);

  return { offerText: offer.text, answerText, mdnsOnly: offer.mdnsOnly };
}

test.describe('QR-signaled handshake', () => {
  test('both engines accept an SDP rebuilt from ~200 characters', async ({ browser }) => {
    // This is §13.1 itself. It asks nothing of the network: only whether an
    // engine will take a description it did not author.
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();

    await open(host);
    await open(player);

    const { offerText, answerText } = await exchange(host, player);

    expect(offerText).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
    expect(answerText).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
    expect(offerText.length).toBeLessThan(250);
    expect(answerText.length).toBeLessThan(250);

    // signalingState reaching 'stable' means both descriptions were accepted:
    // the answerer took our rebuilt offer, and the offerer took our rebuilt
    // answer. An engine that disliked either would have thrown instead.
    for (const [page, key] of [
      [host, '__host'],
      [player, '__player'],
    ] as const) {
      const state = await page.evaluate((which) => {
        const pc = (globalThis as unknown as Record<string, { pc: RTCPeerConnection }>)[which]!.pc;
        return {
          signaling: pc.signalingState,
          hasRemote: Boolean(pc.remoteDescription?.sdp),
          hasLocal: Boolean(pc.localDescription?.sdp),
        };
      }, key);

      expect(state).toEqual({ signaling: 'stable', hasRemote: true, hasLocal: true });
    }

    await hostContext.close();
    await playerContext.close();
  });

  test('the connection opens and carries traffic', async ({ browser }, testInfo) => {
    const hostContext = await browser.newContext();
    const playerContext = await browser.newContext();
    const host = await hostContext.newPage();
    const player = await playerContext.newPage();

    await open(host);
    await open(player);

    const { mdnsOnly } = await exchange(host, player);

    // §3.3: mDNS candidates resolve between peers on a real LAN, which is where
    // this app runs. They do not resolve inside a CI container with no mDNS
    // responder, so on an engine that offers nothing else there is no route to
    // test over. That is a property of the runner, not of the handshake — which
    // the test above has already checked on this engine.
    test.skip(
      mdnsOnly,
      `${testInfo.project.name} gathered only mDNS candidates; nothing here can resolve them`,
    );

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

    // The assertion the design rests on: a connection negotiated entirely
    // through two short strings carries real traffic both ways.
    expect(reply).toBe('host heard: hello from the player');

    expect(
      await host.evaluate(() => {
        const w = globalThis as unknown as { __host: { pc: RTCPeerConnection } };
        return w.__host.pc.connectionState;
      }),
    ).toBe('connected');

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

  test('the same answer scanned twice is not mistaken for someone losing a race', async ({
    page,
  }) => {
    await open(page);

    // The host's camera looks ten times a second and the player's code stays up
    // until their channel opens, so the answer that just worked is seen again
    // almost immediately. Telling the host to ask for a rescan at that point is
    // a lie about a join that succeeded.
    const result = await page.evaluate(async () => {
      const { OfferPool } = await import('/party-games/src/net/offer-pool.ts');
      const { answerOffer } = await import('/party-games/src/net/webrtc.ts');

      const pool = new OfferPool(2);
      await pool.start();

      const live = pool.current();
      if (!live) throw new Error('pool produced no offer');

      const { answerText } = await answerOffer(live.text, {
        playerId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        name: 'Ann',
      });

      const first = await pool.accept(answerText);
      const second = await pool.accept(answerText);
      // Still on camera a frame later, and a frame after that.
      const third = await pool.accept(answerText);

      pool.close();

      return {
        firstOk: first.ok,
        secondReason: second.ok ? null : second.reason,
        thirdReason: third.ok ? null : third.reason,
      };
    });

    expect(result.firstOk).toBe(true);
    expect(result.secondReason).toBe('duplicate');
    expect(result.thirdReason).toBe('duplicate');
  });
});
