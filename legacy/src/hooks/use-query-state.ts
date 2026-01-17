'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function useQueryState<T extends string>(
  key: string,
  defaultValue?: T
): [T | null, (value: T | null) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const value = useMemo(() => {
    return (searchParams.get(key) as T) || (defaultValue ?? null);
  }, [key, searchParams, defaultValue]);

  const setValue = useCallback(
    (newValue: T | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (newValue === null || newValue === defaultValue) {
        params.delete(key);
      } else {
        params.set(key, newValue);
      }

      const queryString = params.toString();
      const url = `${pathname}${queryString ? `?${queryString}` : ''}`;
      router.push(url, { scroll: false });
    },
    [key, pathname, router, searchParams, defaultValue]
  );

  return [value, setValue];
}
