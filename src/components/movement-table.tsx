"use client";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  ArrowRightLeft,
} from "lucide-react";
import { DataSet, Movement, movementLabels, qty, dateTime } from "@/lib/client";
import { Badge, Empty } from "@/components/ui";

export default function MovementTable({
  movements,
  data,
  compact = false,
}: {
  movements: Movement[];
  data: DataSet;
  compact?: boolean;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Produto</th>
            <th>Tipo</th>
            <th className="numeric">Quantidade</th>
            {!compact && <th>Origem → destino</th>}
            <th>Responsável</th>
            <th>Data e hora</th>
            {!compact && <th>Referência / observação</th>}
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => (
            <tr key={m.id}>
              <td>
                <strong>
                  {m.product?.name ||
                    data.products.find((p) => p.id === m.productId)?.name}
                </strong>
                <small>
                  {m.product?.internalCode ||
                    data.products.find((p) => p.id === m.productId)
                      ?.internalCode}
                </small>
              </td>
              <td>
                <Badge
                  tone={
                    m.type === "ENTRY"
                      ? "success"
                      : m.type === "EXIT"
                        ? "orange"
                        : m.type === "TRANSFER"
                          ? "info"
                          : "purple"
                  }
                >
                  {m.type === "ENTRY" ? (
                    <ArrowDownLeft size={13} />
                  ) : m.type === "EXIT" ? (
                    <ArrowUpRight size={13} />
                  ) : (
                    <ArrowRightLeft size={13} />
                  )}{" "}
                  {movementLabels[m.type]}
                </Badge>
              </td>
              <td className="numeric">
                <strong>
                  {m.type === "ENTRY" ? "+" : m.type === "EXIT" ? "−" : ""}
                  {qty(m.quantity)}
                </strong>
                <small>{m.product?.unit}</small>
              </td>
              {!compact && (
                <td>
                  <span className="movement-location">
                    {m.source?.code ||
                      data.locations.find((l) => l.id === m.sourceId)?.code ||
                      "Externo"}{" "}
                    <ArrowRight size={13} />{" "}
                    {m.destination?.code ||
                      data.locations.find((l) => l.id === m.destinationId)
                        ?.code ||
                      "Externo"}
                  </span>
                </td>
              )}
              <td>
                <span className="user-cell">
                  <i>{m.user?.name[0] || "S"}</i>
                  {m.user?.name || "Sistema"}
                </span>
              </td>
              <td className="muted no-wrap">{dateTime(m.createdAt)}</td>
              {!compact && (
                <td>
                  {m.reference || "—"}
                  <small>{m.note}</small>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!movements.length && (
        <Empty
          title="Nenhuma movimentação neste período"
          description="Entradas, saídas e transferências aparecerão aqui."
        />
      )}
    </div>
  );
}
