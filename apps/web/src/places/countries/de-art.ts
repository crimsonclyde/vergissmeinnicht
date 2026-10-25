import type { PlaceArtwork } from '../types.ts';
import wide from '../art/de/landscape-wide.webp';
import wideSmall from '../art/de/landscape-small.webp';
import portrait from '../art/de/landscape-portrait.webp';
import portraitSmall from '../art/de/landscape-phone.webp';

export const artworkFiles: Pick<PlaceArtwork, 'day'> = { day: { wide, wideSmall, portrait, portraitSmall } };
