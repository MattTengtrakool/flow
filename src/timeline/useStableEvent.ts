import {useCallback, useEffect, useRef} from 'react';

export function useStableEvent<T extends (...args: never[]) => unknown>(
  callback: T,
): T {
  const ref = useRef(callback);
  useEffect(() => {
    ref.current = callback;
  }, [callback]);
  return useCallback(((...args: Parameters<T>) => ref.current(...args)) as T, []);
}
