"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useMotion } from "@/components/motion-preferences";

type SurfaceRef = RefObject<HTMLElement | null>;
type Pointer = { x: number; y: number; inside: boolean };

/** Decorative effects stay local: no React renders, requests or tracking on mousemove. */
export function WelcomeEffects({
  surface,
  scope,
}: {
  surface: SurfaceRef;
  scope: SurfaceRef;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<Pointer>({ x: 0, y: 0, inside: false });
  const bursts = useRef<{ x: number; y: number; start: number }[]>([]);
  const { enabled } = useMotion();

  useEffect(() => {
    const panel = surface.current;
    const root = scope.current;
    if (!panel || !root || !enabled) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    let frame = 0;
    let magnetic: HTMLElement | null = null;
    let pending: PointerEvent | null = null;
    const resetMagnet = () => {
      magnetic?.style.removeProperty("--magnet-x");
      magnetic?.style.removeProperty("--magnet-y");
      magnetic = null;
    };
    const reset = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      pending = null;
      pointer.current.inside = false;
      panel.removeAttribute("data-pointer");
      panel.style.removeProperty("--tilt-x");
      panel.style.removeProperty("--tilt-y");
      panel.style.removeProperty("--depth-x");
      panel.style.removeProperty("--depth-y");
      resetMagnet();
    };
    const update = () => {
      frame = 0;
      const event = pending;
      if (!event) return;
      const target = event.target as HTMLElement;
      const next = target.closest<HTMLElement>(
        "[data-magnetic], .login-submit:not(:disabled)",
      );
      // Read geometry before writing styles to avoid layout thrashing.
      const panelRect = panel.getBoundingClientRect();
      const buttonRect = next?.getBoundingClientRect();
      const inPanel = panel.contains(target);
      if (next !== magnetic) resetMagnet();
      magnetic = next;
      if (magnetic && buttonRect) {
        const x = Math.max(
          -8,
          Math.min(
            8,
            (event.clientX - buttonRect.left - buttonRect.width / 2) * 0.16,
          ),
        );
        const y = Math.max(
          -6,
          Math.min(
            6,
            (event.clientY - buttonRect.top - buttonRect.height / 2) * 0.2,
          ),
        );
        magnetic.style.setProperty("--magnet-x", `${x}px`);
        magnetic.style.setProperty("--magnet-y", `${y}px`);
      }
      pointer.current.inside = inPanel;
      if (!inPanel) {
        panel.removeAttribute("data-pointer");
        return;
      }
      const x = event.clientX - panelRect.left;
      const y = event.clientY - panelRect.top;
      pointer.current = { x, y, inside: true };
      panel.dataset.pointer = "active";
      panel.style.setProperty("--pointer-x", `${x}px`);
      panel.style.setProperty("--pointer-y", `${y}px`);
      panel.style.setProperty(
        "--tilt-x",
        `${-(y / panelRect.height - 0.5) * 12}deg`,
      );
      panel.style.setProperty(
        "--tilt-y",
        `${(x / panelRect.width - 0.5) * 16}deg`,
      );
      panel.style.setProperty(
        "--depth-x",
        `${(x / panelRect.width - 0.5) * 24}px`,
      );
      panel.style.setProperty(
        "--depth-y",
        `${(y / panelRect.height - 0.5) * 18}px`,
      );
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !fine.matches) return;
      pending = event;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const burst = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !fine.matches) return;
      const rect = panel.getBoundingClientRect();
      bursts.current = [
        ...bursts.current.slice(-3),
        {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
          start: performance.now(),
        },
      ];
    };
    const hide = () => {
      if (document.hidden) reset();
    };
    root.addEventListener("pointermove", move, { passive: true });
    root.addEventListener("pointerleave", reset);
    panel.addEventListener("pointerleave", reset);
    panel.addEventListener("pointerdown", burst, { passive: true });
    document.addEventListener("visibilitychange", hide);
    return () => {
      reset();
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerleave", reset);
      panel.removeEventListener("pointerleave", reset);
      panel.removeEventListener("pointerdown", burst);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [enabled, scope, surface]);

  useEffect(() => {
    const element = canvas.current;
    const panel = surface.current;
    const context = element?.getContext("2d");
    if (!element || !panel || !context || !enabled) return;
    let width = 0;
    let height = 0;
    let frame = 0;
    let lastDraw = 0;
    let inView = false;
    let phase = 0;
    let lastTick = 0;
    const particles = Array.from({ length: 38 }, (_, index) => ({
      x: ((index * 73 + 19) % 101) / 101,
      y: ((index * 43 + 7) % 103) / 103,
      speed: 0.3 + (index % 5) * 0.1,
    }));
    const resize = () => {
      width = panel.clientWidth;
      height = panel.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      element.width = Math.round(width * dpr);
      element.height = Math.round(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    const draw = (now: number) => {
      frame = 0;
      if (document.hidden || !inView) return;
      frame = requestAnimationFrame(draw);
      // Cap drawing at 30 fps; idle motion needs no 60 fps canvas repaint.
      if (now - lastDraw < 1000 / 30) return;
      lastDraw = now;
      phase += lastTick ? Math.min(now - lastTick, 50) / 1000 : 0;
      lastTick = now;
      context.clearRect(0, 0, width, height);
      const mouse = pointer.current;
      const trail: { x: number; y: number }[] = [];
      for (const [index, particle] of particles.entries()) {
        let x =
          particle.x * width + Math.sin(phase * particle.speed + index) * 28;
        let y =
          (particle.y * height -
            phase * (8 + particle.speed * 8) +
            height * 10) %
          height;
        const dx = x - mouse.x;
        const dy = y - mouse.y;
        const distance = Math.hypot(dx, dy);
        const near = mouse.inside && distance < 210;
        if (near) {
          const push = (1 - distance / 210) * 36;
          x += (dx / (distance || 1)) * push;
          y += (dy / (distance || 1)) * push;
          context.beginPath();
          context.moveTo(mouse.x, mouse.y);
          context.lineTo(x, y);
          context.strokeStyle = `rgba(255, 78, 112, ${(1 - distance / 210) * 0.48})`;
          context.lineWidth = 0.8;
          context.stroke();
        }
        context.beginPath();
        context.arc(x, y, near ? 2.6 : 1.5, 0, Math.PI * 2);
        context.fillStyle = near ? "#ff829c" : "rgba(255, 108, 135, 0.42)";
        context.fill();
        const previous = trail[trail.length - 1];
        if (previous && Math.hypot(previous.x - x, previous.y - y) < 160) {
          context.beginPath();
          context.moveTo(previous.x, previous.y);
          context.lineTo(x, y);
          context.strokeStyle = "rgba(255, 108, 135, 0.12)";
          context.stroke();
        }
        trail.push({ x, y });
      }
      bursts.current = bursts.current.filter((item) => now - item.start < 850);
      for (const item of bursts.current) {
        const progress = (now - item.start) / 850;
        context.beginPath();
        context.arc(item.x, item.y, 12 + progress * 150, 0, Math.PI * 2);
        context.strokeStyle = `rgba(255, 105, 139, ${(1 - progress) * 0.8})`;
        context.lineWidth = 1.5;
        context.stroke();
        for (let i = 0; i < 8; i++) {
          const angle = (i / 8) * Math.PI * 2;
          const distance = 18 + progress * 115;
          context.fillStyle = `rgba(255, 195, 209, ${1 - progress})`;
          context.fillRect(
            item.x + Math.cos(angle) * distance,
            item.y + Math.sin(angle) * distance,
            3,
            3,
          );
        }
      }
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      lastTick = 0;
      if (!document.hidden && inView) frame = requestAnimationFrame(draw);
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    });
    const sizeObserver = new ResizeObserver(resize);
    resize();
    observer.observe(panel);
    sizeObserver.observe(panel);
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      sizeObserver.disconnect();
      document.removeEventListener("visibilitychange", sync);
      context.clearRect(0, 0, width, height);
      bursts.current = [];
    };
  }, [enabled, surface]);

  return (
    <div className="welcome-effects" aria-hidden="true">
      <canvas ref={canvas} className="welcome-particles" />
      <span className="welcome-spotlight" />
      <span className="welcome-cursor-halo" />
    </div>
  );
}
