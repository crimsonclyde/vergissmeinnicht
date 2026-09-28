import qrcode from 'qrcode-generator';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, messageFor, type MfaStatus } from './api.ts';
import { SecondFactorInput, type FactorMode } from './SecondFactorInput.tsx';
import { t } from './i18n/index.ts';

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
      <h4 id="recovery-heading">{t('mfa.codesHeading')}</h4>
      <p>{t('mfa.codesExplain')}</p>
      <ul aria-label={t('mfa.codesList')}>
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
        {t('password.current')}
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
      {t('common.cancel')}
    </button>
  );

  return (
    <section aria-labelledby="security-heading">
      <h3 id="security-heading">{t('mfa.heading')}</h3>
      <p>
        {t('mfa.status', { status: t(status.totpEnabled ? 'mfa.enabled' : 'mfa.notEnabled') })}
        {status.totpEnabled && t('mfa.codesLeft', { count: status.recoveryCodesRemaining })}
      </p>

      {flow.kind === 'codes' && (
        <>
          <RecoveryCodeList codes={flow.codes} />
          <button type="button" onClick={() => begin({ kind: 'idle' })}>
            {t('mfa.codesSaved')}
          </button>
        </>
      )}

      {flow.kind === 'idle' && !status.totpEnabled && (
        <button type="button" onClick={() => begin({ kind: 'enable-password' })}>
          {t('mfa.enable')}
        </button>
      )}
      {flow.kind === 'idle' && status.totpEnabled && (
        <p>
          <button type="button" onClick={() => begin({ kind: 'regenerate' })}>
            {t('mfa.newCodes')}
          </button>{' '}
          <button type="button" onClick={() => begin({ kind: 'disable' })}>
            {t('mfa.disable')}
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
            {t('mfa.continue')}
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
          <p>{t('mfa.scan')}</p>
          <img src={qrDataUrl(flow.uri)} alt={t('mfa.qrAlt')} width={200} height={200} />
          <p>
            {t('mfa.key')}
            <code>{flow.secret.match(/.{1,4}/g)?.join(' ')}</code>
          </p>
          <SecondFactorInput mode="code" value={factor} onChange={setFactor} onModeChange={() => undefined} />
          {errorLine}
          <button type="submit" disabled={busy}>
            {t('mfa.confirmEnable')}
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
            {t('mfa.confirmDisable')}
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
          <p>{t('mfa.oldCodesStop')}</p>
          {passwordField}
          {errorLine}
          <button type="submit" disabled={busy}>
            {t('mfa.createCodes')}
          </button>{' '}
          {cancel}
        </form>
      )}
    </section>
  );
}
