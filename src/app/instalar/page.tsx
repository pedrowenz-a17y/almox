import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Monitor, Smartphone } from "lucide-react";
import { Pwa } from "@/components/pwa";
import styles from "./installation.module.css";

export const metadata: Metadata = {
  title: "Instalar Almox ERP · U.C.A.",
  description: "Instale o Almox pelo navegador no celular ou computador e acesse sua unidade.",
};

export default function Installation() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/login" aria-label="Almox ERP — entrar" className={styles.brand}>
          <Image src="/brand/uca-oficial.png" width={105} height={68} alt="U.C.A. Implementos Agrícolas" />
          <span>Almox <strong>ERP</strong></span>
        </Link>
        <Link href="/login" className={styles.enter}>Entrar <ArrowRight size={17} /></Link>
      </header>
      <section className={styles.intro} aria-labelledby="install-title">
        <p className={styles.eyebrow}>SEU ALMOXARIFADO, SEMPRE POR PERTO</p>
        <h1 id="install-title">O trabalho continua.<br /><span>Em qualquer tela.</span></h1>
        <p className={styles.description}>Adicione o Almox ao celular ou computador pelo navegador. Ele ganha um ícone e uma janela própria, com a mesma conta e os dados da sua unidade.</p>
        <Pwa inline />
        <p className={styles.hint}>Se o botão de instalação não aparecer, siga os passos para seu dispositivo.</p>
      </section>
      <section className={styles.cards} aria-label="Como instalar">
        <article className={styles.card}>
          <Smartphone size={27} aria-hidden="true" />
          <h2>No Android</h2>
          <ol>
            <li>Abra este endereço no <strong>Google Chrome</strong>, fora do WhatsApp ou de outro aplicativo.</li>
            <li>Toque no menu <strong>⋮</strong> e escolha <strong>Adicionar à tela inicial</strong> ou <strong>Instalar aplicativo</strong>.</li>
            <li>Confirme a instalação e abra o ícone <strong>Almox ERP</strong>.</li>
          </ol>
        </article>
        <article className={styles.card}>
          <Monitor size={27} aria-hidden="true" />
          <h2>No Windows</h2>
          <ol>
            <li>Abra este endereço no <strong>Microsoft Edge</strong> ou <strong>Google Chrome</strong>.</li>
            <li>No Edge, abra <strong>⋯ → Aplicativos → Instalar este site como aplicativo</strong>. No Chrome, procure <strong>Instalar Almox ERP</strong> na barra de endereço ou no menu de salvar e compartilhar.</li>
            <li>Confirme e use o atalho no menu Iniciar.</li>
          </ol>
        </article>
      </section>
      <aside className={styles.note}>
        <h2>Mesma operação. Mais perto de você.</h2>
        <p>Essa instalação usa o site hospedado: não baixa um APK ou instalador EXE. O PC pode ficar desligado quando o servidor está na nuvem. É necessária internet para entrar, consultar e registrar movimentações.</p>
        <p>A câmera é solicitada ao ler QR Codes. Cada pessoa entra com sua própria conta autorizada. Para compartilhar, envie o link desta página.</p>
        <Link href="/login" className={styles.enter}>Continuar para o login <ArrowRight size={17} /></Link>
      </aside>
    </main>
  );
}
