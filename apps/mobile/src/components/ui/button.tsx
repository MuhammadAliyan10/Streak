import { ActivityIndicator, Pressable, Text } from 'react-native';

type ButtonProps = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet';
  accessibilityHint?: string;
};

const variants = {
  primary: 'bg-primary active:bg-primary-secondary',
  secondary: 'border border-slate-300 bg-white active:bg-slate-100',
  quiet: 'bg-transparent active:bg-indigo-50',
} as const;

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  accessibilityHint,
}: ButtonProps) {
  const unavailable = disabled || loading;
  const textColor = variant === 'primary' ? 'text-white' : 'text-ink';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      onPress={onPress}
      className={`min-h-12 flex-row items-center justify-center rounded-xl px-5 ${variants[variant]} ${unavailable ? 'opacity-50' : ''}`}
    >
      {loading ? <ActivityIndicator color={variant === 'primary' ? '#FFFFFF' : '#4F46E5'} /> : null}
      <Text className={`text-base font-semibold ${textColor} ${loading ? 'ml-2' : ''}`}>
        {loading ? 'Please wait' : title}
      </Text>
    </Pressable>
  );
}
