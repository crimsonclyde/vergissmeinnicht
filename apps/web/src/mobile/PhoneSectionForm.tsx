import { useId, type ReactNode } from 'react';
import { t } from '../i18n/index.ts';
import { MobileActionBar } from './MobileActionBar.tsx';

/** A local Section draft. Applying updates only the Procedure draft, never the server. */
export function PhoneSectionForm({ heading, submitLabel, onClose, onSubmit, children }: {
  heading: string; submitLabel: string; onClose: () => void; onSubmit: () => void; children: ReactNode;
}) {
  const id = useId();
  return <form id={id} className="phone-section-form stack" onSubmit={event => { event.preventDefault(); onSubmit(); }}>
    <h2>{heading}</h2>
    {children}
    <MobileActionBar label={t('builder.phoneActions')} actions={[
      { id: 'back', label: t('common.back'), icon: 'back', onClick: onClose },
      { id: 'cancel', label: t('common.cancel'), icon: 'close', onClick: onClose },
    ]} primary={{ id: 'apply', label: submitLabel, icon: 'check', type: 'submit', form: id }} />
  </form>;
}
