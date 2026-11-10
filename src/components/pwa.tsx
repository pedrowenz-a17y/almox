"use client";

import { useEffect, useState } from "react";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function Pwa({ inline = false }: { inline?: boolean }) {
  const [offline, setOffline] = useState(false);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  const [standalone, setStandalone] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const mode = window.matchMedia("(display-mode: standalone)");
    const display = () => setStandalone(mode.matches || ("standalone" in navigator && navigator.standalone === true));
    const update = () => setOffline(!navigator.onLine);
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallPrompt);
    };
    const installed = () => { setInstall(null); setStandalone(true); };
    update();
    display();
    mode.addEventListener("change", display);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("appinstalled", installed);
    if ("serviceWorker" in navigator && window.isSecureContext)
      void navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" }).catch(() => {
        /* Browser may prohibit service workers. Online operations remain available. */
      });
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("appinstalled", installed);
      mode.removeEventListener("change", display);
    };
  }, []);
  return (
    <>
      {offline && (
        <div className="pwa-offline" role="alert">
          Sem conexão. Não é possível registrar movimentações no momento.
        </div>
      )}
      {inline && standalone && <p role="status">O Almox já está instalado neste dispositivo.</p>}
      {install && !offline && !standalone && (
        <button
          className={`pwa-install ${inline ? "pwa-install-inline" : ""}`}
          type="button"
          disabled={installing}
          onClick={async () => {
            setInstalling(true);
            setMessage("");
            try {
              await install.prompt();
              const choice = await install.userChoice;
              if (choice.outcome === "dismissed") setMessage("Você pode instalar depois pelo menu do navegador.");
            } catch {
              setMessage("Não foi possível abrir a instalação. Use o menu do navegador conforme as instruções abaixo.");
            } finally {
              setInstall(null);
              setInstalling(false);
            }
          }}
        >
          {installing ? "Abrindo instalação…" : "Instalar Almox no dispositivo"}
        </button>
      )}
      {inline && message && <p role="status">{message}</p>}
      <style jsx>{`
        .pwa-offline {
          position: fixed;
          z-index: 9999;
          left: 0;
          right: 0;
          top: 0;
          background: #9c3030;
          color: white;
          padding: 12px 20px;
          text-align: center;
          font-size: 14px;
          font-weight: 600;
        }
        .pwa-install {
          position: fixed;
          z-index: 45;
          right: 24px;
          bottom: 90px;
          max-width: calc(100vw - 48px);
          padding: 12px 16px;
          border: 1px solid var(--border);
          border-radius: 12px;
          background: #fff;
          color: var(--teal);
          box-shadow: 0 4px 20px #183f2015;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
        }
        .pwa-install-inline {
          position: static;
          max-width: 100%;
          margin-top: 12px;
          padding: 15px 22px;
          border-color: #ed0b3c;
          background: #ed0b3c;
          color: white;
          font-size: 15px;
        }
        @media print {
          .pwa-offline,
          .pwa-install {
            display: none;
          }
        }
      `}</style>
    </>
  );
}
