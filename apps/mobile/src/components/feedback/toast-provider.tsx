import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Pressable, Text, View } from 'react-native';

export type ToastTone = 'success' | 'error' | 'info';
type ToastItem = { id: number; message: string; tone: ToastTone };
type ToastContextValue = {
  showToast: (message: string, tone?: ToastTone, durationMs?: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);
let nextToastId = 0;

export function ToastProvider({ children }: PropsWithChildren) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (timeout.current) clearTimeout(timeout.current);
    timeout.current = null;
    setToast(null);
  }, []);

  const showToast = useCallback((message: string, tone: ToastTone = 'info', durationMs = 3_500) => {
    const cleanMessage = message.trim();
    if (!cleanMessage) return;
    if (timeout.current) clearTimeout(timeout.current);
    const id = ++nextToastId;
    setToast({ id, message: cleanMessage, tone });
    timeout.current = setTimeout(
      () => {
        setToast((current) => (current?.id === id ? null : current));
        timeout.current = null;
      },
      Math.max(durationMs, 1_000),
    );
  }, []);

  useEffect(
    () => () => {
      if (timeout.current) clearTimeout(timeout.current);
    },
    [],
  );

  const background =
    toast?.tone === 'error'
      ? 'bg-red-900'
      : toast?.tone === 'success'
        ? 'bg-emerald-900'
        : 'bg-slate-900';

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toast ? (
        <View className="absolute bottom-7 left-5 right-5 z-50">
          <Pressable
            key={toast.id}
            accessibilityRole="alert"
            accessibilityLiveRegion="polite"
            onPress={dismiss}
            className={`min-h-12 justify-center rounded-xl px-4 py-3 ${background}`}
          >
            <Text className="text-sm font-medium text-white">{toast.message}</Text>
          </Pressable>
        </View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider.');
  return value;
}
