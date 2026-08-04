import { Fragment, useState } from 'react';
import type { PlayerId } from '../../net/handshake.ts';
import { BLANK } from './cards.ts';
import type { CahAction, CahView, RosterView } from './state.ts';
import './cah.css';

type Props = {
  view: CahView;
  me: PlayerId;
  dispatch: (action: CahAction) => void;
};

/*
 * The subject of this game is the sentence, not the cardboard. So the prompt
 * sits at the top with its blanks as ruled gaps, and tapping a card in your
 * hand drops that card's words into the gap — in the game's hue, because the
 * one thing worth colouring is the part you supplied. The hand is secondary
 * and stays quiet.
 *
 * Set in sentence case at normal width, deliberately against the shell's
 * uppercase habit: these cards are printed as bold grotesque sentences and
 * shouting them would cost the joke its timing (§7).
 */
export function Cah({ view, dispatch }: Props) {
  // There is no winner screen here on purpose. The shell owns the end of a
  // game — it has the cross-game scoreboard and the match's own flow — and a
  // branch for it would be unreachable anyway, because `result` turning
  // non-null is exactly what takes this component off the screen (§5).
  if (view.phase === 'SCORED') return <Scored view={view} dispatch={dispatch} />;
  if (view.phase === 'READING') {
    return view.iAmCzar ? (
      <Reading key={view.round} view={view} dispatch={dispatch} />
    ) : (
      <Listening view={view} />
    );
  }
  if (view.iAmCzar) return <Judging view={view} dispatch={dispatch} />;
  return <Composing key={view.round} view={view} dispatch={dispatch} />;
}

/**
 * Where the round sits in whatever the table agreed to play to. One line, in
 * the shell's own label voice, so it reads as furniture rather than as a score.
 */
function standing(view: CahView): string {
  switch (view.ending.until) {
    case 'points':
      return `Round ${view.round} · first to ${view.ending.points}`;
    case 'rounds':
      return `Round ${view.round} of ${view.ending.rounds}`;
    case 'empty':
      return `Round ${view.round}`;
  }
}

/* --- The signature: a prompt whose blanks fill in as you choose --- */

function Sentence({ text, fills }: { text: string; fills: string[] }) {
  const parts = text.split(BLANK);
  const gaps = parts.length - 1;

  return (
    <div className="cah-sentence">
      <p className="cah-prompt">
        {parts.map((part, i) => (
          <Fragment key={i}>
            {part}
            {i < gaps && <Blank word={fills[i]} />}
          </Fragment>
        ))}
      </p>

      {/* Twenty-three prompts are questions with no gap to fill, and a couple
          take more cards than they print gaps. Either way the leftovers are
          the answer, and they read underneath. */}
      {fills.slice(gaps).map((word, i) => (
        <p key={i} className="cah-prompt cah-said">
          {trim(word)}
        </p>
      ))}
    </div>
  );
}

function Blank({ word }: { word: string | undefined }) {
  if (word === undefined) return <span className="cah-blank" />;
  return <span className="cah-blank cah-filled">{trim(word)}</span>;
}

/** The prompt punctuates itself, so a card's own full stop lands mid-sentence. */
function trim(word: string): string {
  return word.endsWith('.') ? word.slice(0, -1) : word;
}

/* --- Picking: everyone but the Czar --- */

function Composing({ view, dispatch }: { view: CahView; dispatch: (a: CahAction) => void }) {
  const [picked, setPicked] = useState<number[]>([]);
  const { pick } = view.black;
  const ready = picked.length === pick;

  if (view.mySubmission) {
    return (
      <section className="game cah">
        <Header view={view} />
        <Sentence text={view.black.text} fills={view.mySubmission} />
        <p className="note grow">
          {view.waitingCount === 0
            ? 'That’s everyone. Hand it over.'
            : `Waiting on ${view.waitingCount} more.`}
        </p>
        <Roster roster={view.roster} />
      </section>
    );
  }

  // Deck ids, in tap order — which is the order they land in the blanks.
  const toggle = (id: number) =>
    setPicked((was) =>
      was.includes(id) ? was.filter((x) => x !== id) : was.length >= pick ? was : [...was, id],
    );

  const textOf = (id: number) => view.myHand.find((c) => c.id === id)?.text ?? '';

  return (
    <section className="game cah">
      <Header view={view} />
      <Sentence text={view.black.text} fills={picked.map(textOf)} />

      <ul className="cah-hand grow">
        {view.myHand.map((card) => {
          const at = picked.indexOf(card.id);
          return (
            <li key={card.id}>
              <button
                className={`cah-card${at >= 0 ? ' cah-played' : ''}`}
                aria-pressed={at >= 0}
                onClick={() => toggle(card.id)}
              >
                {card.text}
                {pick > 1 && at >= 0 && <span className="cah-order">{at + 1}</span>}
              </button>
            </li>
          );
        })}
      </ul>

      <button
        className="btn primary"
        disabled={!ready}
        onClick={() => dispatch({ t: 'PLAY', cards: picked })}
      >
        {ready ? 'Play' : pick === 1 ? 'Pick a card' : `Pick ${pick - picked.length} more`}
      </button>
      <Roster roster={view.roster} />
    </section>
  );
}

