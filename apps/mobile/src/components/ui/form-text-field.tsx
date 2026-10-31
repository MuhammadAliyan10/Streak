import { useState } from 'react';
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
  returnKeyType?: ReturnKeyTypeOptions;
  onSubmitEditing?: () => void;
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
  returnKeyType = 'done',
  onSubmitEditing,
}: FormTextFieldProps<T, N>) {
  const [showSecret, setShowSecret] = useState(false);

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <View className="mb-5">
          <Text className="mb-2 text-sm font-medium text-ink">{label}</Text>
          <View className="flex-row items-center rounded-xl border border-slate-300 bg-white px-4 focus:border-primary">
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
              textContentType={secure ? 'password' : undefined}
              returnKeyType={returnKeyType}
              onSubmitEditing={onSubmitEditing}
              className="min-h-12 flex-1 py-3 text-base text-ink"
              style={{ fontSize: 16 }}
            />
            {secure ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showSecret ? 'Hide secret' : 'Show secret'}
                accessibilityState={{ selected: showSecret }}
                hitSlop={10}
                onPress={() => setShowSecret((visible) => !visible)}
                className="ml-3 min-h-11 justify-center px-1"
              >
                <Text className="font-medium text-primary">{showSecret ? 'Hide' : 'Show'}</Text>
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
