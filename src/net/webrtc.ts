import { decodeHandshake, encodeHandshake, fromSdp, toSdp } from './sdp-codec.ts';
import type { Handshake, PlayerId } from './handshake.ts';

/**
 * No STUN, no TURN (§3.3). A public STUN server would be a central dependency
 * we've forbidden, and it would be useless on a LAN with no internet anyway.
 * Host candidates are exactly right when every peer is on the same link.
 */
export const RTC_CONFIG: RTCConfiguration = { iceServers: [] };

export const CHANNEL_LABEL = 'party';

/** Long enough for a LAN to finish, short enough not to stall the queue. */
export const GATHER_TIMEOUT_MS = 2_000;

export function newPeerConnection(): RTCPeerConnection {
  return new RTCPeerConnection(RTC_CONFIG);
}

/**
 * Gathering is non-trickle: there is no channel to trickle over, so the offer
 * isn't encoded until candidates are in. The timeout caps the wait and encodes
 * whatever arrived, which on a LAN is everything that matters.
 */
export async function gather(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return;

  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      pc.removeEventListener('icegatheringstatechange', check);
      resolve();
    };
    const check = () => {
      if (pc.iceGatheringState === 'complete') done();
    };
    const timer = setTimeout(done, GATHER_TIMEOUT_MS);

    pc.addEventListener('icegatheringstatechange', check);
    check();
  });
}

export function randomNonce(): number {
  const b = new Uint8Array(2);
  crypto.getRandomValues(b);
  return (b[0]! << 8) | b[1]!;
}

export function waitForOpen(dc: RTCDataChannel, timeoutMs = 15_000): Promise<void> {
  if (dc.readyState === 'open') return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      // The one failure mode we can't design around: a network that blocks
      // peer-to-peer traffic outright (§13.2). Say so in words a person can act on.
      reject(new Error("Couldn't reach the other phone. Try a phone hotspot."));
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timer);
      dc.removeEventListener('open', onOpen);
      dc.removeEventListener('error', onError);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('The connection failed before it opened.'));
    };

    dc.addEventListener('open', onOpen);
    dc.addEventListener('error', onError);
  });
}

/**
 * The player half of the handshake: take the host's scanned code, build the
 * answer to show back, and hand over a connection that is still opening.
 */
export async function answerOffer(
  offerText: string,
  identity: { playerId: PlayerId; name: string },
): Promise<{
  answerText: string;
  nonce: number;
  pc: RTCPeerConnection;
  channel: Promise<RTCDataChannel>;
}> {
  const offer = decodeHandshake(offerText);
  if (offer.kind !== 'offer') throw new Error('That code is an answer, not an invitation.');

  const pc = newPeerConnection();

  // The offerer creates the channel, so we wait for it rather than making one.
  const channel = new Promise<RTCDataChannel>((resolve) => {
    pc.addEventListener('datachannel', (event) => resolve(event.channel), { once: true });
  });

  await pc.setRemoteDescription({ type: 'offer', sdp: toSdp(offer) });
  await pc.setLocalDescription(await pc.createAnswer());
  await gather(pc);

  const answer: Handshake = {
    ...fromSdp(pc.localDescription!.sdp, 'answer', offer.nonce),
    identity,
  };

  return { answerText: encodeHandshake(answer), nonce: offer.nonce, pc, channel };
}
