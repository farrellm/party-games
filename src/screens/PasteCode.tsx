import { useState } from 'react';

type Props = {
  /** The code this device is showing, offered as selectable text. */
  show?: string | undefined;
  /** Called with a code typed or pasted in. */
  onPaste?: ((text: string) => void) | undefined;
};

/**
 * The same base45 string as the QR, in text (§3.4).
 *
 * This makes desktop development possible without a webcam, makes remote
 * debugging possible over any chat app, and rescues someone whose camera is
 * broken. It is deliberately not prominent.
 */
export function PasteCode({ show, onPaste }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');

  if (!open) {
    return (
      <button className="link" onClick={() => setOpen(true)}>
        No camera?
      </button>
    );
  }

  return (
    <div className="stack paste">
      {show && (
        <>
          <p className="label">Read this out or send it over</p>
          <p className="code" data-testid="code-out">
            {show}
          </p>
        </>
      )}

      {onPaste && (
        <>
          <label className="label" htmlFor="paste">
            Paste the code you were sent
          </label>
          <textarea
            id="paste"
            className="code paste-in"
            data-testid="code-in"
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            className="btn"
            disabled={draft.trim().length === 0}
            onClick={() => onPaste(draft.trim())}
          >
            Use this code
          </button>
        </>
      )}
    </div>
  );
}
