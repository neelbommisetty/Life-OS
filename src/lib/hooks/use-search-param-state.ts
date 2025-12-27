"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { pushUrl, replaceUrl } from "@/lib/url-state";

/**
 * A hook that syncs a state value with a URL search parameter.
 *
 * @param paramKey The key of the search parameter
 * @param defaultValue The default value if the parameter is not present
 * @returns A tuple [value, setValue] where setValue takes (newValue, replace?)
 */
export function useSearchParamState<T extends string | null>(
  paramKey: string,
  defaultValue: T = null as T
): [T, (value: T, replace?: boolean) => void] {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const value = useMemo(() => {
    const val = searchParams.get(paramKey);
    return (val as T) ?? defaultValue;
  }, [searchParams, paramKey, defaultValue]);

  const setValue = useCallback(
    (newValue: T, replace = false) => {
      const nextParams = new URLSearchParams(searchParams.toString());

      if (newValue === null || newValue === undefined || newValue === "") {
        nextParams.delete(paramKey);
      } else {
        nextParams.set(paramKey, newValue);
      }

      const query = nextParams.toString();
      const nextUrl = query ? `${pathname}?${query}` : pathname;

      if (replace) {
        replaceUrl(nextUrl);
      } else {
        pushUrl(nextUrl);
      }
    },
    [searchParams, pathname, paramKey]
  );

  return [value, setValue];
}
