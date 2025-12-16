"use client";

import { useEffect, useMemo, useState } from "react";

type Theme = "light" | "dark";

const STORAGE_KEY = "theme";

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
}

export function ThemeToggle() {
  const [mounted, setMounted] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");

  useEffect(() => {
    setMounted(true);
    setTheme(getEffectiveTheme());

    const mql = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mql) return;

    const onChange = () => {
      // If user has no explicit override, reflect system changes.
      const root = document.documentElement;
      if (!root.classList.contains("light") && !root.classList.contains("dark")) {
        setTheme(getEffectiveTheme());
      }
    };

    mql.addEventListener?.("change", onChange);
    return () => mql.removeEventListener?.("change", onChange);
  }, []);

  const label = useMemo(() => {
    if (!mounted) return "Theme";
    return theme === "dark" ? "Dark" : "Light";
  }, [mounted, theme]);

  return (
    <button
      type="button"
      aria-label="Toggle theme"
      onClick={() => {
        const next: Theme = getEffectiveTheme() === "dark" ? "light" : "dark";
        applyTheme(next);
        setTheme(next);
      }}
      className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm font-medium text-foreground shadow-sm transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-ring/30"
    >
      <span aria-hidden className="text-base leading-none">
        {mounted && theme === "dark" ? "🌙" : "☀︎"}
      </span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}


