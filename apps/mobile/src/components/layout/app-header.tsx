import type { ReactNode } from 'react';
import { Text, View } from 'react-native';

export type AppHeaderProps = {
  title: string;
  subtitle: string;
  action?: ReactNode;
};

export function AppHeader({ title, subtitle, action }: AppHeaderProps) {
  return (
    <View className="mb-6 min-h-14 flex-row items-center justify-between gap-4">
      <View className="min-w-0 flex-1">
        <Text accessibilityRole="header" className="text-2xl font-bold tracking-tight text-ink">
          {title}
        </Text>
        <Text className="mt-1 text-sm leading-5 text-slate-600">{subtitle}</Text>
      </View>
      {action ? <View className="shrink-0">{action}</View> : null}
    </View>
  );
}
