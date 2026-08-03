import { describe, expect, it, vi } from 'vitest';
import { MemoryNetwork } from './memory-transport.ts';
import type { Envelope } from './transport.ts';

function table() {
  const net = new MemoryNetwork('host');
  return {
    net,
    host: net.connect('host', 'Host'),
    ann: net.connect('ann', 'Ann'),
    bo: net.connect('bo', 'Bo'),
  };
}

describe('MemoryTransport', () => {
  it('delivers a directed message to exactly one peer', () => {
    const { host, ann, bo } = table();

    const toAnn = vi.fn();
    const toBo = vi.fn();
    ann.onMessage(toAnn);
    bo.onMessage(toBo);

    host.send('ann', 'state', { dice: [1, 2, 3] });

    expect(toAnn).toHaveBeenCalledOnce();
    expect(toBo).not.toHaveBeenCalled();
  });

  it('delivers a broadcast to everyone but the sender', () => {
    const { host, ann, bo } = table();

    const seen: string[] = [];
    host.onMessage(() => seen.push('host'));
    ann.onMessage(() => seen.push('ann'));
    bo.onMessage(() => seen.push('bo'));

    host.send('*', 'round', { round: 2 });

    expect(seen.sort()).toEqual(['ann', 'bo']);
  });

  it('stamps envelopes with a monotonic per-sender sequence', () => {
    const { host, ann } = table();

    const seen: Envelope[] = [];
    ann.onMessage((e) => seen.push(e));

    host.send('ann', 'a', null);
    host.send('ann', 'b', null);

    expect(seen.map((e) => e.seq)).toEqual([1, 2]);
    expect(seen.every((e) => e.from === 'host' && e.v === 1)).toBe(true);
  });

  it('reports peers without the caller in the list', () => {
    const { ann } = table();
    expect(ann.peers().map((p) => p.id).sort()).toEqual(['bo', 'host']);
  });

  it('notifies peers when someone joins or leaves', () => {
    const net = new MemoryNetwork('host');
    const host = net.connect('host', 'Host');

    const changed = vi.fn();
    host.onPeersChanged(changed);

    const ann = net.connect('ann', 'Ann');
    expect(changed).toHaveBeenCalledOnce();

    ann.close();
    expect(changed).toHaveBeenCalledTimes(2);
    expect(host.peers()).toEqual([]);
  });

  it('stops delivering to a closed peer', () => {
    const { host, ann } = table();

    const toAnn = vi.fn();
    ann.onMessage(toAnn);
    ann.close();

    host.send('ann', 'state', null);
    expect(toAnn).not.toHaveBeenCalled();
  });
});
