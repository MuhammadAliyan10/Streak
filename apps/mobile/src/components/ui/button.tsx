import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

export type ButtonProps = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'quiet';
  size?: 'regular' | 'large';
  fullWidth?: boolean;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loadingLabel?: string;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

const variants = {
  primary: 'bg-primary active:bg-primary-secondary',
  secondary: 'border border-slate-300 bg-white active:bg-slate-100',
  quiet: 'bg-transparent active:bg-indigo-50',
} as const;
const heights = { regular: 'min-h-12', large: 'min-h-14' } as const;

export function Button({
  title,
  onPress,
  loading = false,
  disabled = false,
  variant = 'primary',
  size = 'regular',
  fullWidth = true,
  leftIcon,
  rightIcon,
  loadingLabel = 'Please wait',
  accessibilityLabel,
  accessibilityHint,
}: ButtonProps) {
  const unavailable = disabled || loading;
  const textColor = variant === 'primary' ? 'text-white' : 'text-ink';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      onPress={onPress}
      className={`${heights[size]} flex-row items-center justify-center rounded-lg px-5 ${variants[variant]} ${fullWidth ? 'w-full' : 'self-start'} ${unavailable ? 'opacity-50' : ''}`}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'primary' ? '#FFFFFF' : '#4F46E5'} />
      ) : leftIcon ? (
        <View className="mr-2">{leftIcon}</View>
      ) : null}
      <Text className={`text-base font-semibold ${textColor} ${loading ? 'ml-2' : ''}`}>
        {loading ? loadingLabel : title}
      </Text>
      {!loading && rightIcon ? <View className="ml-2">{rightIcon}</View> : null}
    </Pressable>
  );
}

export type IconButtonProps = {
  icon: ReactNode;
  accessibilityLabel: string;
  accessibilityHint?: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  size?: 'regular' | 'large';
  variant?: 'default' | 'quiet';
};

export function IconButton({
  icon,
  accessibilityLabel,
  accessibilityHint,
  onPress,
  disabled = false,
  loading = false,
  size = 'regular',
  variant = 'default',
}: IconButtonProps) {
  const unavailable = disabled || loading;
  const dimension = size === 'large' ? 'h-14 w-14' : 'h-12 w-12';
  const surface =
    variant === 'default' ? 'bg-white active:bg-slate-100' : 'bg-transparent active:bg-indigo-50';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: unavailable, busy: loading }}
      disabled={unavailable}
      onPress={onPress}
      className={`${dimension} items-center justify-center rounded-full border border-slate-200 ${surface} ${unavailable ? 'opacity-50' : ''}`}
    >
      {loading ? <ActivityIndicator color="#4F46E5" /> : icon}
    </Pressable>
  );
}
