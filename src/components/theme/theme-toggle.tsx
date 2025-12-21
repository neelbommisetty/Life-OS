"use client";

import { useSyncExternalStore } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "theme";
const THEME_EVENT = "themechange";

function getSystemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function getEffectiveTheme(): Theme {
  const root = document.documentElement;
  if (root.classList.contains("dark")) return "dark";
  if (root.classList.contains("light")) return "light";
  return getSystemTheme();
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {}
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(THEME_EVENT));
  }
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(
    (callback) => {
      if (typeof window === "undefined") {
        return () => {};
      }

      const onChange = () => callback();
      const mql = window.matchMedia?.("(prefers-color-scheme: dark)");

      mql?.addEventListener?.("change", onChange);
      window.addEventListener(THEME_EVENT, onChange);

      return () => {
        mql?.removeEventListener?.("change", onChange);
        window.removeEventListener(THEME_EVENT, onChange);
      };
    },
    () => (typeof document === "undefined" ? "light" : getEffectiveTheme()),
    () => "light"
  );

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => {
        const next: Theme = getEffectiveTheme() === "dark" ? "light" : "dark";
        applyTheme(next);
      }}
      className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/30"
    >
      <span aria-hidden className="text-base leading-none">
        {theme === "dark" ? "🌙" : "☀︎"}
      </span>
      <span className="hidden sm:inline">{theme === "dark" ? "Dark" : "Light"}</span>
    </button>
  );
}

