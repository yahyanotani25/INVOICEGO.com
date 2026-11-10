import { useEffect, useState } from 'react';

/** The value, updated only after it has stopped changing for `ms` milliseconds. */
export function useDebounced<T>(v: T, ms = 400) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}
