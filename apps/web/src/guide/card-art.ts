import type { GuideCardStyle } from '@vergissmeinnicht/domain';
import fireplace from './art/fireplace.webp';
import space from './art/space.webp';
import water from './art/water.webp';
import forest from '../witch-forest/old-forest-wide.webp';

/** CSS `background-image` value per card style. Glass paints no picture; each picture is bundled, never fetched. */
export const GUIDE_CARD_ART: Record<GuideCardStyle, string> = {
  glass: 'none',
  starfield: `url('${space}')`,
  forest: `url('${forest}')`,
  water: `url('${water}')`,
  hearth: `url('${fireplace}')`,
};
