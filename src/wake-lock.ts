import { useEffect } from 'react';

type WakeLock = { release: () => Promise<void> };

/**
 * Hold the screen awake during a game (§9).
 *
 * A phone that sleeps mid-round has to be woken, unlocked and re-read while
 * everyone waits, and in liar's dice it means putting your dice back on screen
 * in front of the person sitting next to you.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;

    const api = (navigator as { wakeLock?: { request(type: 'screen'): Promise<WakeLock> } })
      .wakeLock;
    if (!api) return;

    let lock: WakeLock | null = null;
    let released = false;

    const acquire = async () => {
      try {
        lock = await api.request('screen');
        if (released) void lock.release();
      } catch {
        // Denied, or the tab was backgrounded before it resolved. Not fatal.
      }
    };

    // The lock is dropped whenever the tab is hidden, so take it again on the
    // way back rather than leaving the screen to sleep for the rest of the game.
    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire();
    };

    void acquire();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, [active]);
}
