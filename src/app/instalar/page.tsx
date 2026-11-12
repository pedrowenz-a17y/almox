import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Download, Monitor, Smartphone } from "lucide-react";
import { Pwa } from "@/components/pwa";
import { ThemeToggle } from "@/components/theme-preferences";
import ConnectionAddress from "./connection-address";
import styles from "./installation.module.css";

export const metadata: Metadata = {
  title: "Instalar Almox ERP · U.C.A.",
  description: "Baixe o aplicativo Almox ERP para Android ou Windows e conecte à sua unidade.",
};

export default function Installation() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/login" aria-label="Almox ERP — entrar" className={styles.brand}>
          <Image src="/brand/uca-oficial.png" width={105} height={68} alt="U.C.A. Implementos Agrícolas" />
          <span>Almox <strong>ERP</strong></span>
        </Link>
        <div className={styles.headerActions}>
          <ThemeToggle compact />
          <Link href="/login" className={styles.enter}>Entrar <ArrowRight size={17} /></Link>
        </div>
      </header>
      <section className={styles.intro} aria-labelledby="install-title">
        <p className={styles.eyebrow}>SEU ALMOXARIFADO, SEMPRE POR PERTO</p>
        <h1 id="install-title">O trabalho continua.<br /><span>Em qualquer tela.</span></h1>
        <p className={styles.description}>Baixe o aplicativo para o celular ou computador. Instale, entre com sua conta e continue o trabalho com os dados da sua unidade.</p>
        <p className={styles.hint}>Escolha seu dispositivo. Depois do download, abra o arquivo para instalar.</p>
      </section>
      <section className={styles.cards} aria-label="Baixar e instalar">
        <article className={styles.card} id="android">
          <Smartphone size={27} aria-hidden="true" />
          <h2>No Android</h2>
          <p className={styles.fileInfo}>APK · versão 1.0.0 · 2,7 MB<br />Android 8 ou superior</p>
          <a className={styles.download} href="https://github.com/pedrowenz-a17y/almox/raw/refs/tags/android-v1.0.0/android-distribution/Almox-ERP-Android-1.0.0.apk" download="Almox-ERP-Android-1.0.0.apk">
            <Download size={19} aria-hidden="true" /> Baixar para Android
          </a>
          <ol>
            <li>Toque em <strong>Baixar para Android</strong> e aguarde terminar.</li>
            <li>Abra o arquivo <strong>Almox-ERP-Android-1.0.0.apk</strong> na pasta Downloads. O Android apresenta a confirmação de instalação.</li>
            <li>Abra o <strong>Almox ERP</strong> e substitua o endereço preenchido pelo endereço abaixo. Toque em <strong>Conectar à minha unidade</strong>.</li>
          </ol>
        </article>
        <article className={styles.card} id="windows">
          <Monitor size={27} aria-hidden="true" />
          <h2>No Windows</h2>
          <p className={styles.fileInfo}>EXE · versão 2.6.0 · 182 MB<br />Windows 10/11 · 64 bits</p>
          <a className={styles.download} href="https://github.com/pedrowenz-a17y/almox/releases/download/v2.6.0/Almox-ERP-2.6.0-Windows-x64-Setup.exe" download="Almox-ERP-2.6.0-Windows-x64-Setup.exe">
            <Download size={19} aria-hidden="true" /> Baixar para Windows
          </a>
          <ol>
            <li>Clique em <strong>Baixar para Windows</strong> e aguarde terminar.</li>
            <li>Abra o arquivo <strong>Almox-ERP-2.6.0-Windows-x64-Setup.exe</strong> e siga as etapas do instalador.</li>
            <li>Abra o atalho <strong>Almox ERP</strong>. Em <strong>Endereço do ERP</strong>, use o endereço abaixo e clique em <strong>Conectar ao ERP</strong>.</li>
          </ol>
        </article>
      </section>
      <ConnectionAddress />
      <aside className={styles.note}>
        <h2>Mesma operação. Mais perto de você.</h2>
        <p>Os botões baixam os arquivos oficiais do projeto pelo GitHub. A instalação é confirmada pelo Android ou Windows. Esses arquivos podem exibir avisos de origem ou editor desconhecido. <a className={styles.enter} href="https://github.com/pedrowenz-a17y/almox/blob/main/docs/INSTALACAO-E-ASSINATURA.md">Sobre os avisos de instalação</a>.</p>
        <p>Com o aplicativo conectado ao servidor na nuvem, o PC pode ficar desligado. É necessária internet para entrar, consultar e registrar movimentações. Cada pessoa usa sua conta autorizada. Para compartilhar, envie o link desta página.</p>
        <Link href="/login" className={styles.enter}>Continuar para o login <ArrowRight size={17} /></Link>
        <details className={styles.browserOption}>
          <summary>Outra opção: instalar pelo navegador</summary>
          <Pwa inline />
          <p>No Android, abra esta página no Chrome e escolha <strong>⋮ → Adicionar à tela inicial / Instalar aplicativo</strong>. No Windows, use o Edge e escolha <strong>⋯ → Aplicativos → Instalar este site como aplicativo</strong>.</p>
        </details>
      </aside>
    </main>
  );
}
