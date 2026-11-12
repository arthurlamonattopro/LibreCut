import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { isTopDialog, registerDialog, trapFocus, unregisterDialog } from "../lib/a11y";
import { useT } from "../lib/i18n";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

export function Modal({ open, onClose, title, description, children, footer, width = 520 }: ModalProps) {
  const t = useT();
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  // The close handler is usually an inline arrow, so the effect reads it
  // through a ref instead of re-running on every render of the parent.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (panel) {
      registerDialog(panel);
      // The dialog itself takes focus first, so a screen reader reads the
      // title and the description before the contents.
      panel.focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!panel || !isTopDialog(panel)) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      trapFocus(event, panel);
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      if (panel) unregisterDialog(panel);
      const restore = restoreRef.current;
      restoreRef.current = null;
      if (restore && document.contains(restore)) restore.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/65 backdrop-blur-sm animate-fade-in" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className="relative w-full overflow-hidden rounded-2xl border border-line bg-panel shadow-2xl shadow-black/60 animate-pop-in focus:outline-none"
        style={{ maxWidth: width }}
      >
        <div className="flex items-start justify-between gap-6 px-6 pb-4 pt-6">
          <div>
            <h2 id={titleId} className="text-[17px] font-semibold tracking-[-0.02em]">{title}</h2>
            {description ? <p id={descriptionId} className="mt-1.5 text-[12.5px] leading-relaxed text-muted">{description}</p> : null}
          </div>
          <button className="btn btn-ghost btn-icon -mr-2 -mt-1" onClick={onClose} aria-label={t("Close {title}", { title })}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <div className="px-6 pb-6">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line-soft bg-surface-2/60 px-6 py-3.5">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}
