import { Die } from '../../ui/Die.tsx';
import type { PlayerId } from '../../net/handshake.ts';
import type { LiarsDiceAction, LiarsDiceView, RosterView } from './state.ts';

type Props = {
  view: LiarsDiceView;
  me: PlayerId;
  dispatch: (action: LiarsDiceAction) => void;
};

/*
 * This screen is held at arm's length, tilted away from the neighbours, in a
 * loud room, by someone holding a drink (§7). So the dice are enormous, LIAR is
 * the only other tappable thing, the roster is small and secondary, and the
 * bottom edge — where a thumb rests — holds nothing you can press by accident.
 */
export function LiarsDice({ view, dispatch }: Props) {
  if (view.winner) {
    return (
      <section className="game">
        <p className="label">Round {view.round}</p>
        <div className="grow center">
          <p className="shout">{view.winner.name} wins</p>
        </div>
        <Roster roster={view.roster} />
      </section>
    );
  }

  if (view.phase === 'CALLED' && view.iAmCalling) {
    return (
      <section className="game">
        <p className="label">You called it</p>
        <h1 className="loud">Who loses a die?</h1>

        {/* Their own dice are spent either way, so the caller's screen becomes
            the control surface. The picker must include them: calling badly
            and losing your own die is the normal outcome. */}
        <div className="picker grow">
          {view.roster
            .filter((p) => !p.out)
            .map((p) => (
              <button
                key={p.id}
                className="btn pick"
                onClick={() => dispatch({ t: 'PICK_LOSER', loser: p.id })}
              >
                {p.name}
              </button>
            ))}
        </div>
      </section>
    );
  }

  if (view.phase === 'RESOLVED') {
    return (
      <section className="game">
        <p className="label">Round {view.round}</p>
        <div className="grow center stack">
          <p className="shout">{view.lastLoser?.name} lost a die</p>
          <p className="loud dim">{startsNext(view)} starts</p>
        </div>

        {!view.amOut && (
          <button className="btn primary" onClick={() => dispatch({ t: 'NEXT_ROUND' })}>
            Roll
          </button>
        )}
        <Roster roster={view.roster} />
      </section>
    );
  }

  const called = view.phase === 'CALLED';

  return (
    <section className="game">
      <p className="label">
        {called ? `${view.caller?.name} called liar — hold up your dice` : `Round ${view.round}`}
      </p>

      <div className="dice grow" key={`${view.round}-${view.phase}`}>
        {view.myDice.map((face, i) => (
          <Die key={i} face={face} index={i} />
        ))}
      </div>

      {view.amOut ? (
        <p className="note center">You're out. Stay and heckle.</p>
      ) : (
        // Deliberately the only tappable thing on the screen.
        !called && (
          <button className="btn liar" onClick={() => dispatch({ t: 'CALL_LIAR' })}>
            Liar
          </button>
        )
      )}

      <Roster roster={view.roster} />
    </section>
  );
}

function startsNext(view: LiarsDiceView): string {
  const loser = view.roster.find((p) => p.id === view.lastLoser?.id);
  if (loser && !loser.out) return loser.name;

  // Whoever lost their last die cannot open the next round.
  return view.roster.find((p) => !p.out)?.name ?? 'Somebody';
}

function Roster({ roster }: { roster: RosterView[] }) {
  return (
    <>
      <hr className="rule" />
      <ul className="roster">
        {roster.map((p) => (
          <li key={p.id} className={p.out ? 'out' : undefined}>
            <span className="roster-name">{p.name}</span>{' '}
            <span className="roster-count">{p.out ? '—' : p.diceCount}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
