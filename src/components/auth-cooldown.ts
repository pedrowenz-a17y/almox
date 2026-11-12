"use client";
import { useEffect, useState } from "react";
export function useAuthCooldown() {
  const [deadline, setDeadline] = useState(0), [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!deadline) return;
    const timer = setInterval(() => { const time = Date.now(); setNow(time); if (time >= deadline) clearInterval(timer); }, 1000);
    return () => clearInterval(timer);
  }, [deadline]);
  const remaining = Math.max(0, Math.ceil((deadline - now) / 1000));
  return { remaining, wait: (seconds: number) => { const time = Date.now(); setNow(time); setDeadline(time + Math.max(0, Math.min(3600, seconds)) * 1000); },
    label: remaining >= 60 ? `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}` : `${remaining}s` };
}
