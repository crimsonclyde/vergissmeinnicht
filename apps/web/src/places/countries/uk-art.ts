import type { PlaceArtwork } from '../types.ts';
import wide from '../art/uk/wide.webp';
import wideSmall from '../art/uk/wideSmall.webp';
import portrait from '../art/uk/portrait.webp';
import portraitSmall from '../art/uk/portraitSmall.webp';
import lightsWide from '../art/uk/lights-wide.webp';
import lightsWideSmall from '../art/uk/lights-wideSmall.webp';
import lightsPortrait from '../art/uk/lights-portrait.webp';
import lightsPortraitSmall from '../art/uk/lights-portraitSmall.webp';

export const artworkFiles: Pick<PlaceArtwork, 'day' | 'lights'> = {
  day: { wide, wideSmall, portrait, portraitSmall },
  lights: { wide: lightsWide, wideSmall: lightsWideSmall, portrait: lightsPortrait, portraitSmall: lightsPortraitSmall },
};
