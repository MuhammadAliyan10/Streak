import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

export type NavigationItem = {
  key: string;
  label: string;
  icon: (props: { color: string; size: number }) => ReactNode;
  onPress: () => void;
  accessibilityHint?: string;
  disabled?: boolean;
};

export type BottomNavigationProps = {
  items: readonly [NavigationItem, NavigationItem, NavigationItem];
  selectedKey: string;
};

export function BottomNavigation({ items, selectedKey }: BottomNavigationProps) {
  return (
    <View
      accessibilityRole="tablist"
      className="mx-4 mb-2 min-h-20 flex-row items-center justify-around rounded-3xl border border-slate-200 bg-white px-3 py-2 shadow-sm"
    >
      {items.map((item, index) => {
        const selected = selectedKey === item.key;
        const central = index === 1;
        const iconColor = selected || central ? '#4F46E5' : '#64748B';

        return (
          <Pressable
            key={item.key}
            accessibilityRole="tab"
            accessibilityLabel={item.label}
            accessibilityHint={item.accessibilityHint}
            accessibilityState={{ selected, disabled: item.disabled ?? false }}
            disabled={item.disabled}
            onPress={item.onPress}
            className={`min-w-16 items-center justify-center rounded-2xl px-2 ${item.disabled ? 'opacity-40' : ''}`}
          >
            <View
              className={`${central ? 'mb-1 h-12 w-12 rounded-2xl' : 'mb-1 h-9 w-12 rounded-xl'} items-center justify-center ${central || selected ? 'bg-indigo-100' : ''}`}
            >
              {item.icon({ color: iconColor, size: central ? 24 : 21 })}
            </View>
            <Text
              numberOfLines={1}
              className={`text-xs ${selected || central ? 'font-semibold text-primary' : 'font-medium text-slate-500'}`}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
