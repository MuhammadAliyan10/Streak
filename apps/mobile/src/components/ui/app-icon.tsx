import { SymbolView } from 'expo-symbols';

export type AppIconName =
  | 'help'
  | 'signOut'
  | 'today'
  | 'habits'
  | 'projects'
  | 'settings'
  | 'calendar'
  | 'chevronLeft'
  | 'chevronRight'
  | 'plus'
  | 'clock'
  | 'chart';
type AppIconProps = { name: AppIconName; color?: string; size?: number };

export function AppIcon({ name, color = '#475569', size = 22 }: AppIconProps) {
  switch (name) {
    case 'help':
      return (
        <SymbolView
          name={{ ios: 'questionmark', android: 'help', web: 'help' }}
          size={size}
          tintColor={color}
        />
      );
    case 'signOut':
      return (
        <SymbolView
          name={{ ios: 'rectangle.portrait.and.arrow.right', android: 'logout', web: 'logout' }}
          size={size}
          tintColor={color}
        />
      );
    case 'today':
      return (
        <SymbolView
          name={{ ios: 'sun.max', android: 'today', web: 'today' }}
          size={size}
          tintColor={color}
        />
      );
    case 'habits':
      return (
        <SymbolView
          name={{ ios: 'checkmark.circle', android: 'check_circle', web: 'check_circle' }}
          size={size}
          tintColor={color}
        />
      );
    case 'projects':
      return (
        <SymbolView
          name={{ ios: 'square.grid.2x2', android: 'grid_view', web: 'grid_view' }}
          size={size}
          tintColor={color}
        />
      );
    case 'settings':
      return (
        <SymbolView
          name={{ ios: 'gearshape', android: 'settings', web: 'settings' }}
          size={size}
          tintColor={color}
        />
      );
    case 'calendar':
      return (
        <SymbolView
          name={{ ios: 'calendar', android: 'calendar_month', web: 'calendar_month' }}
          size={size}
          tintColor={color}
        />
      );
    case 'chevronLeft':
      return (
        <SymbolView
          name={{ ios: 'chevron.left', android: 'chevron_left', web: 'chevron_left' }}
          size={size}
          tintColor={color}
        />
      );
    case 'chevronRight':
      return (
        <SymbolView
          name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }}
          size={size}
          tintColor={color}
        />
      );
    case 'plus':
      return (
        <SymbolView
          name={{ ios: 'plus', android: 'add', web: 'add' }}
          size={size}
          tintColor={color}
        />
      );
    case 'clock':
      return (
        <SymbolView
          name={{ ios: 'clock', android: 'schedule', web: 'schedule' }}
          size={size}
          tintColor={color}
        />
      );
    case 'chart':
      return (
        <SymbolView
          name={{ ios: 'chart.bar', android: 'bar_chart', web: 'bar_chart' }}
          size={size}
          tintColor={color}
        />
      );
  }
}
