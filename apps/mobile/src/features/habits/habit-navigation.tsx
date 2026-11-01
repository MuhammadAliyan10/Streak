import { useRouter, type Href } from 'expo-router';
import { AppIcon } from '../../components/ui/app-icon';
import { BottomNavigation } from '../../components/ui/bottom-navigation';
/** Paths are backed by the colocated Expo Router route files. */
export function habitHref(path: string): Href {
  return path as Href;
}
export function HabitNavigation({ selected }: { selected: 'today' | 'habits' | 'history' }) {
  const router = useRouter();
  return (
    <BottomNavigation
      selectedKey={selected}
      items={[
        {
          key: 'today',
          label: 'Today',
          icon: ({ color, size }) => <AppIcon name="today" color={color} size={size} />,
          onPress: () => router.replace('/today'),
        },
        {
          key: 'habits',
          label: 'Habits',
          icon: ({ color, size }) => <AppIcon name="habits" color={color} size={size} />,
          onPress: () => router.replace(habitHref('/habits')),
        },
        {
          key: 'history',
          label: 'History',
          icon: ({ color, size }) => <AppIcon name="projects" color={color} size={size} />,
          onPress: () => router.replace(habitHref('/habits/history')),
        },
      ]}
    />
  );
}
