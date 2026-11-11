export function Logo({ size = 28, withWordmark = false }: { size?: number; withWordmark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#22252b" />
        <path d="M14 15h8v27h9v7H14V15Z" fill="#36c8d0" />
        <path
          d="M51 17v8c-3.2-2.8-5.8-3.8-9.3-2.8-4.2 1.2-6.7 4.8-6.7 9.8 0 5 2.5 8.6 6.7 9.8 3.5 1 6.1 0 9.3-2.8v8c-3.5 2.4-7.8 3.2-12.1 1.8C31.4 46.7 27 40.8 27 32s4.4-14.7 11.9-16.8c4.3-1.4 8.6-.6 12.1 1.8Z"
          fill="#f5f6f7"
        />
      </svg>
      {withWordmark ? (
        <span className="text-[15px] font-semibold tracking-[-0.025em] text-ink">LibreCut</span>
      ) : null}
    </div>
  );
}
