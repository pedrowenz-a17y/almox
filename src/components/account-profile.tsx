"use client";

import { useEffect, useRef, useState } from "react";
import { MotionToggle } from "@/components/motion-preferences";
import { ThemeToggle } from "@/components/theme-preferences";
import { Modal } from "@/components/ui";
import { api, type SessionUser } from "@/lib/client";
import {
  startPages,
  useWorkspacePreferences,
} from "@/lib/workspace-preferences";

const path = "/api/me/avatar";
type Avatar = { photo: string | null };

export function useAccountPhoto(userId?: string) {
  const [result, setResult] = useState<{
    userId: string;
    photo: Avatar["photo"];
    error?: string;
  }>();
  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();
    api<Avatar>(path, { signal: controller.signal }).then(
      ({ photo }) => {
        if (!controller.signal.aborted) setResult({ userId, photo });
      },
      () => {
        if (!controller.signal.aborted) {
          setResult({
            userId,
            photo: null,
            error: "Não foi possível carregar a foto de perfil.",
          });
        }
      },
    );
    return () => controller.abort();
  }, [userId]);
  const current = result && result.userId === userId ? result : undefined;
  return {
    photo: current?.photo ?? null,
    loading: Boolean(userId && !current),
    error: current?.error,
    setPhoto: (photo: Avatar["photo"]) => {
      if (userId) setResult({ userId, photo });
    },
  };
}

export function AccountAvatar({
  name,
  photo,
}: {
  name?: string;
  photo: Avatar["photo"];
}) {
  return photo ? (
    <img className="account-avatar-photo" alt="" src={photo} />
  ) : (
    name
      ?.trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toLocaleUpperCase("pt-BR") || "…"
  );
}

export function AccountProfile({
  user,
  photo,
  loading,
  error,
  onChange,
  onClose,
}: {
  user: SessionUser;
  photo: Avatar["photo"];
  loading: boolean;
  error?: string;
  onChange: (photo: Avatar["photo"]) => void;
  onClose: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const workspace = useWorkspacePreferences();

  async function save(form?: HTMLFormElement) {
    if (busy || loading || (form && !file)) return;
    setBusy(true);
    setFailure("");
    setNotice("");
    try {
      const { photo } = await api<Avatar>(
        path,
        form
          ? { method: "PUT", body: new FormData(form) }
          : { method: "DELETE" },
      );
      onChange(photo);
      formRef.current?.reset();
      setFile(null);
      setNotice(photo ? "Foto atualizada." : "Foto removida.");
    } catch (cause) {
      setFailure(
        cause instanceof Error
          ? cause.message
          : "Não foi possível alterar a foto.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Meu perfil" onClose={onClose} closeDisabled={busy}>
      <div className="modal-body account-profile">
        <div className="account-identity">
          <span className="avatar account-avatar-preview" aria-hidden="true">
            <AccountAvatar name={user.name} photo={photo} />
          </span>
          <div>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </div>
        </div>
        <form
          ref={formRef}
          onSubmit={(event) => {
            event.preventDefault();
            void save(event.currentTarget);
          }}
        >
          <label>
            Foto de perfil
            <input
              type="file"
              name="file"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy || loading}
              onChange={(event) => {
                setFile(event.currentTarget.files?.[0] ?? null);
                setFailure("");
                setNotice("");
              }}
              aria-describedby="profile-photo-help"
            />
          </label>
          <small id="profile-photo-help">JPEG, PNG ou WebP de até 3 MB.</small>
          <div className="account-photo-actions">
            <button
              className="button primary"
              type="submit"
              disabled={!file || busy || loading}
            >
              Salvar foto
            </button>
            {photo && (
              <button
                className="button secondary"
                type="button"
                disabled={busy}
                onClick={() => void save()}
              >
                Remover foto
              </button>
            )}
          </div>
        </form>
        {(failure || error) && (
          <div className="notice error" role="alert">
            {failure || error}
          </div>
        )}
        {notice && (
          <div className="notice info" role="status">
            {notice}
          </div>
        )}
        <section
          className="account-appearance"
          aria-label="Preferências de aparência"
        >
          <h3>Aparência</h3>
          <p className="muted">
            O tema e as animações são salvos neste dispositivo.
          </p>
          <div className="account-photo-actions">
            <ThemeToggle />
            <MotionToggle />
          </div>
        </section>
        <section
          className="account-appearance"
          aria-label="Preferências de trabalho"
        >
          <h3>Área de trabalho</h3>
          <p className="muted">Estas opções valem neste dispositivo.</p>
          <div className="account-workspace-options">
            <label>
              Tela após entrar
              <select
                value={workspace.startPage}
                onChange={(event) => workspace.setStartPage(event.target.value)}
              >
                {Object.entries(startPages).map(([href, name]) => (
                  <option key={href} value={href}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={workspace.compactTables}
                onChange={(event) =>
                  workspace.setCompactTables(event.target.checked)
                }
              />
              Tabelas compactas no PC
            </label>
            <button
              type="button"
              className="text-button"
              onClick={workspace.reset}
            >
              Restaurar opções da área de trabalho
            </button>
          </div>
        </section>
      </div>
    </Modal>
  );
}
