import {useEffect,useState} from 'react';
import type {McpScope} from '@vergissmeinnicht/domain';
import {api,messageFor,type WorkspaceSummary,type McpConnection,type McpConsent} from './api.ts';
import {t,formatDateTime,type MessageKey} from './i18n/index.ts';
import {McpDiagnostics} from './McpDiagnostics.tsx';
import './mcp-connections.css';

type Permission = {
  label: MessageKey;
  read?: McpScope;
  readLabel?: MessageKey;
  write?: McpScope;
  writeLabel?: MessageKey;
  readWriteLabel?: MessageKey;
};

const permissions:readonly Permission[] = [
  {label:'mcp.workspaces',read:'workspaces.read',readLabel:'mcp.readWorkspace'},
  {label:'mcp.procedures',read:'procedures.read',write:'procedures.write',writeLabel:'mcp.addSteps'},
  {label:'mcp.runs',read:'runs.read',write:'runs.write',writeLabel:'mcp.markSteps'},
  {label:'mcp.lists',read:'lists.read',write:'lists.write',writeLabel:'mcp.addGroceries',readWriteLabel:'mcp.readAndAddGroceries'},
  {label:'mcp.todos',read:'todos.read',write:'todos.write',writeLabel:'mcp.manageTodos',readWriteLabel:'mcp.readAndManageTodos'},
  {label:'mcp.listCovers',write:'lists.covers.write',writeLabel:'mcp.manageListCovers'},
  {label:'mcp.recipes',read:'recipes.read',write:'recipes.write',writeLabel:'mcp.saveRecipes'},
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

function connectionState(connection:McpConnection,checkedAt:number) {
  if (connection.revokedAt) return 'mcp.revoked';
  if (Date.parse(connection.expiresAt) <= checkedAt) return 'mcp.expired';
  return connection.tokenIssued ? 'mcp.authorized' : 'mcp.waitingForClient';
}

export function McpConnections({workspaces}:{workspaces:readonly WorkspaceSummary[]|null}) {
  const [connections,setConnections] = useState<McpConnection[]>([]);
  const [checkedAt,setCheckedAt] = useState(() => Date.now());
  const [consent,setConsent] = useState<McpConsent|null>(null);
  const [enabled,setEnabled] = useState<boolean|null>(null);
  const [error,setError] = useState('');
  const [busy,setBusy] = useState(false);
  const [selected,setSelected] = useState<string[]>([]);
  const [scopes,setScopes] = useState<McpScope[]>([]);
  const [confirmDisconnect,setConfirmDisconnect] = useState<string|null>(null);

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
        const result = await api.mcpConnections();
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
      await api.mcpRevoke(id);
      setConnections(current => current.map(connection =>
        connection.id === id ? {...connection,revokedAt:new Date().toISOString()} : connection));
      setConfirmDisconnect(null);
    } catch (error) {
      setError(messageFor(error));
    } finally {
      setBusy(false);
    }
  }

  const liveConnections = connections.filter(connection => !connection.revokedAt && Date.parse(connection.expiresAt) > checkedAt);
  return <section className="card stack mcp-connections">
    <h2>{t('account.section.connections')}</h2>
    <p>{t('mcp.intro')}</p>
    {error && <p role="alert">{error}</p>}
    {enabled === null && !error && <p role="status">{t('mcp.loading')}</p>}
    {enabled === false && <p>{t('mcp.disabled')}</p>}
    {consent && <form className="stack" onSubmit={event => { event.preventDefault(); void decide(true); }}>
      <h3>{t('mcp.connectClient',{client:consent.clientName})}</h3>
      <p>{t('mcp.returnTo',{origin:consent.redirectOrigin})}</p>
      <fieldset className="stack" disabled={busy}>
        <legend>{t('mcp.chooseWorkspaces')}</legend>
        {workspaces?.length === 0 && <p>{t('mcp.noWorkspaces')}</p>}
        {workspaces?.map(workspace => <label className="mcp-workspace" key={workspace.id}>
          <input type="checkbox" checked={selected.includes(workspace.id)}
            disabled={selected.length >= 32 && !selected.includes(workspace.id)}
            onChange={event => {
              const checked = event.currentTarget.checked;
              setSelected(current => checked ? [...current,workspace.id] : current.filter(id => id !== workspace.id));
            }} />
          {workspace.name}
        </label>)}
      </fieldset>
      <fieldset className="stack" disabled={busy}>
        <legend>{t('mcp.chooseAccess')}</legend>
        <p>{t('mcp.accessHint')}</p>
        {permissions.map(permission => {
          const options = permissionOptions(permission,consent.scopes);
          if (options.length === 1) return null;
          const value = permissionValue(permission,scopes);
          return <label className="mcp-permission" key={permission.label}>
            <span>{t(permission.label)}</span>
            <select value={value} onChange={event => {
              const next = options.find(option => option.value === event.currentTarget.value);
              if (next) setScopes(current => [
                ...current.filter(scope => scope !== permission.read && scope !== permission.write),...next.scopes,
              ]);
            }}>
              {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>;
        })}
      </fieldset>
      <div className="button-row">
        <button disabled={busy || !selected.length || !scopes.length}>{t('mcp.allow')}</button>
        <button type="button" disabled={busy} onClick={() => void decide(false)}>{t('mcp.decline')}</button>
      </div>
    </form>}
    {enabled === true && !consent && <>
      {liveConnections.length === 0 && <section className="stack">
        <h3>{t('mcp.getStarted')}</h3>
        <ol>
          <li>{t('mcp.setupTunnel')}</li>
          <li>{t('mcp.setupClient')}</li>
          <li>{t('mcp.setupConsent')}</li>
        </ol>
      </section>}
      <h3>{t('mcp.yourConnections')}</h3>
      {!connections.length && <p>{t('mcp.none')}</p>}
      <ul className="plain-list stack">{connections.map(connection => {
        const state = connectionState(connection,checkedAt);
        return <li key={connection.id} className="stack mcp-connection">
          <h4>{connection.clientName}</h4>
          <p>{t(state)}</p>
          <p>{connection.workspaceIds.map(id => workspaces?.find(workspace => workspace.id === id)?.name ?? t('mcp.unavailableWorkspace')).join(', ')}</p>
          <ul>{permissions.map(permission => {
            const option = permissionOptions(permission,connection.scopes)
              .find(option => option.value === permissionValue(permission,connection.scopes));
            return option && option.value !== 'none' && <li key={permission.label}>{t(permission.label)} · {option.label}</li>;
          })}</ul>
          {liveConnections.includes(connection) && <>
            <p>{t('mcp.expiry',{date:formatDateTime(connection.expiresAt)})}</p>
            {confirmDisconnect === connection.id ? <>
              <p>{t('mcp.disconnectHint')}</p>
              <div className="button-row">
                <button type="button" disabled={busy} onClick={() => void disconnect(connection.id)}>{t('mcp.disconnect')}</button>
                <button type="button" disabled={busy} onClick={() => setConfirmDisconnect(null)}>{t('mcp.keepConnection')}</button>
              </div>
            </> : <button type="button" disabled={busy} onClick={() => setConfirmDisconnect(connection.id)}>{t('mcp.manageAccess')}</button>}
          </>}
        </li>;
      })}</ul>
    </>}
    {!consent && enabled !== null && <McpDiagnostics enabled={enabled} />}
  </section>;
}
