import {useEffect,useState} from 'react';
import {api,messageFor,type McpFileHost} from './api.ts';
import {t,formatDateTime} from './i18n/index.ts';
import {UiIcon} from './ui-icons.tsx';

/**
 * Server admin → AI connections → File sources (36.25). When ChatGPT hands VMN a file from a storage
 * host VMN does not know, the host is listed here. One tap allows it for the next try, without a
 * release or restart; one tap removes it again. Only hosts VMN itself refused appear, never typed names.
 */
export function McpFileHosts() {
  const [hosts,setHosts] = useState<McpFileHost[]|null>(null);
  const [busy,setBusy] = useState<string|null>(null);
  const [error,setError] = useState('');

  useEffect(() => {
    let live = true;
    api.mcpFileHosts().then(result => { if (live) setHosts(result.hosts); }, error => { if (live) setError(messageFor(error)); });
    return () => { live = false; };
  },[]);

  async function change(host:string,action:'allow'|'remove') {
    setBusy(host);
    setError('');
    try {
      await (action === 'allow' ? api.mcpAllowFileHost(host) : api.mcpRemoveFileHost(host));
      setHosts((await api.mcpFileHosts()).hosts);
    } catch (error) {
      setError(messageFor(error));
    } finally {
      setBusy(null);
    }
  }

  if (!error && !hosts?.length) return null;
  return <div className="mcp-file-hosts">
    <h3 className="area-group">{t('mcp.fileHosts')}</h3>
    <p className="muted mcp-hint">{t('mcp.fileHostsHint')}</p>
    {error && <p role="alert">{error}</p>}
    <ul className="plain-list area-rows">
      {hosts?.map(host => {
        const allowed = host.status === 'ALLOWED';
        return <li key={host.host} className="area-row mcp-file-host" data-status={host.status}>
          <span className="area-row-icon" aria-hidden="true"><UiIcon name={allowed ? 'check' : 'lock'} /></span>
          <div className="item-body">
            <strong className="mcp-host-name">{host.host}</strong>
            <small className="muted">{allowed
              ? t('mcp.fileHostAllowed',{name:host.decidedBy ?? '—',date:formatDateTime(host.decidedAt ?? host.lastSeenAt)})
              : t('mcp.fileHostRefused',{count:host.refusedCount,date:formatDateTime(host.lastSeenAt)})}</small>
          </div>
          {!allowed && <button type="button" className="quiet icon-button" disabled={busy !== null}
            aria-label={t('mcp.allowFileHost',{host:host.host})} title={t('mcp.allow')}
            onClick={() => void change(host.host,'allow')}><UiIcon name="check" /></button>}
          <button type="button" className="quiet icon-button" disabled={busy !== null}
            aria-label={t('mcp.removeFileHost',{host:host.host})} title={t('mcp.removeFileHostShort')}
            onClick={() => void change(host.host,'remove')}><UiIcon name="trash" /></button>
        </li>;
      })}
    </ul>
  </div>;
}
