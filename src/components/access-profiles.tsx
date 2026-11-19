"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { api, type Role } from "@/lib/client";
import {
  ACCESS_PROFILES,
  matchesProfile,
  permissionLabel,
  profileTitle,
  roleKeys,
} from "@/lib/access-profiles";

export function RolePermissions({
  role,
  title,
  status,
  description,
}: {
  role: Role;
  title?: string;
  status?: string;
  description?: string;
}) {
  const keys = roleKeys(role);
  return (
    <details className="role-permissions">
      <summary>
        {title ? (
          <span className="profile-summary">
            <strong>{title}</strong>
            <small>
              {status && (
                <>
                  <span>{status}</span>
                  {" · "}
                </>
              )}
              {keys.length} {keys.length === 1 ? "permissão" : "permissões"}
            </small>
          </span>
        ) : (
          `Permissões cadastradas (${keys.length})`
        )}
      </summary>
      {description && <p>{description}</p>}
      {keys.length ? (
        <ul>
          {keys.map((key) => (
            <li key={key}>{permissionLabel(key)}</li>
          ))}
        </ul>
      ) : (
        <p>
          Nenhuma permissão adicional. A consulta básica de materiais e saldos
          permanece disponível ao acesso ativo.
        </p>
      )}
    </details>
  );
}

export default function AccessProfiles({
  roles,
  onPrepared,
}: {
  roles: Role[];
  onPrepared: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const missing = ACCESS_PROFILES.filter(
    (profile) => !roles.some((role) => role.name === profile.name),
  );
  async function prepare() {
    if (busy || !missing.length) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ created: string[] }>("/api/access-profiles", {
        method: "POST",
        body: "{}",
      });
      await onPrepared();
      setNotice(
        result.created.length === 1
          ? "Perfil padrão adicionado."
          : `${result.created.length} perfis padrão adicionados.`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Não foi possível disponibilizar os perfis.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="access-profiles" aria-label="Perfis de acesso">
      <div className="panel access-profiles-list">
        <div className="access-profiles-heading">
          <h2>Perfis de acesso</h2>
          {missing.length > 0 && (
            <button
              type="button"
              className="button primary"
              disabled={busy}
              onClick={() => void prepare()}
            >
              <Plus size={17} />
              {busy ? "Disponibilizando…" : "Disponibilizar perfis padrão"}
            </button>
          )}
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {notice && (
          <div className="notice info" role="status">
            {notice}
          </div>
        )}
        {roles.map((role) => {
          const model = ACCESS_PROFILES.find(
            (profile) => profile.name === role.name,
          );
          const customized =
            !!model && !matchesProfile(role.name, roleKeys(role));
          return (
            <RolePermissions
              key={role.id}
              role={role}
              title={profileTitle(role.name)}
              status={customized ? "Personalizado" : undefined}
              description={customized ? undefined : model?.description}
            />
          );
        })}
        {missing.map((profile) => (
          <RolePermissions
            key={profile.name}
            title={profile.title}
            status="Modelo para adicionar"
            description={profile.description}
            role={{
              id: profile.name,
              name: profile.name,
              permissions: profile.permissions.map((key) => ({
                permission: { key },
              })),
            }}
          />
        ))}
      </div>
    </section>
  );
}
