"use client";

import {
  createContext,
  useContext,
  useEffect,
  useSyncExternalStore,
} from "react";
import { Pause, Play } from "lucide-react";

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
  if (transientPreference) return transientPreference;
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "full" || saved === "quiet") return saved;
  } catch {
    // The device preference remains available when storage is blocked.
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "system"
    : "full";
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
  const label = enabled ? "Pausar animações" : "Ativar animações";
  const Icon = enabled ? Pause : Play;
  return (
    <button
      type="button"
      className={`motion-toggle ${compact ? "compact" : ""}`}
      aria-label={label}
      title={
        systemReduced
          ? "Seu dispositivo reduz o movimento. Clique para ativar as animações."
          : label
      }
      aria-pressed={!enabled}
      onClick={toggle}
    >
      <Icon size={compact ? 17 : 15} />
      <span className={compact ? "sr-only" : ""}>{label}</span>
    </button>
  );
}
