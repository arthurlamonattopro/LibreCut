import type { LucideIcon } from "lucide-react";

export function MenuLabel({ children }: { children: string }) {
  return (
    <div className="px-2 pb-1 pt-2 text-[8.5px] font-semibold uppercase tracking-[0.13em] text-dim/80">
      {children}
    </div>
  );
}

export function MenuRow({
  icon: Icon,
  label,
  shortcut,
  disabled,
  danger,
  checked,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role={checked === undefined ? "menuitem" : "menuitemcheckbox"}
      aria-checked={checked === undefined ? undefined : checked}
      disabled={disabled}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "text-error hover:bg-error/10" : checked ? "text-accent hover:bg-accent-soft/60" : "text-muted hover:bg-white/5 hover:text-ink"
      }`}
      onClick={onClick}
    >
      <Icon size={12} aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? <span className="font-mono text-[9px] text-dim">{shortcut}</span> : null}
      {checked !== undefined ? <span className={`h-1.5 w-1.5 rounded-full ${checked ? "bg-accent" : "bg-line"}`} aria-hidden="true" /> : null}
    </button>
  );
}
