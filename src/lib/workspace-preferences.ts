"use client";

import { useSyncExternalStore } from "react";

export const startPages = {
  "/dashboard": "Painel",
  "/estoque": "Estoque",
  "/consulta": "Consulta rápida",
  "/operacao": "Operação rápida",
} as const;

type StartPage = keyof typeof startPages;
type Preferences = { startPage: StartPage; compactTables: boolean };
const defaults: Preferences = { startPage: "/dashboard", compactTables: false };
const storageKey = "almox-workspace-preferences";
const changeEvent = "almox-workspace-preferences-change";
let temporary: string | undefined;

function snapshot() {
  if (temporary !== undefined) return temporary;
  try {
    return localStorage.getItem(storageKey) ?? "";
  } catch {
    return "";
  }
}

function parsePreferences(raw: string): Preferences {
  try {
    const value = JSON.parse(raw);
    return {
      startPage:
        typeof value?.startPage === "string" &&
        Object.hasOwn(startPages, value.startPage)
          ? value.startPage
          : defaults.startPage,
      compactTables: value?.compactTables === true,
    };
  } catch {
    return defaults;
  }
}

export function preferredStartPage() {
  return parsePreferences(snapshot()).startPage;
}

function subscribe(notify: () => void) {
  function storage(event: StorageEvent) {
    if (event.key === storageKey || event.key === null) {
      temporary = undefined;
      notify();
    }
  }
  window.addEventListener("storage", storage);
  window.addEventListener(changeEvent, notify);
  return () => {
    window.removeEventListener("storage", storage);
    window.removeEventListener(changeEvent, notify);
  };
}

function save(preferences: Preferences) {
  const value = JSON.stringify(preferences);
  try {
    localStorage.setItem(storageKey, value);
    temporary = undefined;
  } catch {
    temporary = value;
  }
  window.dispatchEvent(new Event(changeEvent));
}

export function useWorkspacePreferences() {
  const raw = useSyncExternalStore(subscribe, snapshot, () => "");
  const preferences = parsePreferences(raw);
  return {
    ...preferences,
    setStartPage: (page: string) => {
      if (Object.hasOwn(startPages, page))
        save({ ...parsePreferences(snapshot()), startPage: page as StartPage });
    },
    setCompactTables: (compactTables: boolean) =>
      save({ ...parsePreferences(snapshot()), compactTables }),
    reset: () => save(defaults),
  };
}
