"use client";
import { useState } from "react";
import {
  ArrowLeft,
  Download,
  Printer,
  MapPin,
  Plus,
  Pencil,
  QrCode,
} from "lucide-react";
import Link from "@/components/workspace-link";
import {
  type Product,
  type DataSet,
  availableFor,
  physicalFor,
  qty,
  number,
  locationPath,
} from "@/lib/client";
import { Badge, Empty } from "@/components/ui";

export default function ProductOverview({
  product,
  data,
  canMove,
  onMove,
  onEdit,
}: {
  product: Product;
  data: DataSet;
  canMove: boolean;
  onMove: () => void;
  onEdit?: () => void;
}) {
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const qr = `/api/products/${product.id}/qr`;
  const balances = data.balances.filter((b) => b.productId === product.id);
  async function download() {
    setError("");
    setBusy(true);
    try {
      const response = await fetch(`${qr}?format=png&download=1`, {
        cache: "no-store",
      });
      if (!response.ok)
        throw new Error(
          "Não foi possível baixar o QR. Atualize os dados e tente novamente.",
        );
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `produto-${product.internalCode.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Falha ao baixar QR Code.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function printLabel() {
    setError("");
    const popup = window.open("", "_blank", "width=700,height=650");
    if (!popup) {
      setError("Permita a janela de impressão no navegador.");
      return;
    }
    popup.document.write(
      '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiqueta de produto</title><style>@page{size:60mm 40mm;margin:0}body{margin:0;font:11px Arial,sans-serif;text-align:center}article{box-sizing:border-box;width:60mm;height:40mm;padding:2mm;display:flex;align-items:center;justify-content:center;gap:2mm}img{width:28mm;height:28mm}section{width:25mm;overflow-wrap:anywhere}strong{display:block;font-size:12px}p{margin:4px 0}@media screen{body{padding:24px}article{border:1px dashed #aaa}}</style></head><body><button id="print" disabled>Carregando etiqueta…</button><article><img alt="QR Code do produto"><section><strong></strong><p></p></section></article><style>@media print{button{display:none}}</style></body></html>',
    );
    popup.document.close();
    popup.document.querySelector("strong")!.textContent = product.internalCode;
    popup.document.querySelector("p")!.textContent = product.name;
    const image = popup.document.querySelector("img")!;
    image.src = `${window.location.origin}${qr}?format=svg`;
    const button = popup.document.getElementById("print") as HTMLButtonElement;
    button.onclick = () => popup.print();
    try {
      await image.decode();
      const label = popup.document.querySelector("article")!;
      const text = popup.document.querySelector("section")!;
      if (text.scrollHeight > label.clientHeight - 12)
        throw new Error(
          "O nome não cabe na etiqueta de 60 × 40 mm. Baixe o QR e use um modelo maior.",
        );
      button.textContent = "Imprimir / salvar PDF · escala 100%";
      button.disabled = false;
      popup.focus();
      popup.print();
    } catch (cause) {
      button.textContent =
        cause instanceof Error
          ? cause.message
          : "Falha ao carregar etiqueta. Feche a janela e tente novamente.";
    }
  }
  return (
    <>
      <Link href="/produtos" className="back-link">
        <ArrowLeft size={16} /> Produtos
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">Ficha do material</span>
          <h1>{product.name}</h1>
          <p>
            {product.internalCode}
            {product.sku ? ` / SKU ${product.sku}` : ""} · {product.unit}
          </p>
        </div>
        <div className="row-actions">
          {onEdit && (
            <button className="button secondary" onClick={onEdit}>
              <Pencil size={16} /> Editar
            </button>
          )}
          {canMove && product.active && (
            <button className="button primary" onClick={onMove}>
              <Plus size={17} /> Registrar entrada
            </button>
          )}
        </div>
      </div>
      <div className="product-workbench">
        <section className="panel product-identity">
          <div className="panel-heading">
            <h2>Disponibilidade</h2>
            <Badge tone={product.active ? "success" : ""}>
              {product.active ? "Ativo" : "Arquivado"}
            </Badge>
          </div>
          <div className="material-amount">
            <strong>{qty(availableFor(data, product.id))}</strong>
            <span>{product.unit} disponíveis</span>
          </div>
          <dl className="material-facts">
            <div>
              <dt>Físico nas localizações</dt>
              <dd>
                {qty(physicalFor(data, product.id))} {product.unit}
              </dd>
            </div>
            <div>
              <dt>Estoque mínimo</dt>
              <dd>
                {qty(product.minStock)} {product.unit}
              </dd>
            </div>
            <div>
              <dt>Fornecedor principal</dt>
              <dd>
                {product.supplier?.tradeName ||
                  product.supplier?.legalName ||
                  "Não informado"}
              </dd>
            </div>
            <div>
              <dt>Categoria</dt>
              <dd>{product.category?.name || "Sem categoria"}</dd>
            </div>
          </dl>
          {product.description && (
            <p className="material-description">{product.description}</p>
          )}
        </section>
        <section
          className="panel product-qr-panel"
          aria-label="QR Code do produto"
        >
          <div>
            <QrCode size={21} />
            <h2>Etiqueta do produto</h2>
            <p>
              Escaneie para abrir esta ficha e conferir o saldo por localização.
            </p>
          </div>
          <img
            key={product.id}
            className="product-qr"
            src={qr}
            width={208}
            height={208}
            alt={`QR Code de ${product.name}`}
            onLoad={() => {
              setReady(true);
              setError("");
            }}
            onError={() => {
              setReady(false);
              setError(
                "Não foi possível carregar o QR. Confira a conexão e atualize a página.",
              );
            }}
          />
          <strong className="label-code">{product.internalCode}</strong>
          <div className="row-actions">
            <button
              className="button secondary"
              disabled={!ready || busy}
              onClick={() => void download()}
            >
              <Download size={16} /> Baixar PNG
            </button>
            <button
              className="button primary"
              disabled={!ready}
              onClick={() => void printLabel()}
            >
              <Printer size={16} /> Imprimir
            </button>
          </div>
          <small>Etiqueta 60 × 40 mm. A leitura exige acesso à unidade.</small>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Onde encontrar</h2>
            <p>Quantidades disponíveis para retirada em cada posição.</p>
          </div>
          <span className="count-pill">{balances.length} locais</span>
        </div>
        {balances.length ? (
          <div className="material-locations">
            {balances.map((b) => (
              <Link key={b.id} href={`/localizacao/${b.locationId}`}>
                <MapPin size={21} />
                <span>
                  <strong>{locationPath(data, b.locationId)}</strong>
                  <small>
                    Físico: {qty(b.physicalQuantity ?? b.quantity)} · Reservado:{" "}
                    {qty(b.reservedQuantity)} · Aplicado:{" "}
                    {qty(b.appliedQuantity)}
                  </small>
                </span>
                <strong
                  className={
                    number(b.availableQuantity ?? b.quantity) <= 0
                      ? "text-danger"
                      : ""
                  }
                >
                  {qty(b.availableQuantity ?? b.quantity)} {product.unit}
                </strong>
              </Link>
            ))}
          </div>
        ) : (
          <Empty
            title="Este produto ainda não tem saldo por localização"
            description="Registre uma entrada para informar onde o material está armazenado."
          />
        )}
      </section>
    </>
  );
}
