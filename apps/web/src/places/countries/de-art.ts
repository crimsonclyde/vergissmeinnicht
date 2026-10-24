import type { PlaceArtwork } from '../types.ts';
import wide from '../art/de/wide.webp';
import wideSmall from '../art/de/wideSmall.webp';
import portrait from '../art/de/portrait.webp';
import portraitSmall from '../art/de/portraitSmall.webp';
import lightsWide from '../art/de/lights-wide.webp';
import lightsWideSmall from '../art/de/lights-wideSmall.webp';
import lightsPortrait from '../art/de/lights-portrait.webp';
import lightsPortraitSmall from '../art/de/lights-portraitSmall.webp';

export const artworkFiles: Pick<PlaceArtwork, 'day' | 'lights'> = {
  day: { wide, wideSmall, portrait, portraitSmall },
  lights: { wide: lightsWide, wideSmall: lightsWideSmall, portrait: lightsPortrait, portraitSmall: lightsPortraitSmall },
};