/* --- Picking: the Czar, who has nothing to do but wait --- */

function Judging({ view, dispatch }: { view: CahView; dispatch: (a: CahAction) => void }) {
  return (
    <section className="game cah">
      <Header view={view} />
      <Sentence text={view.black.text} fills={[]} />

      <p className="note grow">
        {view.waitingCount === 0
          ? 'Everyone is in.'
          : `Waiting on ${view.waitingCount} of ${view.roster.length - 1}.`}
      </p>

      {/* A phone that fell asleep should not be able to hold the party up. */}
      {view.waitingCount > 0 && view.submittedCount >= 2 && (
        <button className="btn" onClick={() => dispatch({ t: 'FORCE_READ' })}>
          Read what’s in
        </button>
      )}
      <Roster roster={view.roster} />
    </section>
  );
}

/* --- Reading: the Czar's teleprompter --- */

function Reading({ view, dispatch }: { view: CahView; dispatch: (a: CahAction) => void }) {
  const [at, setAt] = useState(0);
  const all = view.submissions ?? [];
  const cards = all[at] ?? [];

  return (
    <section className="game cah">
      <p className="label">
        Read it out — {at + 1} of {all.length}
      </p>

      {/* The Czar's screen is a teleprompter and the sentence is the only
          thing on it, so it sits in the middle of the glass rather than
          clinging to the top with a hole underneath. Ranged left: these run
          long, and centred prose is harder to read aloud. */}
      <div className="cah-stage">
        <Sentence text={view.black.text} fills={cards} />
      </div>

      <div className="cah-flip">
        <button className="btn" disabled={at === 0} onClick={() => setAt(at - 1)}>
          Back
        </button>
        <button className="btn" disabled={at >= all.length - 1} onClick={() => setAt(at + 1)}>
          Next
        </button>
      </div>
      <button className="btn primary" onClick={() => dispatch({ t: 'JUDGE', pick: at })}>
        This one wins
      </button>
      <Roster roster={view.roster} />
    </section>
  );
}

/* --- Reading: everyone else, who should be listening, not reading --- */

function Listening({ view }: { view: CahView }) {
  return (
    <section className="game cah">
      <p className="label">{standing(view)}</p>
      <Sentence text={view.black.text} fills={[]} />
      <div className="grow center">
        <p className="loud dim">{view.czar.name} is reading</p>
      </div>
      <Roster roster={view.roster} />
    </section>
  );
}

/* --- Scored --- */

function Scored({ view, dispatch }: { view: CahView; dispatch: (a: CahAction) => void }) {
  return (
    <section className="game cah">
      <p className="label">{standing(view)}</p>
      <Sentence text={view.black.text} fills={view.winner?.cards ?? []} />

      <div className="grow center">
        <p className="loud">{view.winner?.name} takes it</p>
      </div>

      {/*
        The round that settles it offers one button, because there is nothing
        else left to do. Every other round offers the way out as well: a race to
        seven can outlive the room's interest in it, and the alternative is a
        game nobody can leave.
      */}
      {view.lastRound ? (
        <button className="btn primary" onClick={() => dispatch({ t: 'FINISH' })}>
          Finish
        </button>
      ) : (
        <div className="cah-flip">
          <button className="btn" onClick={() => dispatch({ t: 'FINISH' })}>
            Stop here
          </button>
          <button className="btn primary" onClick={() => dispatch({ t: 'NEXT_ROUND' })}>
            Next round
          </button>
        </div>
      )}
      <Roster roster={view.roster} />
      <Credit credit={view.credit} />
    </section>
  );
}

/* --- Furniture --- */

function Header({ view }: { view: CahView }) {
  return (
    <p className="label">
      Round {view.round} — <span className="cah-czar">{view.czar.name}</span> judges
    </p>
  );
}

/** On the bottom edge, where a thumb rests: the one thing you cannot press. */
function Roster({ roster }: { roster: RosterView[] }) {
  return (
    <>
      <hr className="rule" />
      <ul className="roster">
        {roster.map((p) => (
          <li key={p.id}>
            <span className={`roster-name${p.isCzar ? ' cah-czar' : ''}`}>
              {p.name}
              {p.submitted && <span className="cah-in" aria-label="played" />}
            </span>{' '}
            <span className="roster-count">{p.wins}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

/**
 * Names the edition actually being played, because attribution is a licence
 * term and the two decks are not the same work. Only the Main Deck's PDF grants
 * CC BY-NC-SA 2.0, so only the Main Deck says so.
 */
function Credit({ credit }: { credit: CahView['credit'] }) {
  return (
    <p className="cah-credit">
      {credit.name}
      {credit.cc && ' — CC BY-NC-SA 2.0'}
    </p>
  );
}
