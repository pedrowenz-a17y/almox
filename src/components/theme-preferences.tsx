"use client";

import { createContext, useContext, useLayoutEffect, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "dark" | "light";
const KEY = "almox-theme";
const EVENT = "almox-theme-change";
let temporary: Theme | null = null;
const ThemeContext = createContext({ theme: "dark" as Theme, toggle: () => {} });

function snapshot(): Theme {
  if (temporary) return temporary;
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

function subscribe(notify: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === KEY || event.key === null) {
      temporary = null;
      notify();
    }
  };
  window.addEventListener("storage", storage);
  window.addEventListener(EVENT, notify);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(EVENT, notify);
  };
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "dark" as Theme);
  useLayoutEffect(() => {
    // Read the current preference, including during the first hydration render.
    document.documentElement.dataset.theme = snapshot();
  }, [theme]);

  function toggle() {
    const next = snapshot() === "dark" ? "light" : "dark";
    try {
      localStorage.setItem(KEY, next);
      temporary = null;
    } catch {
      temporary = next;
    }
    document.documentElement.dataset.theme = next;
    window.dispatchEvent(new Event(EVENT));
  }

  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, toggle } = useContext(ThemeContext);
  const label = theme === "dark" ? "Ativar modo claro" : "Ativar modo escuro";
  const Icon = theme === "dark" ? Sun : Moon;
  return (
    <button
      type="button"
      className={`theme-toggle ${compact ? "compact" : ""}`}
      onClick={toggle}
      aria-label={label}
      aria-pressed={theme === "dark"}
      title={label}
    >
      <Icon size={18} aria-hidden="true" />
      <span className={compact ? "sr-only" : ""}>{label}</span>
    </button>
  );
}
