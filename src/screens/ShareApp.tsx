import { useEffect, useRef } from 'react';
import { QrCode } from '../qr/QrCode.tsx';
import { appUrl } from '../router.ts';

type Props = {
  onClose: () => void;
};

/**
 * The app's own address, held up for somebody else's camera.
 *
 * The lobby's code is a session: live, single-use, and only meaningful for the
 * next thirty seconds. This one is the opposite — it never changes, and it is
 * needed before anyone has typed a name. So it deliberately does not deal or
 * rotate; it just sits there being scannable.
 *
 * It takes the whole screen because the gesture is physical. You hold the phone
 * up and out, away from yourself, and for those few seconds it has stopped
 * being your interface and become a sign.
 */
export function ShareApp({ onClose }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const url = appUrl();

  // showModal rather than an open attribute: it promotes the dialog to the top
  // layer (so #root's 30rem cap can't clip it) and brings Esc, focus
  // containment and an inert background with it, none of which is worth
  // hand-rolling for one screen.
  useEffect(() => {
    ref.current?.showModal();
  }, []);

  // `close` fires for Esc and for the button alike, so both exits land here.
  return (
    <dialog ref={ref} className="handoff" onClose={onClose}>
      <div className="ticket">
        <p className="label">Get the app</p>
        <QrCode text={url} label="Link to this app" />
        <p className="code" data-testid="app-url">
          {url}
        </p>
      </div>

      <p className="note">
        Point a camera at this to open the app. It works with no internet once it has loaded.
      </p>

      <button className="btn" onClick={() => ref.current?.close()}>
        Done
      </button>
    </dialog>
  );
}
