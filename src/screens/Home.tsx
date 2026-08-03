import { useState } from 'react';
import { GAMES } from '../game/registry.ts';
import { rememberName, trimName } from '../identity.ts';
import { href } from '../router.ts';

type Props = {
  name: string;
  onName: (name: string) => void;
};

export function Home({ name, onName }: Props) {
  const [draft, setDraft] = useState(name);
  const ready = trimName(draft).length > 0;

  const commit = (value: string) => {
    const clean = trimName(value);
    setDraft(value);
    onName(clean);
    rememberName(clean);
  };

  return (
    <main className="screen">
      <div className="stack">
        <label className="label" htmlFor="name">
          You
        </label>
        <input
          id="name"
          className="field"
          value={draft}
          placeholder="Your name"
          autoComplete="given-name"
          onChange={(e) => commit(e.target.value)}
        />
      </div>

      <hr className="rule" />

      <div className="stack grow">
        <p className="label">Start a game</p>
        {GAMES.map((game) => (
          <a
            key={game.id}
            className={`game-row${ready ? '' : ' disabled'}`}
            href={ready ? href(`/host/${game.id}`) : undefined}
            // The hue each game lights its surface with, previewed on its rail.
            style={{ ['--game-hue' as string]: game.hue }}
            aria-disabled={!ready}
          >
            <span className="game-rail" />
            <span className="stack">
              <span className="loud">{game.name}</span>
              <span className="note">{game.blurb}</span>
              <span className="label">
                {game.minPlayers}–{game.maxPlayers} players
              </span>
            </span>
          </a>
        ))}
        {!ready && <p className="note">Put your name in first, so the table knows who you are.</p>}
      </div>

      <hr className="rule" />

      <a className={`btn${ready ? '' : ' disabled'}`} href={ready ? href('/join') : undefined}>
        Join a game
      </a>

      <p className="note">
        Everyone needs to open this page once before the party. After that it works with no
        internet at all.
      </p>
    </main>
  );
}
