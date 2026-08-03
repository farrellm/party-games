import type { PlayerId } from '../net/handshake.ts';
import type { RngState } from '../game/rng.ts';

/**
 * The host writes one of these after every accepted action, so a host page
 * reload restores the match (§5). Peers still have to rescan to reconnect, but
 * nobody loses their dice.
 *
 * Players never write snapshots. They hold no authoritative state to lose.
 */
export type Snapshot = {
  matchId: string;
  hostId: PlayerId;
  seats: { id: PlayerId; name: string; score: number }[];
  gameId: string | null;
  gameNumber: number;
  gameState: unknown;
  rng: RngState;
  savedAt: number;
};

const DB_NAME = 'party-games';
const STORE = 'host-snapshots';
const KEY = 'current';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

export async function saveSnapshot(snapshot: Snapshot): Promise<void> {
  // A failed write must never take the game down with it — the snapshot is a
  // convenience, and the authoritative state is already in memory.
  try {
    await withStore('readwrite', (store) => store.put(snapshot, KEY));
  } catch {
    // Private browsing, quota, a locked database: play on.
  }
}

export async function loadSnapshot(): Promise<Snapshot | null> {
  try {
    return (await withStore<Snapshot | undefined>('readonly', (s) => s.get(KEY))) ?? null;
  } catch {
    return null;
  }
}

export async function clearSnapshot(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(KEY));
  } catch {
    // Nothing to do about it.
  }
}
