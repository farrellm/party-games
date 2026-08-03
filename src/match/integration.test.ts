import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryNetwork } from '../net/memory-transport.ts';
import { MatchHost } from './host.ts';
import { MatchClient } from './client.ts';
import { liarsDice } from '../game/liars-dice/index.ts';
import type { ClientState } from './protocol.ts';
import type { LiarsDiceView } from '../game/liars-dice/state.ts';

/*
 * The whole host/projection/action loop, in process, with no browser and no
 * WebRTC (§12). MemoryNetwork enforces the same star topology as the real
 * transport, so anything that works here works there.
 */

vi.mock('./snapshot.ts', () => ({
  saveSnapshot: vi.fn(async () => {}),
  loadSnapshot: vi.fn(async () => null),
  clearSnapshot: vi.fn(async () => {}),
}));

function table() {
  const net = new MemoryNetwork('host');

  const hostTransport = net.connect('host', 'Host');
  const host = new MatchHost(hostTransport, 'host', 'Host');

  const players = ['ann', 'bo', 'cy'].map((id) => {
    const transport = net.connect(id, id[0]!.toUpperCase() + id.slice(1));
    return { id, client: new MatchClient(transport) };
  });

  return { net, host, players };
}

function viewOf(state: ClientState | null): LiarsDiceView {
  return state!.view as LiarsDiceView;
}

describe('a match over MemoryTransport', () => {
  let table_: ReturnType<typeof table>;

  beforeEach(() => {
    table_ = table();
  });

  it('seats everyone the transport can reach', () => {
    const { host } = table_;
    expect(host.roster().map((s) => s.id).sort()).toEqual(['ann', 'bo', 'cy', 'host']);
  });

  it('sends every player their own dice and nobody else’s', () => {
    const { host, players } = table_;
    host.start(liarsDice);

    for (const { client } of players) {
      expect(viewOf(client.state()).myDice).toHaveLength(5);
    }

    // Four distinct hands were dealt, and each device holds exactly one.
    const hands = players.map(({ client }) => JSON.stringify(viewOf(client.state()).myDice));
    for (const { client } of players) {
      const mine = JSON.stringify(viewOf(client.state()).myDice);
      const others = hands.filter((h) => h !== mine);
      const wire = JSON.stringify(client.state());

      for (const hand of others) expect(wire).not.toContain(hand);
    }
  });

  it('carries an action from a player to the host and the result back to everyone', () => {
    const { host, players } = table_;
    host.start(liarsDice);

    const bo = players.find((p) => p.id === 'bo')!;
    bo.client.dispatch({ t: 'CALL_LIAR' });

    for (const { id, client } of players) {
      const view = viewOf(client.state());
      expect(view.phase).toBe('CALLED');
      expect(view.caller?.name).toBe('Bo');
      expect(view.iAmCalling).toBe(id === 'bo');
    }
  });

  it('tells only the offender when an action is rejected', () => {
    const { host, players } = table_;
    host.start(liarsDice);

    const [ann, bo] = players;
    bo!.client.dispatch({ t: 'CALL_LIAR' });

    // Ann is not the caller, so she may not pick the loser.
    ann!.client.dispatch({ t: 'PICK_LOSER', loser: 'cy' });

    expect(ann!.client.rejection()).toMatch(/Only the caller/);
    // Nobody else's screen flickers because someone mistimed a tap.
    expect(bo!.client.rejection()).toBeNull();
    expect(viewOf(bo!.client.state()).phase).toBe('CALLED');
  });

  it('plays a full round and carries the dice count forward', () => {
    const { host, players } = table_;
    host.start(liarsDice);

    const bo = players.find((p) => p.id === 'bo')!;
    const cy = players.find((p) => p.id === 'cy')!;

    bo.client.dispatch({ t: 'CALL_LIAR' });
    bo.client.dispatch({ t: 'PICK_LOSER', loser: 'cy' });

    expect(viewOf(cy.client.state()).lastLoser?.name).toBe('Cy');

    bo.client.dispatch({ t: 'NEXT_ROUND' });

    expect(viewOf(cy.client.state()).myDice).toHaveLength(4);
    expect(viewOf(bo.client.state()).myDice).toHaveLength(5);
    expect(viewOf(bo.client.state()).round).toBe(2);
  });

  it('accumulates a scoreboard across games in the match', () => {
    const { host, players } = table_;
    const bo = players.find((p) => p.id === 'bo')!;

    // Knock everyone but the host out.
    host.start(liarsDice);
    for (const victim of ['ann', 'bo', 'cy']) {
      for (let i = 0; i < 5; i++) {
        host.dispatch('host', { t: 'CALL_LIAR' });
        host.dispatch('host', { t: 'PICK_LOSER', loser: victim });
        if (host.clientState().phase === 'RESULTS') break;
        host.dispatch('host', { t: 'NEXT_ROUND' });
      }
    }

    const state = host.clientState();
    expect(state.phase).toBe('RESULTS');
    expect(state.result?.placements[0]).toBe('host');

    // The shell owns the scoreboard, so the players see it too.
    const scores = Object.fromEntries(
      viewOfRoster(bo.client.state()).map((p) => [p.id, p.score]),
    );
    expect(scores['host']).toBe(3);
    expect(scores['ann']).toBe(0);
  });

  it('keeps a returning player’s seat and score', () => {
    const { host } = table_;
    host.start(liarsDice);

    const before = host.roster().find((s) => s.id === 'ann')!;
    before.score = 7;

    // A reload arrives as the same playerId with the same name.
    host.seat('ann', 'Ann');

    expect(host.roster()).toHaveLength(4);
    expect(host.roster().find((s) => s.id === 'ann')!.score).toBe(7);
  });
});

function viewOfRoster(state: ClientState | null) {
  return state!.roster;
}
