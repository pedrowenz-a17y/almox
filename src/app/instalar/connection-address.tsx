"use client";

import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import styles from "./installation.module.css";

export default function ConnectionAddress() {
  const [origin, setOrigin] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    queueMicrotask(() => setOrigin(window.location.origin));
  }, []);
  return (
    <section className={styles.connection} aria-labelledby="connection-title">
      <h2 id="connection-title">Um endereço para conectar sua equipe.</h2>
      <p>Na primeira abertura do aplicativo, use este endereço no campo <strong>Endereço do ERP</strong>. Depois entre com sua conta.</p>
      <div className={styles.addressRow}>
        <input aria-label="Endereço do ERP" type="url" readOnly value={origin} placeholder="Carregando endereço…" onFocus={event => event.currentTarget.select()} />
        <button type="button" disabled={!origin} onClick={async () => {
          setMessage("");
          try {
            await navigator.clipboard.writeText(origin);
            setMessage("Endereço copiado.");
          } catch {
            setMessage("Selecione o endereço acima e use a opção Copiar do seu dispositivo.");
          }
        }}><Copy size={17} aria-hidden="true" /> Copiar endereço</button>
      </div>
      {message && <p className={styles.copyStatus} role="status">{message}</p>}
    </section>
  );
}
