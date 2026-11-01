import { useState } from 'react';
import { AppIcon } from './app-icon';
import { Controller, type Control, type FieldPathByValue, type FieldValues } from 'react-hook-form';
import {
  Pressable,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type ReturnKeyTypeOptions,
} from 'react-native';

type FormTextFieldProps<T extends FieldValues, N extends FieldPathByValue<T, string>> = {
  control: Control<T>;
  name: N;
  label: string;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  autoComplete?: 'off' | 'one-time-code' | 'password' | 'new-password';
  textContentType?: 'emailAddress' | 'password' | 'newPassword' | 'name';
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
  multiline?: boolean;
  numberOfLines?: number;
};

export function FormTextField<T extends FieldValues, N extends FieldPathByValue<T, string>>({
  control,
  name,
  label,
  placeholder,
  secure = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
  autoComplete = 'off',
  textContentType,
  returnKeyType = 'done',
  onSubmitEditing,
  multiline = false,
  numberOfLines = 1,
}: FormTextFieldProps<T, N>) {
  const [showSecret, setShowSecret] = useState(false);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <View className="mb-5">
          <Text className="mb-2 text-sm font-medium text-ink">{label}</Text>
          <View className="flex-row items-center rounded-lg border border-slate-300 bg-white px-4 focus:border-primary">
            <TextInput
              ref={field.ref}
              accessibilityLabel={label}
              accessibilityHint={fieldState.error?.message}
              accessibilityState={{ disabled: false }}
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              placeholder={placeholder}
              placeholderTextColor="#94A3B8"
              secureTextEntry={secure && !showSecret}
              keyboardType={keyboardType}
              autoCapitalize={autoCapitalize}
              autoComplete={autoComplete}
              textContentType={
                textContentType ??
                (secure
                  ? autoComplete === 'new-password'
                    ? 'newPassword'
                    : 'password'
                  : undefined)
              }
              returnKeyType={returnKeyType}
              onSubmitEditing={onSubmitEditing}
              multiline={multiline}
              numberOfLines={multiline ? numberOfLines : undefined}
              textAlignVertical={multiline ? 'top' : 'center'}
              className={`${multiline ? 'min-h-28' : 'min-h-12'} flex-1 py-3 text-base text-ink`}
              style={{ fontSize: 16 }}
            />
            {secure ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${showSecret ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
                accessibilityState={{ selected: showSecret }}
                hitSlop={10}
                onPress={() => setShowSecret((visible) => !visible)}
                className="ml-3 h-11 w-11 items-center justify-center"
              >
                <AppIcon name={showSecret ? 'eyeClosed' : 'eye'} size={21} color="#4F46E5" />
              </Pressable>
            ) : null}
          </View>
          {fieldState.error?.message ? (
            <Text accessibilityLiveRegion="polite" className="mt-1 text-sm text-red-700">
              {fieldState.error.message}
            </Text>
          ) : null}
        </View>
      )}
    />
  );
}
