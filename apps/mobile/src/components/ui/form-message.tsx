import { Text, View } from 'react-native';

export function FormMessage({
  message,
  tone = 'error',
}: {
  message: string;
  tone?: 'error' | 'info';
}) {
  const color = tone === 'error' ? 'text-red-700' : 'text-slate-600';
  return (
    <View accessibilityLiveRegion="polite" className="mb-4 rounded-lg bg-white px-3 py-2">
      <Text accessibilityRole={tone === 'error' ? 'alert' : 'text'} className={`text-sm ${color}`}>
        {message}
      </Text>
    </View>
  );
}
