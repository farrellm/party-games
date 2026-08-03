import { QrCode } from '../qr/QrCode.tsx';
import { Scanner } from '../qr/Scanner.tsx';
import { PasteCode } from './PasteCode.tsx';

export function JoinScan({
  onOffer,
  error,
}: {
  onOffer: (text: string) => void;
  error: string | null;
}) {
  return (
    <main className="screen">
      <p className="label">Joining</p>
      <h1 className="shout">Point at the host's code</h1>

      <Scanner onScan={onOffer} />

      {error && (
        <p className="alarm" role="status">
          {error}
        </p>
      )}

      <div className="grow" />
      <PasteCode onPaste={onOffer} />
    </main>
  );
}

export function JoinShowAnswer({ code, error }: { code: string; error: string | null }) {
  return (
    <main className="screen">
      <p className="label">Nearly in</p>

      <div className="ticket">
        <QrCode text={code} label="Your code, for the host to scan" />
        <p className="shout ticket-caption">Show the host</p>
      </div>

      {/* Nothing to press: this advances itself the moment the channel opens. */}
      {error ? (
        <p className="alarm" role="status">
          {error}
        </p>
      ) : (
        <p className="note" role="status">
          Waiting for the host to scan you in.
        </p>
      )}

      <div className="grow" />
      <PasteCode show={code} />
    </main>
  );
}
