import { useState } from 'react';
import { Home } from './screens/Home.tsx';
import { HostLobby } from './screens/HostLobby.tsx';
import { JoinScan, JoinShowAnswer } from './screens/Join.tsx';
import { Results } from './screens/Results.tsx';
import { findGame } from './game/registry.ts';
import { playerId, storedName } from './identity.ts';
import { go, useBroadcastMode, useRoute } from './router.ts';
import { useHostSession, usePlayerSession } from './session.ts';
import { useWakeLock } from './wake-lock.ts';
import type { ClientState } from './match/protocol.ts';
import type { AnyGame } from './game/types.ts';

export function App() {
  const route = useRoute();
  const broadcast = useBroadcastMode();
  const [name, setName] = useState(storedName);

  if (route.name === 'host') {
    const game = findGame(route.gameId);
    return game ? (
      <HostFlow game={game} name={name} broadcast={broadcast} />
    ) : (
      <Missing what="game" />
    );
  }

  if (route.name === 'join') return <JoinFlow name={name} broadcast={broadcast} />;

  return <Home name={name} onName={setName} />;
}

function HostFlow({
  game,
  name,
  broadcast,
}: {
  game: AnyGame;
  name: string;
  broadcast: boolean;
}) {
  const session = useHostSession(name, broadcast);
  /*
   * The setup lives here rather than in the lobby because it has to outlive it:
   * "Play again" starts a second game without passing back through the lobby,
   * and it must deal the same deck the table just agreed on.
   */
  const [config, setConfig] = useState<Record<string, unknown>>(() => ({
    ...(game.defaultConfig as Record<string, unknown>),
  }));
  useWakeLock(session?.state.phase === 'PLAYING');

  if (!session) return <Connecting />;

  const { match, state } = session;

  if (state.phase === 'RESULTS') {
    return (
      <Results
        game={game}
        state={state}
        onAgain={() => match.start(game, config)}
        onPickAnother={() => {
          match.toLobby();
          go('/');
        }}
      />
    );
  }

  if (state.phase === 'PLAYING') {
    return <GameSurface game={game} state={state} onAction={(a) => match.dispatch(match.self, a)} />;
  }

  return (
    <HostLobby
      game={game}
      offer={session.offer}
      roster={state.roster}
      notice={session.notice}
      canStart={match.canStart(game)}
      broadcast={broadcast}
      config={config}
      onOption={(key, value) => setConfig((was) => ({ ...was, [key]: value }))}
      onAnswer={session.accept}
      onStart={() => match.start(game, config)}
    />
  );
}

function JoinFlow({ name, broadcast }: { name: string; broadcast: boolean }) {
  const { stage, offer } = usePlayerSession(name, broadcast);
  const state = stage.at === 'in' ? stage.state : null;
  useWakeLock(state?.phase === 'PLAYING');

  if (stage.at === 'scanning') return <JoinScan onOffer={offer} error={stage.error} />;
  if (stage.at === 'showing') return <JoinShowAnswer code={stage.code} error={stage.error} />;

  if (!state) return <Connecting />;

  const game = findGame(state.gameId);

  if (state.phase === 'RESULTS' && game) return <Results game={game} state={state} />;

  if (state.phase === 'PLAYING' && game) {
    return (
      <GameSurface game={game} state={state} onAction={(a) => stage.client.dispatch(a)} />
    );
  }

  return (
    <main className="screen center">
      <p className="label">You're in</p>
      <p className="shout">Wait for the host</p>
      <p className="note">{state.roster.length} at the table.</p>
    </main>
  );
}

/**
 * The boundary between the shell and a game. Everything inside is lit by the
 * game's own hue; everything outside stays the shell's quiet night.
 */
function GameSurface({
  game,
  state,
  onAction,
}: {
  game: AnyGame;
  state: ClientState;
  onAction: (action: unknown) => void;
}) {
  return (
    <div className="surface" style={{ ['--game-hue' as string]: game.hue }}>
      <game.Component view={state.view} me={playerId()} dispatch={onAction} />
    </div>
  );
}

function Connecting() {
  return (
    <main className="screen center">
      <p className="label" role="status">
        Connecting
      </p>
    </main>
  );
}

function Missing({ what }: { what: string }) {
  return (
    <main className="screen center stack">
      <p className="shout">No such {what}</p>
      <a className="btn" href="#/">
        Back
      </a>
    </main>
  );
}
