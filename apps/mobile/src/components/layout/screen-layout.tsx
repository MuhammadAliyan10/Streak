import { type PropsWithChildren, type ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { spacing } from '../../theme/tokens';
import { AppHeader, type AppHeaderProps } from './app-header';

export type ScreenLayoutProps = PropsWithChildren<{
  header?: AppHeaderProps;
  bottomNavigation?: ReactNode;
}>;

export function ScreenLayout({ children, header, bottomNavigation }: ScreenLayoutProps) {
  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {header ? (
          <View className="px-6 pt-6">
            <AppHeader {...header} />
          </View>
        ) : null}
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: spacing.lg,
            paddingTop: header ? 0 : spacing.lg,
            paddingBottom: spacing.lg,
          }}
        >
          <View className="flex-1">{children}</View>
        </ScrollView>
        {bottomNavigation}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
