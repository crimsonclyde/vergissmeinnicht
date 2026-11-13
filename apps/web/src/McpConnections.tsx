import {useEffect,useState} from 'react';
import type {McpScope} from '@vergissmeinnicht/domain';
import {api,messageFor,type WorkspaceSummary,type McpAdminConnection,type McpConsent} from './api.ts';
import {t,formatDateTime,type MessageKey} from './i18n/index.ts';
import {McpDiagnostics} from './McpDiagnostics.tsx';
import {McpFileHosts} from './McpFileHosts.tsx';
import {UiIcon,type UiIconName} from './ui-icons.tsx';
import './mcp-connections.css';

type Permission = {
  label: MessageKey;
  icon: UiIconName;
  read?: McpScope;
  readLabel?: MessageKey;
  write?: McpScope;
  writeLabel?: MessageKey;
  readWriteLabel?: MessageKey;
};

const permissions:readonly Permission[] = [
  {label:'mcp.workspaces',icon:'grid',read:'workspaces.read',readLabel:'mcp.readWorkspace'},
  {label:'mcp.procedures',icon:'procedures',read:'procedures.read',write:'procedures.write',writeLabel:'mcp.addSteps'},
  {label:'mcp.runs',icon:'check',read:'runs.read',write:'runs.write',writeLabel:'mcp.markSteps'},
  {label:'mcp.lists',icon:'lists',read:'lists.read',write:'lists.write',writeLabel:'mcp.addGroceries',readWriteLabel:'mcp.readAndAddGroceries'},
  {label:'mcp.todos',icon:'checklist',read:'todos.read',write:'todos.write',writeLabel:'mcp.manageTodos',readWriteLabel:'mcp.readAndManageTodos'},
  {label:'mcp.calendar',icon:'calendar',read:'calendar.read',write:'calendar.write',writeLabel:'mcp.addReminders',readWriteLabel:'mcp.readAndAddReminders'},
  {label:'mcp.notes',icon:'notebook',read:'notes.read',write:'notes.write',writeLabel:'mcp.writeNotes',readWriteLabel:'mcp.readAndWriteNotes'},
  {label:'mcp.listCovers',icon:'photo',write:'lists.covers.write',writeLabel:'mcp.manageListCovers'},
  {label:'mcp.recipes',icon:'grocery',read:'recipes.read',write:'recipes.write',writeLabel:'mcp.saveRecipes'},
];

function permissionOptions({read,write,readLabel,writeLabel,readWriteLabel}:Permission, requested:readonly McpScope[]) {
  const options = [{value:'none',label:t('mcp.noAccess'),scopes:[] as McpScope[]}];
  const canRead = read !== undefined && requested.includes(read);
  if (canRead) options.push({value:'read',label:t(readLabel ?? 'mcp.read'),scopes:[read]});
  if (write && writeLabel && requested.includes(write)) {
    if (canRead) options.push({
      value:'read-write',label:t(readWriteLabel ?? 'mcp.readAndWrite',{action:t(writeLabel)}),scopes:[read,write],
    });
    options.push({value:'write',label:t('mcp.writeOnly',{action:t(writeLabel)}),scopes:[write]});
  }
  return options;
}

function permissionValue({read,write}:Permission, scopes:readonly McpScope[]) {
  const canRead = read !== undefined && scopes.includes(read);
  if (write && scopes.includes(write)) return canRead ? 'read-write' : 'write';
  return canRead ? 'read' : 'none';
}

/** Short words for what a connection may do in one area: read, change, or both. */
function accessWord(permission:Permission, scopes:readonly McpScope[]):MessageKey|null {
  const value = permissionValue(permission,scopes);
  if (value === 'none') return null;
  return value === 'read' ? 'mcp.short.read' : value === 'write' ? 'mcp.short.write' : 'mcp.short.readWrite';
}

type State = 'mcp.revoked'|'mcp.expired'|'mcp.authorized'|'mcp.waitingForClient';
function connectionState(connection:McpAdminConnection,checkedAt:number):State {
  if (connection.revokedAt) return 'mcp.revoked';
  if (Date.parse(connection.expiresAt) <= checkedAt) return 'mcp.expired';
  return connection.tokenIssued ? 'mcp.authorized' : 'mcp.waitingForClient';
}

/**
 * Server admin → AI connections (36.24). Since this release only server admins allow a connection, so
 * the consent screen lives here too. Every connection on the server is listed with who it acts for;
 * any can be ended. A connection cannot be edited (grants are immutable): to change it, connect again.
 */
