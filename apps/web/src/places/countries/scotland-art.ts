import type { PlaceArtwork } from '../types.ts';
import wide from '../art/scotland/wide.webp';
import wideSmall from '../art/scotland/wideSmall.webp';
import portrait from '../art/scotland/portrait.webp';
import portraitSmall from '../art/scotland/portraitSmall.webp';
import lightsWide from '../art/scotland/lights-wide.webp';
import lightsWideSmall from '../art/scotland/lights-wideSmall.webp';
import lightsPortrait from '../art/scotland/lights-portrait.webp';
import lightsPortraitSmall from '../art/scotland/lights-portraitSmall.webp';

export const artworkFiles: Pick<PlaceArtwork, 'day' | 'lights'> = {
  day: { wide, wideSmall, portrait, portraitSmall },
  lights: { wide: lightsWide, wideSmall: lightsWideSmall, portrait: lightsPortrait, portraitSmall: lightsPortraitSmall },
};
