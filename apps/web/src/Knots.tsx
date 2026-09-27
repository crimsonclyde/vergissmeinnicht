import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, messageFor, type KnotInfo, type KnotTargetType } from './api.ts';
import { Link, navigate, paths } from './router.tsx';

const TARGET_NOUN: Record<KnotTargetType, string> = { PROCEDURE: 'Procedure', RUN: 'Run' };
const STATUS_TEXT: Record<KnotInfo['status'], string> = { ACTIVE: 'Active', EXPIRED: 'Expired', REVOKED: 'Revoked' };
/** Lifetime choices in days; `null` = does not expire. */
const LIFETIMES: readonly { readonly days: number | null; readonly label: string }[] = [
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: 365, label: '1 year' },
  { days: null, label: 'Does not expire' },
];

/**
 * "Share as Knot link" for a Procedure or Run (editors and admins). The link is shown once: only
 * its hash is stored. Opening it still requires signing in with access to the target.
 */
export function KnotShare(props: { workspaceId: string; target: { type: KnotTargetType; id: string }; defaultLabel: string }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(props.defaultLabel.slice(0, 80));
  const [days, setDays] = useState<string>('30');
  const [link, setLink] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const linkRef = useRef<HTMLInputElement>(null);
  const noun = TARGET_NOUN[props.target.type];

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
      setMessage('Link copied.');
    } catch {
      linkRef.current?.select();
      setMessage('Copying is not available here; the link is selected so you can copy it yourself.');
    }
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}>
        Share as Knot link…
      </button>
    );
  }
  return (
    <section aria-label={`Knot link for this ${noun}`} className="card stack">
      <h3 style={{ marginTop: 0 }}>Knot link for this {noun}</h3>
      {link === null ? (
        <form className="stack" onSubmit={(event) => void submit(event)}>
          <p className="muted" style={{ margin: 0 }}>
            A Knot link opens this {noun} directly. It does not give access: whoever opens it must sign in and be allowed to see it.
          </p>
          <label>
            Name of the link
            <br />
            <input value={label} maxLength={80} required onChange={(e) => setLabel(e.target.value)} />
          </label>
          <label>
            Valid for
            <br />
            <select value={days} onChange={(e) => setDays(e.target.value)}>
              {LIFETIMES.map((lifetime) => (
                <option key={lifetime.label} value={lifetime.days === null ? 'never' : String(lifetime.days)}>
                  {lifetime.label}
                </option>
              ))}
            </select>
          </label>
          <div className="row">
            <button type="submit" className="primary" disabled={busy}>
              Create Knot link
            </button>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="stack">
          <label>
            Knot link (shown only now — copy it before closing)
            <br />
            <input ref={linkRef} readOnly value={link} onFocus={(e) => e.target.select()} style={{ width: '100%' }} />
          </label>
          <div className="row">
            <button type="button" className="primary" onClick={() => void copy()}>
              Copy link
            </button>
            <button
              type="button"
              onClick={() => {
                setLink(null);
                setOpen(false);
                setMessage(null);
              }}
            >
              Done
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
    if (!window.confirm(`Revoke the Knot link “${knot.label}”? It stops working for everyone and cannot be restored.`)) return;
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
        <h2 id="knots-heading">Knot links</h2>
        <span className="muted">Links that open a Procedure or Run directly. Create them from a Procedure or Run.</span>
      </div>
      {message !== null && <p role="alert">{message}</p>}
      {knots === null ? (
        message === null && <p>Loading…</p>
      ) : knots.length === 0 ? (
        <p className="card">No Knot links yet.</p>
      ) : (
        <div className="card table-wrap">
          <table aria-label="Knot links">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Opens</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
                <th scope="col">Expires</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {knots.map((knot) => (
                <tr key={knot.id}>
                  <td>{knot.label}</td>
                  <td>
                    {TARGET_NOUN[knot.target.type]}:{' '}
                    {knot.target.available ? (
                      <Link href={targetPath(workspaceId, knot.target)}>{knot.target.title ?? ''}</Link>
                    ) : (
                      <>{knot.target.title} (deleted)</>
                    )}
                  </td>
                  <td>
                    {STATUS_TEXT[knot.status]}
                    {knot.revoked !== null && ` by ${knot.revoked.by} on ${new Date(knot.revoked.at).toLocaleString()}`}
                  </td>
                  <td>
                    {knot.createdBy}, {new Date(knot.createdAt).toLocaleString()}
                  </td>
                  <td>{knot.expiresAt === null ? 'Never' : new Date(knot.expiresAt).toLocaleString()}</td>
                  <td>
                    {knot.revoked === null && (
                      <button type="button" onClick={() => void revoke(knot)}>
                        Revoke {knot.label}
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
  if (failure === null) return <p>Opening Knot link…</p>;
  return (
    <div className="card stack">
      <h2 style={{ marginTop: 0 }}>Knot link cannot be opened</h2>
      <p role="alert">{failure}</p>
      <p>
        <Link href="/">Go to the start page</Link>
      </p>
    </div>
  );
}
