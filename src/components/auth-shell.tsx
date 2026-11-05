"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  Boxes,
  Check,
  ClipboardCheck,
  LockKeyhole,
  QrCode,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { brand } from "@/lib/brand";
import { Pwa } from "@/components/pwa";
import { MotionToggle, useMotion } from "@/components/motion-preferences";

const stories = [
  {
    label: "Encontre",
    icon: QrCode,
    title: "Uma etiqueta. O material certo.",
    description:
      "Leia o QR Code para encontrar o produto e saber onde ele está.",
    detail: "Localize pelo QR Code",
    className: "locate",
  },
  {
    label: "Movimente",
    icon: Boxes,
    title: "Cada peça segue o seu caminho.",
    description:
      "Da entrada à aplicação na ordem, acompanhe o material em cada etapa.",
    detail: "Do estoque para a ordem",
    className: "move",
  },
  {
    label: "Confira",
    icon: ClipboardCheck,
    title: "Confiança para o próximo passo.",
    description:
      "Confira o físico, revise as diferenças e mantenha a equipe na mesma página.",
    detail: "Conferência e histórico",
    className: "check",
  },
] as const;

export default function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  const visual = useRef<HTMLElement>(null);
  const frame = useRef<number | null>(null);
  const { enabled } = useMotion();
  const [active, setActive] = useState(0);
  const [formFocused, setFormFocused] = useState(false);
  const story = stories[active];
  const Icon = story.icon;
  const reset = () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    visual.current?.style.setProperty("--tilt-x", "0deg");
    visual.current?.style.setProperty("--tilt-y", "0deg");
  };
  useEffect(() => {
    if (!enabled || formFocused) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        setActive((current) => (current + 1) % stories.length);
    }, 6500);
    return () => clearInterval(timer);
  }, [enabled, formFocused, active]);
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );
  return (
    <main
      className={`login-shell uca-auth-shell welcome-shell ${formFocused ? "auth-is-editing" : ""}`}
    >
      <section
        className="login-story uca-login-visual"
        ref={visual}
        onPointerLeave={reset}
        onPointerMove={(event) => {
          if (event.pointerType !== "mouse" || !enabled || formFocused) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const x = (event.clientX - rect.left) / rect.width;
          const y = (event.clientY - rect.top) / rect.height;
          if (frame.current !== null) cancelAnimationFrame(frame.current);
          frame.current = requestAnimationFrame(() => {
            visual.current?.style.setProperty(
              "--tilt-x",
              `${-(y - 0.5) * 4}deg`,
            );
            visual.current?.style.setProperty(
              "--tilt-y",
              `${(x - 0.5) * 5}deg`,
            );
          });
        }}
      >
        <div className="welcome-ambient" aria-hidden="true">
          <i />
          <i />
          <i />
          <span className="welcome-grid" />
        </div>
        <Link
          className="uca-auth-brand"
          href="/login"
          aria-label="Almox ERP — entrar"
        >
          {brand.logoPath && (
            <img
              src={brand.logoPath}
              width={115}
              height={74}
              alt={brand.organization}
            />
          )}
          <span>
            Almox<span className="brand-erp">ERP</span>
            <small>U.C.A. Implementos Agrícolas</small>
          </span>
        </Link>
        <div className="uca-visual-body">
          <p className="welcome-overline">
            <span /> Do almoxarifado à produção
          </p>
          <h1 className="welcome-headline">
            <span>
              <span>Tudo no lugar.</span>
            </span>
            <span>
              <span>Trabalho em</span>
            </span>
            <span>
              <span className="welcome-red-word">movimento.</span>
            </span>
          </h1>
          <p className="welcome-lead">
            Menos tempo procurando peças.
            <br />
            Mais tempo fazendo acontecer.
          </p>
          <div className="welcome-showcase">
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
              <div className="welcome-photo-caption">
                <span className="welcome-photo-mark">
                  <Check size={14} />
                </span>{" "}
                A força de quem produz.
              </div>
              <div className="uca-technical-lines" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
              <span className="uca-photo-shine" aria-hidden="true" />
            </div>
            <div className="welcome-float-tag" aria-hidden="true">
              <span>
                <QrCode size={24} />
              </span>
              <div>
                <strong>Encontrou. Conferiu.</strong>
                <small>O próximo passo fica mais simples.</small>
              </div>
              <ArrowUpRight size={18} />
            </div>
          </div>
          <section
            className={`welcome-story welcome-story-${story.className}`}
            aria-label="Conheça os recursos do ERP"
          >
            <div className="welcome-story-tabs">
              {stories.map((item, index) => (
                <button
                  type="button"
                  key={item.label}
                  aria-pressed={index === active}
                  onClick={() => setActive(index)}
                  className={index === active ? "active" : ""}
                >
                  <item.icon size={17} />
                  {item.label}
                  <span
                    className="story-progress"
                    key={`${active}-${enabled}-${formFocused}`}
                    aria-hidden="true"
                  />
                </button>
              ))}
            </div>
            <div className="welcome-story-copy" key={story.label}>
              <span className="welcome-story-icon">
                <Icon size={20} />
              </span>
              <div>
                <h2>{story.title}</h2>
                <p>{story.description}</p>
              </div>
            </div>
          </section>
          <a className="welcome-skip" href="#login-access">
            Ir para o acesso <ArrowDown size={15} />
          </a>
        </div>
        <p className="uca-auth-context">
          <span>{brand.context}</span>
          <span>Feito para o dia a dia da equipe.</span>
        </p>
      </section>
      <section
        id="login-access"
        className="login-form-wrap"
        onFocusCapture={() => {
          setFormFocused(true);
          reset();
        }}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setFormFocused(false);
        }}
      >
        <div className="auth-utility">
          <MotionToggle />
        </div>
        <div className="login-form">
          <div className="welcome-form-heading">
            <span className="login-lock">
              <LockKeyhole size={24} />
            </span>
            <span className="welcome-team-label">Acesso da equipe</span>
          </div>
          <h2>{title}</h2>
          <p>{description}</p>
          {children}
          <div className="login-secure">
            <ShieldCheck size={16} />
            <span>
              Seu acesso, sua unidade.
              <br />
              <small>Movimentações com responsável e histórico.</small>
            </span>
          </div>
          <p className="login-help">
            Precisa de acesso? Fale com o administrador da sua unidade.
          </p>
          <div className="welcome-form-signature">
            <Wrench size={14} />
            <span>Organização para quem coloca a mão na massa.</span>
          </div>
        </div>
      </section>
      <Pwa />
    </main>
  );
}
