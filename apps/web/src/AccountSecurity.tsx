import qrcode from 'qrcode-generator';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFor, type MfaStatus } from './api.ts';
import { SecondFactorInput, type FactorMode } from './SecondFactorInput.tsx';

/** Rendered locally into a data: URL; the secret never leaves the browser. */
function qrDataUrl(uri: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(uri);
  qr.make();
  return qr.createDataURL(4, 4);
}

function RecoveryCodeList({ codes }: { codes: readonly string[] }) {
  return (
    <section aria-labelledby="recovery-heading">
      <h4 id="recovery-heading">Your recovery codes</h4>
      <p>
        Store these codes somewhere safe, e.g. in a password manager. Each code works once and lets you sign in if you
        lose your authenticator. They are shown only now.
      </p>
      <ul aria-label="Recovery codes">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Flow =
  | { readonly kind: 'idle' }
  | { readonly kind: 'enable-password' }
  | { readonly kind: 'enable-code'; readonly secret: string; readonly uri: string }
  | { readonly kind: 'disable' }
  | { readonly kind: 'regenerate' }
  | { readonly kind: 'codes'; readonly codes: readonly string[] };

export function AccountSecurity() {
  const [status, setStatus] = useState<MfaStatus | null>(null);
  const [flow, setFlow] = useState<Flow>({ kind: 'idle' });
  const [password, setPassword] = useState('');
  const [factor, setFactor] = useState('');
  const [mode, setMode] = useState<FactorMode>('code');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    api.mfaStatus().then(setStatus, () => setStatus(null));
  }, []);
  useEffect(refresh, [refresh]);

  function begin(next: Flow) {
    setFlow(next);
    setPassword('');
    setFactor('');
    setMode('code');
    setError(null);
  }

  async function run(event: FormEvent, action: () => Promise<Flow>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      begin(next);
      refresh();
    } catch (caught) {
      setError(messageFor(caught));
      setFactor('');
    } finally {
      setBusy(false);
    }
  }

  if (status === null) return null;

  const passwordField = (
    <p>
      <label>
        Current password
        <br />
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </label>
    </p>
  );
  const errorLine = error !== null && <p role="alert">{error}</p>;
  const cancel = (
    <button type="button" onClick={() => begin({ kind: 'idle' })}>
      Cancel
    </button>
  );

  return (
    <section aria-labelledby="security-heading">
      <h3 id="security-heading">Two-factor authentication</h3>
      <p>
        Status: <strong>{status.totpEnabled ? 'Enabled' : 'Not enabled'}</strong>
        {status.totpEnabled && ` · ${status.recoveryCodesRemaining} recovery codes left`}
      </p>

      {flow.kind === 'codes' && (
        <>
          <RecoveryCodeList codes={flow.codes} />
          <button type="button" onClick={() => begin({ kind: 'idle' })}>
            I have saved my recovery codes
          </button>
        </>
      )}

      {flow.kind === 'idle' && !status.totpEnabled && (
        <button type="button" onClick={() => begin({ kind: 'enable-password' })}>
          Enable two-factor authentication
        </button>
      )}
      {flow.kind === 'idle' && status.totpEnabled && (
        <p>
          <button type="button" onClick={() => begin({ kind: 'regenerate' })}>
            New recovery codes
          </button>{' '}
          <button type="button" onClick={() => begin({ kind: 'disable' })}>
            Disable two-factor authentication
          </button>
        </p>
      )}

      {flow.kind === 'enable-password' && (
        <form
          onSubmit={(e) =>
            void run(e, async () => {
              const { secret, uri } = await api.startTotp(password);
              return { kind: 'enable-code', secret, uri };
            })
          }
        >
          {passwordField}
          {errorLine}
          <button type="submit" disabled={busy}>
            Continue
          </button>{' '}
          {cancel}
        </form>
      )}

      {flow.kind === 'enable-code' && (
        <form
          onSubmit={(e) =>
            void run(e, async () => ({ kind: 'codes', codes: (await api.confirmTotp(factor)).recoveryCodes }))
          }
        >
          <p>Scan this code with your authenticator app, or enter the key manually.</p>
          <img src={qrDataUrl(flow.uri)} alt="QR code for your authenticator app" width={200} height={200} />
          <p>
            Key: <code>{flow.secret.match(/.{1,4}/g)?.join(' ')}</code>
          </p>
          <SecondFactorInput mode="code" value={factor} onChange={setFactor} onModeChange={() => undefined} />
          {errorLine}
          <button type="submit" disabled={busy}>
            Enable
          </button>{' '}
          {cancel}
        </form>
      )}

      {flow.kind === 'disable' && (
        <form
          onSubmit={(e) =>
            void run(e, async () => {
              await api.disableTotp(password, mode === 'code' ? { code: factor } : { recoveryCode: factor });
              return { kind: 'idle' };
            })
          }
        >
          {passwordField}
          <SecondFactorInput
            mode={mode}
            value={factor}
            onChange={setFactor}
            onModeChange={(next) => {
              setMode(next);
              setFactor('');
            }}
          />
          {errorLine}
          <button type="submit" disabled={busy}>
            Disable
          </button>{' '}
          {cancel}
        </form>
      )}

      {flow.kind === 'regenerate' && (
        <form
          onSubmit={(e) =>
            void run(e, async () => ({
              kind: 'codes',
              codes: (await api.regenerateRecoveryCodes(password)).recoveryCodes,
            }))
          }
        >
          <p>All previous recovery codes stop working.</p>
          {passwordField}
          {errorLine}
          <button type="submit" disabled={busy}>
            Create new codes
          </button>{' '}
          {cancel}
        </form>
      )}
    </section>
  );
}
