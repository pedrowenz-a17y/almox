"use client";

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { Pause, Play, Accessibility } from "lucide-react";

const KEY = "almox-motion";
const EVENT = "almox-motion-change";
type Preference = "full" | "quiet" | "system";
let transientPreference: "full" | "quiet" | null = null;
const MotionContext = createContext({
  enabled: true,
  systemReduced: false,
  toggle: () => {},
});

function snapshot(): Preference {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    return "system";
  if (transientPreference) return transientPreference;
  try {
    return localStorage.getItem(KEY) === "quiet" ? "quiet" : "full";
  } catch {
    return "full";
  }
}
function subscribe(notify: () => void) {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", notify);
  window.addEventListener("storage", notify);
  window.addEventListener(EVENT, notify);
  return () => {
    media.removeEventListener("change", notify);
    window.removeEventListener("storage", notify);
    window.removeEventListener(EVENT, notify);
  };
}

export function MotionProvider({ children }: { children: React.ReactNode }) {
  const preference = useSyncExternalStore(
    subscribe,
    snapshot,
    () => "full" as Preference,
  );
  const enabled = preference === "full";
  useEffect(() => {
    document.documentElement.dataset.motion = enabled ? "full" : "quiet";
  }, [enabled]);
  useEffect(() => {
    const visibility = () => {
      document.documentElement.dataset.visibility = document.visibilityState;
    };
    visibility();
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);
  function toggle() {
    if (preference === "system") return;
    const next = enabled ? "quiet" : "full";
    try {
      localStorage.setItem(KEY, next);
      transientPreference = null;
    } catch {
      transientPreference = next;
    }
    document.documentElement.dataset.motion = next;
    window.dispatchEvent(new Event(EVENT));
  }
  return (
    <MotionContext.Provider
      value={{ enabled, systemReduced: preference === "system", toggle }}
    >
      {children}
    </MotionContext.Provider>
  );
}

export const useMotion = () => useContext(MotionContext);

export function MotionToggle({ compact = false }: { compact?: boolean }) {
  const { enabled, systemReduced, toggle } = useMotion();
  const label = systemReduced
    ? "Movimento reduzido pelo dispositivo"
    : enabled
      ? "Pausar animações"
      : "Ativar animações";
  const Icon = systemReduced ? Accessibility : enabled ? Pause : Play;
  return (
    <button
      type="button"
      className={`motion-toggle ${compact ? "compact" : ""}`}
      aria-label={label}
      title={label}
      aria-pressed={!enabled}
      disabled={systemReduced}
      onClick={toggle}
    >
      <Icon size={compact ? 17 : 15} />
      <span className={compact ? "sr-only" : ""}>
        {systemReduced
          ? "Movimento reduzido"
          : enabled
            ? "Pausar animações"
            : "Ativar animações"}
      </span>
    </button>
  );
}
