import type { PlaceArtwork } from '../types.ts';
import wide from '../art/scotland/landscape-wide.webp';
import wideSmall from '../art/scotland/landscape-small.webp';
import portrait from '../art/scotland/landscape-portrait.webp';
import portraitSmall from '../art/scotland/landscape-phone.webp';

export const artworkFiles: Pick<PlaceArtwork, 'day'> = { day: { wide, wideSmall, portrait, portraitSmall } };
