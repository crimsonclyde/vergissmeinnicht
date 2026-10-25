import type { PlaceArtwork } from '../types.ts';
import wide from '../art/uk/landscape-wide.webp';
import wideSmall from '../art/uk/landscape-small.webp';
import portrait from '../art/uk/landscape-portrait.webp';
import portraitSmall from '../art/uk/landscape-phone.webp';

export const artworkFiles: Pick<PlaceArtwork, 'day'> = { day: { wide, wideSmall, portrait, portraitSmall } };
