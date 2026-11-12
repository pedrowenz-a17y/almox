"use client";

import { useState } from "react";
import { ShieldCheck, Plus } from "lucide-react";
import { api, type Role } from "@/lib/client";
import { ACCESS_PROFILES, matchesProfile, permissionLabel, profileTitle, roleKeys } from "@/lib/access-profiles";
import { Badge } from "@/components/ui";

export function RolePermissions({ role, planned = false }: { role: Role; planned?: boolean }) {
  const keys = roleKeys(role);
  return <details className="role-permissions">
    <summary>{planned ? "Permissões previstas" : "Permissões cadastradas"} ({keys.length})</summary>
    {keys.length ? <ul>{keys.map(key => <li key={key}>{permissionLabel(key)}</li>)}</ul> : <p>Nenhuma permissão adicional. A consulta básica de materiais e saldos permanece disponível ao acesso ativo.</p>}
  </details>;
}

export default function AccessProfiles({ roles, onPrepared }: { roles: Role[]; onPrepared: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const missing = ACCESS_PROFILES.filter(profile => !roles.some(role => role.name === profile.name));
  async function prepare() {
    if (busy || !missing.length) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api<{ created: string[]; preserved: string[]; customized: string[] }>("/api/access-profiles", { method: "POST", body: "{}" });
      await onPrepared();
      setNotice(`${result.created.length} perfil(is) disponibilizado(s). Os perfis e acessos existentes foram preservados.${result.customized.length ? " Há perfis personalizados: confira suas permissões antes de atribuir." : ""}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível disponibilizar os perfis."); }
    finally { setBusy(false); }
  }
  return <section className="access-profiles" aria-label="Perfis de acesso">
    <div className="panel access-profiles-heading">
      <div><h2>Perfis por responsabilidade</h2><p>O perfil vale para a unidade selecionada. Todos os acessos ativos consultam materiais e saldos; as permissões adicionais estão detalhadas em cada perfil.</p></div>
      {missing.length > 0 && <button type="button" className="button primary" disabled={busy} onClick={() => void prepare()}><Plus size={17} />{busy ? "Disponibilizando…" : "Disponibilizar perfis padrão"}</button>}
      {missing.length > 0 && <small>Cria somente os perfis que faltam. Nenhum usuário é associado ou alterado automaticamente.</small>}
    </div>
    {error && <div className="notice error" role="alert">{error}</div>}
    {notice && <div className="notice info" role="status">{notice}</div>}
    <div className="role-cards">
      {roles.map(role => {
        const model = ACCESS_PROFILES.find(profile => profile.name === role.name);
        const customized = !!model && !matchesProfile(role.name, roleKeys(role));
        return <section className="panel" key={role.id}>
          <ShieldCheck size={21} /><h3>{profileTitle(role.name)}</h3>
          <Badge tone={customized ? "warning" : "success"}>{customized ? "Personalizado — preservado" : "Disponível"}</Badge>
          <p>{customized ? "Este perfil tem uma configuração própria. Confira as permissões cadastradas antes de atribuir." : model?.description ?? "Confira as permissões cadastradas neste perfil antes de atribuir um acesso."}</p>
          <RolePermissions role={role} />
        </section>;
      })}
      {missing.map(profile => <section className="panel" key={profile.name}>
        <ShieldCheck size={21} /><h3>{profile.title}</h3><Badge tone="info">Modelo para adicionar</Badge>
        <p>{profile.description}</p>
        <RolePermissions planned role={{ id: profile.name, name: profile.name, permissions: profile.permissions.map(key => ({ permission: { key } })) }} />
      </section>)}
    </div>
  </section>;
}
