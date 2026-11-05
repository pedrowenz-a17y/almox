"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
  useDeferredValue,
} from "react";
import Link from "@/components/workspace-link";
import dynamic from "next/dynamic";
import { navigateWorkspace } from "@/lib/workspace-navigation";
import { ApiError } from "@/lib/client";
import { usePathname, useRouter } from "next/navigation";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowRightLeft,
  ArrowUpRight,
  Bell,
  Boxes,
  Building2,
  ChartNoAxesCombined,
  Check,
  ChevronRight,
  ClipboardCheck,
  FileClock,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  Package,
  Plus,
  Printer,
  QrCode,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Trash2,
  TriangleAlert,
  Truck,
  Users,
  X,
  Pencil,
  RefreshCw,
  ScanLine,
} from "lucide-react";
import {
  api,
  Audit,
  DataSet,
  InventoryCount,
  Location,
  locationPath,
  money,
  movementLabels,
  number,
  Product,
  qty,
  Role,
  SessionUser,
  stockState,
  availableFor,
  physicalFor,
  dateTime,
} from "@/lib/client";
import type { CatalogEntity } from "@/components/catalog-form";
const CatalogForm = dynamic(() => import("@/components/catalog-form"), {
  loading: () => <Loading />,
});
const entityTitles: Record<CatalogEntity, string> = {
  products: "produto",
  categories: "categoria",
  suppliers: "fornecedor",
  warehouses: "almoxarifado",
  locations: "localização",
  users: "usuário",
};
const MovementForm = dynamic(() => import("@/components/movement-form"), {
  loading: () => <Loading />,
});
const InventoryForm = dynamic(() => import("@/components/inventory-form"), {
  loading: () => <Loading />,
});
const Reports = dynamic(() => import("@/components/reports"), {
  loading: () => <Loading />,
});
import Dashboard from "@/components/dashboard";
import MovementTable from "@/components/movement-table";
import { Empty, Loading, Modal, Badge } from "@/components/ui";
const Scanner = dynamic(
  () => import("@/components/scanner").then((m) => m.Scanner),
  { loading: () => <Loading /> },
);
const Labels = dynamic(
  () => import("@/components/labels").then((m) => m.Labels),
  { loading: () => <Loading /> },
);
const ProductOverview = dynamic(() => import("@/components/product-overview"));
const Replenishment = dynamic(() => import("@/components/replenishment"), {
  loading: () => <Loading />,
});
const QuickLookup = dynamic(() => import("@/components/quick-lookup"), {
  loading: () => <Loading />,
});
import { Pwa } from "@/components/pwa";
const Orders = dynamic(() => import("@/components/orders"), {
  loading: () => <Loading />,
});
const Purchases = dynamic(() => import("@/components/purchases"), {
  loading: () => <Loading />,
});
import { brand } from "@/lib/brand";

