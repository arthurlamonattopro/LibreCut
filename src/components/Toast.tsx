import { CheckCircle2, CircleAlert, Info, X } from "lucide-react";
import { create } from "zustand";

type ToastKind = "info" | "success" | "error";

interface ToastItem {
  id: string;
  message: string;
  kind: ToastKind;
}

interface ToastState {
  items: ToastItem[];
  push: (message: string, kind: ToastKind) => void;
  dismiss: (id: string) => void;
}

const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (message, kind) => {
    const id = crypto.randomUUID();
    set((state) => ({ items: [...state.items, { id, message, kind }].slice(-4) }));
    window.setTimeout(() => {
      set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
    }, 4200);
  },
  dismiss: (id) => set((state) => ({ items: state.items.filter((item) => item.id !== id) })),
}));

export function toast(message: string, kind: ToastKind = "info") {
  useToastStore.getState().push(message, kind);
}

export function ToastViewport() {
  const items = useToastStore((state) => state.items);
  const dismiss = useToastStore((state) => state.dismiss);

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[70] flex w-[340px] flex-col gap-2">
      {items.map((item) => {
        const Icon = item.kind === "success" ? CheckCircle2 : item.kind === "error" ? CircleAlert : Info;
        return (
          <div
            key={item.id}
            className="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-panel-2/95 px-3.5 py-3 shadow-xl shadow-black/40 backdrop-blur-md animate-pop-in"
          >
            <Icon
              size={16}
              className={
                item.kind === "success"
                  ? "mt-0.5 shrink-0 text-mint"
                  : item.kind === "error"
                    ? "mt-0.5 shrink-0 text-accent"
                    : "mt-0.5 shrink-0 text-blue"
              }
            />
            <p className="flex-1 text-[12.5px] leading-relaxed text-ink/90">{item.message}</p>
            <button className="text-dim transition hover:text-ink" onClick={() => dismiss(item.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
