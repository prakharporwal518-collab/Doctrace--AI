import { useEffect, useState } from 'react';

interface State<T> {
  data: T | null;
  error: Error | null;
  /** The request generation this result belongs to. */
  gen: number;
}

/**
 * Load async data with loading / error state and a reload function.
 * `deps` work like useEffect dependencies.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [state, setState] = useState<State<T>>({ data: null, error: null, gen: -1 });
  const [tick, setTick] = useState(0);
  const [gen, setGen] = useState(0);
  const [lastKey, setLastKey] = useState<unknown[]>([...deps, tick]);

  // A new request starts whenever the deps (or a manual reload) change.
  // Comparing during render is React's recommended alternative to setState-in-effect.
  const key = [...deps, tick];
  if (key.length !== lastKey.length || key.some((v, i) => !Object.is(v, lastKey[i]))) {
    setLastKey(key);
    setGen((g) => g + 1);
  }

  useEffect(() => {
    let live = true;
    const mine = gen;
    fn().then(
      (data) => live && setState({ data, error: null, gen: mine }),
      (error: unknown) => live && setState({ data: null, error: error instanceof Error ? error : new Error(String(error)), gen: mine }),
    );
    return () => {
      live = false;
    };
    // The generation counter captures every dependency change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gen]);

  return {
    data: state.data,
    error: state.gen === gen ? state.error : null,
    loading: state.gen !== gen,
    reload: () => setTick((t) => t + 1),
  };
}
