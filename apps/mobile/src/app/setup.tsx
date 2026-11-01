import { useRouter } from 'expo-router';
import { OwnerGate } from '../features/owner/owner-gate';
import { useAuth } from '../features/auth/auth-context';
export default function SetupRoute() {
  const router = useRouter();
  const { refreshOwnerSetup } = useAuth();
  return (
    <OwnerGate
      setupOnly
      onSetupComplete={() => {
        void refreshOwnerSetup().then(() => router.replace('/sign-up'));
      }}
    />
  );
}
