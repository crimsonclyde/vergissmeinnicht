import {useEffect,useState} from 'react';
import {api,messageFor,type McpAiBackup,type McpAiBackupSettings} from './api.ts';
import {formatBytes} from './document-model.ts';
import {t,formatDateTime} from './i18n/index.ts';
import {UiIcon} from './ui-icons.tsx';

/**
 * Server admin → AI connections → Safety backups (48.1). Before an AI assistant changes anything, VMN
 * writes a backup of the whole server (at most one per interval). Listed newest first with who, which
 * assistant, where and what triggered it; one tap copies the file's path for `restore`.
 */
export function McpAiBackups() {
  const [backups,setBackups] = useState<McpAiBackup[]|null>(null);
  const [settings,setSettings] = useState<McpAiBackupSettings|null>(null);
  const [showAll,setShowAll] = useState(false);
  const [status,setStatus] = useState('');

  useEffect(() => {
    let live = true;
    api.mcpAiBackups().then(result => { if (live) { setBackups(result.backups); setSettings(result.settings); } }, error => { if (live) setStatus(messageFor(error)); });
    return () => { live = false; };
  },[]);

  async function copy(name:string) {
    try {
      if (!navigator.clipboard) throw new Error();
      await navigator.clipboard.writeText(`/data/backups/${name}`);
      setStatus(t('mcp.backupCopied'));
    } catch {
      setStatus(t('mcp.backupCopyFailed'));
    }
  }

  const shown = showAll ? backups ?? [] : (backups ?? []).slice(0,5);
  return <div className="mcp-ai-backups">
    <h3 className="area-group">{t('mcp.backups')}</h3>
    {settings && <p className="muted mcp-hint">{t('mcp.backupsHint',{minutes:settings.intervalMinutes,keep:settings.keep})}</p>}
    {status && <p role="status">{status}</p>}
    {backups?.length === 0 && <p className="muted">{t('mcp.backupsNone')}</p>}
    {shown.length > 0 && <ul className="plain-list area-rows">
      {shown.map(backup => <li key={backup.name} className="area-row mcp-ai-backup">
        <span className="area-row-icon" aria-hidden="true"><UiIcon name="backup" /></span>
        <div className="item-body">
          <strong>{formatDateTime(backup.createdAt)} · {formatBytes(backup.bytes)}</strong>
          <small className="muted">{[backup.person,backup.assistant,backup.workspace,backup.tool].filter(part => part !== null).join(' · ') || t('mcp.backupUnknown')}</small>
        </div>
        <button type="button" className="quiet icon-button" aria-label={t('mcp.backupCopy',{date:formatDateTime(backup.createdAt)})} title={t('mcp.backupCopyShort')}
          onClick={() => void copy(backup.name)}><UiIcon name="copy" /></button>
      </li>)}
    </ul>}
    {(backups?.length ?? 0) > shown.length && <div className="area-more">
      <button type="button" className="area-round" onClick={() => setShowAll(true)}
        aria-label={t('mcp.backupsShowAll',{count:backups?.length ?? 0})} title={t('mcp.backupsShowAll',{count:backups?.length ?? 0})}><UiIcon name="expand" /></button>
    </div>}
    {(backups?.length ?? 0) > 0 && <p className="muted mcp-hint">{t('mcp.backupsRestore')}</p>}
  </div>;
}
