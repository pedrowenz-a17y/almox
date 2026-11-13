"use client";
import { useState } from "react";
import type { DataSet } from "@/lib/client";
import StockReports from "@/components/stock-reports";
import ValidationDashboard from "@/components/validation-dashboard";
export default function Reports({ data }: { data: DataSet }) {
  const [tab, setTab] = useState("stock");
  return (
    <div className="reports-workspace">
      <div className="toolbar no-print">
        <div className="segmented" aria-label="Área de relatórios">
          <button
            aria-pressed={tab === "stock"}
            className={tab === "stock" ? "selected" : ""}
            onClick={() => setTab("stock")}
          >
            Relatórios de estoque
          </button>
          <button
            aria-pressed={tab === "validation"}
            className={tab === "validation" ? "selected" : ""}
            onClick={() => setTab("validation")}
          >
            Validação e indicadores
          </button>
        </div>
      </div>
      {tab === "stock" ? (
        <StockReports data={data} />
      ) : (
        <ValidationDashboard
          permissions={data.user?.permissions ?? data.permissions ?? []}
        />
      )}
    </div>
  );
}
