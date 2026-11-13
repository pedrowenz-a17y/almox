"use client";
import { useState } from "react";
import { canViewReports } from "@/lib/access-profiles";
import { Empty } from "@/components/ui";
import OrderCostReport from "@/components/order-cost-report";
import ErpReconciliation from "@/components/erp-reconciliation";

export default function Reconciliation({
  permissions,
}: {
  permissions: string[];
}) {
  const reportsAllowed = canViewReports(permissions);
  const costsAllowed = permissions.includes("costs:read");
  const [tab, setTab] = useState(reportsAllowed ? "reconcile" : "costs");
  if (!reportsAllowed && !costsAllowed)
    return (
      <Empty
        title="Acesso restrito"
        description="Seu perfil não possui acesso a relatórios ou custos."
      />
    );
  return (
    <div className="reconciliation-workspace">
      <div className="page-heading">
        <div>
          <h1>Custos e conciliação</h1>
          <p>
            Confira o estoque e os materiais por ordem com o ERP da empresa.
          </p>
        </div>
      </div>
      <div className="toolbar">
        <div className="segmented" aria-label="Área de consulta">
          {reportsAllowed && (
            <button
              className={tab === "reconcile" ? "selected" : ""}
              aria-pressed={tab === "reconcile"}
              onClick={() => setTab("reconcile")}
            >
              Conciliação com ERP
            </button>
          )}
          {costsAllowed && (
            <button
              className={tab === "costs" ? "selected" : ""}
              aria-pressed={tab === "costs"}
              onClick={() => setTab("costs")}
            >
              Custos por ordem
            </button>
          )}
        </div>
      </div>
      {tab === "costs" && costsAllowed ? (
        <OrderCostReport />
      ) : reportsAllowed ? (
        <ErpReconciliation permissions={permissions} />
      ) : null}
    </div>
  );
}
