import { Image, Text, View } from 'react-native';
export function AuthBrand() {
  return (
    <View className="mb-5 flex-row items-center">
      <View className="mr-3 h-11 w-11 items-center justify-center rounded-2xl bg-primary">
        <Image
          source={require('../../../assets/images/streak-mark.png')}
          className="h-8 w-8"
          resizeMode="contain"
          accessibilityLabel="Streak logo"
        />
      </View>
      <Text className="text-2xl font-bold tracking-tight text-ink">Streak</Text>
    </View>
  );
}
