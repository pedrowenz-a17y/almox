"use client";
import { canMoveStock } from "@/lib/access-profiles";
import { useState } from "react";
import Link from "@/components/workspace-link";
import {
  Activity,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowRight,
  ArrowRightLeft,
  Boxes,
  ClipboardCheck,
  Clock3,
  Package,
  ScanLine,
  ShieldCheck,
  TriangleAlert,
  ChevronRight,
} from "lucide-react";
import {
  DataSet,
  Product,
  SessionUser,
  availableFor,
  number,
  qty,
} from "@/lib/client";
import MovementTable from "@/components/movement-table";
import { Empty } from "@/components/ui";
const localDay = (value: string | Date) =>
  new Date(value).toLocaleDateString("en-CA", {
    timeZone: "America/Sao_Paulo",
  });

export default function Dashboard({
  data,
  user,
  onScan,
  onMove,
  canMove,
  onProduct,
}: {
  data: DataSet;
  user: SessionUser | null;
  onScan: () => void;
  onMove: (type: string) => void;
  canMove: boolean;
  onProduct: (p: Product) => void;
}) {
  const [now] = useState(() => Date.now());
  const today = localDay(new Date(now));
  const active = data.products.filter((p) => p.active);
  const low = active.filter(
    (p) => availableFor(data, p.id) < number(p.minStock),
  );
  const summary = data.dashboard;
  const totalProducts = summary?.totalProducts ?? active.length;
  const lowCount = summary?.lowStock ?? low.length;
  const zeroCount =
    summary?.outOfStock ??
    active.filter((p) => availableFor(data, p.id) <= 0).length;
  const total =
    summary?.totalPhysical ??
    data.balances.reduce(
      (sum, balance) =>
        sum + number(balance.physicalQuantity ?? balance.quantity),
      0,
    );
  const todayCount = (type: string) =>
    summary?.today[type] ??
    data.movements.filter(
      (m) => m.type === type && localDay(m.createdAt) === today,
    ).length;
  const [chartDays, setChartDays] = useState(7);
  const days = Array.from({ length: chartDays }, (_, index) => {
    const day = new Date(now - (chartDays - 1 - index) * 86400000);
    const dayKey = localDay(day);
    const activity = summary?.dailyActivity.filter(
      (item) => item.date === dayKey,
    );
    const entries = activity
      ? activity
          .filter((item) => item.type === "ENTRY")
          .reduce((sum, item) => sum + item.operations, 0)
      : data.movements.filter(
          (m) => m.type === "ENTRY" && localDay(m.createdAt) === dayKey,
        ).length;
    const exits = activity
      ? activity
          .filter((item) => item.type === "EXIT")
          .reduce((sum, item) => sum + item.operations, 0)
      : data.movements.filter(
          (m) => m.type === "EXIT" && localDay(m.createdAt) === dayKey,
        ).length;
    return {
      label: day.toLocaleDateString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        day: "2-digit",
        month: "2-digit",
      }),
      entry: entries,
      exit: exits,
    };
  });
  const max = Math.max(1, ...days.flatMap((day) => [day.entry, day.exit]));
  const popular = (
    summary
      ? summary.topProducts.flatMap((item) => {
          const product = data.products.find((p) => p.id === item.productId);
          return product ? [{ product, count: item.operations }] : [];
        })
      : active
          .map((product) => ({
            product,
            count: data.movements.filter((m) => m.productId === product.id)
              .length,
          }))
          .filter((item) => item.count > 0)
          .sort((a, b) => b.count - a.count)
  ).slice(0, 4);
  return (
    <>
      <div className="page-heading dashboard-heading">
        <div>
          <span className="eyebrow">Rotina do almoxarifado</span>
          <h1>Seu almoxarifado, hoje</h1>
          <p>
            Olá, {user?.name.split(" ")[0] || "operador"}. Aqui está o resumo da
            unidade selecionada.
          </p>
        </div>
        <div className="today-chip">
          <Clock3 size={16} />
          {new Date(now).toLocaleDateString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            day: "2-digit",
            month: "long",
            year: "numeric",
          })}
        </div>
      </div>
      <div className="stats-grid">
        <Stat
          label="Produtos cadastrados"
          value={qty(totalProducts)}
          caption="Materiais ativos no catálogo"
          icon={<Package size={22} />}
          tone="teal"
        />
        <Stat
          label="Saldo físico"
          value={qty(total)}
          caption="Materiais nas localizações; aplicação descontada"
          icon={<Boxes size={22} />}
          tone="blue"
        />
        <Stat
          label="Abaixo do estoque mínimo"
          value={qty(lowCount)}
          caption={
            lowCount
              ? "Precisam de reposição"
              : totalProducts
                ? "Nenhum alerta de reposição"
                : "Nenhum material cadastrado"
          }
          icon={<TriangleAlert size={22} />}
          tone="amber"
          alert={lowCount > 0}
        />
        <Stat
          label="Produtos sem estoque"
          value={qty(zeroCount)}
          caption={
            zeroCount
              ? "Sem saldo disponível"
              : totalProducts
                ? "Nenhum produto zerado"
                : "Cadastre os materiais desta unidade"
          }
          icon={<Package size={22} />}
          tone="red"
          alert={zeroCount > 0}
        />
      </div>
      <div className="scan-banner">
        <div className="scan-banner-icon">
          <ScanLine size={35} />
        </div>
        <div className="scan-banner-copy">
          <span>Produto ou localização</span>
          <h2>Qual material você está procurando?</h2>
          <p>Leia a etiqueta para consultar o saldo e encontrar o material.</p>
        </div>
        <button className="button scan-button" onClick={onScan}>
          <ScanLine size={19} />
          Escanear QR Code
          <ArrowUpRight size={17} />
        </button>
      </div>
      <div className="shift-desk">
        <div>
          <h2>Para conferir</h2>
          <p>Prioridades da unidade, sem perder o histórico.</p>
        </div>
        <Link href="/consulta">
          <Package size={20} />
          <span>
            <strong>Consulta rápida</strong>
            <small>Buscar código ou material</small>
          </span>
          <ChevronRight size={17} />
        </Link>
        {user?.permissions.includes("purchases:read") && (
          <Link href="/reposicao">
            <TriangleAlert size={20} />
            <span>
              <strong>
                {low.length}{" "}
                {low.length === 1
                  ? "material para conferir"
                  : "materiais para conferir"}
              </strong>
              <small>Ver lista de reposição</small>
            </span>
            <ChevronRight size={17} />
          </Link>
        )}
        <Link href="/inventario">
          <ClipboardCheck size={20} />
          <span>
            <strong>
              {data.counts.filter((c) => c.status === "PENDING").length}{" "}
              {data.counts.filter((c) => c.status === "PENDING").length === 1
                ? "contagem pendente"
                : "contagens pendentes"}
            </strong>
            <small>Conferir inventário</small>
          </span>
          <ChevronRight size={17} />
        </Link>
      </div>
      <div className="dashboard-middle">
        <section className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h2>Fluxo de movimentações</h2>
              <p>Entradas e saídas no período selecionado</p>
            </div>
            <select
              aria-label="Período do gráfico"
              value={chartDays}
              onChange={(e) => setChartDays(Number(e.target.value))}
            >
              <option value={7}>Últimos 7 dias</option>
              <option value={14}>Últimos 14 dias</option>
              <option value={30}>Últimos 30 dias</option>
            </select>
          </div>
          <div className="chart-summary">
            <div>
              <span className="legend-dot entry" />
              <span>
                Entradas hoje<strong>{todayCount("ENTRY")}</strong>
              </span>
            </div>
            <div>
              <span className="legend-dot exit" />
              <span>
                Saídas hoje<strong>{todayCount("EXIT")}</strong>
              </span>
            </div>
            <div>
              <span className="legend-dot transfer" />
              <span>
                Transferências hoje<strong>{todayCount("TRANSFER")}</strong>
              </span>
            </div>
          </div>
          <div className="chart-container">
            <div className="chart-y">
              <span>{max}</span>
              <span>{Math.round(max / 2)}</span>
              <span>0</span>
            </div>
            <div className="chart-bars">
              <div className="chart-grid-lines">
                <i />
                <i />
                <i />
              </div>
              {days.map((d) => (
                <div className="chart-day" key={d.label}>
                  <div className="bar-pair">
                    <div
                      className="bar entry"
                      style={{
                        height: `${(d.entry / max) * 100}%`,
                        minHeight: d.entry ? 4 : 0,
                      }}
                      title={`${d.label}: ${d.entry} entradas`}
                    />
                    <div
                      className="bar exit"
                      style={{
                        height: `${(d.exit / max) * 100}%`,
                        minHeight: d.exit ? 4 : 0,
                      }}
                      title={`${d.label}: ${d.exit} saídas`}
                    />
                  </div>
                  <span>{d.label}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="chart-caption">
            Quantidade de operações registradas por dia
          </div>
        </section>
        <section className="panel alerts-panel">
          <div className="panel-heading">
            <div>
              <h2>
                Precisam de atenção{" "}
                <span className="count-pill">{low.length}</span>
              </h2>
              <p>Produtos abaixo do estoque mínimo</p>
            </div>
            <span className="alert-heading-icon">
              <TriangleAlert size={20} />
            </span>
          </div>
          <div className="alert-list">
            {low.slice(0, 4).map((p) => {
              const total = availableFor(data, p.id);
              return (
                <button
                  className="alert-row"
                  key={p.id}
                  onClick={() => onProduct(p)}
                >
                  <span className="alert-product-icon">
                    <Package size={19} />
                  </span>
                  <span className="alert-product-copy">
                    <strong>{p.name}</strong>
                    <small>
                      Mínimo: {qty(p.minStock)} {p.unit}
                    </small>
                  </span>
                  <span className={total <= 0 ? "text-danger" : "text-warning"}>
                    <strong>{qty(total)}</strong>
                    <small>{p.unit} disponíveis</small>
                  </span>
                </button>
              );
            })}
            {!low.length && (
              <div className="all-good">
                <ShieldCheck size={32} />
                <strong>
                  {totalProducts
                    ? "Nenhum alerta de reposição"
                    : "Nenhum material cadastrado"}
                </strong>
                <p>
                  {totalProducts
                    ? "O saldo disponível atende aos mínimos cadastrados."
                    : "Cadastre os materiais e registre o inventário inicial aprovado desta unidade."}
                </p>
              </div>
            )}
          </div>
          <Link
            href={
              user?.permissions.includes("purchases:read")
                ? "/reposicao"
                : "/estoque"
            }
            className="panel-bottom-link"
          >
            Conferir reposição
            <ArrowRight size={16} />
          </Link>
        </section>
      </div>
      <div className="section-title-row">
        <div>
          <h2>Ações rápidas</h2>
          <p>O que você precisa fazer agora?</p>
        </div>
        <Link href="/operacao" className="text-link">
          Modo operação
          <ArrowUpRight size={15} />
        </Link>
      </div>
      <div className="quick-actions">
        {canMove && (
          <>
            {canMoveStock(user?.permissions ?? data.permissions ?? [], "ENTRY") && (<button onClick={() => onMove("ENTRY")}>
              <span className="action-icon teal">
                <ArrowDownLeft size={23} />
              </span>
              <span>
                <strong>Registrar entrada</strong>
                <small>Receber materiais</small>
              </span>
              <ArrowRight size={17} />
            </button>)}
            {canMoveStock(user?.permissions ?? data.permissions ?? [], "EXIT") && (<button onClick={() => onMove("EXIT")}>
              <span className="action-icon orange">
                <ArrowUpRight size={23} />
              </span>
              <span>
                <strong>Registrar saída</strong>
                <small>Retirar materiais</small>
              </span>
              <ArrowRight size={17} />
            </button>)}
            {canMoveStock(user?.permissions ?? data.permissions ?? [], "TRANSFER") && (<button onClick={() => onMove("TRANSFER")}>
              <span className="action-icon blue">
                <ArrowRightLeft size={23} />
              </span>
              <span>
                <strong>Transferir material</strong>
                <small>Entre localizações</small>
              </span>
              <ArrowRight size={17} />
            </button>)}
          </>
        )}
        <Link href="/inventario">
          <span className="action-icon purple">
            <ClipboardCheck size={23} />
          </span>
          <span>
            <strong>Conferir inventário</strong>
            <small>Validar estoque físico</small>
          </span>
          <ArrowRight size={17} />
        </Link>
      </div>
      <div className="dashboard-lower">
        <section className="panel recent-panel">
          <div className="panel-heading">
            <div>
              <h2>Últimas movimentações</h2>
              <p>Atualizações mais recentes do seu estoque</p>
            </div>
            <Link className="text-link" href="/movimentacoes">
              Ver todas
              <ArrowRight size={15} />
            </Link>
          </div>
          <MovementTable
            compact
            data={data}
            movements={data.movements.slice(0, 5)}
          />
        </section>
        <section className="panel popular-panel">
          <div className="panel-heading">
            <div>
              <h2>Mais movimentados</h2>
              <p>Materiais com maior atividade</p>
            </div>
            <Activity size={19} />
          </div>
          <div className="popular-list">
            {popular.map((item, index) => (
              <button
                key={item.product.id}
                onClick={() => onProduct(item.product)}
              >
                <span className="rank">0{index + 1}</span>
                <span>
                  <strong>{item.product.name}</strong>
                  <small>{item.count} movimentações</small>
                  <i
                    style={{
                      width: `${(item.count / (popular[0]?.count || 1)) * 100}%`,
                    }}
                  />
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
            {!popular.length && (
              <Empty
                title="Sem movimentos"
                description="Os materiais mais utilizados aparecerão aqui."
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
}
function Stat({
  label,
  value,
  caption,
  icon,
  tone,
  alert = false,
}: {
  label: string;
  value: string;
  caption: string;
  icon: React.ReactNode;
  tone: string;
  alert?: boolean;
}) {
  return (
    <section className={`stat-card ${tone}`}>
      <div className="stat-top">
        <span>{label}</span>
        <span className={`stat-icon ${tone}`}>{icon}</span>
      </div>
      <strong className="stat-value">{value}</strong>
      <div className={`stat-caption ${alert ? "attention" : ""}`}>
        {alert ? (
          <span className={`dot ${tone}`} />
        ) : (
          <span className="tiny-line" />
        )}
        {caption}
      </div>
    </section>
  );
}
