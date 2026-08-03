import type { ClientState } from '../match/protocol.ts';
import type { AnyGame } from '../game/types.ts';

type Props = {
  game: AnyGame;
  state: ClientState;
  /** Only the host can move the match on. */
  onAgain?: (() => void) | undefined;
  onPickAnother?: (() => void) | undefined;
};

export function Results({ game, state, onAgain, onPickAnother }: Props) {
  const byId = new Map(state.roster.map((p) => [p.id, p]));
  const placements = state.result?.placements ?? [];

  return (
    <main className="screen">
      <p className="label">
        {game.name} · game {state.gameNumber}
      </p>

      <div className="stack grow">
        {placements.map((id, index) => (
          <div key={id} className="placing">
            <span className="place">{index + 1}</span>
            <span className="loud grow">{byId.get(id)?.name ?? 'Gone'}</span>
            <span className="score">{byId.get(id)?.score ?? 0}</span>
          </div>
        ))}
      </div>

      <hr className="rule" />
      <p className="label">Match score, all games</p>
      <ul className="roster">
        {[...state.roster]
          .sort((a, b) => b.score - a.score)
          .map((p) => (
            <li key={p.id}>
              <span className="roster-name">{p.name}</span>{' '}
              <span className="roster-count">{p.score}</span>
            </li>
          ))}
      </ul>

      {onAgain && onPickAnother ? (
        <div className="stack">
          <button className="btn primary" onClick={onAgain}>
            Play again
          </button>
          <button className="btn" onClick={onPickAnother}>
            Pick another game
          </button>
        </div>
      ) : (
        // Same roster, no rescanning — the host decides what happens next.
        <p className="note">Waiting for the host to pick what's next.</p>
      )}
    </main>
  );
}
