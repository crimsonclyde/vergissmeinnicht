import { appletBackPath, navigate, paths } from '../router.tsx';
import { useTodaySettings } from '../today-settings.ts';
import { ClockScreen } from './ClockScreen.tsx';
import { WeatherScreen } from './WeatherScreen.tsx';

export function AppletPage({ page, userId, workspaceId }: { page: 'clock' | 'weather'; userId: string; workspaceId: string | null }) {
  const { settings } = useTodaySettings(userId);
  const back = () => navigate(appletBackPath(workspaceId === null ? '/' : paths.home(workspaceId)));
  return page === 'clock' ? <ClockScreen hour24={settings.cards.find(item => item.card.id === 'clock')?.hour24 ?? false} onBack={back} /> : <WeatherScreen onBack={back} />;
}
