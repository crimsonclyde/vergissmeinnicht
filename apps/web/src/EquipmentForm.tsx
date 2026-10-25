import { useId, useState } from 'react';
import { api, type EquipmentFilters, type EquipmentInput, type EquipmentRecord } from './api.ts';
import { FormDialog } from './FormDialog.tsx';
import { t } from './i18n/index.ts';
import { UiIcon } from './ui-icons.tsx';

export const EQUIPMENT_FIELDS = ['name', 'manufacturer', 'model', 'replacementParts', 'category', 'location', 'serialNumber', 'purchaseDate', 'warrantyExpiry', 'notes'] as const;
const PRIMARY = ['name', 'manufacturer', 'model', 'replacementParts'] as const;
type Field = typeof EQUIPMENT_FIELDS[number];
export function EquipmentForm(props: { workspaceId: string; record: EquipmentRecord | null; filters: EquipmentFilters | null; onClose: () => void; onSaved: (record: EquipmentRecord) => void }) {
  const id = useId();
  const [form, setForm] = useState<EquipmentInput>(() => props.record === null ? { name: '', manufacturer: '', model: '', replacementParts: '', customFields: [] } : { ...Object.fromEntries(EQUIPMENT_FIELDS.map(key => [key, props.record?.[key]])), name: props.record.name, customFields: props.record.customFields });
  const [visible, setVisible] = useState<readonly Field[]>(() => EQUIPMENT_FIELDS.filter(key => (PRIMARY as readonly string[]).includes(key) || Boolean(props.record?.[key])));
  const fields = form.customFields ?? [];
  const setField = (key: Field, value: string) => setForm({ ...form, [key]: value });
  return <FormDialog title={t(props.record === null ? 'equipment.add' : 'equipment.edit')} submitLabel={t('maintenance.save')} submitDisabled={form.name.trim() === '' || fields.some(f => !f.label.trim() || !f.value.trim())} onClose={props.onClose} onSubmit={async () => props.onSaved(props.record === null ? await api.createEquipment(props.workspaceId, form) : await api.updateEquipment(props.workspaceId, props.record.id, form, props.record.revision))}>
    <p className="muted">{t('equipment.formHint')}</p>
    {visible.map(key => {
      const suggestions = key === 'category' ? props.filters?.categories : key === 'location' ? props.filters?.locations : key === 'manufacturer' ? props.filters?.manufacturers : undefined;
      return <div className="field" key={key}><label htmlFor={`${id}-${key}`}>{t(`equipment.field.${key}`)}{key === 'name' && <span className="muted"> · {t('common.required')}</span>}</label>
        {key === 'notes' || key === 'replacementParts' ? <textarea id={`${id}-${key}`} rows={key === 'notes' ? 4 : 3} maxLength={key === 'notes' ? 4000 : 2000} value={form[key] ?? ''} onChange={e => setField(key, e.target.value)} placeholder={key === 'replacementParts' ? t('equipment.partsPlaceholder') : undefined} /> : <input id={`${id}-${key}`} type={key === 'purchaseDate' || key === 'warrantyExpiry' ? 'date' : 'text'} required={key === 'name'} maxLength={key === 'category' ? 60 : 200} list={suggestions === undefined ? undefined : `${id}-${key}-suggestions`} value={form[key] ?? ''} onChange={e => setField(key, e.target.value)} />}
        {suggestions !== undefined && <datalist id={`${id}-${key}-suggestions`}>{suggestions.map(value => <option key={value} value={value} />)}</datalist>}
      </div>;
    })}
    {fields.map((field, index) => <div className="equipment-custom-field" key={index}><div className="field"><label htmlFor={`${id}-label-${index}`}>{t('equipment.detailLabel', { count: index + 1 })}</label><input id={`${id}-label-${index}`} maxLength={60} required value={field.label} onChange={e => setForm({ ...form, customFields: fields.map((f, i) => i === index ? { ...f, label: e.target.value } : f) })} /></div><div className="field"><label htmlFor={`${id}-value-${index}`}>{t('equipment.detailValue', { count: index + 1 })}</label><input id={`${id}-value-${index}`} maxLength={500} required value={field.value} onChange={e => setForm({ ...form, customFields: fields.map((f, i) => i === index ? { ...f, value: e.target.value } : f) })} /></div><button type="button" className="quiet icon-button" aria-label={t('equipment.removeDetail', { count: index + 1 })} onClick={() => setForm({ ...form, customFields: fields.filter((_, i) => i !== index) })}><UiIcon name="close" /></button></div>)}
    <div className="field"><label htmlFor={`${id}-add`}>{t('equipment.addField')}</label><select id={`${id}-add`} value="" onChange={e => { if (e.target.value === 'custom') setForm({ ...form, customFields: [...fields, { label: '', value: '' }] }); else if (EQUIPMENT_FIELDS.includes(e.target.value as Field)) setVisible([...visible, e.target.value as Field]); }}><option value="">{t('equipment.chooseField')}</option>{EQUIPMENT_FIELDS.filter(key => !visible.includes(key)).map(key => <option key={key} value={key}>{t(`equipment.field.${key}`)}</option>)}{fields.length < 16 && <option value="custom">{t('equipment.customDetail')}</option>}</select></div>
  </FormDialog>;
}
