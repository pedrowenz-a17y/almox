"use client";
import { useEffect, useId, useRef, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { X, PackageOpen, LoaderCircle } from "lucide-react";
const subscribeToDOM = () => () => {};
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
  closeDisabled = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
  closeDisabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const target = useSyncExternalStore(
    subscribeToDOM,
    () => document.body,
    () => null,
  );
  const close = useRef({ disabled: closeDisabled, run: onClose });
  useEffect(() => {
    close.current = { disabled: closeDisabled, run: onClose };
  }, [onClose, closeDisabled]);
  useEffect(() => {
    if (!target) return;
    const previous = document.activeElement as HTMLElement | null;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const nodes = () =>
      Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]',
        ) || [],
      ).filter((element) => element.getClientRects().length > 0);
    (nodes()[0] || ref.current)?.focus({ preventScroll: true });
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" && event.key !== "Tab") return;
      const dialogs = target.querySelectorAll(".modal-backdrop > .modal");
      if (ref.current !== dialogs.item(dialogs.length - 1)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        if (!close.current.disabled) close.current.run();
      }
      if (event.key === "Tab") {
        const list = nodes();
        const first = list[0];
        const last = list.at(-1);
        if (!first || !ref.current?.contains(document.activeElement) || document.activeElement === ref.current) {
          event.preventDefault();
          (event.shiftKey ? last || ref.current : first || ref.current)?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = original;
      previous?.focus({ preventScroll: true });
    };
  }, [target]);
  if (!target) return null;
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (!closeDisabled && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={ref}
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        tabIndex={-1}
        aria-modal="true"
        aria-busy={closeDisabled || undefined}
        aria-labelledby={titleId}
      >
        <div className="modal-heading">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onClose}
            aria-label="Fechar"
            disabled={closeDisabled}
          >
            <X size={21} />
          </button>
        </div>
        {children}
      </div>
    </div>,
    target,
  );
}
export function Empty({
  title = "Nenhum registro encontrado",
  description = "Os registros aparecerão aqui assim que forem cadastrados.",
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="empty-state">
      <PackageOpen size={34} />
      <strong>{title}</strong>
      <p>{description}</p>
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading-state">
      <LoaderCircle className="spin" size={28} />
      <p>Carregando seu almoxarifado…</p>
    </div>
  );
}
export function Badge({
  children,
  tone = "",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
