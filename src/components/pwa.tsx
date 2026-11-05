"use client";

import { useEffect, useState } from "react";

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export function Pwa() {
  const [offline, setOffline] = useState(false);
  const [install, setInstall] = useState<InstallPrompt | null>(null);
  useEffect(() => {
    const update = () => setOffline(!navigator.onLine);
    const onInstall = (event: Event) => {
      event.preventDefault();
      setInstall(event as InstallPrompt);
    };
    const installed = () => setInstall(null);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    window.addEventListener("beforeinstallprompt", onInstall);
    window.addEventListener("appinstalled", installed);
    if ("serviceWorker" in navigator && window.isSecureContext)
      void navigator.serviceWorker.register("/sw.js").catch(() => {
        /* Browser may prohibit service workers. Online operations remain available. */
      });
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      window.removeEventListener("beforeinstallprompt", onInstall);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  return (
    <>
      {offline && (
        <div className="pwa-offline" role="alert">
          Sem conexão. Não é possível registrar movimentações no momento.
        </div>
      )}
      {install && !offline && (
        <button
          className="pwa-install"
          type="button"
          onClick={async () => {
            await install.prompt();
            await install.userChoice;
            setInstall(null);
          }}
        >
          Instalar Almox no dispositivo
        </button>
      )}
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
