import type { KeyboardEvent as ReactKeyboardEvent, RefObject } from "react";
import {
  ArrowDown,
  ArrowUp,
  AudioWaveform,
  ChevronsRight,
  Copy,
  Eye,
  EyeOff,
  Film,
  Gauge,
  Lock,
  Magnet,
  Music2,
  Scissors,
  SlidersHorizontal,
  Trash2,
  Type,
  Unlock,
  Volume2,
  VolumeX,
  ZoomIn,
} from "lucide-react";
import { useEditor } from "../../../stores/editor";
import { DEFAULT_DUCKING } from "../../../lib/audio";
import { normalizeSpeedRamp } from "../../../lib/speed";
import { useT } from "../../../lib/i18n";
import { MenuLabel, MenuRow } from "./TimelineMenu";
import { trackIcon } from "./geometry";

export interface TimelineMenuState {
  x: number;
  y: number;
  trackId: string;
  clipId?: string;
}

export function TimelineContextMenu({
  menu,
  menuRef,
  onClose,
  onFit,
}: {
  menu: TimelineMenuState;
  menuRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  onFit: () => void;
}) {
  const project = useEditor((state) => state.project);
  const currentTime = useEditor((state) => state.currentTime);
  const snap = useEditor((state) => state.snap);
  const ripple = useEditor((state) => state.ripple);
  const updateTrack = useEditor((state) => state.updateTrack);
  const setMagneticTrack = useEditor((state) => state.setMagneticTrack);
  const moveTrackUp = useEditor((state) => state.moveTrackUp);
  const moveTrackDown = useEditor((state) => state.moveTrackDown);
  const deleteTrack = useEditor((state) => state.deleteTrack);
  const addTrack = useEditor((state) => state.addTrack);
  const addEffectClip = useEditor((state) => state.addEffectClip);
  const splitAtPlayhead = useEditor((state) => state.splitAtPlayhead);
  const toggleSnap = useEditor((state) => state.toggleSnap);
  const toggleRipple = useEditor((state) => state.toggleRipple);
  const t = useT();

  const menuTrack = project?.tracks.find((track) => track.id === menu.trackId);
  const menuClip = menu.clipId
    ? project?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === menu.clipId)
    : undefined;
  const menuClipAtPlayhead = Boolean(
    menuClip && currentTime > menuClip.start + 0.05 && currentTime < menuClip.start + menuClip.duration - 0.05,
  );

  if (!menuTrack) return null;
  const MenuIcon = trackIcon(menuTrack.kind);

  const runMenuAction = (action: () => void) => {
    action();
    onClose();
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Tab") {
      onClose();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)') ?? []);
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (index + 1 + items.length) % items.length
          : (index - 1 + items.length) % items.length;
    items[next]?.focus();
  };

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label={t("Quick actions for {name}", { name: menuTrack.name })}
      onKeyDown={handleMenuKeyDown}
      className="animate-fade-in fixed z-[80] w-60 overflow-y-auto rounded-lg border border-line bg-panel p-1 shadow-2xl shadow-black/60"
      style={{
        left: Math.max(8, Math.min(menu.x, window.innerWidth - 252)),
        top: Math.max(8, Math.min(menu.y, window.innerHeight - 440)),
        maxHeight: "min(72vh, 520px)",
      }}
    >
      <div className="flex items-center gap-2 px-2 py-1.5">
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line bg-raised text-accent">
          <MenuIcon size={12} aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold text-ink">{menuClip ? menuClip.name : menuTrack.name}</div>
          <div className="text-[9px] text-dim">
            {menuClip ? t("{name} · {kind} clip", { name: menuTrack.name, kind: t(menuClip.kind) }) : t("{kind} track · quick actions", { kind: t(menuTrack.kind) })}
          </div>
        </div>
      </div>
      <div className="my-1 h-px bg-line-soft" />

      {menuClip ? (
        <>
          <MenuLabel>{t("Clip")}</MenuLabel>
          <MenuRow
            icon={Scissors}
            label={t("Split at playhead")}
            shortcut="S"
            disabled={!menuClipAtPlayhead}
            onClick={() => runMenuAction(splitAtPlayhead)}
          />
          <MenuRow
            icon={Copy}
            label={t("Duplicate clip")}
            shortcut="Ctrl+D"
            onClick={() => runMenuAction(() => {
              const state = useEditor.getState();
              if (state.selectedClipIds.includes(menuClip.id) && state.selectedClipIds.length > 1) state.duplicateSelected();
              else state.duplicateClip(menuClip.id);
            })}
          />
          <MenuRow
            icon={Trash2}
            label={t("Delete clip")}
            shortcut="Del"
            danger
            onClick={() => runMenuAction(() => {
              const state = useEditor.getState();
              if (state.selectedClipIds.includes(menuClip.id) && state.selectedClipIds.length > 1) state.deleteSelected();
              else state.deleteClip(menuClip.id);
            })}
          />

          <MenuLabel>{t("Speed")}</MenuLabel>
          <MenuRow
            icon={Gauge}
            label={t("Ramp up  0.5× → 2×")}
            onClick={() => runMenuAction(() => useEditor.getState().updateClip(menuClip.id, {
              speedRamp: normalizeSpeedRamp([{ time: 0, speed: 0.5 }, { time: menuClip.duration, speed: 2 }], menuClip.duration),
            }))}
          />
          <MenuRow
            icon={Gauge}
            label={t("Ramp down  2× → 0.5×")}
            onClick={() => runMenuAction(() => useEditor.getState().updateClip(menuClip.id, {
              speedRamp: normalizeSpeedRamp([{ time: 0, speed: 2 }, { time: menuClip.duration, speed: 0.5 }], menuClip.duration),
            }))}
          />
          <MenuRow
            icon={Gauge}
            label={t("Bullet time")}
            onClick={() => runMenuAction(() => useEditor.getState().updateClip(menuClip.id, {
              speedRamp: normalizeSpeedRamp([
                { time: 0, speed: 1 },
                { time: menuClip.duration / 2, speed: 0.3 },
                { time: menuClip.duration, speed: 1 },
              ], menuClip.duration),
            }))}
          />
          <MenuRow
            icon={Gauge}
            label={t("Clear speed ramp")}
            disabled={!menuClip.speedRamp?.length}
            onClick={() => runMenuAction(() => useEditor.getState().updateClip(menuClip.id, { speedRamp: [] }))}
          />

          <MenuLabel>{t("Transition")}</MenuLabel>
          <MenuRow
            icon={ChevronsRight}
            label={t("Crossfade in · 0.5s")}
            checked={menuClip.transitionIn.type !== "none"}
            onClick={() => runMenuAction(() => useEditor.getState().updateClip(menuClip.id, {
              transitionIn: menuClip.transitionIn.type === "none"
                ? { type: "fade", duration: Math.min(0.5, menuClip.duration) }
                : { ...menuClip.transitionIn, type: "none" },
            }))}
          />
          <MenuRow
            icon={ChevronsRight}
            label={t("Crossfade out · 0.5s")}
            checked={menuClip.transitionOut.type !== "none"}
            onClick={() => runMenuAction(() => useEditor.getState().updateClip(menuClip.id, {
              transitionOut: menuClip.transitionOut.type === "none"
                ? { type: "fade", duration: Math.min(0.5, menuClip.duration) }
                : { ...menuClip.transitionOut, type: "none" },
            }))}
          />
        </>
      ) : null}

      <MenuLabel>{t("Track")}</MenuLabel>
      {menuTrack.kind === "audio" || menuTrack.kind === "video" ? (
        <MenuRow
          icon={menuTrack.muted ? VolumeX : Volume2}
          label={menuTrack.muted ? t("Unmute track") : t("Mute track")}
          checked={menuTrack.muted}
          onClick={() => runMenuAction(() => updateTrack(menuTrack.id, { muted: !menuTrack.muted }))}
        />
      ) : null}
      {menuTrack.kind !== "audio" ? (
        <MenuRow
          icon={menuTrack.hidden ? EyeOff : Eye}
          label={menuTrack.hidden ? t("Show track") : t("Hide track")}
          checked={menuTrack.hidden}
          onClick={() => runMenuAction(() => updateTrack(menuTrack.id, { hidden: !menuTrack.hidden }))}
        />
      ) : null}
      <MenuRow
        icon={menuTrack.locked ? Unlock : Lock}
        label={menuTrack.locked ? t("Unlock track") : t("Lock track")}
        checked={menuTrack.locked}
        onClick={() => runMenuAction(() => updateTrack(menuTrack.id, { locked: !menuTrack.locked }))}
      />
      {menuTrack.kind === "video" ? (
        <MenuRow
          icon={Magnet}
          label={menuTrack.magnetic ? t("Disable main track") : t("Make main track")}
          checked={Boolean(menuTrack.magnetic)}
          onClick={() => runMenuAction(() => setMagneticTrack(menuTrack.magnetic ? null : menuTrack.id))}
        />
      ) : null}
      {menuTrack.kind === "audio" || menuTrack.kind === "video" ? (
        <MenuRow
          icon={AudioWaveform}
          label={menuTrack.ducking?.enabled ? t("Disable ducking") : t("Duck under other audio")}
          checked={Boolean(menuTrack.ducking?.enabled)}
          onClick={() => runMenuAction(() => updateTrack(menuTrack.id, {
            ducking: { ...DEFAULT_DUCKING, ...menuTrack.ducking, enabled: !menuTrack.ducking?.enabled },
          }))}
        />
      ) : null}
      <MenuRow icon={ArrowUp} label={t("Move track up")} onClick={() => runMenuAction(() => moveTrackUp(menuTrack.id))} />
      <MenuRow icon={ArrowDown} label={t("Move track down")} onClick={() => runMenuAction(() => moveTrackDown(menuTrack.id))} />
      <MenuRow
        icon={Trash2}
        label={t("Delete track")}
        danger
        disabled={menuTrack.locked}
        onClick={() => runMenuAction(() => deleteTrack(menuTrack.id))}
      />

      <MenuLabel>{t("Add")}</MenuLabel>
      <MenuRow icon={Film} label={t("Video track")} onClick={() => runMenuAction(() => addTrack("video"))} />
      <MenuRow icon={Music2} label={t("Audio track")} onClick={() => runMenuAction(() => addTrack("audio"))} />
      <MenuRow icon={Type} label={t("Text track")} onClick={() => runMenuAction(() => addTrack("text"))} />
      <MenuRow icon={SlidersHorizontal} label={t("Color filter at playhead")} onClick={() => runMenuAction(() => addEffectClip(undefined, currentTime))} />

      <MenuLabel>{t("Timeline")}</MenuLabel>
      <MenuRow icon={Magnet} label={t("Snapping")} checked={snap} onClick={() => runMenuAction(toggleSnap)} />
      <MenuRow icon={ChevronsRight} label={t("Ripple edits")} checked={ripple} onClick={() => runMenuAction(toggleRipple)} />
      <MenuRow icon={ZoomIn} label={t("Fit timeline")} onClick={() => runMenuAction(onFit)} />
    </div>
  );
}
