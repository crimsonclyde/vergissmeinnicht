import { useEffect, useState } from 'react';
import { api, messageFor } from './api.ts';
import { TOOL_PLUGINS, type ToolPlugin } from './tool-registry.ts';
import { UiIcon } from './ui-icons.tsx';
import type { WorkspaceContext } from './workspace-context.ts';
import { t } from './i18n/index.ts';

/**
 * Workspace settings → Plugins, for Workspace admins: one tile per tool from the registry with an on/off
 * switch. A tool switched on appears for every member; switched off it is hidden for everyone and its
 * content is kept. There is no personal hiding.
 */
export function PluginsPage(props: { context: WorkspaceContext; onChanged: () => void }) {
  const { context } = props;
  const [status, setStatus] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  // Shown at once; put back if the server refuses.
  const [on, setOn] = useState<readonly string[]>(context.tools);
  const [revision, setRevision] = useState(context.toolsRevision);
  const [receivedRevision, setReceivedRevision] = useState(context.toolsRevision);
  if (receivedRevision !== context.toolsRevision) {
    setReceivedRevision(context.toolsRevision);
    setRevision(context.toolsRevision);
    setOn(context.tools);
  }
  async function set(plugin: ToolPlugin, enabled: boolean) {
    const name = plugin.name();
    if (!enabled && plugin.confirmOff === true && !window.confirm(t('tools.stopNotifications', { tool: name }))) return;
    const before = on;
    setBusy(true);
    setMessage(null);
    setOn(enabled ? [...on, plugin.tool] : on.filter((each) => each !== plugin.tool));
    try {
      const result = await api.setWorkspaceTool(context.workspace.id, plugin.tool, enabled, revision);
      setOn(result.tools);
      setRevision(result.revision);
      setStatus(t(enabled ? 'tools.on' : 'tools.off', { tool: name }));
      props.onChanged();
    } catch (caught) {
      setOn(before);
      setStatus(null);
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="stack" aria-labelledby="plugins-heading">
      <h3 id="plugins-heading" style={{ margin: 0 }}>
        {t('workspaceSettings.plugins')}
      </h3>
      <p className="muted" style={{ margin: 0 }}>
        {t('tools.hint')}
      </p>
      {message !== null && <p role="alert">{message}</p>}
      <ul className="plugin-grid">
        {TOOL_PLUGINS.map((plugin) => {
          const name = plugin.name();
          const checked = on.includes(plugin.tool);
          const hintId = `plugin-${plugin.tool}-hint`;
          return (
            <li key={plugin.tool} className={`card plugin-tile${checked ? ' plugin-on' : ''}`}>
              <label className="plugin-switch">
                <span className="plugin-icon">
                  <UiIcon name={plugin.icon} size="1.5rem" />
                </span>
                <strong className="plugin-name">{name}</strong>
                <input type="checkbox" className="switch" checked={checked} disabled={busy} aria-describedby={hintId} onChange={(event) => void set(plugin, event.target.checked)} />
              </label>
              <button type="button" className="icon-button plugin-info" aria-expanded={open === plugin.tool} aria-controls={hintId} aria-label={t('plugins.about', { tool: name })} title={t('plugins.about', { tool: name })} onClick={() => setOpen(open === plugin.tool ? null : plugin.tool)}>
                <UiIcon name="info" />
              </button>
              <small id={hintId} className={open === plugin.tool ? 'muted plugin-hint' : 'visually-hidden'}>
                {plugin.hint()}
              </small>
            </li>
          );
        })}
      </ul>
      <AiAssistantsTile workspaceId={context.workspace.id} />
      <p role="status" style={{ margin: 0 }}>
        {status ?? ''}
      </p>
    </section>
  );
}

/** 45.11: "AI assistants allowed" for the whole Workspace — on by default; off keeps every MCP connection out. */
function AiAssistantsTile(props: { workspaceId: string }) {
  const { workspaceId } = props;
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    api.aiAssistants(workspaceId).then(setAllowed, (caught: unknown) => setMessage(messageFor(caught)));
  }, [workspaceId]);
  async function set(next: boolean) {
    const before = allowed;
    setBusy(true);
    setMessage(null);
    setAllowed(next);
    try {
      setAllowed(await api.setAiAssistants(workspaceId, next));
    } catch (caught) {
      setAllowed(before);
      setMessage(messageFor(caught));
    } finally {
      setBusy(false);
    }
  }
  const name = t('aiAssistants.name');
  return (
    <ul className="plugin-grid">
      <li className={`card plugin-tile${allowed === true ? ' plugin-on' : ''}`}>
        <label className="plugin-switch">
          <span className="plugin-icon">
            <UiIcon name="assistant" size="1.5rem" />
          </span>
          <strong className="plugin-name">{name}</strong>
          <input type="checkbox" className="switch" checked={allowed === true} disabled={busy || allowed === null} aria-describedby="plugin-ai-hint" onChange={(event) => void set(event.target.checked)} />
        </label>
        <button type="button" className="icon-button plugin-info" aria-expanded={open} aria-controls="plugin-ai-hint" aria-label={t('plugins.about', { tool: name })} title={t('plugins.about', { tool: name })} onClick={() => setOpen(!open)}>
          <UiIcon name="info" />
        </button>
        <small id="plugin-ai-hint" className={open ? 'muted plugin-hint' : 'visually-hidden'}>
          {t('aiAssistants.hint')}
        </small>
        {message !== null && <p role="alert">{message}</p>}
      </li>
    </ul>
  );
}
