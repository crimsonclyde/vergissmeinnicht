import type { PlaceArtwork } from '../types.ts';
import wide from '../art/it/landscape-wide.webp';
import wideSmall from '../art/it/landscape-small.webp';
import portrait from '../art/it/landscape-portrait.webp';
import portraitSmall from '../art/it/landscape-phone.webp';

export const artworkFiles: Pick<PlaceArtwork, 'day'> = { day: { wide, wideSmall, portrait, portraitSmall } };
