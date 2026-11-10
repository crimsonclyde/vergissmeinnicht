import { useState } from 'react';
import { LIST_ICONS, type ListIcon, type ListKind } from '@vergissmeinnicht/domain';
import { api, listCoverUrl, messageFor, uploadListCover, type ListDetail } from './api.ts';
import { t, type MessageKey } from './i18n/index.ts';
import { PhoneEditorDialog } from './mobile/PhoneEditorDialog.tsx';
import { UiIcon, type UiIconName } from './ui-icons.tsx';
import './list-overview.css';

const icons: Record<ListIcon, { image: UiIconName; name: MessageKey }> = {
  shopping: { image: 'grocery', name: 'lists.iconShopping' },
  checklist: { image: 'lists', name: 'lists.iconChecklist' },
  home: { image: 'today', name: 'lists.iconHome' },
  travel: { image: 'plane', name: 'lists.iconTravel' },
  garden: { image: 'plant', name: 'lists.iconGarden' },
  tools: { image: 'maintenance', name: 'lists.iconTools' },
  book: { image: 'journal', name: 'lists.iconBook' },
  gift: { image: 'gift', name: 'lists.iconGift' },
};

const defaultIcon = (kind: ListKind): ListIcon => kind === 'GROCERY' ? 'shopping' : 'checklist';

function Cover({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return failed ? null : <img alt="" src={src} loading="lazy" onError={() => setFailed(true)} />;
}

export function ListArtwork({ kind, icon, src }: { kind: ListKind; icon: ListIcon | null; src?: string | undefined }) {
  return <span className="list-artwork" data-kind={kind} aria-hidden="true">
    <UiIcon name={icons[icon ?? defaultIcon(kind)].image} size="2em" />
    {src && <Cover key={src} src={src} />}
  </span>;
}

export function ListAppearanceDialog({ workspaceId, list, onSave, onRepair, onClose }: {
  workspaceId: string;
  list: ListDetail;
  onSave: (saved: ListDetail) => void;
  onRepair: () => void;
  onClose: () => void;
}) {
  const [initial] = useState(list);
  const [icon, setIcon] = useState<ListIcon | null>(initial.icon ?? null);
  const [coverId, setCoverId] = useState<string | null>(initial.coverId ?? null);
  const [file, setFile] = useState<File | null>(null);
  const [upload, setUpload] = useState<{ file: File; id: string } | null>(null);
  const [repairing, setRepairing] = useState(false);
  const [repair, setRepair] = useState<{ text: string; error: boolean } | null>(null);
  async function repairCover(id: string) {
    setRepairing(true);
    setRepair(null);
    try {
      await api.repairListCover(workspaceId, list.id, id);
      onRepair();
      setRepair({ text: t('lists.coverRepaired'), error: false });
    } catch (error) {
      setRepair({ text: messageFor(error), error: true });
    } finally {
      setRepairing(false);
    }
  }
  const dirty = icon !== (initial.icon ?? null) || coverId !== (initial.coverId ?? null) || file !== null;
  return <PhoneEditorDialog title={t('lists.appearance')} stages={[{ id: 'art', title: t('lists.appearance') }]}
    submitLabel={t('lists.save')} dirty={dirty} submitDisabled={!dirty || repairing} onClose={onClose} onSubmit={async () => {
      let nextCover = coverId;
      if (file) {
        nextCover = upload?.file === file ? upload.id : (await uploadListCover(workspaceId, initial.id, file)).id;
        setUpload({ file, id: nextCover });
      }
      onSave(await api.saveListAppearance(workspaceId, initial.id, initial.revision, { icon, coverId: nextCover }));
    }}>
    {() => <>
      <fieldset className="stack">
        <legend>{t('lists.icon')}</legend>
        <div className="list-icon-picker">
          {[null, ...LIST_ICONS].map(value => <button key={value ?? 'default'} type="button"
            aria-pressed={icon === value} onClick={() => setIcon(value)}>
            <UiIcon name={icons[value ?? defaultIcon(list.kind)].image} />
            <span>{t(value ? icons[value].name : 'lists.iconDefault')}</span>
          </button>)}
        </div>
      </fieldset>
      <div className="stack">
        <label>{t('lists.cover')}<input type="file" accept="image/jpeg,image/png" disabled={repairing}
          onChange={event => { setFile(event.target.files?.[0] ?? null); setUpload(null); setRepair(null); }} /></label>
        <small className="muted">{t('lists.coverHint')}</small>
        {coverId && !file && <div className="row wrap">
          <a href={listCoverUrl(workspaceId, list.id, coverId, 'original')} download>{t('lists.coverDownload')}</a>
          <button type="button" disabled={repairing} onClick={() => void repairCover(coverId)}>{t('lists.coverRepair')}</button>
          <button type="button" disabled={repairing} onClick={() => { setCoverId(null); setRepair(null); }}>{t('lists.coverRemove')}</button>
        </div>}
        {repair && <small role={repair.error ? 'alert' : 'status'}>{repair.text}</small>}
      </div>
    </>}
  </PhoneEditorDialog>;
}
