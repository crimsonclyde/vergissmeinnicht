import { sceneOfTheme } from '@vergissmeinnicht/domain';
import { CityScene } from './CityScene.tsx';
import { ForestScene } from './ForestScene.tsx';
import { PlaceScene } from './places/PlaceScene.tsx';
import type { PlaceProminence } from './places/look.ts';
import { useThemeMode } from './theme.ts';

/**
 * The one scene slot (45.4): the theme registry says which painted background the displayed theme
 * brings, and this slot is the only place a scene is mounted. A new scenic theme adds its scene here
 * and its id in the registry; pages never mount scenes themselves.
 */
export function ThemeScene({ userId, workspaceId, placeWorkspaceId, prominence }: {
  userId?: string;
  /** The Workspace of the page (the forest's weather). */
  workspaceId?: string | undefined;
  /** The Workspace whose Places look is shown (the remembered one on personal pages). */
  placeWorkspaceId?: string | null;
  prominence: PlaceProminence;
}) {
  const [mode] = useThemeMode();
  switch (sceneOfTheme(mode)) {
    case 'city':
      return <CityScene />;
    case 'forest':
      return <ForestScene userId={userId} workspaceId={workspaceId} />;
    case 'place':
      return <PlaceScene userId={userId} workspaceId={placeWorkspaceId ?? null} prominence={prominence} />;
    default:
      return null;
  }
}
