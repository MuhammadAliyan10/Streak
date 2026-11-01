import { Text, View } from 'react-native';
export function AuthBrand() {
  return (
    <View className="mb-5 flex-row items-center">
      <View className="mr-3 h-11 w-11 items-center justify-center rounded-2xl bg-indigo-100">
        <View className="h-5 w-5 rounded-full border-[3px] border-primary" />
      </View>
      <Text className="text-2xl font-bold tracking-tight text-ink">Streak</Text>
    </View>
  );
}
