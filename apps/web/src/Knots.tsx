import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, messageFor, type KnotInfo, type KnotTargetType } from './api.ts';
import { formatDateTime, t } from './i18n/index.ts';
import { Link, navigate, paths } from './router.tsx';

/** Lifetime choices in days; `never` = does not expire. */
const LIFETIMES = ['1', '7', '30', '90', '365', 'never'] as const;

/**
 * "Share as Knot link" for a Procedure or Run (editors and admins). The link is shown once: only
 * its hash is stored. Opening it still requires signing in with access to the target.
 */
export function KnotShare(props: {
  workspaceId: string;
  target: { type: KnotTargetType; id: string };
  defaultLabel: string;
  /** Opened from a ⋯ menu: show the form right away; `onDone` closes the whole panel. */
  initiallyOpen?: boolean;
  onDone?: () => void;
}) {
  const [open, setOpenState] = useState(props.initiallyOpen === true);
  const setOpen = (next: boolean) => {
    setOpenState(next);
    if (!next) props.onDone?.();
  };
  const [label, setLabel] = useState(props.defaultLabel.slice(0, 80));
  const [days, setDays] = useState<string>('30');
  const [link, setLink] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const noun = t(`knot.target.${props.target.type}`);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const created = await api.createKnot(props.workspaceId, {
        target: props.target,
        label,
        expiresInDays: days === 'never' ? null : Number(days),
      });
      setLink(created.url);
    } catch (caught) {
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link ?? '');
      setMessage(t('knot.copied'));
    } catch {
      linkRef.current?.select();
      setMessage(t('knot.copyUnavailable'));
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        {t('knot.share')}
      </button>
    );
  }
  return (
    <section aria-label={t('knot.shareHeading', { target: noun })} className="card stack">
      <h3 style={{ marginTop: 0 }}>{t('knot.shareHeading', { target: noun })}</h3>
      {link === null ? (
        <form className="stack" onSubmit={(event) => void submit(event)}>
          <p className="muted" style={{ margin: 0 }}>
            {t('knot.shareExplain', { target: noun })}
          </p>
          <label>
            {t('knot.name')}
            <br />
            <input value={label} maxLength={80} required onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label>
            {t('knot.validFor')}
            <br />
            <select value={days} onChange={(e) => setDays(e.target.value)}>
              {LIFETIMES.map((lifetime) => (
                <option key={lifetime} value={lifetime}>
                  {t(`knot.lifetime.${lifetime}`)}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <button type="submit" className="primary" disabled={busy}>
              {t('knot.create')}
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      ) : (
        <div className="stack">
          <label>
            {t('knot.link')}
            <br />
            <input ref={linkRef} readOnly value={link} onFocus={(e) => e.target.select()} style={{ width: '100%' }} />
          </label>
          <div className="row">
            <button type="button" className="primary" onClick={() => void copy()}>
              {t('knot.copy')}
            </button>
            <button
              type="button"
              onClick={() => {
                setLink(null);
                setOpen(false);
                setMessage(null);
              }}
            >
              {t('knot.done')}
            </button>
          </div>
        </div>
      )}
      {message !== null && <p role="status">{message}</p>}
    </section>
  );
}

function targetPath(workspaceId: string, target: { type: KnotTargetType; id: string }): string {
  return target.type === 'RUN' ? paths.run(workspaceId, target.id) : paths.procedure(workspaceId, target.id);
}

/** Management list of a Workspace's Knot links (editors and admins; the server decides). */
export function KnotsPage({ workspaceId }: { workspaceId: string }) {
  const [knots, setKnots] = useState<KnotInfo[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api.knots(workspaceId).then(setKnots, (caught: unknown) => setMessage(messageFor(caught)));
  }, [workspaceId]);
  useEffect(refresh, [refresh]);

  async function revoke(knot: KnotInfo) {
    if (!window.confirm(t('knot.revokeConfirm', { label: knot.label }))) return;
    setMessage(null);
    try {
      await api.revokeKnot(workspaceId, knot.id);
    } catch (caught) {
      setMessage(messageFor(caught));
    }
    refresh();
  }

  return (
    <section aria-labelledby="knots-heading">
      <div className="page-header">
        <h2 id="knots-heading">{t('knot.pageHeading')}</h2>
        <span className="muted">{t('knot.pageHint')}</span>
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {knots === null ? (
        message === null && <p>{t('common.loading')}</p>
      ) : knots.length === 0 ? (
        <p className="card">{t('knot.none')}</p>
      ) : (
        <div className="card table-wrap">
          <table aria-label={t('knot.pageHeading')}>
            <thead>
              <tr>
                <th scope="col">{t('knot.column.name')}</th>
                <th scope="col">{t('knot.column.opens')}</th>
                <th scope="col">{t('knot.column.status')}</th>
                <th scope="col">{t('knot.column.created')}</th>
                <th scope="col">{t('knot.column.expires')}</th>
                <th scope="col">
                  <span className="visually-hidden">{t('knot.column.actions')}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {knots.map((knot) => (
                <tr key={knot.id}>
                  <td>{knot.label}</td>
                  <td>
                    {t('knot.opens', { target: t(`knot.target.${knot.target.type}`) })}
                    {knot.target.available ? (
                      <Link href={targetPath(workspaceId, knot.target)}>{knot.target.title ?? ''}</Link>
                    ) : (
                      t('knot.deleted', { title: knot.target.title ?? '' })
                    )}
                  </td>
                  <td>
                    {knot.revoked !== null
                      ? t('knot.revokedBy', { name: knot.revoked.by, time: formatDateTime(knot.revoked.at) })
                      : t(`knot.status.${knot.status}`)}
                  </td>
                  <td>
                    {t('knot.created', { name: knot.createdBy, time: formatDateTime(knot.createdAt) })}
                  </td>
                  <td>{knot.expiresAt === null ? t('knot.never') : formatDateTime(knot.expiresAt)}</td>
                  <td>
                    {knot.revoked === null && (
                      <button type="button" onClick={() => void revoke(knot)}>
                        {t('knot.revoke', { label: knot.label })}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/**
 * `/knot/{token}` after sign-in: asks the server where the link points (token in the request
 * body) and replaces the history entry with the target, so the token leaves the address bar.
 */
export function KnotOpener({ token }: { token: string }) {
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    api.resolveKnot(token).then(
      (resolved) => active && navigate(targetPath(resolved.workspaceId, resolved.target), { replace: true }),
      (caught: unknown) => active && setFailure(messageFor(caught)),
    );
    return () => {
      active = false;
    };
  }, [token]);
  if (failure === null) return <p>{t('knot.opening')}</p>;
  return (
    <div className="card stack">
      <h2 style={{ marginTop: 0 }}>{t('knot.cannotOpen')}</h2>
      <p role="alert">{failure}</p>
      <p>
        <Link href="/">{t('common.startPage')}</Link>
      </p>
    </div>
  );
}
