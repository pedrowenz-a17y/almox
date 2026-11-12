"use client";
import { roleLabel } from "@/lib/access-profiles";
import { RolePermissions } from "@/components/access-profiles";
import { useState } from "react";
import { Save, Upload } from "lucide-react";
import { api, DataSet, Role, locationPath } from "@/lib/client";
import { Modal } from "@/components/ui";
export type CatalogEntity =
  | "products"
  | "categories"
  | "suppliers"
  | "warehouses"
  | "locations"
  | "users";
type Option = { value: string; label: string };
type Field = {
  key: string;
  label: string;
  type?: string;
  required?: boolean;
  options?: Option[];
  wide?: boolean;
  placeholder?: string;
};
export const entityTitles: Record<CatalogEntity, string> = {
  products: "produto",
  categories: "categoria",
  suppliers: "fornecedor",
  warehouses: "almoxarifado",
  locations: "localização",
  users: "usuário",
};
export default function CatalogForm({
  entity,
  record,
  data,
  roles,
  onClose,
  onDone,
  canViewCost,
  canArchive,
}: {
  entity: CatalogEntity;
  record?: Record<string, unknown>;
  data: DataSet;
  roles: Role[];
  onClose: () => void;
  onDone: (saved: Record<string, unknown>) => Promise<void>;
  canViewCost: boolean;
  canArchive: boolean;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState(String(record?.roleId || ""));
  const [userCreationMode, setUserCreationMode] = useState("invite");
  const selectedRole = roles.find(role => role.id === selectedRoleId);
  const [imageUrl, setImageUrl] = useState(String(record?.imageUrl || ""));
  const [warehouseId, setWarehouseId] = useState(
    String(record?.warehouseId || data.warehouses[0]?.id || ""),
  );
  const asOptions = (items: { id: string; name: string }[]) =>
    items.map((i) => ({ value: i.id, label: i.name }));
  const fields: Record<CatalogEntity, Field[]> = {
    products: [
      { key: "name", label: "Nome do produto", required: true, wide: true },
      {
        key: "internalCode",
        label: "Código interno",
        required: true,
        placeholder: "Ex.: ROL-6204",
      },
      { key: "sku", label: "SKU" },
      {
        key: "categoryId",
        label: "Categoria",
        type: "select",
        options: asOptions(data.categories),
      },
      {
        key: "unit",
        label: "Unidade de medida",
        required: true,
        placeholder: "UN, KG, M, L, CX…",
      },
      { key: "description", label: "Descrição", type: "textarea", wide: true },
      { key: "manufacturer", label: "Fabricante" },
      {
        key: "supplierId",
        label: "Fornecedor",
        type: "select",
        options: data.suppliers.map((s) => ({
          value: s.id,
          label: s.tradeName || s.legalName,
        })),
      },
      { key: "barcode", label: "Código de barras" },
      {
        key: "minStock",
        label: "Estoque mínimo",
        type: "number",
        required: true,
      },
      { key: "maxStock", label: "Estoque máximo", type: "number" },
      ...(canViewCost
        ? [
            {
              key: "unitCost",
              label: "Custo unitário (R$, opcional)",
              type: "number",
            },
          ]
        : []),
      { key: "notes", label: "Observações", type: "textarea", wide: true },
    ],
    categories: [
      { key: "name", label: "Nome da categoria", required: true, wide: true },
      { key: "description", label: "Descrição", type: "textarea", wide: true },
    ],
    suppliers: [
      { key: "legalName", label: "Razão social", required: true, wide: true },
      { key: "tradeName", label: "Nome fantasia" },
      { key: "taxId", label: "CNPJ / identificação" },
      { key: "phone", label: "Telefone", type: "tel" },
      { key: "whatsapp", label: "WhatsApp", type: "tel" },
      { key: "email", label: "E-mail", type: "email" },
      { key: "contact", label: "Pessoa de contato" },
      { key: "address", label: "Endereço", wide: true },
      { key: "notes", label: "Observações", type: "textarea", wide: true },
    ],
    warehouses: [
      {
        key: "name",
        label: "Nome do almoxarifado",
        required: true,
        wide: true,
      },
      { key: "code", label: "Código único", required: true, wide: true },
      { key: "description", label: "Descrição", type: "textarea", wide: true },
    ],
    locations: [
      { key: "name", label: "Nome da localização", required: true },
      {
        key: "code",
        label: "Código único",
        required: true,
        placeholder: "ALM-A-E02-P03",
      },
      {
        key: "warehouseId",
        label: "Almoxarifado",
        type: "select",
        required: true,
        options: asOptions(data.warehouses),
      },
      {
        key: "parentId",
        label: "Localização superior",
        type: "select",
        options: data.locations
          .filter((l) => l.id !== record?.id && l.warehouseId === warehouseId)
          .map((l) => ({ value: l.id, label: locationPath(data, l.id) })),
      },
      { key: "description", label: "Descrição", type: "textarea", wide: true },
      { key: "notes", label: "Observações", type: "textarea", wide: true },
    ],
    users: [
      ...(!record
        ? [
            { key: "name", label: "Nome completo", required: true, wide: true },
            {
              key: "email",
              label: "E-mail de acesso",
              type: "email",
              required: true,
              wide: true,
            },
            ...(userCreationMode === "existing" ? [{
              key: "authUserId",
              label: "UUID da identidade confirmada",
              required: true,
              wide: true,
              placeholder: "Supabase → Authentication → Users → UID",
            }] : []),
          ]
        : []),
      {
        key: "roleId",
        label: "Perfil nesta unidade",
        type: "select",
        required: true,
        options: roles.map((role) => ({ value: role.id, label: roleLabel(role) })),
        wide: true,
      },
    ],
  };
  async function upload(file?: File) {
    if (!file) return;
    setUploading(true);
    setError("");
    const form = new FormData();
    form.append("file", file);
    try {
      const result = await api<{ url: string }>("/api/upload", {
        method: "POST",
        body: form,
      });
      setImageUrl(result.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha no upload.");
    } finally {
      setUploading(false);
    }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = {};
    fields[entity].forEach((field) => {
      const value = String(form.get(field.key) || "").trim();
      if (field.key === "authUserId" && !value) return;
      payload[field.key] =
        field.type === "number"
          ? value || (["maxStock", "unitCost"].includes(field.key) ? null : "0")
          : [
                "categoryId",
                "supplierId",
                "parentId",
                "sku",
                "taxId",
                "barcode",
              ].includes(field.key)
            ? value || null
            : value;
    });
    if (canArchive) payload.active = form.get("active") === "on";
    if (entity === "products") payload.imageUrl = imageUrl || null;
    try {
      const saved = await api<Record<string, unknown>>(
        `/api/catalog/${entity}${record ? `/${record.id}` : ""}`,
        {
          method: record ? "PATCH" : "POST",
          body: JSON.stringify(payload),
        },
      );
      await onDone(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao salvar cadastro.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      wide
      title={`${record ? "Editar" : "Cadastrar"} ${entityTitles[entity]}`}
      subtitle={
        entity === "products"
          ? "Ao salvar, o QR Code do produto fica pronto para imprimir. O saldo muda por movimentações."
          : entity === "locations"
            ? "A localização recebe um QR Code único automaticamente."
            : "Mantenha os dados do seu almoxarifado atualizados."
      }
      onClose={() => {
        if (!busy && !uploading) onClose();
      }}
    >
      <form className="modal-body" onSubmit={submit}>
        {entity === "users" && (
          <div className="notice info">
            {record
              ? "O perfil e a situação de acesso valem apenas para a unidade selecionada. Nome e e-mail pertencem à identidade global."
              : userCreationMode === "existing" ? "Vincule uma identidade com e-mail confirmado no Supabase. O identificador deve corresponder ao e-mail; nenhum novo convite será enviado."
              : "O acesso é cadastrado antes do envio. A pessoa define a própria senha pelo convite; se o e-mail não for confirmado pelo serviço, você poderá acompanhar e reenviar pela tela Acesso."}
          </div>
        )}
        {entity === "users" && !record && <label className="user-creation-mode">Como esta pessoa vai acessar<select value={userCreationMode} onChange={event => setUserCreationMode(event.target.value)} disabled={busy}>
          <option value="invite">Preparar acesso e enviar convite</option><option value="existing">Vincular identidade existente</option>
        </select><small>Se a pessoa já está cadastrada no ERP em outra unidade, o vínculo existente será preservado.</small></label>}
        <div className="form-grid">
          {fields[entity].map((field) => (
            <label key={field.key} className={field.wide ? "span-2" : ""}>
              {field.label}
              {field.required && <span className="required"> *</span>}
              {field.type === "textarea" ? (
                <textarea
                  name={field.key}
                  defaultValue={String(record?.[field.key] || "")}
                  rows={2}
                  maxLength={2000}
                />
              ) : field.type === "select" ? (
                <select
                  name={field.key}
                  required={field.required}
                  defaultValue={String(
                    record?.[field.key] ||
                      (field.key === "warehouseId" ? warehouseId : ""),
                  )}
                  onChange={
                    field.key === "warehouseId"
                      ? (e) => setWarehouseId(e.target.value)
                      : field.key === "roleId" ? (e) => setSelectedRoleId(e.target.value)
                      : undefined
                  }
                >
                  <option value="">
                    {field.key === "parentId"
                      ? "Sem superior (nível principal)"
                      : "Selecione"}
                  </option>
                  {field.options?.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  name={field.key}
                  required={field.required}
                  type={field.type || "text"}
                  min={field.type === "number" ? 0 : undefined}
                  step={
                    field.key === "unitCost"
                      ? "0.01"
                      : field.type === "number"
                        ? "0.001"
                        : undefined
                  }
                  minLength={field.type === "password" ? 10 : undefined}
                  autoComplete={
                    field.type === "password" ? "new-password" : undefined
                  }
                  inputMode={field.type === "number" ? "decimal" : undefined}
                  defaultValue={String(
                    record?.[field.key] ??
                      (field.key === "unit"
                        ? "UN"
                        : field.key === "minStock"
                          ? "0"
                          : ""),
                  )}
                  placeholder={field.placeholder}
                />
              )}
            </label>
          ))}
        </div>
        {entity === "users" && selectedRole && <RolePermissions role={selectedRole} />}
        {entity === "products" && (
          <div className="upload-row">
            {imageUrl && (
              <img
                src={imageUrl}
                alt="Imagem do produto"
                className="product-preview"
              />
            )}
            <label className="button secondary file-label">
              <Upload size={17} />
              {uploading ? "Enviando…" : "Anexar imagem"}
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                disabled={uploading}
                onChange={(e) => void upload(e.target.files?.[0])}
              />
            </label>
            {imageUrl && (
              <button
                type="button"
                className="text-button"
                onClick={() => setImageUrl("")}
              >
                Remover imagem
              </button>
            )}
            <small>JPG, PNG ou WebP · até 3 MB</small>
          </div>
        )}
        {canArchive && (
          <label className="checkbox-label">
            <input
              name="active"
              type="checkbox"
              defaultChecked={record?.active !== false}
            />
            Cadastro ativo
          </label>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button
            type="button"
            className="button secondary"
            onClick={onClose}
            disabled={busy}
          >
            Cancelar
          </button>
          <button
            type="submit"
            className="button primary"
            disabled={busy || uploading}
          >
            <Save size={17} />
            {busy ? "Salvando…" : "Salvar cadastro"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
