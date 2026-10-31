import { Pressable, Text, View } from 'react-native';

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View className="rounded-2xl border border-red-200 bg-red-50 p-5">
      <Text className="text-base font-semibold text-red-900">Could not connect</Text>
      <Text className="mt-2 text-sm leading-5 text-red-800">{message}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          onPress={onRetry}
          className="mt-4 min-h-11 justify-center"
        >
          <Text className="font-semibold text-primary">Try again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function EmptyState({ title, message }: { title: string; message: string }) {
  return (
    <View className="items-center rounded-2xl border border-slate-200 bg-white p-6">
      <Text className="text-base font-semibold text-ink">{title}</Text>
      <Text className="mt-2 text-center text-sm leading-5 text-slate-600">{message}</Text>
    </View>
  );
}
