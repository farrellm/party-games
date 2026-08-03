import type { PlayerId } from './net/handshake.ts';
import { MAX_NAME_BYTES } from './net/handshake.ts';

const ID_KEY = 'party-games:player-id';
const NAME_KEY = 'party-games:name';

/**
 * Tabs in one browser share localStorage, so multi-tab dev mode (§12) would
 * otherwise seat the same player over and over. ?as=bo gives each tab its own
 * identity — and its own UUID, since the handshake packs playerId as 16 bytes.
 */
function devAlias(): string | null {
  return new URLSearchParams(globalThis.location.search).get('as');
}

function uuidFrom(alias: string): PlayerId {
  const hex = [...alias].reduce((h, ch) => h + ch.codePointAt(0)!.toString(16).padStart(4, '0'), '');
  const padded = hex.padEnd(32, '0').slice(0, 32);
  return [
    padded.slice(0, 8),
    padded.slice(8, 12),
    padded.slice(12, 16),
    padded.slice(16, 20),
    padded.slice(20),
  ].join('-');
}

/**
 * A playerId that survives a reload is what makes reconnecting work: the host
 * sees an answer carrying an id it already has a seat for and rebinds that
 * seat, dice count intact, instead of seating a stranger (§4).
 */
export function playerId(): PlayerId {
  const alias = devAlias();
  if (alias) return uuidFrom(alias);

  const stored = localStorage.getItem(ID_KEY);
  if (stored) return stored;

  const fresh = crypto.randomUUID();
  localStorage.setItem(ID_KEY, fresh);
  return fresh;
}

export function storedName(): string {
  return devAlias() ?? localStorage.getItem(NAME_KEY) ?? '';
}

export function rememberName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

const encoder = new TextEncoder();

/** Names ride in the QR answer, so they are capped in bytes, not characters. */
export function trimName(name: string): string {
  let out = name.trim().replace(/\s+/g, ' ');
  while (encoder.encode(out).length > MAX_NAME_BYTES) out = out.slice(0, -1);
  return out;
}
