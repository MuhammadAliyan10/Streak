import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

type State = { hasError: boolean };

export class AppErrorBoundary extends Component<PropsWithChildren, State> {
  public override state: State = { hasError: false };

  public static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Application rendering failed', error, info.componentStack);
  }

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <View className="flex-1 items-center justify-center bg-canvas px-8">
          <Text className="mb-3 text-xl font-semibold text-ink">Streak could not open</Text>
          <Text className="mb-6 text-center text-ink/70">Restart the app to try again.</Text>
          <Pressable
            accessibilityRole="button"
            className="rounded-xl bg-primary px-5 py-3"
            onPress={() => this.setState({ hasError: false })}
          >
            <Text className="font-semibold text-white">Try again</Text>
          </Pressable>
        </View>
      );
    }
    return this.props.children;
  }
}
