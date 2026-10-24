import type { PlaceArtwork } from '../types.ts';
import wide from '../art/it/wide.webp';
import wideSmall from '../art/it/wideSmall.webp';
import portrait from '../art/it/portrait.webp';
import portraitSmall from '../art/it/portraitSmall.webp';
import lightsWide from '../art/it/lights-wide.webp';
import lightsWideSmall from '../art/it/lights-wideSmall.webp';
import lightsPortrait from '../art/it/lights-portrait.webp';
import lightsPortraitSmall from '../art/it/lights-portraitSmall.webp';

export const artworkFiles: Pick<PlaceArtwork, 'day' | 'lights'> = {
  day: { wide, wideSmall, portrait, portraitSmall },
  lights: { wide: lightsWide, wideSmall: lightsWideSmall, portrait: lightsPortrait, portraitSmall: lightsPortraitSmall },
};