const navigation = [
  { path: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { path: "/produtos", label: "Produtos", icon: Package },
  { path: "/estoque", label: "Estoque", icon: Boxes },
  { path: "/consulta", label: "Consulta rápida", icon: Search },
  {
    path: "/reposicao",
    label: "Reposição",
    icon: Truck,
    permission: "purchases:read",
  },
  { path: "/localizacoes", label: "Localizações", icon: MapPin },
  { path: "/movimentacoes", label: "Movimentações", icon: ArrowRightLeft },
  { path: "/qrcodes", label: "QR Codes", icon: QrCode },
  { path: "/fornecedores", label: "Fornecedores", icon: Truck },
  { path: "/inventario", label: "Inventário", icon: ClipboardCheck },
  {
    path: "/ordens-servico",
    label: "Ordens de serviço",
    icon: FileClock,
    permission: "orders:read",
  },
  {
    path: "/ordens-producao",
    label: "Ordens de produção",
    icon: Settings2,
    permission: "orders:read",
  },
  {
    path: "/compras",
    label: "Compras e recebimentos",
    icon: Truck,
    permission: "purchases:read",
  },
  {
    path: "/relatorios",
    label: "Relatórios",
    icon: ChartNoAxesCombined,
    permission: "reports:read",
  },
];
type Editor = { entity: CatalogEntity; record?: Record<string, unknown> };
type MoveOptions = {
  type: string;
  location?: string;
  product?: string;
  qr?: boolean;
};
export default function ERP({ initialUser }: { initialUser: SessionUser }) {
  const [now, setNow] = useState(() => Date.now());
  const pathname = usePathname();
  const router = useRouter();
  const route = pathname === "/" ? "/dashboard" : pathname;
  const [data, setData] = useState<DataSet | null>(null);
  const [user, setUser] = useState<SessionUser | null>(initialUser);
  const [roles, setRoles] = useState<Role[]>([]);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [menu, setMenu] = useState(false);
  const [switchingUnit, setSwitchingUnit] = useState(false);
  const refreshGeneration = useRef(0);
  const refreshController = useRef<AbortController | null>(null);
  const refreshedAt = useRef(0);
  const [productPage, setProductPage] = useState(1);
  const [search, setSearch] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const [searchResult, setSearchResult] = useState<{
    query: string;
    products: Product[];
    locations: Location[];
  } | null>(null);
  const [searchError, setSearchError] = useState("");
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);
  const [category, setCategory] = useState("");
  const [stockFilter, setStockFilter] = useState("all");
  const [locationFilter, setLocationFilter] = useState("");
  const [movementType, setMovementType] = useState("");
  const [period, setPeriod] = useState("30");
  const [tab, setTab] = useState("main");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [deleting, setDeleting] = useState<Editor | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [movement, setMovement] = useState<MoveOptions | null>(null);
  const [scan, setScan] = useState(false);
  const [count, setCount] = useState<{ location?: string } | null>(null);
  const [countDetails, setCountDetails] = useState<InventoryCount | null>(null);
  const [auditDetails, setAuditDetails] = useState<Audit | null>(null);
  const [productDetails, setProductDetails] = useState<Product | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const permissions = user?.permissions || data?.permissions || [];
  const can = (key: string) => permissions.includes(key);
  const refresh = useCallback(async () => {
    refreshController.current?.abort();
    const controller = new AbortController();
    refreshController.current = controller;
    const generation = ++refreshGeneration.current;
    setRefreshing(true);
    try {
      const dataset = await api<DataSet>("/api/data", {
        signal: controller.signal,
      });
      if (generation !== refreshGeneration.current) return;
      if (!dataset.user)
        throw new Error(
          "Atualize o servidor para carregar esta versão do ERP.",
        );
      setUser(dataset.user);
      setData(dataset);
      setRoles(dataset.roles || []);
      setNow(Date.now());
      refreshedAt.current = Date.now();
      setError("");
    } catch (e) {
      if (generation !== refreshGeneration.current || controller.signal.aborted)
        return;
      if (e instanceof ApiError && [401, 403].includes(e.status)) {
        setData(null);
        setRoles([]);
        setUser(null);
        if (e.status === 401) router.replace("/login");
      }
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível carregar o almoxarifado.",
      );
    } finally {
      if (generation === refreshGeneration.current) setRefreshing(false);
    }
  }, [router]);
  async function switchUnit(unitId: string) {
    if (!unitId || unitId === user?.unitId || switchingUnit) return;
    setSwitchingUnit(true);
    ++refreshGeneration.current;
    setData(null);
    setRoles([]);
    setError("");
    setSearch("");
    setSearchResult(null);
    setSearchError("");
    setEditor(null);
    setDeleting(null);
    setMovement(null);
    setScan(false);
    setCount(null);
    setCountDetails(null);
    setAuditDetails(null);
    setProductDetails(null);
    setToast("");
    setFilter("");
    setCategory("");
    setStockFilter("all");
    setLocationFilter("");
    setTab("main");
    setMenu(false);
    try {
      await api("/api/unit", {
        method: "POST",
        body: JSON.stringify({ unitId }),
      });
      await refresh();
      navigateWorkspace("/dashboard", true);
    } catch (cause) {
      await refresh();
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível trocar de unidade.",
      );
    } finally {
      setSwitchingUnit(false);
    }
  }
  useEffect(() => {
    let disposed = false;
    void Promise.resolve().then(() => {
      if (!disposed) return refresh();
    });
    const focus = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - refreshedAt.current > 30_000
      )
        void refresh();
    };
    window.addEventListener("focus", focus);
    document.addEventListener("visibilitychange", focus);
    return () => {
      disposed = true;
      refreshController.current?.abort();
      window.removeEventListener("focus", focus);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [refresh]);
  useEffect(() => {
    queueMicrotask(() => {
      setFilter("");
      setCategory("");
      setStockFilter("all");
      setLocationFilter("");
      setTab("main");
      setMenu(false);
      setSearch("");
    });
  }, [pathname]);
  useEffect(() => {
    queueMicrotask(() => setProductPage(1));
  }, [filter, category, stockFilter, locationFilter, pathname, user?.unitId]);
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.key === "Escape") setSearch("");
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(timer);
  }, [toast]);
  async function complete(message: string) {
    setEditor(null);
    setMovement(null);
    setCount(null);
    setCountDetails(null);
    await refresh();
    setToast(message);
  }
  async function logout() {
    try {
      await api("/api/auth/logout", { method: "POST" });
      router.replace("/login");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao sair.");
    }
  }
  async function remove() {
    if (!deleting?.record) return;
    setDeleteBusy(true);
    try {
      await api(`/api/catalog/${deleting.entity}/${deleting.record.id}`, {
        method: "DELETE",
      });
      setDeleting(null);
      await refresh();
      setToast("Cadastro removido ou arquivado. O histórico foi preservado.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível remover.");
      setDeleting(null);
    } finally {
      setDeleteBusy(false);
    }
  }
  async function approve(id: string) {
    setActionBusy(true);
    try {
      await api(`/api/inventory/${id}/approve`, { method: "POST", body: "{}" });
      await complete("Inventário aprovado. Os ajustes foram registrados.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Não foi possível aprovar.");
    } finally {
      setActionBusy(false);
    }
  }
  const low = useMemo(
    () =>
      data?.products.filter(
        (p) =>
          p.active &&
          (availableFor(data, p.id) < number(p.minStock) ||
            availableFor(data, p.id) <= 0),
      ) || [],
    [data],
  );
  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSearchError("");
      api<{ products: Product[]; locations: Location[] }>(
        `/api/search?q=${encodeURIComponent(query)}`,
        { signal: controller.signal },
      )
        .then((result) => {
          if (!controller.signal.aborted) setSearchResult({ ...result, query });
        })
        .catch((cause) => {
          if (!controller.signal.aborted)
            setSearchError(
              cause instanceof Error
                ? cause.message
                : "Não foi possível pesquisar.",
            );
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search, user?.unitId]);
  const globalMatches =
    search.trim().length >= 2 && searchResult?.query === search.trim()
      ? searchResult
      : null;
  const pageTitle = route.startsWith("/produto/")
    ? "Ficha do produto"
    : route.startsWith("/localizacao/")
      ? "Detalhes da localização"
      : route === "/operacao"
        ? "Operação rápida"
        : route === "/usuarios"
          ? "Usuários"
          : route === "/configuracoes"
            ? "Configurações"
            : route === "/auditoria"
              ? "Auditoria"
              : route === "/imprimir-etiquetas"
                ? "Imprimir etiquetas"
                : navigation.find((n) => n.path === route)?.label ||
                  "Página não encontrada";
  const descriptions: Record<string, string> = {
    "/dashboard": "Saldos, movimentações e pendências da unidade.",
    "/produtos":
      "Cadastre materiais, defina mínimos e imprima o QR de cada produto.",
    "/estoque": "Acompanhe o saldo real de cada material, em cada localização.",
    "/localizacoes":
      "Almoxarifados, setores, estantes e posições de armazenamento.",
    "/movimentacoes": "Rastreabilidade completa, da entrada à última retirada.",
    "/qrcodes": "Conecte suas localizações físicas à operação digital.",
    "/fornecedores": "Dados de contato e identificação dos fornecedores.",
    "/inventario":
      "Compare o estoque físico com o sistema e resolva divergências.",
    "/relatorios": "Consulte e exporte os registros da unidade.",
    "/usuarios": "Gerencie acessos e responsabilidades da sua equipe.",
    "/auditoria": "Um registro íntegro das ações realizadas no sistema.",
    "/configuracoes": "Preferências e regras de funcionamento do almoxarifado.",
    "/operacao": "Sua rotina de estoque, a poucos toques de distância.",
  };
  const recordEdit = (entity: CatalogEntity, record: object) =>
    setEditor({ entity, record: record as Record<string, unknown> });
  const actions = (entity: CatalogEntity, record: object) => (
    <div className="row-actions">
      {(entity === "users" ? can("users:manage") : can("catalog:write")) && (
        <button
          title="Editar cadastro"
          aria-label="Editar cadastro"
          className="icon-button"
          onClick={() => recordEdit(entity, record)}
        >
          <Pencil size={16} />
        </button>
      )}
      {can("records:delete") && (
        <button
          title="Excluir ou arquivar"
          aria-label="Excluir ou arquivar"
          className="icon-button danger-action"
          onClick={() =>
            setDeleting({ entity, record: record as Record<string, unknown> })
          }
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
  const addButton = (entity: CatalogEntity) =>
    (entity === "users" ? can("users:manage") : can("catalog:write")) && (
      <button className="button primary" onClick={() => setEditor({ entity })}>
        <Plus size={18} />{" "}
        {entity === "locations"
          ? "Nova localização"
          : entity === "categories"
            ? "Nova categoria"
            : `Novo ${entityTitles[entity]}`}
      </button>
    );
  const stockBadge = (p: Product) => {
    const state = stockState(p, availableFor(data!, p.id));
    return <Badge tone={state.className}>{state.label}</Badge>;
  };
  const productsTable = (products: Product[], showLocation = false) => (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Produto / material</th>
            <th>Código / SKU</th>
            {showLocation ? <th>Localizações</th> : <th>Categoria</th>}
            {showLocation && (
              <>
                <th className="numeric">Físico</th>
                <th className="numeric">Reservado</th>
                <th className="numeric">Aplicado pendente</th>
              </>
            )}
            <th className="numeric">Disponível</th>
            <th className="numeric">Mínimo</th>
            <th>Status</th>
            <th aria-label="Ações" />
          </tr>
        </thead>
        <tbody>
          {products.slice((productPage - 1) * 50, productPage * 50).map((p) => (
            <tr key={p.id}>
              <td>
                <button
                  className="product-cell"
                  onClick={() => setProductDetails(p)}
                >
                  {p.imageUrl ? (
                    <img src={p.imageUrl} alt="" />
                  ) : (
                    <span className="product-avatar">
                      <Package size={20} />
                    </span>
                  )}
                  <span>
                    <strong>{p.name}</strong>
                    <small>{p.manufacturer || p.unit}</small>
                  </span>
                </button>
              </td>
              <td>
                <span className="mono">{p.internalCode}</span>
                <small>{p.sku || "—"}</small>
              </td>
              {showLocation ? (
                <td>
                  <div className="location-chips">
                    {data!.balances
                      .filter(
                        (b) => b.productId === p.id && number(b.quantity) !== 0,
                      )
                      .map((b) => (
                        <Link
                          className="small-link"
                          key={b.id}
                          href={`/localizacao/${b.locationId}`}
                        >
                          {
                            data!.locations.find((l) => l.id === b.locationId)
                              ?.code
                          }{" "}
                          <strong>
                            {qty(b.availableQuantity ?? b.quantity)} disp.
                          </strong>
                        </Link>
                      ))}
                  </div>
                </td>
              ) : (
                <td>{p.category?.name || "Sem categoria"}</td>
              )}
              {showLocation && (
                <>
                  <td className="numeric">{qty(physicalFor(data!, p.id))}</td>
                  <td className="numeric">
                    {qty(
                      data!.balances
                        .filter((b) => b.productId === p.id)
                        .reduce(
                          (sum, b) => sum + number(b.reservedQuantity),
                          0,
                        ),
                    )}
                  </td>
                  <td className="numeric">
                    {qty(
                      data!.balances
                        .filter((b) => b.productId === p.id)
                        .reduce((sum, b) => sum + number(b.appliedQuantity), 0),
                    )}
                  </td>
                </>
              )}
              <td className="numeric">
                <strong>{qty(availableFor(data!, p.id))}</strong>{" "}
                <span className="muted">{p.unit}</span>
              </td>
              <td className="numeric muted">{qty(p.minStock)}</td>
              <td>{p.active ? stockBadge(p) : <Badge>Inativo</Badge>}</td>
              <td>{actions("products", p)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!products.length && (
        <Empty
          title="Nenhum material encontrado"
          description="Cadastre um material nesta unidade ou revise os filtros."
        />
      )}
      {products.length > 50 && (
        <div className="table-footer pagination">
          <span>
            {products.length} materiais · página {productPage}
          </span>
          <div>
            <button
              className="button secondary small"
              disabled={productPage <= 1}
              onClick={() => setProductPage((page) => page - 1)}
            >
              Anterior
            </button>
            <button
              className="button secondary small"
              disabled={productPage * 50 >= products.length}
              onClick={() => setProductPage((page) => page + 1)}
            >
              Próxima
            </button>
          </div>
        </div>
      )}
    </div>
  );

  function content() {
    if (!data)
      return error ? (
        <Empty
          title="Dados indisponíveis"
          description="Não foi possível consultar esta unidade. Use Tentar novamente no aviso acima. Nenhum saldo foi considerado zero."
        />
      ) : (
        <Loading />
      );
    const required = navigation.find((item) => item.path === route)?.permission;
    if (required && !can(required)) return <Denied />;
    if (route === "/ordens-servico" || route === "/ordens-producao")
      return (
        <Orders
          key={`${user?.unitId}-${route}`}
          kind={route === "/ordens-servico" ? "SERVICE" : "PRODUCTION"}
          data={data}
          permissions={permissions}
          onRefresh={refresh}
        />
      );
    if (route === "/compras")
      return (
        <Purchases
          key={user?.unitId}
          data={data}
          permissions={permissions}
          onRefresh={refresh}
        />
      );
    if (route === "/reposicao") return <Replenishment key={user?.unitId} />;
    if (route === "/consulta")
      return <QuickLookup data={data} onScan={() => setScan(true)} />;
    if (route.startsWith("/produto/")) {
      const product = data.products.find((p) => p.id === route.split("/")[2]);
      return product ? (
        <ProductOverview
          product={product}
          data={data}
          canMove={can("stock:move")}
          onMove={() => setMovement({ type: "ENTRY", product: product.id })}
          onEdit={
            can("catalog:write")
              ? () => recordEdit("products", product)
              : undefined
          }
        />
      ) : (
        <Empty
          title="Produto não encontrado nesta unidade"
          description="Confira a unidade selecionada ou procure o código na consulta rápida."
        />
      );
    }
    const query = deferredFilter.toLocaleLowerCase("pt-BR");
    const filteredProducts = data.products.filter(
      (p) =>
        (!query ||
          [
            p.name,
            p.internalCode,
            p.sku,
            p.category?.name,
            p.supplier?.legalName,
          ].some((v) => v?.toLocaleLowerCase("pt-BR").includes(query))) &&
        (!category || p.categoryId === category) &&
        (stockFilter === "all" ||
          (stockFilter === "low"
            ? availableFor(data, p.id) < number(p.minStock)
            : stockFilter === "zero"
              ? availableFor(data, p.id) <= 0
              : stockState(p, availableFor(data, p.id)).className ===
                "success")) &&
        (!locationFilter ||
          data.balances.some(
            (b) => b.productId === p.id && b.locationId === locationFilter,
          )),
    );
    if (route === "/dashboard")
      return (
        <Dashboard
          data={data}
          user={user}
          onScan={() => setScan(true)}
          onMove={(type) => setMovement({ type })}
          canMove={can("stock:move")}
          onProduct={setProductDetails}
        />
      );
    if (route === "/produtos" || route === "/estoque")
      return (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">CATÁLOGO E DISPONIBILIDADE</span>
              <h1>{pageTitle}</h1>
              <p>{descriptions[route]}</p>
            </div>
            {route === "/produtos"
              ? addButton(tab === "categories" ? "categories" : "products")
              : can("stock:move") && (
                  <button
                    className="button primary"
                    onClick={() => setMovement({ type: "ENTRY" })}
                  >
                    <Plus size={18} />
                    Nova movimentação
                  </button>
                )}
          </div>
          {route === "/produtos" && (
            <div className="tabs">
              <button
                className={tab === "main" ? "active" : ""}
                onClick={() => setTab("main")}
              >
                Produtos <span>{data.products.length}</span>
              </button>
              <button
                className={tab === "categories" ? "active" : ""}
                onClick={() => setTab("categories")}
              >
                Categorias <span>{data.categories.length}</span>
              </button>
            </div>
          )}
          {tab === "categories" ? (
            <section className="panel">
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Categoria</th>
                      <th>Descrição</th>
                      <th>Produtos</th>
                      <th aria-label="Ações" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.categories.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <strong>{c.name}</strong>
                        </td>
                        <td>{c.description || "—"}</td>
                        <td>
                          {
                            data.products.filter((p) => p.categoryId === c.id)
                              .length
                          }
                        </td>
                        <td>{actions("categories", c)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!data.categories.length && <Empty />}
              </div>
            </section>
          ) : (
            <>
              <div className="summary-strip">
                <span>
                  <i className="dot teal" />
                  {data.products.filter((p) => p.active).length} produtos ativos
                </span>
                <span>
                  <i className="dot amber" />
                  {low.length} abaixo do mínimo
                </span>
                <span>
                  <i className="dot red" />
                  {
                    data.products.filter(
                      (p) => p.active && availableFor(data, p.id) <= 0,
                    ).length
                  }{" "}
                  sem estoque
                </span>
              </div>
              <section className="panel">
                <div className="toolbar">
                  <div className="table-search">
                    <Search size={17} />
                    <input
                      aria-label="Pesquisar produtos"
                      placeholder="Buscar por nome, código ou SKU…"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    />
                  </div>
                  <select
                    aria-label="Filtrar categoria"
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                  >
                    <option value="">Todas as categorias</option>
                    {data.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Filtrar nível de estoque"
                    value={stockFilter}
                    onChange={(e) => setStockFilter(e.target.value)}
                  >
                    <option value="all">Todos os status</option>
                    <option value="low">Abaixo do mínimo</option>
                    <option value="zero">Sem estoque</option>
                    <option value="normal">Normal</option>
                  </select>
                  {route === "/estoque" && (
                    <select
                      aria-label="Filtrar localização"
                      value={locationFilter}
                      onChange={(e) => setLocationFilter(e.target.value)}
                    >
                      <option value="">Todas as localizações</option>
                      {data.locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.code}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                {route === "/estoque" && (
                  <p className="stock-explanation">
                    Físico = saldo registrado − aplicado pendente. Disponível =
                    físico − reservado. A baixa definitiva ocorre no faturamento
                    da ordem.
                  </p>
                )}
                {productsTable(filteredProducts, route === "/estoque")}
                <div className="table-footer">
                  {filteredProducts.length} de {data.products.length} produtos{" "}
                  <span>Saldo consolidado de todas as localizações</span>
                </div>
              </section>
            </>
          )}
        </>
      );
    if (route === "/localizacoes")
      return (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">MAPA DO ALMOXARIFADO</span>
              <h1>Localizações</h1>
              <p>{descriptions[route]}</p>
            </div>
            {addButton(tab === "warehouses" ? "warehouses" : "locations")}
          </div>
          <div className="tabs">
            <button
              className={tab === "main" ? "active" : ""}
              onClick={() => setTab("main")}
            >
              Localizações <span>{data.locations.length}</span>
            </button>
            <button
              className={tab === "warehouses" ? "active" : ""}
              onClick={() => setTab("warehouses")}
            >
              Almoxarifados <span>{data.warehouses.length}</span>
            </button>
          </div>
          {tab === "warehouses" ? (
            <div className="location-grid">
              {data.warehouses.map((w) => (
                <section className="panel location-card" key={w.id}>
                  <Building2 size={27} />
                  <h3>{w.name}</h3>
                  <p>{w.code}</p>
                  <small>{w.description}</small>
                  <div className="location-card-bottom">
                    <span>
                      {
                        data.locations.filter((l) => l.warehouseId === w.id)
                          .length
                      }{" "}
                      localizações
                    </span>
                    {actions("warehouses", w)}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <section className="panel">
              <div className="toolbar">
                <div className="table-search">
                  <Search size={18} />
                  <input
                    aria-label="Buscar localização"
                    placeholder="Buscar localização ou código…"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  />
                </div>
                <Link href="/imprimir-etiquetas" className="button secondary">
                  <Printer size={17} />
                  Imprimir etiquetas
                </Link>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Localização</th>
                      <th>Código</th>
                      <th>Almoxarifado</th>
                      <th className="numeric">Materiais</th>
                      <th>Status</th>
                      <th aria-label="Ações" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.locations
                      .filter(
                        (l) =>
                          !query ||
                          `${l.name} ${l.code} ${locationPath(data, l.id)}`
                            .toLocaleLowerCase("pt-BR")
                            .includes(query),
                      )
                      .map((l) => (
                        <tr key={l.id}>
                          <td>
                            <Link
                              href={`/localizacao/${l.id}`}
                              className="location-cell"
                            >
                              <span className="location-avatar">
                                <MapPin size={19} />
                              </span>
                              <span>
                                <strong>{l.name}</strong>
                                <small>
                                  {l.parentId
                                    ? locationPath(data, l.parentId)
                                    : "Localização principal"}
                                </small>
                              </span>
                            </Link>
                          </td>
                          <td>
                            <span className="code-tag">{l.code}</span>
                          </td>
                          <td>
                            {
                              data.warehouses.find(
                                (w) => w.id === l.warehouseId,
                              )?.name
                            }
                          </td>
                          <td className="numeric">
                            {
                              data.balances.filter(
                                (b) =>
                                  b.locationId === l.id &&
                                  number(b.quantity) > 0,
                              ).length
                            }
                          </td>
                          <td>
                            <Badge tone={l.active ? "success" : ""}>
                              {l.active ? "Ativa" : "Inativa"}
                            </Badge>
                          </td>
                          <td>
                            <div className="row-actions">
                              <Link
                                href={`/localizacao/${l.id}`}
                                title="Abrir localização"
                                className="icon-button"
                              >
                                <ArrowUpRight size={17} />
                              </Link>
                              {actions("locations", l)}
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
                {!data.locations.length && <Empty />}
              </div>
            </section>
          )}
        </>
      );
    if (route.startsWith("/localizacao/")) {
      const id = route.split("/")[2];
      const location = data.locations.find((l) => l.id === id);
      if (!location)
        return (
          <Empty
            title="Localização não encontrada"
            description="Confira o código ou leia novamente a etiqueta."
          />
        );
      const balances = data.balances.filter((b) => b.locationId === id);
      return (
        <>
          <div className="breadcrumbs">
            <Link href="/localizacoes">Localizações</Link>
            <ChevronRight size={14} />
            <span>{location.code}</span>
          </div>
          <div className="page-heading">
            <div>
              <span className="eyebrow">LOCALIZAÇÃO IDENTIFICADA</span>
              <h1>{location.name}</h1>
              <p>{locationPath(data, id)}</p>
            </div>
            {actions("locations", location)}
          </div>
          <div className="location-detail-banner">
            <span className="location-large-icon">
              <MapPin size={34} />
            </span>
            <div>
              <Badge tone={location.active ? "success" : ""}>
                {location.active ? "Localização ativa" : "Inativa"}
              </Badge>
              <h3>{location.code}</h3>
              <p>
                {
                  data.warehouses.find((w) => w.id === location.warehouseId)
                    ?.name
                }
              </p>
            </div>
            <img
              src={`/api/qr/${id}?format=svg`}
              alt={`QR Code de ${location.code}`}
              width={100}
              height={100}
            />
            <Link
              className="button secondary"
              href={`/imprimir-etiquetas?location=${id}`}
            >
              <Printer size={17} />
              Imprimir QR
            </Link>
          </div>
          <div className="quick-actions">
            {can("stock:move") && (
              <>
                <button
                  onClick={() => setMovement({ type: "ENTRY", location: id })}
                >
                  <span className="action-icon teal">
                    <ArrowDownLeft size={23} />
                  </span>
                  <strong>Entrada</strong>
                  <ArrowRight size={18} />
                </button>
                <button
                  onClick={() => setMovement({ type: "EXIT", location: id })}
                >
                  <span className="action-icon orange">
                    <ArrowUpRight size={23} />
                  </span>
                  <strong>Retirar material</strong>
                  <ArrowRight size={18} />
                </button>
                <button
                  onClick={() =>
                    setMovement({ type: "TRANSFER", location: id })
                  }
                >
                  <span className="action-icon blue">
                    <ArrowRightLeft size={23} />
                  </span>
                  <strong>Transferir</strong>
                  <ArrowRight size={18} />
                </button>
              </>
            )}
            {can("inventory:count") && (
              <button onClick={() => setCount({ location: id })}>
                <span className="action-icon purple">
                  <ClipboardCheck size={23} />
                </span>
                <strong>Inventário</strong>
                <ArrowRight size={18} />
              </button>
            )}
          </div>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Materiais nesta localização</h2>
                <p>{balances.length} materiais registrados</p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th>Código</th>
                    <th className="numeric">Físico</th>
                    <th className="numeric">Reservado</th>
                    <th className="numeric">Aplicado pendente</th>
                    <th className="numeric">Disponível</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {balances.map((b) => {
                    const p = data.products.find((v) => v.id === b.productId);
                    return (
                      <tr key={b.id}>
                        <td>
                          <strong>{p?.name}</strong>
                        </td>
                        <td className="mono">{p?.internalCode}</td>
                        <td className="numeric">
                          <strong>
                            {qty(b.physicalQuantity ?? b.quantity)}
                          </strong>{" "}
                          {p?.unit}
                        </td>
                        <td className="numeric">{qty(b.reservedQuantity)}</td>
                        <td className="numeric">{qty(b.appliedQuantity)}</td>
                        <td className="numeric">
                          <strong>
                            {qty(b.availableQuantity ?? b.quantity)}
                          </strong>{" "}
                          {p?.unit}
                        </td>
                        <td>
                          {can("stock:move") && (
                            <button
                              className="button secondary small"
                              onClick={() =>
                                setMovement({
                                  type: "EXIT",
                                  location: id,
                                  product: b.productId,
                                })
                              }
                            >
                              Retirar
                              <ArrowUpRight size={15} />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!balances.length && (
                <Empty
                  title="Esta localização está vazia"
                  description="Registre uma entrada para começar a armazenar materiais aqui."
                />
              )}
            </div>
          </section>
          {data.locations.some((l) => l.parentId === id) && (
            <section className="panel">
              <div className="panel-heading">
                <h2>Localizações internas</h2>
              </div>
              <div className="child-locations">
                {data.locations
                  .filter((l) => l.parentId === id)
                  .map((l) => (
                    <Link
                      className="button secondary"
                      key={l.id}
                      href={`/localizacao/${l.id}`}
                    >
                      <MapPin size={17} />
                      {l.name}
                      <ChevronRight size={17} />
                    </Link>
                  ))}
              </div>
            </section>
          )}
          <section className="panel">
            <div className="panel-heading">
              <h2>Histórico desta localização</h2>
            </div>
            <MovementTable
              movements={data.movements.filter(
                (m) => m.sourceId === id || m.destinationId === id,
              )}
              data={data}
            />
          </section>
        </>
      );
    }
    if (route === "/movimentacoes") {
      const cutoff = period === "all" ? 0 : now - Number(period) * 86400000;
      const movements = data.movements.filter(
        (m) =>
          (!movementType || m.type === movementType) &&
          new Date(m.createdAt).getTime() >= cutoff &&
          (!query ||
            `${m.product?.name} ${m.product?.internalCode} ${m.reference} ${m.user?.name}`
              .toLocaleLowerCase("pt-BR")
              .includes(query)),
      );
      return (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">RASTREABILIDADE</span>
              <h1>Movimentações</h1>
              <p>{descriptions[route]}</p>
            </div>
            {can("stock:move") && (
              <button
                className="button primary"
                onClick={() => setMovement({ type: "ENTRY" })}
              >
                <Plus size={18} />
                Nova movimentação
              </button>
            )}
          </div>
          <section className="panel">
            <div className="toolbar">
              <div className="table-search">
                <Search size={18} />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Produto, documento ou usuário…"
                  aria-label="Buscar movimentações"
                />
              </div>
              <select
                value={movementType}
                onChange={(e) => setMovementType(e.target.value)}
                aria-label="Tipo de movimentação"
              >
                <option value="">Todos os movimentos</option>
                {Object.entries(movementLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                aria-label="Período"
              >
                <option value="1">Últimas 24 horas</option>
                <option value="7">Últimos 7 dias</option>
                <option value="30">Últimos 30 dias</option>
                <option value="all">Todo o período</option>
              </select>
            </div>
            <MovementTable movements={movements} data={data} />
            <div className="table-footer">
              {movements.length} movimentações
              <span>
                <ShieldCheck size={14} />
                Histórico protegido contra exclusão
              </span>
            </div>
          </section>
        </>
      );
    }
    if (route === "/qrcodes" || route === "/imprimir-etiquetas")
      return (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">DO FÍSICO AO DIGITAL</span>
              <h1>{pageTitle}</h1>
              <p>
                {route === "/qrcodes"
                  ? descriptions[route]
                  : "Selecione as localizações e prepare suas etiquetas para impressão."}
              </p>
            </div>
            <button className="button primary" onClick={() => setScan(true)}>
              <ScanLine size={19} />
              Escanear QR Code
            </button>
          </div>
          <Labels
            locations={data.locations}
            selectedIds={
              typeof window !== "undefined" &&
              new URLSearchParams(window.location.search).get("location")
                ? [new URLSearchParams(window.location.search).get("location")!]
                : undefined
            }
          />
        </>
      );
    if (route === "/fornecedores")
      return (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">REDE DE PARCEIROS</span>
              <h1>Fornecedores</h1>
              <p>{descriptions[route]}</p>
            </div>
            {addButton("suppliers")}
          </div>
          <section className="panel">
            <div className="toolbar">
              <div className="table-search">
                <Search size={18} />
                <input
                  placeholder="Razão social, nome ou CNPJ…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  aria-label="Buscar fornecedor"
                />
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fornecedor</th>
                    <th>CNPJ / identificação</th>
                    <th>Contato</th>
                    <th>Produtos</th>
                    <th>Status</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {data.suppliers
                    .filter(
                      (s) =>
                        !query ||
                        `${s.legalName} ${s.tradeName} ${s.taxId}`
                          .toLocaleLowerCase("pt-BR")
                          .includes(query),
                    )
                    .map((s) => (
                      <tr key={s.id}>
                        <td>
                          <strong>{s.tradeName || s.legalName}</strong>
                          <small>{s.legalName}</small>
                        </td>
                        <td>{s.taxId || "—"}</td>
                        <td>
                          {s.contact || s.phone || "—"}
                          <small>{s.email}</small>
                        </td>
                        <td>
                          {
                            data.products.filter((p) => p.supplierId === s.id)
                              .length
                          }
                        </td>
                        <td>
                          <Badge tone={s.active ? "success" : ""}>
                            {s.active ? "Ativo" : "Inativo"}
                          </Badge>
                        </td>
                        <td>{actions("suppliers", s)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!data.suppliers.length && <Empty />}
            </div>
          </section>
        </>
      );
    if (route === "/inventario")
      return (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">CONFERÊNCIA E CONTROLE</span>
              <h1>Inventário</h1>
              <p>{descriptions[route]}</p>
            </div>
            {can("inventory:count") && (
              <button className="button primary" onClick={() => setCount({})}>
                <Plus size={18} />
                Nova contagem
              </button>
            )}
          </div>
          <div className="summary-strip">
            <span>
              <i className="dot amber" />
              {data.counts.filter((c) => c.status === "PENDING").length}{" "}
              aguardando aprovação
            </span>
            <span>
              <i className="dot teal" />
              {data.counts.filter((c) => c.status === "APPROVED").length}{" "}
              aprovados
            </span>
          </div>
          <section className="panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Localização</th>
                    <th>Data da contagem</th>
                    <th>Responsável</th>
                    <th>Materiais</th>
                    <th>Status</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {data.counts.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <strong>
                          {c.location?.name ||
                            data.locations.find((l) => l.id === c.locationId)
                              ?.name}
                        </strong>
                        <small>{c.location?.code}</small>
                      </td>
                      <td>{dateTime(c.createdAt)}</td>
                      <td>{c.user?.name || c.createdBy?.name || "—"}</td>
                      <td>{c.items.length}</td>
                      <td>
                        <Badge
                          tone={c.status === "APPROVED" ? "success" : "warning"}
                        >
                          {c.status === "APPROVED"
                            ? "Aprovado"
                            : "Aguardando aprovação"}
                        </Badge>
                      </td>
                      <td>
                        <button
                          className="button secondary small"
                          onClick={() => {
                            setError("");
                            setCountDetails(c);
                          }}
                        >
                          Conferir
                          <ChevronRight size={15} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.counts.length && (
                <Empty
                  title="Nenhum inventário realizado"
                  description="Inicie uma contagem para conferir o estoque físico de uma localização."
                />
              )}
            </div>
          </section>
        </>
      );
    if (route === "/relatorios")
      return can("reports:read") ? <Reports data={data} /> : <Denied />;
    if (route === "/usuarios")
      return can("users:manage") ? (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">EQUIPE E ACESSOS</span>
              <h1>Usuários</h1>
              <p>{descriptions[route]}</p>
            </div>
            {addButton("users")}
          </div>
          <section className="panel">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Usuário</th>
                    <th>E-mail</th>
                    <th>Perfil</th>
                    <th>Status</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {data.users?.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <strong>{u.name}</strong>
                        {u.id === user?.id && <small>Você</small>}
                      </td>
                      <td>{u.email}</td>
                      <td>
                        <Badge
                          tone={
                            u.role?.name === "ADMINISTRADOR" ? "purple" : "info"
                          }
                        >
                          {u.role?.name}
                        </Badge>
                      </td>
                      <td>
                        <Badge tone={u.active ? "success" : ""}>
                          {u.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </td>
                      <td>{actions("users", u)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="role-cards">
            {roles.map((r) => (
              <section className="panel" key={r.id}>
                <ShieldCheck size={21} />
                <h3>{r.name}</h3>
                <p>
                  {r.name === "ADMINISTRADOR"
                    ? "Acesso completo, usuários, custos e regras do sistema."
                    : r.name === "SUPERVISOR"
                      ? "Catálogo, movimentações, relatórios e aprovação de inventários."
                      : "Consulta, leitura de QR, movimentações e contagens de inventário."}
                </p>
              </section>
            ))}
          </div>
        </>
      ) : (
        <Denied />
      );
    if (route === "/auditoria")
      return can("reports:read") || can("users:manage") ? (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">TRANSPARÊNCIA NA OPERAÇÃO</span>
              <h1>Auditoria</h1>
              <p>{descriptions[route]}</p>
            </div>
            <Badge tone="success">
              <ShieldCheck size={14} />
              Histórico protegido
            </Badge>
          </div>
          <section className="panel">
            <div className="toolbar">
              <div className="table-search">
                <Search size={17} />
                <input
                  aria-label="Buscar auditoria"
                  placeholder="Ação, registro ou usuário…"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                />
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Data e hora</th>
                    <th>Usuário</th>
                    <th>Ação</th>
                    <th>Registro</th>
                    <th aria-label="Ações" />
                  </tr>
                </thead>
                <tbody>
                  {data.audit
                    ?.filter(
                      (a) =>
                        !query ||
                        `${a.action} ${a.user?.name} ${a.entity} ${a.entityId}`
                          .toLocaleLowerCase("pt-BR")
                          .includes(query),
                    )
                    .map((a) => (
                      <tr key={a.id}>
                        <td>{dateTime(a.createdAt)}</td>
                        <td>{a.user?.name || "Sistema"}</td>
                        <td>
                          <Badge tone="info">
                            {movementLabels[a.action] || a.action}
                          </Badge>
                        </td>
                        <td>
                          {a.entity}
                          <small className="mono">{a.entityId}</small>
                        </td>
                        <td>
                          <button
                            className="button secondary small"
                            onClick={() => setAuditDetails(a)}
                          >
                            Detalhes
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              {!data.audit?.length && <Empty />}
            </div>
          </section>
        </>
      ) : (
        <Denied />
      );
    if (route === "/configuracoes")
      return can("settings:manage") ? (
        <Settings
          data={data}
          onDone={() => complete("Configurações atualizadas e auditadas.")}
        />
      ) : (
        <Denied />
      );
    if (route === "/operacao")
      return (
        <>
          <div className="page-heading">
            <div>
              <span className="eyebrow">PRONTO PARA O PRÓXIMO MOVIMENTO</span>
              <h1>Operação rápida</h1>
              <p>{descriptions[route]}</p>
            </div>
          </div>
          <button className="mobile-scan-card" onClick={() => setScan(true)}>
            <ScanLine size={42} />
            <span>
              <strong>Escanear QR Code</strong>
              <small>Aponte a câmera e encontre seus materiais</small>
            </span>
            <ArrowRight size={24} />
          </button>
          <div className="operation-grid">
            {can("stock:move") &&
              [
                ["ENTRY", "Entrada de material", ArrowDownLeft],
                ["EXIT", "Retirar material", ArrowUpRight],
                ["TRANSFER", "Transferência", ArrowRightLeft],
              ].map(([type, label, Icon]) => {
                const Symbol = Icon as typeof ArrowRight;
                return (
                  <button
                    key={type as string}
                    className="panel"
                    onClick={() => setMovement({ type: type as string })}
                  >
                    <Symbol size={28} />
                    <strong>{label as string}</strong>
                  </button>
                );
              })}
            <button
              className="panel"
              onClick={() => navigateWorkspace("/produtos")}
            >
              <Search size={28} />
              <strong>Consultar produto</strong>
            </button>
            {can("stock:move") && (
              <button
                className="panel"
                onClick={() => setMovement({ type: "TRANSFER", qr: true })}
              >
                <QrCode size={28} />
                <strong>Transferência via QR</strong>
              </button>
            )}
            {can("inventory:count") && (
              <button className="panel" onClick={() => setCount({})}>
                <ClipboardCheck size={28} />
                <strong>Contar inventário</strong>
              </button>
            )}
          </div>
        </>
      );
    return (
      <Empty
        title="Página não encontrada"
        description="Use a navegação para acessar os módulos do almoxarifado."
      />
    );
  }
  return (
    <div className="app-shell">
      {menu && (
        <button
          className="sidebar-scrim"
          aria-label="Fechar menu"
          onClick={() => setMenu(false)}
        />
      )}
      <aside className={`sidebar ${menu ? "open" : ""}`}>
        <Link
          href="/dashboard"
          className="brand uca-sidebar-brand"
          aria-label="Almox ERP U.C.A. — início"
        >
          <img
            src={brand.logoPath!}
            width={82}
            height={54}
            alt="U.C.A. Implementos Agrícolas"
          />
          <span>
            Almox ERP<small>Grupo Capacle</small>
          </span>
        </Link>
        <div className="unit-selector">
          <label htmlFor="operational-unit">Unidade operacional</label>
          <select
            id="operational-unit"
            value={user?.unitId || ""}
            disabled={!user || switchingUnit || refreshing}
            onChange={(event) => void switchUnit(event.target.value)}
          >
            {!user && <option value="">Carregando unidades…</option>}
            {user?.memberships.map((membership) => (
              <option key={membership.unitId} value={membership.unitId}>
                {membership.unitName}
              </option>
            ))}
          </select>
          <small>
            {switchingUnit
              ? "Trocando unidade…"
              : user?.memberships.find(
                  (membership) => membership.unitId === user.unitId,
                )?.organizationName || "Acesso vinculado à sua conta"}
          </small>
        </div>
        <span className="nav-caption">Principal</span>
        <nav aria-label="Navegação principal">
          {navigation
            .filter((n) => !n.permission || can(n.permission))
            .map((n) => (
              <Link
                key={n.path}
                href={n.path}
                className={`nav-link ${route === n.path || (n.path === "/localizacoes" && route.startsWith("/localizacao/")) ? "active" : ""}`}
              >
                <n.icon size={19} />
                <span>{n.label}</span>
                {n.path === "/estoque" && low.length > 0 && (
                  <span className="nav-count">{low.length}</span>
                )}
                {n.path === "/qrcodes" && <span className="new-tag">QR</span>}
              </Link>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="nav-caption">Administração</span>
          {can("users:manage") && (
            <Link
              href="/usuarios"
              className={`nav-link ${route === "/usuarios" ? "active" : ""}`}
            >
              <Users size={19} />
              Usuários
            </Link>
          )}
          {(can("reports:read") || can("users:manage")) && (
            <Link
              href="/auditoria"
              className={`nav-link ${route === "/auditoria" ? "active" : ""}`}
            >
              <FileClock size={19} />
              Auditoria
            </Link>
          )}
          {can("settings:manage") && (
            <Link
              href="/configuracoes"
              className={`nav-link ${route === "/configuracoes" ? "active" : ""}`}
            >
              <Settings2 size={19} />
              Configurações
            </Link>
          )}
          <Link href="/operacao" className="operator-link">
            <Smartphone size={19} />
            <span>
              Modo operação<small>Mais rápido no celular</small>
            </span>
            <ArrowUpRight size={17} />
          </Link>
          <div className="sidebar-user">
            <span className="avatar">
              {user?.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("") || "…"}
            </span>
            <span>
              <strong>{user?.name || "Carregando…"}</strong>
              <small>
                {user?.role?.name?.toLocaleLowerCase("pt-BR") || "Usuário"}
              </small>
            </span>
            <button
              onClick={logout}
              className="icon-button"
              aria-label="Sair da conta"
              title="Sair da conta"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMenu(true)}
              aria-label="Abrir menu"
            >
              <Menu size={22} />
            </button>
            <span className="desktop-only">Operação</span>
            <ChevronRight size={14} className="desktop-only" />
            <strong>{pageTitle}</strong>
          </div>
          <div className="global-search">
            <Search size={17} />
            <input
              ref={searchInput}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar material ou localização"
              aria-label="Busca global"
            />
            {search ? (
              <button
                className="icon-button"
                onClick={() => setSearch("")}
                aria-label="Limpar busca"
              >
                <X size={15} />
              </button>
            ) : (
              <kbd className="search-hint">Ctrl K</kbd>
            )}
            {search.trim().length >= 2 && !globalMatches && (
              <div className="search-results">
                <p className="muted">
                  {searchError || "Pesquisando no almoxarifado…"}
                </p>
              </div>
            )}
            {globalMatches && (
              <div className="search-results">
                <span className="eyebrow">PRODUTOS</span>
                {globalMatches.products.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => {
                      setProductDetails(p);
                      setSearch("");
                    }}
                  >
                    <Package size={18} />
                    <span>
                      <strong>{p.name}</strong>
                      <small>
                        {p.internalCode} · {p.sku || p.category?.name}
                      </small>
                    </span>
                    <ChevronRight size={15} />
                  </button>
                ))}
                <span className="eyebrow">LOCALIZAÇÕES</span>
                {globalMatches.locations.map((l) => (
                  <Link
                    key={l.id}
                    href={`/localizacao/${l.id}`}
                    onClick={() => setSearch("")}
                  >
                    <MapPin size={18} />
                    <span>
                      <strong>{l.name}</strong>
                      <small>{l.code}</small>
                    </span>
                    <ChevronRight size={15} />
                  </Link>
                ))}
                {!globalMatches.products.length &&
                  !globalMatches.locations.length && (
                    <p className="muted">Nenhum resultado para “{search}”.</p>
                  )}
              </div>
            )}
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              aria-label="Atualizar dados"
              title="Atualizar dados"
              onClick={() => void refresh()}
              disabled={refreshing}
            >
              <RefreshCw size={18} className={refreshing ? "spin" : ""} />
            </button>
            <Link
              className="notification-button icon-button"
              href={can("purchases:read") ? "/reposicao" : "/estoque"}
              aria-label={`${low.length} alertas de estoque`}
            >
              <Bell size={20} />
              {low.length > 0 && <i />}
            </Link>
            <span className="topbar-divider" />
            <span className="avatar small">
              {user?.name
                .split(" ")
                .map((n) => n[0])
                .slice(0, 2)
                .join("") || "…"}
            </span>
          </div>
        </header>
        <Pwa />
        <main className="main-content">
          {error && (
            <div className="notice error global-error" role="alert">
              <TriangleAlert size={19} />
              <span>{error}</span>
              <button className="text-button" onClick={() => void refresh()}>
                Tentar novamente
              </button>
              <button
                className="icon-button"
                onClick={() => setError("")}
                aria-label="Fechar aviso"
                disabled={!data}
              >
                <X size={17} />
              </button>
            </div>
          )}
          <div className="workspace-view" key={route}>
            {content()}
          </div>
          <footer className="app-footer">
            <span>Almox ERP · U.C.A. · Grupo Capacle</span>
            <span>
              <span className="dot teal" />
              {error
                ? "Consulta indisponível — confira o aviso"
                : refreshing || switchingUnit
                  ? "Atualizando dados…"
                  : data
                    ? "Dados da unidade selecionada"
                    : "Aguardando consulta"}
            </span>
          </footer>
        </main>
        <nav className="mobile-bottom-nav" aria-label="Navegação no celular">
          <Link
            href="/dashboard"
            className={route === "/dashboard" ? "active" : ""}
          >
            <LayoutDashboard size={20} />
            Início
          </Link>
          <Link
            href="/estoque"
            className={route === "/estoque" ? "active" : ""}
          >
            <Boxes size={20} />
            Estoque
          </Link>
          <button className="bottom-scan" onClick={() => setScan(true)}>
            <span>
              <ScanLine size={24} />
            </span>
            Escanear
          </button>
          <Link
            href="/operacao"
            className={route === "/operacao" ? "active" : ""}
          >
            <ArrowRightLeft size={20} />
            Operação
          </Link>
          <button onClick={() => setMenu(true)}>
            <Menu size={20} />
            Menu
          </button>
        </nav>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={19} />
          {toast}
          <button
            className="icon-button"
            aria-label="Fechar mensagem"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {editor && data && (
        <CatalogForm
          entity={editor.entity}
          record={editor.record}
          data={data}
          roles={roles}
          canViewCost={can("costs:read")}
          canArchive={can("records:delete")}
          onClose={() => setEditor(null)}
          onDone={async (saved) => {
            const newProduct =
              editor.entity === "products" && !editor.record && saved?.id;
            await complete(
              newProduct
                ? "Produto cadastrado. O QR Code já está pronto."
                : "Cadastro salvo.",
            );
            if (newProduct) navigateWorkspace(`/produto/${saved.id}`);
          }}
        />
      )}
      {movement && data && (
        <MovementForm
          data={data}
          initialType={movement.type}
          initialLocation={movement.location}
          initialProduct={movement.product}
          qrTransfer={movement.qr}
          onClose={() => setMovement(null)}
          onDone={() =>
            complete("Movimentação registrada. Estoque atualizado.")
          }
        />
      )}
      {count && data && (
        <InventoryForm
          data={data}
          initialLocation={count.location}
          onClose={() => setCount(null)}
          onDone={() =>
            complete("Contagem registrada e enviada para aprovação.")
          }
        />
      )}
      {scan && (
        <Modal
          title="Escanear QR Code"
          subtitle="Leia a etiqueta de um produto ou de uma localização."
          onClose={() => setScan(false)}
        >
          <Scanner
            scope="any"
            onResolved={(location) => {
              setScan(false);
              navigateWorkspace(
                `/${location.kind === "product" ? "produto" : "localizacao"}/${location.id}`,
              );
            }}
            onClose={() => setScan(false)}
          />
        </Modal>
      )}
      {deleting && (
        <Modal title="Remover cadastro?" onClose={() => setDeleting(null)}>
          <div className="modal-body">
            <p>
              O cadastro será excluído quando não houver dependências. Registros
              com histórico serão arquivados para manter a rastreabilidade.
            </p>
            <strong>
              {String(
                deleting.record?.name || deleting.record?.legalName || "",
              )}
            </strong>
            <div className="modal-actions">
              <button
                className="button secondary"
                onClick={() => setDeleting(null)}
                disabled={deleteBusy}
              >
                Cancelar
              </button>
              <button
                className="button danger"
                disabled={deleteBusy}
                onClick={remove}
              >
                {deleteBusy ? "Removendo…" : "Confirmar remoção"}
              </button>
            </div>
          </div>
        </Modal>
      )}
      {countDetails && data && (
        <Modal
          wide
          title="Conferir inventário"
          subtitle={`${locationPath(data, countDetails.locationId)} · ${dateTime(countDetails.createdAt)}`}
          onClose={() => setCountDetails(null)}
        >
          <div className="modal-body">
            <p>{countDetails.note}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Produto</th>
                    <th className="numeric">Sistema</th>
                    <th className="numeric">Contagem</th>
                    <th className="numeric">Diferença</th>
                  </tr>
                </thead>
                <tbody>
                  {countDetails.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        {i.product?.name ||
                          data.products.find((p) => p.id === i.productId)?.name}
                      </td>
                      <td className="numeric">{qty(i.expectedQuantity)}</td>
                      <td className="numeric">{qty(i.countedQuantity)}</td>
                      <td className="numeric">
                        {qty(
                          number(i.countedQuantity) -
                            number(i.expectedQuantity),
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            {countDetails.status === "PENDING" && can("inventory:adjust") && (
              <>
                <div className="notice warning">
                  Ao aprovar, as divergências gerarão ajustes de estoque com
                  registro de auditoria. Se o saldo mudou desde a contagem, será
                  necessário realizar uma nova contagem.
                </div>
                <button
                  className="button primary full"
                  disabled={actionBusy}
                  onClick={() => void approve(countDetails.id)}
                >
                  <Check size={18} />
                  {actionBusy
                    ? "Aprovando…"
                    : "Confirmar aprovação e ajustar estoque"}
                </button>
              </>
            )}
          </div>
        </Modal>
      )}
      {auditDetails && (
        <Modal
          wide
          title="Detalhes da auditoria"
          subtitle={`${auditDetails.user?.name || "Sistema"} · ${dateTime(auditDetails.createdAt)}`}
          onClose={() => setAuditDetails(null)}
        >
          <div className="modal-body">
            <p>
              <strong>{auditDetails.action}</strong> · {auditDetails.entity}
            </p>
            <small className="mono">{auditDetails.entityId}</small>
            <div className="form-grid">
              <div>
                <h3>Valor anterior</h3>
                <pre className="audit-json">
                  {JSON.stringify(auditDetails.before, null, 2) ||
                    "Sem valor anterior"}
                </pre>
              </div>
              <div>
                <h3>Valor posterior</h3>
                <pre className="audit-json">
                  {JSON.stringify(auditDetails.after, null, 2) ||
                    "Sem valor posterior"}
                </pre>
              </div>
            </div>
          </div>
        </Modal>
      )}
      {productDetails && data && (
        <Modal
          wide
          title={productDetails.name}
          subtitle={`${productDetails.internalCode} · ${productDetails.sku || "Sem SKU"}`}
          onClose={() => setProductDetails(null)}
        >
          <div className="modal-body">
            <div className="product-detail-top">
              {productDetails.imageUrl && (
                <img
                  className="product-detail-image"
                  src={productDetails.imageUrl}
                  alt={productDetails.name}
                />
              )}
              <div>
                <div className="detail-stock">
                  {qty(availableFor(data, productDetails.id))}
                  <span>{productDetails.unit} disponíveis</span>
                </div>
                {stockBadge(productDetails)}
                <p>
                  {productDetails.description || "Sem descrição cadastrada."}
                </p>
              </div>
            </div>
            <div className="detail-grid">
              <div>
                <small>Categoria</small>
                <strong>{productDetails.category?.name || "—"}</strong>
              </div>
              <div>
                <small>Fornecedor</small>
                <strong>
                  {productDetails.supplier?.tradeName ||
                    productDetails.supplier?.legalName ||
                    "—"}
                </strong>
              </div>
              <div>
                <small>Fabricante</small>
                <strong>{productDetails.manufacturer || "—"}</strong>
              </div>
              <div>
                <small>Estoque mínimo / máximo</small>
                <strong>
                  {qty(productDetails.minStock)} /{" "}
                  {productDetails.maxStock == null
                    ? "—"
                    : qty(productDetails.maxStock)}
                </strong>
              </div>
              {can("costs:read") && (
                <div>
                  <small>Custo unitário</small>
                  <strong>
                    {productDetails.unitCost == null
                      ? "Não informado"
                      : money(productDetails.unitCost)}
                  </strong>
                </div>
              )}
              <div>
                <small>Cadastro</small>
                <strong>{dateTime(productDetails.createdAt)}</strong>
              </div>
            </div>
            <Link
              className="button secondary"
              href={`/produto/${productDetails.id}`}
              onClick={() => setProductDetails(null)}
            >
              <QrCode size={17} /> Abrir ficha e QR Code
            </Link>
            <h3>Saldo por localização</h3>
            <div className="product-locations">
              {data.balances
                .filter((b) => b.productId === productDetails.id)
                .map((b) => (
                  <Link
                    key={b.id}
                    href={`/localizacao/${b.locationId}`}
                    onClick={() => setProductDetails(null)}
                  >
                    <MapPin size={18} />
                    <span>{locationPath(data, b.locationId)}</span>
                    <strong>
                      {qty(b.availableQuantity ?? b.quantity)}{" "}
                      {productDetails.unit} disponíveis
                      <small>
                        Físico {qty(b.physicalQuantity ?? b.quantity)} ·
                        Reservado {qty(b.reservedQuantity)} · Aplicado{" "}
                        {qty(b.appliedQuantity)}
                      </small>
                    </strong>
                    <ChevronRight size={16} />
                  </Link>
                ))}
            </div>
            {productDetails.notes && <p>{productDetails.notes}</p>}
            <div className="modal-actions">
              {can("catalog:write") && (
                <button
                  className="button secondary"
                  onClick={() => {
                    recordEdit("products", productDetails);
                    setProductDetails(null);
                  }}
                >
                  <Pencil size={17} />
                  Editar cadastro
                </button>
              )}
              {can("stock:move") && (
                <button
                  className="button primary"
                  onClick={() => {
                    setMovement({ type: "ENTRY", product: productDetails.id });
                    setProductDetails(null);
                  }}
                >
                  <ArrowRightLeft size={18} />
                  Movimentar produto
                </button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Denied() {
  return (
    <Empty
      title="Acesso restrito"
      description="Seu perfil não possui permissão para acessar este módulo."
    />
  );
}

function Settings({
  data,
  onDone,
}: {
  data: DataSet;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({
          companyName: form.get("companyName"),
          allowNegativeStock: false,
        }),
      });
      await onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">REGRAS DA OPERAÇÃO</span>
          <h1>Configurações</h1>
          <p>Preferências e regras de funcionamento do almoxarifado.</p>
        </div>
      </div>
      <form className="panel settings-panel" onSubmit={submit}>
        <div className="settings-section">
          <span className="action-icon teal">
            <Building2 size={24} />
          </span>
          <div>
            <h2>Identificação da empresa</h2>
            <p>Nome exibido no ambiente de trabalho.</p>
            <label>
              Nome da empresa
              <input
                required
                name="companyName"
                defaultValue={data.settings.companyName || ""}
                minLength={2}
                maxLength={150}
              />
            </label>
          </div>
        </div>
        <div className="settings-section">
          <span className="action-icon orange">
            <SlidersHorizontal size={24} />
          </span>
          <div>
            <h2>Regras de estoque</h2>
            <p>Estoque negativo bloqueado.</p>
            <div className="notice info">
              Retiradas, reservas e aplicações respeitam o saldo disponível.
              Materiais reservados ou aplicados a ordens não podem ser
              utilizados em outra operação.
            </div>
          </div>
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button className="button primary" disabled={busy}>
            <Check size={18} />
            {busy ? "Salvando…" : "Salvar configurações"}
          </button>
        </div>
      </form>
    </>
  );
}
