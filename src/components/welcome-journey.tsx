"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Boxes, ClipboardCheck, QrCode } from "lucide-react";
import { brand } from "@/lib/brand";
import { useMotion } from "@/components/motion-preferences";

const FIRST = "M155 190 C300 100 430 390 540 290";
const ROUTE = `${FIRST} S730 100 840 210`;
const STOPS = [0, 0.42, 0.86];
const steps = [
  {
    label: "Encontre",
    icon: QrCode,
    className: "locate",
    copy: "Encontre materiais pelo QR Code.",
  },
  {
    label: "Movimente",
    icon: Boxes,
    className: "move",
    copy: "Acompanhe o material do estoque à ordem.",
  },
  {
    label: "Confira",
    icon: ClipboardCheck,
    className: "check",
    copy: "Confira o estoque e consulte o histórico.",
  },
] as const;

export function WelcomeJourney({ paused }: { paused: boolean }) {
  const { enabled } = useMotion();
  const captionId = useId();
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const selected = useRef(0);
  const phase = useRef(0);
  const path = useRef<SVGPathElement>(null);
  const first = useRef<SVGPathElement>(null);
  const trail = useRef<SVGPathElement>(null);
  const light = useRef<SVGCircleElement>(null);
  const geometry = useRef<{ length: number; middle: number } | null>(null);

  // One clock moves the light, draws the red trail and activates each box on arrival.
  const paint = useCallback((value: number) => {
    if (!path.current || !first.current || !trail.current || !light.current)
      return;
    if (!geometry.current) {
      const length = path.current.getTotalLength();
      geometry.current = {
        length,
        middle: first.current.getTotalLength() / length,
      };
    }
    const { length, middle } = geometry.current;
    const progress =
      value < 0.1
        ? 0
        : value < 0.42
          ? ((value - 0.1) / 0.32) * middle
          : value < 0.52
            ? middle
            : value < 0.86
              ? middle + ((value - 0.52) / 0.34) * (1 - middle)
              : 1;
    const point = path.current.getPointAtLength(progress * length);
    trail.current.style.strokeDashoffset = String(100 - progress * 100);
    light.current.setAttribute("cx", String(point.x));
    light.current.setAttribute("cy", String(point.y));
    const next = value >= 0.86 ? 2 : value >= 0.42 ? 1 : 0;
    if (next !== selected.current) {
      selected.current = next;
      setActive(next);
    }
  }, []);

  useEffect(() => {
    paint(phase.current);
    if (!enabled || paused || hovered || focused) return;
    let frame = 0;
    let previous = 0;
    let inView = false;
    const tick = (now: number) => {
      if (document.hidden || !inView) return;
      frame = requestAnimationFrame(tick);
      if (previous && now - previous < 1000 / 30) return;
      // Exclude time spent in another tab or away from the photograph.
      if (previous)
        phase.current =
          (phase.current + Math.min(now - previous, 80) / 10500) % 1;
      previous = now;
      paint(phase.current);
    };
    const sync = () => {
      cancelAnimationFrame(frame);
      previous = 0;
      if (!document.hidden && inView) frame = requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      sync();
    });
    if (path.current?.ownerSVGElement)
      observer.observe(path.current.ownerSVGElement);
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [enabled, paused, hovered, focused, paint]);

  function select(index: number) {
    phase.current = STOPS[index];
    paint(phase.current);
  }

  return (
    <figure
      className="welcome-showcase welcome-journey"
      data-step={active}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setFocused(false);
      }}
    >
      <div
        className={`uca-photo-frame ${brand.implementPhotoPath ? "has-photo" : "without-photo"}`}
      >
        {brand.implementPhotoPath && (
          <img
            className="uca-implement-photo"
            src={brand.implementPhotoPath}
            alt={brand.implementPhotoAlt}
            width={1000}
            height={700}
            fetchPriority="high"
          />
        )}
        <div className="welcome-photo-vignette" aria-hidden="true" />
        <svg
          className="welcome-photo-route"
          viewBox="0 0 1000 600"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path ref={first} d={FIRST} className="journey-measure" />
          <path ref={path} d={ROUTE} className="photo-route-base" />
          <path
            ref={trail}
            d={ROUTE}
            pathLength="100"
            className="photo-route-flow"
          />
          <circle
            ref={light}
            className="photo-route-light"
            cx="155"
            cy="190"
            r="7"
          />
        </svg>
        {steps.map((step, index) => (
          <button
            key={step.label}
            type="button"
            className={`welcome-photo-point photo-point-${step.className} ${index <= active ? "reached" : ""} ${index === active ? "active" : ""}`}
            aria-label={`Conhecer recurso: ${step.label}`}
            aria-pressed={active === index}
            aria-describedby={captionId}
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") {
                setHovered(true);
                select(index);
              }
            }}
            onPointerLeave={() => setHovered(false)}
            onPointerCancel={() => setHovered(false)}
            onFocus={(event) => {
              setFocused(event.currentTarget.matches(":focus-visible"));
              select(index);
            }}
            onClick={() => select(index)}
          >
            <span className="photo-point-icon">
              <step.icon size={21} />
            </span>
            <span className="photo-point-label">{step.label}</span>
          </button>
        ))}
      </div>
      <figcaption id={captionId} className="journey-caption">
        {steps[active].copy}
      </figcaption>
    </figure>
  );
}