export function McpConnections({workspaces,currentUserId}:{workspaces:readonly WorkspaceSummary[]|null;currentUserId:string}) {
  const [connections,setConnections] = useState<McpAdminConnection[]>([]);
  const [checkedAt,setCheckedAt] = useState(() => Date.now());
  const [consent,setConsent] = useState<McpConsent|null>(null);
  const [enabled,setEnabled] = useState<boolean|null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [selected,setSelected] = useState<string[]>([]);
  const [scopes,setScopes] = useState<McpScope[]>([]);
  const [confirmDisconnect,setConfirmDisconnect] = useState<string|null>(null);
  const [showAllEnded,setShowAllEnded] = useState(false);

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const status = await api.mcpStatus();
        if (!live) return;
        setEnabled(status.enabled);
        if (!status.enabled) return;
        const id = new URLSearchParams(window.location.search).get('request');
        if (id) {
          const request = await api.mcpConsent(id);
          if (!live) return;
          setConsent(request);
          setScopes(request.scopes.filter(scope => scope.endsWith('.read')));
        }
        const result = await api.mcpAdminConnections();
        if (live) {
          setConnections(result.connections);
          setCheckedAt(Date.now());
        }
      } catch (error) {
        if (live) setError(messageFor(error));
      }
    }
    void load();
    return () => { live = false; };
  },[]);

  async function decide(allow:boolean) {
    if (!consent) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.mcpApprove({
        requestId:consent.id,allow,workspaceIds:allow ? selected : [],scopes:allow ? scopes : [],
      });
      window.location.assign(result.redirect);
    } catch (error) {
      setError(messageFor(error));
      setBusy(false);
    }
  }

  async function disconnect(id:string) {
    setBusy(true);
    setError('');
    try {
      await api.mcpAdminRevoke(id);
      setConnections(current => current.map(connection =>
        connection.id === id ? {...connection,revokedAt:new Date().toISOString()} : connection));
      setConfirmDisconnect(null);
    } catch (error) {
      setError(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  const isLive = (connection:McpAdminConnection) => !connection.revokedAt && Date.parse(connection.expiresAt) > checkedAt;
  const liveConnections = connections.filter(isLive);
  // Most recently ended first, so a connection just disconnected shows at the top of the list.
  const endedAt = (connection:McpAdminConnection) => Date.parse(connection.revokedAt ?? connection.expiresAt);
  const ended = connections.filter(connection => !isLive(connection)).sort((a,b) => endedAt(b)-endedAt(a));
  const shownEnded = showAllEnded ? ended : ended.slice(0,3);

  function row(connection:McpAdminConnection) {
    const state = connectionState(connection,checkedAt);
    const live = isLive(connection);
    const areas = permissions.flatMap(permission => {
      const word = accessWord(permission,connection.scopes);
      return word === null ? [] : [{permission,word}];
    });
    const names = connection.workspaces.map(workspace => workspace.name ?? t('mcp.unavailableWorkspace'));
    return <li key={connection.id} className="mcp-connection" data-state={live ? 'live' : 'ended'}>
      <div className="mcp-connection-head">
        <span className="area-row-icon" aria-hidden="true"><UiIcon name={live ? 'connected' : 'unlink'} /></span>
        <div className="item-body">
          <strong>{connection.clientName}</strong>
          <small className="muted">
            {connection.owner.id === currentUserId ? t('mcp.actsAsYou') : t('mcp.actsAs',{name:connection.owner.displayName})}
            {' · '}{names.join(', ')}
          </small>
        </div>
        <span className="mcp-state" data-state={state}>{t(state)}</span>
        {live && confirmDisconnect !== connection.id && <button type="button" className="quiet icon-button" disabled={busy}
          aria-label={t('mcp.disconnectNamed',{client:connection.clientName})} title={t('mcp.disconnect')}
          onClick={() => setConfirmDisconnect(connection.id)}><UiIcon name="unlink" /></button>}
      </div>
      {live && <ul className="plain-list mcp-areas" aria-label={t('mcp.access')}>
        {areas.map(({permission,word}) => <li key={permission.label}>
          <UiIcon name={permission.icon} size={16} /><span>{t(permission.label)}</span><small>{t(word)}</small>
        </li>)}
      </ul>}
      {live && <p className="muted mcp-expiry"><UiIcon name="clock" size={14} /> {t('mcp.expiry',{date:formatDateTime(connection.expiresAt)})}</p>}
      {confirmDisconnect === connection.id && <div className="mcp-confirm" role="group" aria-label={t('mcp.disconnect')}>
        <p>{t('mcp.disconnectHint')}</p>
        <div className="button-row">
          <button type="button" className="danger" disabled={busy} onClick={() => void disconnect(connection.id)}>{t('mcp.disconnect')}</button>
          <button type="button" disabled={busy} onClick={() => setConfirmDisconnect(null)}>{t('mcp.keepConnection')}</button>
        </div>
      </div>}
    </li>;
  }

  return <section className="area mcp-connections" aria-labelledby="mcp-heading">
    <header className="area-head">
      <div className="area-title">
        <p className="area-eyebrow"><UiIcon name="assistant" size={16} /> {t('admin.heading')}</p>
        <h2 id="mcp-heading" className="area-heading">
          {t('admin.section.connections')}
          {enabled === true && !consent && <> <span className="area-heading-muted">{liveConnections.length}</span></>}
        </h2>
      </div>
      {enabled !== null && <span className="mcp-server-state" data-on={enabled}>{t(enabled ? 'mcp.on' : 'mcp.off')}</span>}
    </header>
    <p className="area-lead">{t('mcp.intro')}</p>
    {error && <p role="alert">{error}</p>}
    {enabled === null && !error && <p role="status">{t('mcp.loading')}</p>}
    {enabled === false && <p className="card">{t('mcp.disabled')}</p>}

    {consent && <form className="card stack mcp-consent" onSubmit={event => { event.preventDefault(); void decide(true); }}>
      <div className="mcp-connection-head">
        <span className="area-row-icon" aria-hidden="true"><UiIcon name="assistant" /></span>
        <div className="item-body">
          <h3>{t('mcp.connectClient',{client:consent.clientName})}</h3>
          <small className="muted">{t('mcp.returnTo',{origin:consent.redirectOrigin})}</small>
        </div>
      </div>
      <fieldset className="stack" disabled={busy}>
        <legend className="area-group">{t('mcp.chooseWorkspaces')}</legend>
        {workspaces?.length === 0 && <p>{t('mcp.noWorkspaces')}</p>}
        <ul className="plain-list area-rows">
          {workspaces?.map(workspace => <li key={workspace.id}>
            <label className="area-row mcp-pick">
              <span className="area-row-icon" aria-hidden="true"><UiIcon name="grid" /></span>
              <span className="item-body"><strong>{workspace.name}</strong></span>
              <input type="checkbox" className="switch" checked={selected.includes(workspace.id)}
                aria-label={workspace.name}
                disabled={selected.length >= 32 && !selected.includes(workspace.id)}
                onChange={event => {
                  const checked = event.currentTarget.checked;
                  setSelected(current => checked ? [...current,workspace.id] : current.filter(id => id !== workspace.id));
                }} />
            </label>
          </li>)}
        </ul>
      </fieldset>
      <fieldset className="stack" disabled={busy}>
        <legend className="area-group">{t('mcp.chooseAccess')}</legend>
        <ul className="plain-list area-rows">
          {permissions.map(permission => {
            const options = permissionOptions(permission,consent.scopes);
            if (options.length === 1) return null;
            const value = permissionValue(permission,scopes);
            const id = 'mcp-permission-'+permission.label.replace(/\W/g,'-');
            return <li key={permission.label} className="area-row mcp-permission">
              <span className="area-row-icon" aria-hidden="true"><UiIcon name={permission.icon} /></span>
              <label className="item-body" htmlFor={id}><strong>{t(permission.label)}</strong></label>
              <select id={id} value={value} data-access={value} onChange={event => {
                const next = options.find(option => option.value === event.currentTarget.value);
                if (next) setScopes(current => [
                  ...current.filter(scope => scope !== permission.read && scope !== permission.write),...next.scopes,
                ]);
              }}>
                {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </li>;
          })}
        </ul>
        <p className="muted mcp-hint">{t('mcp.accessHint')}</p>
      </fieldset>
      <div className="button-row">
        <button className="primary" disabled={busy || !selected.length || !scopes.length}><UiIcon name="check" /> {t('mcp.allow')}</button>
        <button type="button" disabled={busy} onClick={() => void decide(false)}>{t('mcp.decline')}</button>
      </div>
    </form>}

    {enabled === true && !consent && <>
      {liveConnections.length === 0 && <>
        <h3 className="area-group">{t('mcp.getStarted')}</h3>
        <ol className="plain-list area-rows mcp-steps">
          {(['mcp.setupTunnel','mcp.setupClient','mcp.setupConsent'] as const).map((key,index) => <li key={key} className="area-row">
            <span className="area-row-icon" aria-hidden="true">{index + 1}</span>
            <span className="item-body">{t(key)}</span>
          </li>)}
        </ol>
      </>}
      {liveConnections.length > 0 && <>
        <h3 className="area-group">{t('mcp.connected')}</h3>
        <ul className="plain-list area-rows mcp-list">{liveConnections.map(row)}</ul>
      </>}
      {ended.length > 0 && <>
        <h3 className="area-group">{t('mcp.ended')}</h3>
        <ul className="plain-list area-rows mcp-list">{shownEnded.map(row)}</ul>
        {ended.length > shownEnded.length && <div className="area-more">
          <button type="button" className="area-round" onClick={() => setShowAllEnded(true)}
            aria-label={t('mcp.showAllEnded',{count:ended.length})} title={t('mcp.showAllEnded',{count:ended.length})}><UiIcon name="expand" /></button>
        </div>}
      </>}
      <McpFileHosts />
    </>}
    {!consent && enabled !== null && <McpDiagnostics enabled={enabled} />}
  </section>;
}
