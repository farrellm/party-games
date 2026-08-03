import { describe, expect, it, vi } from 'vitest';
import { WebRtcHostTransport } from './webrtc-transport.ts';
import { MatchHost } from '../match/host.ts';
import { SYNC, type ClientState } from '../match/protocol.ts';
import type { Envelope } from './transport.ts';
import type { Joined } from './offer-pool.ts';

/*
 * A data channel is negotiated well before it is open, and a send on a channel
 * that is still connecting is dropped without a word. The host seats a player
 * the moment their answer is scanned, which is the right feel — but everything
 * that seating provoked lands in that closed window, so the newcomer used to
 * sit on "Connecting" until the host happened to change something.
 *
 * None of that needs a real peer connection to pin down: adopt() only ever
 * touches readyState, onmessage, send and a couple of listeners.
 */

vi.mock('../match/snapshot.ts', () => ({
  saveSnapshot: vi.fn(async () => {}),
  loadSnapshot: vi.fn(async () => null),
  clearSnapshot: vi.fn(async () => {}),
}));

function fakeChannel(readyState: RTCDataChannel['readyState']) {
  const listeners = new Set<() => void>();
  const sent: Envelope[] = [];

  const dc = {
    readyState,
    onmessage: null,
    send: (text: string) => sent.push(JSON.parse(text) as Envelope),
    addEventListener: (type: string, handler: () => void) => {
      if (type === 'open') listeners.add(handler);
    },
  };

  return {
    dc: dc as unknown as RTCDataChannel,
    sent,
    /** What the browser does when the channel finishes opening. */
    open() {
      dc.readyState = 'open';
      for (const handler of [...listeners]) handler();
    },
  };
}

function fakePeerConnection() {
  return {
    connectionState: 'connecting',
    addEventListener: () => {},
    close: () => {},
  } as unknown as RTCPeerConnection;
}

function seatFor(dc: RTCDataChannel): Joined {
  return { playerId: 'ann', name: 'Ann', pc: fakePeerConnection(), dc };
}

function syncs(sent: Envelope[]): ClientState[] {
  return sent.filter((e) => e.type === SYNC).map((e) => e.payload as ClientState);
}

describe('WebRtcHostTransport.adopt', () => {
  it('syncs a newcomer once their channel opens, with no host action', () => {
    const transport = new WebRtcHostTransport('host');
    new MatchHost(transport, 'host', 'Host');
    const channel = fakeChannel('connecting');

    transport.adopt(seatFor(channel.dc));

    // The seating happened — but on a channel nobody could send down.
    expect(syncs(channel.sent)).toEqual([]);

    channel.open();

    // Nobody pressed Start game. The projection arrived anyway.
    const seen = syncs(channel.sent);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.at(-1)!.phase).toBe('LOBBY');
    expect(seen.at(-1)!.roster.map((p) => p.name).sort()).toEqual(['Ann', 'Host']);

    transport.close();
  });

  it('syncs immediately when the channel is already open', () => {
    const transport = new WebRtcHostTransport('host');
    new MatchHost(transport, 'host', 'Host');
    const channel = fakeChannel('open');

    transport.adopt(seatFor(channel.dc));

    expect(syncs(channel.sent).at(-1)?.roster.map((p) => p.name).sort()).toEqual(['Ann', 'Host']);

    transport.close();
  });

  it('ignores a stale channel opening after the seat was replaced', () => {
    const transport = new WebRtcHostTransport('host');
    new MatchHost(transport, 'host', 'Host');

    const abandoned = fakeChannel('connecting');
    transport.adopt(seatFor(abandoned.dc));

    // Same player, second handshake: the first channel loses the seat.
    const live = fakeChannel('connecting');
    transport.adopt(seatFor(live.dc));

    abandoned.open();
    expect(syncs(abandoned.sent)).toEqual([]);

    live.open();
    expect(syncs(live.sent).length).toBeGreaterThan(0);

    transport.close();
  });
});
