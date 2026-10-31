import { type PropsWithChildren } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export function ScreenLayout({ children }: PropsWithChildren) {
  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 24, paddingVertical: 28 }}
        >
          <View className="flex-1">{children}</View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
