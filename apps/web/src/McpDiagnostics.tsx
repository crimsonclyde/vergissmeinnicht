import {useState} from 'react';
import {api} from './api.ts';
import {t} from './i18n/index.ts';
import {UiIcon} from './ui-icons.tsx';

const setupGuide = 'https://github.com/crimsonclyde/vergissmeinnicht/blob/main/docs/admin/chatgpt-mcp-tunnel.md';

async function check(path:string,metadata = false):Promise<{status:number|null;body:Record<string,unknown>}> {
  try {
    const response = await fetch(path,{
      credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(5000),
    });
    const json:unknown = metadata && response.ok ? await response.json().catch(() => null) : null;
    return {status:response.status,body:json !== null && typeof json === 'object' ? json as Record<string,unknown> : {}};
  } catch {
    return {status:null,body:{}};
  }
}

export function McpDiagnostics({enabled}:{enabled:boolean}) {
  const [report,setReport] = useState('');
  const [running,setRunning] = useState(false);
  const [copyStatus,setCopyStatus] = useState('');

  async function runChecks() {
    setRunning(true);
    setCopyStatus('');
    const [endpoint,resource,issuer,account] = await Promise.all([
      check('/mcp'),
      check('/.well-known/oauth-protected-resource/mcp',true),
      check('/.well-known/oauth-authorization-server',true),
      enabled ? api.mcpConnections().catch(() => null) : null,
    ]);
    const origin = window.location.origin;
    const servers = resource.body.authorization_servers;
    const matches = resource.status === 200 && issuer.status === 200
      && resource.body.resource === origin+'/mcp'
      && Array.isArray(servers) && servers[0] === origin+'/' && issuer.body.issuer === origin+'/'
      && issuer.body.authorization_endpoint === origin+'/authorize'
      && issuer.body.registration_endpoint === origin+'/register'
      && issuer.body.token_endpoint === origin+'/token';
    const status = (result:typeof endpoint) => result.status === null ? t('mcp.unreachable') : 'HTTP '+result.status;
    const active = account?.connections.filter(connection => !connection.revokedAt && Date.parse(connection.expiresAt) > Date.now());
    const issued = active?.filter(connection => connection.tokenIssued).length ?? 0;
    setReport([
      t('mcp.reportTitle')+' · '+new Date().toISOString(),
      t(enabled ? 'mcp.enabled' : 'mcp.disabled'),
      t('mcp.endpointStatus',{status:status(endpoint)}),
      t('mcp.resourceStatus',{status:status(resource)}),
      t('mcp.issuerStatus',{status:status(issuer)}),
      ...(enabled ? [
        t(matches ? 'mcp.metadataMatches' : 'mcp.metadataMismatch'),
        t(endpoint.status === 401 && matches ? 'mcp.localPassed' : 'mcp.localFailed'),
        active ? t('mcp.grantCounts',{issued,pending:active.length-issued}) : t('mcp.grantUnavailable'),
      ] : []),
      t('mcp.externalUnchecked'),
    ].join('\n'));
    setRunning(false);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopyStatus(t('mcp.copied'));
    } catch {
      setCopyStatus(t('mcp.copyManually'));
    }
  }

  return <section className="card stack mcp-check">
    <h3><UiIcon name="info" /> {t('mcp.diagnostics')}</h3>
    <p>{t('mcp.diagnosticsHint')}</p>
    <div className="button-row">
      <button type="button" disabled={running} onClick={() => void runChecks()}>{t(running ? 'mcp.checking' : 'mcp.check')}</button>
      <a href={setupGuide} target="_blank" rel="noreferrer">{t('mcp.setupGuide')}</a>
    </div>
    {report && <>
      <label className="stack">{t('mcp.reportTitle')}<textarea readOnly rows={8} value={report} /></label>
      <button type="button" onClick={() => void copy()}>{t('mcp.copy')}</button>
      {copyStatus && <p role="status">{copyStatus}</p>}
    </>}
    <details className="stack">
      <summary>{t('mcp.testInAssistant')}</summary>
      <p>{t('mcp.testPrompt')}</p>
      <p>{t('mcp.operatorHint')}</p>
    </details>
  </section>;
}
