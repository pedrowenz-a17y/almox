"use client";

import { useMemo, useState } from "react";

type LabelLocation = {
  id: string;
  code: string;
  name: string;
  parentId?: string | null;
};
type LabelSize = "50x30" | "60x40" | "100x50" | "A4";
const sizes: Record<
  LabelSize,
  { width: number; height: number; qr: number; font: number }
> = {
  "50x30": { width: 50, height: 30, qr: 22, font: 6 },
  "60x40": { width: 60, height: 40, qr: 29, font: 7 },
  "100x50": { width: 100, height: 50, qr: 35, font: 9 },
  A4: { width: 63, height: 46, qr: 31, font: 8 },
};

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

export function Labels({
  locations,
  selectedIds = [],
}: {
  locations: LabelLocation[];
  selectedIds?: string[];
}) {
  const [selected, setSelected] = useState<string[]>(selectedIds);
  const [size, setSize] = useState<LabelSize>("60x40");
  const [search, setSearch] = useState("");
  const [sector, setSector] = useState("");
  const [error, setError] = useState("");
  const lookup = useMemo(
    () => new Map(locations.map((item) => [item.id, item])),
    [locations],
  );
  function ancestry(location: LabelLocation) {
    const names = [location.name];
    const seen = new Set([location.id]);
    let parent = location.parentId ? lookup.get(location.parentId) : undefined;
    while (parent && !seen.has(parent.id)) {
      names.unshift(parent.name);
      seen.add(parent.id);
      parent = parent.parentId ? lookup.get(parent.parentId) : undefined;
    }
    return names.join(" › ");
  }
  function inside(location: LabelLocation, ancestor: string) {
    let item: LabelLocation | undefined = location;
    const seen = new Set<string>();
    while (item && !seen.has(item.id)) {
      if (item.id === ancestor) return true;
      seen.add(item.id);
      item = item.parentId ? lookup.get(item.parentId) : undefined;
    }
    return false;
  }
  const filtered = locations.filter(
    (item) =>
      (!sector || inside(item, sector)) &&
      `${item.code} ${ancestry(item)}`
        .toLocaleLowerCase("pt-BR")
        .includes(search.toLocaleLowerCase("pt-BR")),
  );
  const chosen = locations.filter((item) => selected.includes(item.id));
  const toggle = (id: string) =>
    setSelected((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : [...current, id],
    );

  async function download(location: LabelLocation) {
    setError("");
    try {
      const response = await fetch(
        `/api/qr/${location.id}?format=svg&download=1`,
        { cache: "no-store" },
      );
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload.error || "Não foi possível baixar a etiqueta.");
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `localizacao-${location.code}.svg`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Falha no download.");
    }
  }

  function print() {
    if (!chosen.length) return;
    setError("");
    const popup = window.open("", "_blank", "width=900,height=750");
    if (!popup) {
      setError(
        "Permita a abertura da janela de impressão no navegador e tente novamente.",
      );
      return;
    }
    const dimensions = sizes[size];
    const compact = size === "50x30";
    // The new window contains only labels, so app layout cannot clip print output.
    const sheet = chosen
      .map(
        (location) =>
          `<article><img src="${window.location.origin}/api/qr/${location.id}?format=svg" alt="QR Code"><div class="text"><strong>${escapeHtml(ancestry(location))}</strong><span>${escapeHtml(location.code)}</span></div></article>`,
      )
      .join("");
    popup.document.write(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas de localizações · Almox</title><style>@page{size:${size === "A4" ? "A4 portrait" : `${dimensions.width}mm ${dimensions.height}mm`};margin:${size === "A4" ? "8mm" : "0"}}*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;background:white;color:#000}.toolbar{padding:16px;background:#f0f4f2;font-size:14px}.toolbar button{padding:10px 16px;cursor:pointer}main{${size === "A4" ? "display:grid;grid-template-columns:repeat(3,63mm);gap:2mm;" : ""}}article{width:${dimensions.width}mm;height:${dimensions.height}mm;padding:1mm;display:flex;flex-direction:${compact ? "row" : "column"};align-items:center;justify-content:center;break-inside:avoid;overflow:hidden;${size === "A4" ? "border:1px dashed #aaa" : "break-after:page"}}article:last-child{break-after:auto}img{width:${dimensions.qr}mm;height:${dimensions.qr}mm;flex-shrink:0}.text{width:${compact ? dimensions.width - dimensions.qr - 2 : dimensions.width - 2}mm;max-height:${compact ? dimensions.height - 2 : dimensions.height - dimensions.qr - 2}mm;text-align:${compact ? "left" : "center"};line-height:1.1;font-size:${dimensions.font}pt;overflow:hidden}.text strong{display:block;font-weight:600;overflow-wrap:anywhere}.text span{display:block;font-weight:700;margin-top:.5mm;overflow-wrap:anywhere}@media print{.toolbar{display:none}article{border-color:transparent}body{print-color-adjust:exact;-webkit-print-color-adjust:exact}}@media screen{main{padding:12px}article{border:1px dashed #aaa;margin-bottom:8px}}</style></head><body><div class="toolbar"><button id="print" disabled>Carregando QR Codes…</button> Imprima em escala 100%. ${size === "A4" ? "Folha A4, margens de 8 mm." : `Configure papel ${dimensions.width} × ${dimensions.height} mm na impressora.`}</div><main>${sheet}</main></body></html>`,
    );
    popup.document.close();
    const button = popup.document.getElementById("print") as HTMLButtonElement;
    button.onclick = () => popup.print();
    const images = Array.from(popup.document.images);
    void Promise.all(images.map((img) => img.decode()))
      .then(() => {
        const texts = Array.from(
          popup.document.querySelectorAll<HTMLElement>(".text"),
        );
        const fits = texts.every((block) => {
          let font = dimensions.font;
          while (
            (block.scrollHeight > block.clientHeight + 1 ||
              block.scrollWidth > block.clientWidth + 1) &&
            font > 4
          ) {
            font -= 0.25;
            block.style.fontSize = `${font}pt`;
          }
          return (
            block.scrollHeight <= block.clientHeight + 1 &&
            block.scrollWidth <= block.clientWidth + 1
          );
        });
        if (!fits) {
          button.textContent =
            "O texto não cabe neste tamanho. Feche e escolha uma etiqueta maior.";
          return;
        }
        button.disabled = false;
        button.textContent = "Imprimir / salvar PDF";
        popup.focus();
        popup.print();
      })
      .catch(() => {
        button.textContent =
          "Falha ao carregar QR. Feche esta janela e entre novamente.";
      });
  }

  return (
    <section className="labels-module">
      <div className="labels-tools">
        <div>
          <h2>Etiquetas de localização</h2>
          <p>
            Selecione as localizações e prepare as etiquetas para o
            almoxarifado.
          </p>
        </div>
        <button
          className="btn btn-primary"
          disabled={!chosen.length}
          onClick={print}
        >
          Imprimir{" "}
          {chosen.length
            ? `${chosen.length} etiqueta${chosen.length > 1 ? "s" : ""}`
            : "etiquetas"}
        </button>
      </div>
      <div className="labels-filters">
        <label>
          Buscar localização
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome ou código da localização"
          />
        </label>
        <label>
          Setor ou localização superior
          <select
            value={sector}
            onChange={(event) => setSector(event.target.value)}
          >
            <option value="">Todos os setores</option>
            {locations
              .filter((item) =>
                locations.some((child) => child.parentId === item.id),
              )
              .map((item) => (
                <option value={item.id} key={item.id}>
                  {ancestry(item)}
                </option>
              ))}
          </select>
        </label>
        <label>
          Tamanho da etiqueta
          <select
            value={size}
            onChange={(event) => setSize(event.target.value as LabelSize)}
          >
            <option value="50x30">50 × 30 mm</option>
            <option value="60x40">60 × 40 mm</option>
            <option value="100x50">100 × 50 mm</option>
            <option value="A4">Folha A4 · múltiplas etiquetas</option>
          </select>
        </label>
      </div>
      <div className="labels-selection">
        <label>
          <input
            type="checkbox"
            checked={
              filtered.length > 0 &&
              filtered.every((item) => selected.includes(item.id))
            }
            onChange={(event) =>
              setSelected((current) =>
                event.target.checked
                  ? [
                      ...new Set([
                        ...current,
                        ...filtered.map((item) => item.id),
                      ]),
                    ]
                  : current.filter(
                      (id) => !filtered.some((item) => item.id === id),
                    ),
              )
            }
          />{" "}
          Selecionar resultados ({filtered.length})
        </label>
        <span>
          {chosen.length} selecionada{chosen.length !== 1 ? "s" : ""}
        </span>
        {chosen.length > 0 && (
          <button type="button" onClick={() => setSelected([])}>
            Limpar seleção
          </button>
        )}
      </div>
      {error && (
        <p className="labels-error" role="alert">
          {error}
        </p>
      )}
      <div className="labels-grid">
        {filtered.map((location) => (
          <article
            className={`label-preview ${selected.includes(location.id) ? "selected" : ""}`}
            key={location.id}
          >
            <label className="label-check">
              <input
                type="checkbox"
                checked={selected.includes(location.id)}
                onChange={() => toggle(location.id)}
                aria-label={`Selecionar ${location.code}`}
              />
              <span>{location.name}</span>
            </label>
            {/* Authenticated images are intentionally excluded from Next image optimization/cache. */}
            <img
              src={`/api/qr/${location.id}?format=svg`}
              alt={`QR Code de ${location.code}`}
              width={160}
              height={160}
              loading="lazy"
            />
            <p>{ancestry(location)}</p>
            <strong>{location.code}</strong>
            <button type="button" onClick={() => void download(location)}>
              Baixar QR Code SVG
            </button>
          </article>
        ))}
      </div>
      {!filtered.length && (
        <p className="labels-empty">
          Nenhuma localização encontrada. Cadastre uma localização para gerar
          sua etiqueta.
        </p>
      )}
      <p className="labels-footnote">
        O QR Code contém apenas a URL da localização. O acesso ao estoque exige
        autenticação. Na impressão, use escala de 100% para preservar o tamanho
        escolhido.
      </p>
      <style jsx>{`
        .labels-module {
          background: white;
          border: 1px solid #e0e7e3;
          border-radius: 16px;
          padding: 24px;
        }
        .labels-tools {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
        }
        .labels-tools h2 {
          font-size: 20px;
          margin: 0 0 6px;
        }
        .labels-tools p,
        .labels-footnote {
          color: #687b70;
          font-size: 13px;
        }
        .labels-tools p {
          margin: 0;
        }
        .labels-filters {
          display: grid;
          grid-template-columns: 1.2fr 1fr 1fr;
          gap: 16px;
          margin: 24px 0;
        }
        .labels-filters label {
          font-size: 12px;
          font-weight: 600;
        }
        .labels-filters input,
        .labels-filters select {
          display: block;
          width: 100%;
          border: 1px solid #d4dfd8;
          border-radius: 8px;
          margin-top: 7px;
          padding: 11px;
          font: inherit;
          font-size: 14px;
          min-height: 44px;
          background: white;
        }
        .labels-selection {
          display: flex;
          gap: 16px;
          align-items: center;
          flex-wrap: wrap;
          font-size: 13px;
          margin-bottom: 20px;
        }
        .labels-selection label {
          display: flex;
          gap: 8px;
          align-items: center;
        }
        .labels-selection span {
          color: #687b70;
        }
        .labels-selection button,
        .label-preview button {
          border: 0;
          background: transparent;
          color: #147d64;
          font-weight: 600;
          cursor: pointer;
          min-height: 44px;
        }
        .labels-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
          gap: 16px;
        }
        .label-preview {
          border: 1px solid #dfe7e2;
          border-radius: 12px;
          padding: 16px;
          text-align: center;
          display: flex;
          align-items: center;
          flex-direction: column;
        }
        .label-preview.selected {
          border-color: #147d64;
          background: #f7fcfa;
          box-shadow: 0 0 0 1px #147d64;
        }
        .label-check {
          display: flex;
          align-items: center;
          gap: 8px;
          align-self: stretch;
          text-align: left;
          font-size: 14px;
          font-weight: 600;
        }
        .label-check input,
        .labels-selection input {
          width: 18px;
          height: 18px;
          accent-color: #147d64;
          flex-shrink: 0;
        }
        .label-preview img {
          margin: 8px 0;
          max-width: 100%;
          height: auto;
        }
        .label-preview p {
          font-size: 12px;
          color: #687b70;
          margin: 0 0 8px;
          overflow-wrap: anywhere;
        }
        .label-preview strong {
          font-size: 13px;
          overflow-wrap: anywhere;
        }
        .label-preview button {
          font-size: 12px;
          margin-top: 8px;
        }
        .labels-empty {
          padding: 24px;
          text-align: center;
          color: #687b70;
        }
        .labels-error {
          color: #a52b2b;
          background: #fff0ef;
          padding: 12px;
          border-radius: 8px;
        }
        .labels-footnote {
          margin: 24px 0 0;
          line-height: 1.6;
        }
        .btn {
          padding: 12px 18px;
          min-height: 44px;
          border: 0;
          border-radius: 9px;
          font-weight: 600;
          cursor: pointer;
          white-space: nowrap;
        }
        .btn-primary {
          background: #147d64;
          color: white;
        }
        .btn:disabled {
          opacity: 0.5;
          cursor: default;
        }
        @media (max-width: 720px) {
          .labels-module {
            padding: 16px;
          }
          .labels-tools {
            align-items: stretch;
            flex-direction: column;
          }
          .labels-filters {
            grid-template-columns: 1fr;
          }
          .labels-grid {
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
          }
        }
      `}</style>
    </section>
  );
}
