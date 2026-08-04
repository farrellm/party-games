import { useEffect, useRef, useState } from 'react';
import { QrCode } from '../qr/QrCode.tsx';
import { Scanner } from '../qr/Scanner.tsx';
import { PasteCode } from './PasteCode.tsx';
import { Setup } from './Setup.tsx';
import type { LiveOffer } from '../net/offer-pool.ts';
import type { RosterEntry } from '../match/protocol.ts';
import type { AnyGame } from '../game/types.ts';

type Props = {
  game: AnyGame;
  offer: LiveOffer | null;
  roster: RosterEntry[];
  notice: string | null;
  canStart: boolean;
  /** Dev mode has no handshake, so it has no code and no camera (§12). */
  broadcast: boolean;
  config: Record<string, unknown>;
  onOption: (key: string, value: unknown) => void;
  onAnswer: (text: string) => void;
  onStart: () => void;
};

/**
 * The hero screen, and the one everybody sees every session.
 *
 * The live code and the camera are on screen together, so the host can stand in
 * one place and scan a queue of people without touching anything (§3.1).
 */
export function HostLobby({
  game,
  offer,
  roster,
  notice,
  canStart,
  broadcast,
  config,
  onOption,
  onAnswer,
  onStart,
}: Props) {
  const dealt = useDeal(offer?.nonce);

  return (
    <main className="screen">
      <p className="label">{game.name} · lobby</p>

      {broadcast ? (
        <p className="note">
          Dev mode. Open more tabs at <code className="code">?transport=broadcast&as=Name</code> to
          fill the table.
        </p>
      ) : (
        <>
          <div className="ticket">
            {offer ? (
              <div className="deal" key={offer.nonce}>
                {dealt && <div className="deal-spent" aria-hidden />}
                <QrCode text={offer.text} label="Code for a player to scan" />
              </div>
            ) : (
              <div className="ticket-empty" />
            )}
            <p className="shout ticket-caption">Scan me</p>
          </div>

          <Scanner onScan={onAnswer} resetKey={offer?.nonce} />

          {notice && (
            <p className="alarm" role="status">
              {notice}
            </p>
          )}
        </>
      )}

      <hr className="rule" />

      <div className="stack grow">
        <p className="label">In ({roster.length})</p>
        <ul className="roster">
          {roster.map((p) => (
            <li key={p.id}>
              <span className="roster-name">{p.name}</span>
            </li>
          ))}
        </ul>
        {roster.length < 2 && <p className="note">Nobody's in yet. Point a phone at the code.</p>}
      </div>

      <Setup game={game} config={config} onOption={onOption} />

      <button className="btn primary" disabled={!canStart} onClick={onStart}>
        Start game
      </button>
      {!canStart && (
        <p className="note">
          {game.name} needs {game.minPlayers}–{game.maxPlayers} players.
        </p>
      )}

      {!broadcast && <PasteCode show={offer?.text} onPaste={onAnswer} />}
    </main>
  );
}

/**
 * A spent code deals away as the next one drops in — the one orchestrated
 * moment in the app, and the only place a protocol constraint (§3.1's
 * single-use offers) becomes something nice to look at.
 */
function useDeal(nonce: number | undefined): boolean {
  const [dealing, setDealing] = useState(false);
  const previous = useRef(nonce);

  useEffect(() => {
    if (previous.current !== undefined && nonce !== previous.current) {
      setDealing(true);
      const timer = setTimeout(() => setDealing(false), 300);
      previous.current = nonce;
      return () => clearTimeout(timer);
    }
    previous.current = nonce;
    return;
  }, [nonce]);

  return dealing;
}
