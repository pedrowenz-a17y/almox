"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowDown, LockKeyhole, ShieldCheck, Wrench } from "lucide-react";
import { brand } from "@/lib/brand";
import { Pwa } from "@/components/pwa";
import { useMotion } from "@/components/motion-preferences";
import { WelcomePhoto } from "@/components/welcome-photo";
import { WelcomeEffects } from "@/components/welcome-effects";
import { ThemeToggle } from "@/components/theme-preferences";

export default function AuthShell({
  title,
  description,
  children,
  fitScreen = false,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  fitScreen?: boolean;
}) {
  const root = useRef<HTMLElement>(null);
  const visual = useRef<HTMLElement>(null);
  const { enabled, toggle } = useMotion();
  const [formFocused, setFormFocused] = useState(false);
  return (
    <main
      ref={root}
      className={`login-shell uca-auth-shell welcome-shell ${fitScreen ? "login-screen" : ""} ${formFocused ? "auth-is-editing" : ""}`}
    >
      <section className="login-story uca-login-visual" ref={visual}>
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
          <WelcomePhoto />
          {!fitScreen && (
            <a className="welcome-skip" href="#login-access">
              Ir para o acesso <ArrowDown size={15} />
            </a>
          )}
        </div>
        <p className="uca-auth-context">
          <span>{brand.context}</span>
          <span>Feito para o dia a dia da equipe.</span>
        </p>
      </section>
      <section
        id="login-access"
        className="login-form-wrap"
        onFocusCapture={(event) => {
          setFormFocused(Boolean((event.target as Element).closest("form")));
        }}
        onBlurCapture={(event) => {
          const next = event.relatedTarget;
          setFormFocused(
            next instanceof Element &&
              event.currentTarget.contains(next) &&
              Boolean(next.closest("form")),
          );
        }}
      >
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
            <br />
            <Link href="/instalar" className="text-link">Instalar o Almox neste dispositivo</Link>
          </p>
          <div className="welcome-form-signature">
            <Wrench size={14} />
            <span>Organização para quem coloca a mão na massa.</span>
          </div>
          <div className="auth-preferences">
            <button
              type="button"
              className="welcome-motion-link"
              onClick={toggle}
              aria-pressed={!enabled}
            >
              {enabled ? "Reduzir movimento" : "Ativar movimento"}
            </button>
            <ThemeToggle />
          </div>
        </div>
      </section>
      <Pwa />
    </main>
  );
}
