import { z } from "zod";

export type QrTarget = { kind: "location" | "product"; id: string };
/** URLs identify a resource, never a quantity, credential or authorization. */
export function qrTargetUrl(origin: string, target: QrTarget) {
  const id = z.string().uuid().parse(target.id);
  return `${new URL(origin).origin}/${target.kind === "product" ? "produto" : "localizacao"}/${id}`;
}

export function parseQrCode(
  raw: string,
  origin: string,
  allowProducts: boolean,
) {
  const code = z.string().trim().min(1).max(500).parse(raw);
  if (!/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(code)) return { code, kind: undefined };
  let url: URL;
  try {
    url = new URL(code);
  } catch {
    throw new Error("QR Code inválido.");
  }
  if (
    url.origin !== new URL(origin).origin ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Este QR Code não pertence a este almoxarifado.");
  const match = url.pathname.match(
    /^\/(localizacao|produto)\/([0-9a-f-]+)\/?$/i,
  );
  if (!match || !z.string().uuid().safeParse(match[2]).success)
    throw new Error("O QR Code não identifica um produto ou localização.");
  const kind = match[1].toLowerCase() === "produto" ? "product" : "location";
  if (kind === "product" && !allowProducts)
    throw new Error(
      "Escaneie a etiqueta da localização. O QR do produto está disponível na consulta rápida.",
    );
  return { code: match[2], kind };
}
