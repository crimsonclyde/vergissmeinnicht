import { useState } from 'react';
import { gazetteHeaderUrl, type GazetteHeaderImage } from '../../api.ts';
import { useThemeMode } from '../../theme.ts';
import woodlandWide from '../../witch-forest/old-forest-wide.webp';
import woodlandPhone from '../../witch-forest/old-forest-portrait-480.webp';
import orbit from './art/orbit.webp';
import city from './art/city.webp';
import coast from './art/coast.webp';

export function GazetteMastheadArtwork({ workspaceId, header, date }: { workspaceId: string; header: GazetteHeaderImage | null; date: string }) {
  const [theme] = useThemeMode();
  const [failed, setFailed] = useState<string | null>(null);
  const day = Date.parse(date) / 86_400_000;
  const scenery = theme === 'space-guide' ? orbit
    : theme === 'witch-forest' ? woodlandWide
    : theme === 'tokyo-nights' ? city
    : theme.startsWith('places-') || day % 2 === 0 ? coast
    : city;

  if (header && failed !== header.id) {
    return <img className="gazette-masthead-art gazette-custom-art" alt="" src={gazetteHeaderUrl(workspaceId, header.id)} style={{ objectPosition: `${header.x}% ${header.y}%` }} onError={() => setFailed(header.id)} />;
  }

  return (
    <picture className="gazette-masthead-art" aria-hidden="true">
      {scenery === woodlandWide && <source media="(max-width: 540px)" srcSet={woodlandPhone} />}
      <img src={scenery} alt="" />
    </picture>
  );
}
