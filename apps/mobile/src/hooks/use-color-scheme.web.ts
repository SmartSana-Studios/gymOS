import { useSyncExternalStore } from 'react';
import { useColorScheme as useRNColorScheme } from 'react-native';

// "Have we hydrated yet" is a fact about the environment, not React state, so
// useSyncExternalStore is the primitive for it -- the store never changes, and
// the answer differs only because the server and the client read different
// snapshots. The previous useState + useEffect version expressed the same idea
// as a synchronous setState inside an effect (react-hooks/set-state-in-effect),
// which also cost an extra render pass on every mount.
//
// subscribe never fires, so it returns a no-op unsubscribe: nothing can change
// this value after hydration. Both functions are module-level constants so
// their identity is stable across renders.
const subscribeToNothing = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * To support static rendering, this value needs to be re-calculated on the client side for web
 */
export function useColorScheme() {
  const hasHydrated = useSyncExternalStore(
    subscribeToNothing,
    getClientSnapshot,
    getServerSnapshot,
  );
  const colorScheme = useRNColorScheme();

  if (hasHydrated) {
    return colorScheme;
  }

  return 'light';
}
