"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Html5Qrcode } from "html5-qrcode";
import { api } from "@/lib/client";

export type ScannedLocation = {
  kind?: "location" | "product";
  id: string;
  code: string;
  name: string;
  parentId?: string | null;
  warehouseId?: string;
};

type ScannerProps = {
  scope?: "location" | "any";
  onResolved: (location: ScannedLocation) => void;
  onClose?: () => void;
  title?: string;
};

/** Camera access is lazy and the stream is closed on resolution, cancellation and unmount. */
export function Scanner({
  onResolved,
  onClose,
  title = "Escanear QR Code",
  scope = "location",
}: ScannerProps) {
  const readerId = `qr-reader-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const scanner = useRef<Html5Qrcode | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const resolving = useRef(false);
  const [code, setCode] = useState("");
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const stop = useCallback(async () => {
    generation.current += 1;
    const current = scanner.current;
    scanner.current = null;
    if (current) {
      try {
        if (current.isScanning) await current.stop();
      } catch {
        /* Already stopped. */
      }
      try {
        current.clear();
      } catch {
        /* A starting scanner is closed when its promise resolves. */
      }
    }
    if (mounted.current) {
      setRunning(false);
      setStarting(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void stop();
    };
  }, [stop]);

  async function resolve(value: string) {
    if (resolving.current || !value.trim()) return;
    resolving.current = true;
    setBusy(true);
    setError("");
    try {
      if (!navigator.onLine)
        throw new Error(
          "Sem conexão. Não é possível consultar a localização no momento.",
        );
      const location = await api<ScannedLocation>(
        `/api/resolve?scope=${scope}&code=${encodeURIComponent(value.trim())}`,
      );
      await stop();
      if (mounted.current) onResolved(location);
    } catch (cause) {
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "QR Code inválido.");
    } finally {
      resolving.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  async function start() {
    if (starting || running) return;
    setError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError(
        "A câmera precisa de HTTPS (ou localhost). Digite o código da etiqueta abaixo.",
      );
      return;
    }
    setStarting(true);
    const run = ++generation.current;
    try {
      const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import(
        "html5-qrcode"
      );
      if (!mounted.current || run !== generation.current) return;
      const current = new Html5Qrcode(readerId, {
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
        verbose: false,
      });
      scanner.current = current;
      await current.start(
        { facingMode: "environment" },
        {
          fps: 10,
          qrbox: (width, height) => ({
            width: Math.floor(Math.min(width, height, 320) * 0.75),
            height: Math.floor(Math.min(width, height, 320) * 0.75),
          }),
          aspectRatio: 1,
        },
        (decoded) => {
          void resolve(decoded);
        },
        () => {
          /* Normal frames without a readable QR are not errors. */
        },
      );
      if (!mounted.current || run !== generation.current) {
        try {
          await current.stop();
          current.clear();
        } catch {
          /* Stream already released. */
        }
        return;
      }
      setRunning(true);
    } catch (cause) {
      if (!mounted.current || run !== generation.current) return;
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(
        /NotAllowed|Permission|denied/i.test(message)
          ? "Permissão da câmera negada. Autorize a câmera nas configurações do navegador ou digite o código."
          : /NotFound|DevicesNotFound/i.test(message)
            ? "Nenhuma câmera encontrada. Digite o código da etiqueta."
            : "Não foi possível abrir a câmera. Feche outros aplicativos que a utilizam e tente novamente.",
      );
      await stop();
    } finally {
      if (mounted.current && run === generation.current) setStarting(false);
    }
  }

  return (
    <section className="scanner-card" aria-label={title}>
      <div className="scanner-heading">
        <div>
          <h2>{title}</h2>
          <p>
            {scope === "any"
              ? "Aponte a câmera para a etiqueta do produto ou da localização."
              : "Aponte a câmera para a etiqueta da localização."}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              void stop();
              onClose();
            }}
            aria-label="Fechar leitor"
          >
            Fechar
          </button>
        )}
      </div>
      <div
        id={readerId}
        className="scanner-viewport"
        aria-label="Imagem da câmera"
      />
      <div className="scanner-controls">
        {!running && (
          <button
            className="btn btn-primary"
            type="button"
            disabled={starting || busy}
            onClick={() => void start()}
          >
            {starting ? "Abrindo câmera…" : "Abrir câmera"}
          </button>
        )}
        {running && (
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => void stop()}
          >
            Desligar câmera
          </button>
        )}
        {running && (
          <span role="status">
            {busy ? "Conferindo etiqueta…" : "Aguardando leitura da etiqueta"}
          </span>
        )}
      </div>
      <form
        className="scanner-manual"
        onSubmit={(event) => {
          event.preventDefault();
          void resolve(code);
        }}
      >
        <label htmlFor={`${readerId}-code`}>
          Ou digite o código da localização
        </label>
        <div>
          <input
            id={`${readerId}-code`}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="Ex.: ALM-A-E02-P03"
            maxLength={500}
            autoComplete="off"
            autoCapitalize="characters"
            required
          />
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy || !code.trim()}
          >
            {busy ? "Buscando…" : "Localizar"}
          </button>
        </div>
      </form>
      {error && (
        <p className="scanner-error" role="alert">
          {error}
        </p>
      )}
      <style jsx>{`
        .scanner-card {
          border: 1px solid #dce5e2;
          border-radius: 16px;
          background: white;
          padding: 24px;
          max-width: 640px;
          margin: auto;
        }
        .scanner-heading {
          display: flex;
          gap: 16px;
          justify-content: space-between;
          align-items: flex-start;
        }
        .scanner-heading h2 {
          margin: 0 0 8px;
          font-size: 22px;
        }
        .scanner-heading p {
          margin: 0;
          color: #64736c;
          font-size: 14px;
        }
        .scanner-viewport {
          width: 100%;
          max-width: 420px;
          margin: 20px auto;
          background: #eef4f1;
          border-radius: 12px;
          overflow: hidden;
        }
        .scanner-viewport:empty {
          min-height: 150px;
          display: grid;
          place-items: center;
        }
        .scanner-viewport:empty:before {
          content: "A câmera será ativada com sua permissão";
          font-size: 13px;
          color: #64736c;
          padding: 24px;
          text-align: center;
        }
        .scanner-controls {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
          font-size: 13px;
          color: #64736c;
        }
        .scanner-manual {
          margin-top: 24px;
        }
        .scanner-manual label {
          display: block;
          font-size: 14px;
          font-weight: 600;
          margin-bottom: 8px;
        }
        .scanner-manual > div {
          display: flex;
          gap: 8px;
        }
        .scanner-manual input {
          min-width: 0;
          flex: 1;
          border: 1px solid #cbd5cf;
          border-radius: 8px;
          padding: 12px;
          font-size: 16px;
        }
        .scanner-error {
          color: #a82828;
          background: #fff0ef;
          padding: 12px;
          border-radius: 8px;
          font-size: 14px;
        }
        .scanner-card button {
          min-height: 44px;
        }
        .scanner-card button:disabled {
          opacity: 0.6;
        }
        .scanner-card .btn {
          border-radius: 8px;
          padding: 10px 16px;
          font-weight: 600;
          cursor: pointer;
          border: 1px solid #dce5e2;
          white-space: nowrap;
        }
        .scanner-card .btn-primary {
          background: var(--teal);
          border-color: var(--teal);
          color: white;
        }
        .scanner-card .btn-secondary {
          background: white;
          color: var(--text);
        }
        @media (max-width: 480px) {
          .scanner-card {
            padding: 16px;
          }
          .scanner-heading h2 {
            font-size: 20px;
          }
          .scanner-manual > div {
            flex-wrap: wrap;
          }
          .scanner-manual input {
            flex-basis: 100%;
          }
          .scanner-manual button {
            width: 100%;
          }
        }
      `}</style>
    </section>
  );
}
