"use client";
import Link from "next/link";
import { useRef } from "react";
import { LockKeyhole, ShieldCheck } from "lucide-react";
import { brand } from "@/lib/brand";
import { Pwa } from "@/components/pwa";

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
  const reset = () => {
    visual.current?.style.setProperty("--tilt-x", "0deg");
    visual.current?.style.setProperty("--tilt-y", "0deg");
  };
  return (
    <main className="login-shell uca-auth-shell">
      <section
        className="login-story uca-login-visual"
        ref={visual}
        onPointerLeave={reset}
        onPointerMove={(event) => {
          if (
            event.pointerType !== "mouse" ||
            window.matchMedia("(prefers-reduced-motion: reduce)").matches
          )
            return;
          const rect = event.currentTarget.getBoundingClientRect();
          visual.current?.style.setProperty(
            "--tilt-x",
            `${-((event.clientY - rect.top) / rect.height - 0.5) * 3}deg`,
          );
          visual.current?.style.setProperty(
            "--tilt-y",
            `${((event.clientX - rect.left) / rect.width - 0.5) * 3}deg`,
          );
        }}
      >
        <Link
          className="uca-auth-brand"
          href="/login"
          aria-label="Almox ERP — entrar"
        >
          {brand.logoPath ? (
            <img
              src={brand.logoPath}
              width={100}
              height={100}
              alt={brand.organization}
            />
          ) : (
            <span className="uca-wordmark">
              U.C.A.<small>IMPLEMENTOS AGRÍCOLAS</small>
            </span>
          )}
          <span>
            ALMOX ERP<small>Gestão de materiais</small>
          </span>
        </Link>
        <div className="uca-visual-body">
          <p className="eyebrow">CONTROLE INDUSTRIAL</p>
          <h1>
            Rastreabilidade
            <br /> em cada operação.
          </h1>
          <p>
            Materiais, estoque e aplicação em ordens, com responsáveis e
            histórico.
          </p>
          <div
            className={`uca-photo-frame ${brand.implementPhotoPath ? "has-photo" : "without-photo"}`}
          >
            {brand.implementPhotoPath ? (
              <img
                className="uca-implement-photo"
                src={brand.implementPhotoPath}
                alt={brand.implementPhotoAlt}
                width={1000}
                height={700}
                fetchPriority="high"
              />
            ) : (
              <div className="uca-operation-note">
                <ShieldCheck size={42} />
                <strong>Do recebimento à aplicação</strong>
                <span>Registros vinculados à unidade e à ordem.</span>
              </div>
            )}
            <div className="uca-technical-lines" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
            <span className="uca-photo-shine" aria-hidden="true" />
          </div>
        </div>
        <p className="uca-auth-context">{brand.context}</p>
      </section>
      <section className="login-form-wrap">
        <div className="login-form">
          <span className="login-lock">
            <LockKeyhole size={24} />
          </span>
          <h2>{title}</h2>
          <p>{description}</p>
          {children}
          <div className="login-secure">
            <ShieldCheck size={16} /> Acesso autorizado · Operações auditadas
          </div>
          <p className="login-help">
            As contas são liberadas pelo administrador responsável. Não há
            cadastro público.
          </p>
        </div>
      </section>
      <Pwa />
    </main>
  );
}
