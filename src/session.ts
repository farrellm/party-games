import { useEffect, useReducer, useRef, useState } from 'react';
import { BroadcastChannelTransport } from './net/broadcast-transport.ts';
import { OfferPool, type LiveOffer } from './net/offer-pool.ts';
import { WebRtcHostTransport, WebRtcPlayerTransport } from './net/webrtc-transport.ts';
import { answerOffer, waitForOpen } from './net/webrtc.ts';
import { decodeHandshake } from './net/sdp-codec.ts';
import { MatchHost } from './match/host.ts';
import { MatchClient } from './match/client.ts';
import type { ClientState } from './match/protocol.ts';
import { playerId } from './identity.ts';

const HOST_UNKNOWN = 'host';

/** Re-render whenever the given object says something changed. */
function useChanges(subscribe: ((handler: () => void) => () => void) | null): void {
  const [, bump] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (!subscribe) return;
    return subscribe(bump);
  }, [subscribe]);
}

export type HostSession = {
  match: MatchHost;
  state: ClientState;
  offer: LiveOffer | null;
  notice: string | null;
  accept: (text: string) => void;
};

export function useHostSession(name: string, broadcast: boolean): HostSession | null {
  const [host, setHost] = useState<{
    match: MatchHost;
    transport: WebRtcHostTransport | BroadcastChannelTransport;
    pool: OfferPool | null;
  } | null>(null);

  const [offer, setOffer] = useState<LiveOffer | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const me = playerId();

    // The dev transport skips the handshake entirely: no pool, no camera.
    const transport = broadcast
      ? new BroadcastChannelTransport(me, name)
      : new WebRtcHostTransport(me);

    const match = new MatchHost(transport, me, name);
    const pool = broadcast ? null : new OfferPool();

    setHost({ match, transport, pool });

    const off = pool?.onChange(setOffer);
    void pool?.start().then(() => setOffer(pool.current()));

    return () => {
      off?.();
      pool?.close();
      match.close();
      transport.close();
    };
  }, [broadcast, name]);

  useChanges(host ? (handler) => host.match.onChange(handler) : null);

  if (!host) return null;

  const accept = (text: string) => {
    const { pool, transport, match } = host;
    if (!pool || !(transport instanceof WebRtcHostTransport)) return;

    void (async () => {
      const result = await pool.accept(text);

      if (!result.ok) {
        setNotice(
          result.reason === 'stale'
            ? 'Stale code. Ask them to rescan.'
            : "That code didn't read. Ask them to show it again.",
        );
        return;
      }

      setNotice(null);
      setOffer(pool.current());

      const { rejoined } = transport.adopt(result.joined);
      match.seat(result.joined.playerId, result.joined.name);

      try {
        await waitForOpen(result.joined.dc);
      } catch (error) {
        setNotice((error as Error).message);
        return;
      }

      // A rejoin gets its projection the moment the channel opens, so a
      // reloaded phone lands back in the game rather than in a lobby.
      if (rejoined) match.seat(result.joined.playerId, result.joined.name);
    })();
  };

  return {
    match: host.match,
    state: host.match.clientState(),
    offer,
    notice,
    accept,
  };
}

export type JoinStage =
  | { at: 'scanning'; error: string | null }
  | { at: 'showing'; code: string; error: string | null }
  | { at: 'in'; client: MatchClient; state: ClientState | null };

export function usePlayerSession(name: string, broadcast: boolean): {
  stage: JoinStage;
  offer: (text: string) => void;
} {
  const [stage, setStage] = useState<JoinStage>({ at: 'scanning', error: null });
  const clientRef = useRef<MatchClient | null>(null);
  const closers = useRef<(() => void)[]>([]);

  // The dev transport has no handshake: a player is simply in.
  useEffect(() => {
    if (!broadcast) return;

    const transport = new BroadcastChannelTransport(playerId(), name);
    const client = new MatchClient(transport);
    clientRef.current = client;
    setStage({ at: 'in', client, state: null });

    return () => {
      client.close();
      transport.close();
    };
  }, [broadcast, name]);

  useEffect(
    () => () => {
      for (const close of closers.current) close();
    },
    [],
  );

  useChanges(clientRef.current ? (handler) => clientRef.current!.onChange(handler) : null);

  const offer = (text: string) => {
    void (async () => {
      try {
        // Fail on a bad code before touching WebRTC, so the message is useful.
        const decoded = decodeHandshake(text);
        if (decoded.kind !== 'offer') throw new Error("That's not a host's code.");

        const { answerText, pc, channel } = await answerOffer(text, {
          playerId: playerId(),
          name,
        });

        setStage({ at: 'showing', code: answerText, error: null });

        const dc = await channel;
        await waitForOpen(dc);

        // A player doesn't learn the host's real id until the first sync, and
        // doesn't need it: everything it sends goes down its one channel
        // regardless. MatchClient addresses actions using the id sync carries.
        const transport = new WebRtcPlayerTransport(playerId(), HOST_UNKNOWN, pc, dc);
        const client = new MatchClient(transport);
        clientRef.current = client;
        closers.current.push(() => {
          client.close();
          transport.close();
        });

        setStage({ at: 'in', client, state: null });
      } catch (error) {
        const message = (error as Error).message;
        setStage((current) =>
          current.at === 'showing'
            ? { at: 'showing', code: current.code, error: message }
            : { at: 'scanning', error: message },
        );
      }
    })();
  };

  const client = clientRef.current;
  return {
    stage: client ? { at: 'in', client, state: client.state() } : stage,
    offer,
  };
}
