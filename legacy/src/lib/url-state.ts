import { useEffect, useState } from "react";

type UrlState = {
  pathname: string;
  search: string;
};

function getUrlState(): UrlState {
  if (typeof window === "undefined") {
    return { pathname: "", search: "" };
  }
  return { pathname: window.location.pathname, search: window.location.search };
}

export function useUrlState(): UrlState {
  const [state, setState] = useState<UrlState>(() => getUrlState());

  useEffect(() => {
    const update = () => setState(getUrlState());
    update();
    window.addEventListener("popstate", update);
    window.addEventListener("urlchange", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("urlchange", update);
    };
  }, []);

  return state;
}

export function pushUrl(url: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.history.pushState({}, "", url);
  window.dispatchEvent(new Event("urlchange"));
}

export function replaceUrl(url: string) {
  if (typeof window === "undefined") {
    return;
  }
  window.history.replaceState({}, "", url);
  window.dispatchEvent(new Event("urlchange"));
}
