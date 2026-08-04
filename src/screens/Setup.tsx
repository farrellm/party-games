import { Fragment } from 'react';
import type { AnyGame, AnyOption } from '../game/types.ts';

type Props = {
  game: AnyGame;
  config: Record<string, unknown>;
  onOption: (key: string, value: unknown) => void;
};

/*
 * What the host settles before the game starts.
 *
 * Collapsed, because three groups of choices is more screen than the lobby has
 * — the code, the camera and the Start button are already fighting for one
 * phone (§3.1). The summary line stays visible either way, so the deck can be
 * read at a glance by somebody who has just noticed a child in the room.
 *
 * A choice is marked the way Home marks a game: a lit rail down its edge. That
 * is the same gesture the host made one screen ago to get here, and it is the
 * only colour in an otherwise unlit lobby.
 */
export function Setup({ game, config, onOption }: Props) {
  const shown = (game.options ?? []).filter(
    (option: AnyOption) => option.when?.(config) ?? true,
  ) as AnyOption[];

  if (shown.length === 0) return null;

  return (
    // The one lit thing here, scoped to this block the way Home scopes it to a
    // row. The shell around it stays night until the game actually starts.
    <details className="setup" style={{ ['--game-hue' as string]: game.hue }}>
      <summary className="setup-head">
        <span className="stack setup-grow">
          <span className="label">Setup</span>
          <span className="setup-line">
            <span className="rail" />
            {summarise(game, config, shown)}
          </span>
        </span>
        <span className="setup-chev" aria-hidden>
          ›
        </span>
      </summary>

      {shown.map((option) => (
        <fieldset key={option.key} className="opt">
          <legend className="label">{option.label}</legend>

          {/* Layout follows the content rather than a second decision: choices
              that carry a note need a line each, bare values do not. */}
          <div className={option.choices.some((c) => c.note) ? 'opt-stack' : 'opt-inline'}>
            {option.choices.map((choice, i) => {
              const id = `${option.key}-${i}`;
              return (
                <Fragment key={id}>
                  {/* Hidden, not absent: a real radio group is what makes the
                      arrow keys and the screen reader work without a roving
                      tabindex. The label wears the focus ring for it. */}
                  <input
                    id={id}
                    className="opt-in"
                    type="radio"
                    name={option.key}
                    checked={Object.is(config[option.key], choice.value)}
                    onChange={() => onOption(option.key, choice.value)}
                  />
                  <label className="opt-choice" htmlFor={id}>
                    <span className="rail" />
                    <span className="stack opt-text">
                      <span className="opt-name">{choice.label}</span>
                      {choice.note && <span className="note">{choice.note}</span>}
                    </span>
                  </label>
                </Fragment>
              );
            })}
          </div>
        </fieldset>
      ))}
    </details>
  );
}

/**
 * The game's own words if it has any — "first to 5" reads as one thought, and
 * no amount of joining two independent options up will produce it. Failing
 * that, the chosen labels in order, which is at least true.
 */
function summarise(game: AnyGame, config: Record<string, unknown>, shown: AnyOption[]): string {
  if (game.summary) return game.summary(config);

  return shown
    .map((option) => option.choices.find((c) => Object.is(c.value, config[option.key]))?.label)
    .filter((label): label is string => label !== undefined)
    .join(' · ');
}
