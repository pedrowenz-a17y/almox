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
  MousePointer2,
  QrCode,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { brand } from "@/lib/brand";
import { Pwa } from "@/components/pwa";
import { MotionToggle, useMotion } from "@/components/motion-preferences";
import { WelcomeEffects } from "@/components/welcome-effects";

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
  const root = useRef<HTMLElement>(null);
  const visual = useRef<HTMLElement>(null);
  const { enabled } = useMotion();
  const [active, setActive] = useState(0);
  const [formFocused, setFormFocused] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [featureFocused, setFeatureFocused] = useState(false);
  const story = stories[active];
  const Icon = story.icon;
  const storyPaused = formFocused || exploring || featureFocused;
  useEffect(() => {
    if (!enabled || storyPaused) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible")
        setActive((current) => (current + 1) % stories.length);
    }, 6500);
    return () => clearInterval(timer);
  }, [enabled, storyPaused, active]);
  return (
    <main
      ref={root}
      className={`login-shell uca-auth-shell welcome-shell ${storyPaused ? "auth-is-editing" : ""}`}
    >
      <section
        className="login-story uca-login-visual"
        ref={visual}
        data-scene={story.className}
        onFocusCapture={() => setFeatureFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setFeatureFocused(false);
        }}
      >
        <div className="welcome-ambient" aria-hidden="true">
          <i />
          <i />
          <i />
          <span className="welcome-grid" />
        </div>
        <WelcomeEffects surface={visual} scope={root} />
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
          <h1
            className="welcome-headline"
            aria-label="Tudo no lugar. Trabalho em movimento."
          >
            {["Tudo no lugar.", "Trabalho em", "movimento."].map(
              (line, lineIndex) => (
                <span className="welcome-line" key={line} aria-hidden="true">
                  <span className={lineIndex === 2 ? "welcome-red-word" : ""}>
                    {Array.from(line).map((letter, index) => (
                      <span className="welcome-letter" key={index}>
                        {letter === " " ? "\u00a0" : letter}
                      </span>
                    ))}
                  </span>
                </span>
              ),
            )}
          </h1>
          <p className="welcome-lead">
            Menos tempo procurando peças.
            <br />
            Mais tempo fazendo acontecer.
          </p>
          <div
            className="welcome-showcase"
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") setExploring(true);
            }}
            onPointerLeave={() => setExploring(false)}
          >
            <div className="welcome-explore-hint">
              <MousePointer2 size={14} />
              <span className="explore-mouse">
                Passe o mouse. Descubra o movimento.
              </span>
              <span className="explore-touch">Toque nos pontos e explore.</span>
              <span className="explore-line" />
            </div>
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
              <div className="welcome-photo-scan" aria-hidden="true" />
              <svg
                className="welcome-photo-route"
                viewBox="0 0 1000 600"
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                <path
                  className="photo-route-base"
                  d="M155 190 C300 100 430 390 540 290 S730 100 840 210"
                />
                <path
                  className="photo-route-flow"
                  d="M155 190 C300 100 430 390 540 290 S730 100 840 210"
                />
              </svg>
              <div
                className="welcome-scene-label"
                aria-hidden="true"
                key={story.label}
              >
                <Icon size={16} /> {story.detail}
              </div>
              {stories.map((item, index) => (
                <button
                  key={item.label}
                  type="button"
                  className={`welcome-photo-point photo-point-${item.className} ${active === index ? "active" : ""}`}
                  aria-label={`Conhecer recurso: ${item.label}`}
                  aria-pressed={active === index}
                  data-magnetic=""
                  onPointerEnter={(event) => {
                    if (event.pointerType === "mouse") setActive(index);
                  }}
                  onFocus={() => setActive(index)}
                  onClick={() => setActive(index)}
                >
                  <span className="photo-point-icon">
                    <item.icon size={21} />
                  </span>
                  <span className="photo-point-label">{item.label}</span>
                </button>
              ))}
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
                <Icon size={24} />
              </span>
              <div key={story.label} className="welcome-float-copy">
                <strong>{story.detail}</strong>
                <small>Explore. Conheça. Faça acontecer.</small>
              </div>
              <ArrowUpRight size={18} />
            </div>
          </div>
          <section
            className={`welcome-story welcome-story-${story.className}`}
            aria-label="Conheça os recursos do ERP"
            onPointerEnter={(event) => {
              if (event.pointerType === "mouse") setExploring(true);
            }}
            onPointerLeave={() => setExploring(false)}
          >
            <div className="welcome-story-tabs">
              {stories.map((item, index) => (
                <button
                  type="button"
                  key={item.label}
                  data-magnetic=""
                  aria-pressed={index === active}
                  onPointerEnter={(event) => {
                    if (event.pointerType === "mouse") setActive(index);
                  }}
                  onFocus={() => setActive(index)}
                  onClick={() => setActive(index)}
                  className={index === active ? "active" : ""}
                >
                  <item.icon size={17} />
                  {item.label}
                  <span
                    className="story-progress"
                    key={`${active}-${enabled}-${storyPaused}`}
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
