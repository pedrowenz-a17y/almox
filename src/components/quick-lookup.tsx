"use client";
import { useDeferredValue, useMemo, useState } from "react";
import { Search, ScanLine, Package, ArrowUpRight } from "lucide-react";
import Link from "@/components/workspace-link";
import { type DataSet, availableFor, qty, stockState } from "@/lib/client";
import { Badge, Empty } from "@/components/ui";

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("pt-BR");
export default function QuickLookup({
  data,
  onScan,
}: {
  data: DataSet;
  onScan: () => void;
}) {
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const index = useMemo(
    () =>
      data.products.map((product) => ({
        product,
        text: normalize(
          [
            product.name,
            product.internalCode,
            product.sku,
            product.barcode,
            product.manufacturer,
          ]
            .filter(Boolean)
            .join(" "),
        ),
      })),
    [data.products],
  );
  const matches = index.filter(
    ({ product, text }) =>
      product.active && text.includes(normalize(deferred.trim())),
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Consulta rápida</h1>
          <p>Encontre o material antes de ir até a prateleira.</p>
        </div>
        <button className="button primary" onClick={onScan}>
          <ScanLine size={18} /> Escanear etiqueta
        </button>
      </div>
      <section className="lookup-desk">
        <Search size={25} />
        <label className="sr-only" htmlFor="lookup-query">
          Nome, código, SKU ou código de barras
        </label>
        <input
          id="lookup-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nome, código, SKU ou código de barras"
          autoComplete="off"
        />
        <span>{matches.length} materiais</span>
      </section>
      <div
        className="lookup-results"
        aria-live="polite"
        aria-busy={query !== deferred}
      >
        {matches.slice(0, 40).map(({ product: p }) => {
          const available = availableFor(data, p.id);
          const state = stockState(p, available);
          return (
            <Link
              href={`/produto/${p.id}`}
              className="lookup-material"
              key={p.id}
            >
              <div className="lookup-material-icon">
                {p.imageUrl ? (
                  <img src={p.imageUrl} alt="" loading="lazy" />
                ) : (
                  <Package size={25} />
                )}
              </div>
              <div className="lookup-material-copy">
                <small>
                  {p.internalCode} {p.sku ? `/ ${p.sku}` : ""}
                </small>
                <h2>{p.name}</h2>
                <p>
                  {p.category?.name || "Sem categoria"}
                  {p.manufacturer ? ` · ${p.manufacturer}` : ""}
                </p>
              </div>
              <div className="lookup-material-stock">
                <strong>
                  {qty(available)} <small>{p.unit}</small>
                </strong>
                <Badge tone={state.className}>{state.label}</Badge>
              </div>
              <ArrowUpRight size={19} />
            </Link>
          );
        })}
        {!matches.length && (
          <Empty
            title="Nenhum material com esse código ou nome"
            description="Confira a busca ou escaneie o QR Code da etiqueta. Os resultados são da unidade selecionada."
          />
        )}
        {matches.length > 40 && (
          <p className="muted">
            Exibindo os primeiros 40. Digite mais detalhes para encontrar o
            material.
          </p>
        )}
      </div>
    </>
  );
}
