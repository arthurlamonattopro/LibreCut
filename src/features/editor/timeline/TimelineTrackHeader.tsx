import type { MouseEvent as ReactMouseEvent } from "react";
import {
  AudioWaveform,
  Eye,
  EyeOff,
  Lock,
  Magnet,
  MoreVertical,
  Unlock,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEditor } from "../../../stores/editor";
import { DEFAULT_DUCKING } from "../../../lib/audio";
import { useT } from "../../../lib/i18n";
import type { Track } from "../../../lib/types";
import { LABEL_WIDTH, trackIcon } from "./geometry";

export function TimelineTrackHeader({
  track,
  height,
  layerNumber,
  layerTag,
  onContextMenu,
}: {
  track: Track;
  height: number;
  layerNumber: number;
  layerTag: string;
  onContextMenu: (event: ReactMouseEvent) => void;
}) {
  const updateTrack = useEditor((state) => state.updateTrack);
  const setMagneticTrack = useEditor((state) => state.setMagneticTrack);
  const t = useT();
  const Icon = trackIcon(track.kind);

  return (
    <div
      className="sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-1 border-r border-line-soft bg-[#191a1f] px-2.5"
      style={{ width: LABEL_WIDTH, height }}
      onContextMenu={onContextMenu}
    >
      <div className="flex items-center gap-1.5">
        <Icon size={12} aria-hidden="true" className={track.kind === "text" ? "text-blue" : track.kind === "audio" ? "text-mint" : track.kind === "misc" ? "text-amber" : "text-accent"} />
        <span className="min-w-0 flex-1 truncate text-[10.5px] font-medium text-ink/90">{track.name}</span>
        {track.magnetic ? <span className="rounded border border-accent/40 bg-accent-soft px-1 py-0.5 font-mono text-[8px] leading-none text-accent" title={t("Magnetic main track")}>MAIN</span> : null}
        {track.ducking?.enabled ? <span className="rounded border border-mint/40 bg-mint/10 px-1 py-0.5 font-mono text-[8px] leading-none text-mint" title={t("Ducking under other audio")}>DUCK</span> : null}
        <span className="rounded border border-white/10 bg-white/[0.04] px-1 py-0.5 font-mono text-[8px] leading-none text-dim" title={t("{kind} layer {number}", { kind: t(track.kind), number: layerNumber })}>
          {layerTag}{layerNumber}
        </span>
        <span className="text-[9px] text-dim">{track.clips.length}</span>
        <button
          className="ml-auto flex h-5 w-5 shrink-0 items-center justify-center rounded text-dim transition hover:bg-white/5 hover:text-ink"
          onClick={onContextMenu}
          title={t("Track actions")}
          aria-label={t("Track actions for {name}", { name: track.name })}
          aria-haspopup="menu"
        >
          <MoreVertical size={11} aria-hidden="true" />
        </button>
      </div>
      <div className="flex items-center gap-0.5">
        {track.kind === "audio" || track.kind === "video" ? (
          <button
            className="flex h-5 w-5 items-center justify-center rounded text-dim transition hover:bg-white/5 hover:text-ink"
            onClick={() => updateTrack(track.id, { muted: !track.muted })}
            title={track.muted ? t("Unmute track") : t("Mute track")}
            aria-label={t("{action} {name}", { action: track.muted ? t("Unmute") : t("Mute"), name: track.name })}
            aria-pressed={track.muted}
          >
            {track.muted ? <VolumeX size={11} aria-hidden="true" /> : <Volume2 size={11} aria-hidden="true" />}
          </button>
        ) : null}
        {track.kind !== "audio" ? (
          <button
            className="flex h-5 w-5 items-center justify-center rounded text-dim transition hover:bg-white/5 hover:text-ink"
            onClick={() => updateTrack(track.id, { hidden: !track.hidden })}
            title={track.hidden ? t("Show track") : t("Hide track")}
            aria-label={t("{action} {name}", { action: track.hidden ? t("Show") : t("Hide"), name: track.name })}
            aria-pressed={track.hidden}
          >
            {track.hidden ? <EyeOff size={11} aria-hidden="true" /> : <Eye size={11} aria-hidden="true" />}
          </button>
        ) : null}
        {track.kind === "video" ? (
          <button
            className={`flex h-5 w-5 items-center justify-center rounded transition hover:bg-white/5 ${track.magnetic ? "text-accent" : "text-dim hover:text-ink"}`}
            onClick={() => setMagneticTrack(track.magnetic ? null : track.id)}
            title={track.magnetic ? t("Disable magnetic main track") : t("Make this the magnetic main track")}
            aria-pressed={Boolean(track.magnetic)}
            aria-label={t("{action} {name} the magnetic main track", { action: track.magnetic ? t("Disable") : t("Make"), name: track.name })}
          >
            <Magnet size={11} aria-hidden="true" />
          </button>
        ) : null}
        {track.kind === "audio" || track.kind === "video" ? (
          <button
            className={`flex h-5 w-5 items-center justify-center rounded transition hover:bg-white/5 ${track.ducking?.enabled ? "text-mint" : "text-dim hover:text-ink"}`}
            onClick={() => updateTrack(track.id, { ducking: { ...DEFAULT_DUCKING, ...track.ducking, enabled: !track.ducking?.enabled } })}
            title={track.ducking?.enabled ? t("Disable ducking on this track") : t("Duck this track under other audio")}
            aria-pressed={Boolean(track.ducking?.enabled)}
            aria-label={t("{action} ducking on {name}", { action: track.ducking?.enabled ? t("Disable") : t("Enable"), name: track.name })}
          >
            <AudioWaveform size={11} aria-hidden="true" />
          </button>
        ) : null}
        <button
          className="flex h-5 w-5 items-center justify-center rounded text-dim transition hover:bg-white/5 hover:text-ink"
          onClick={() => updateTrack(track.id, { locked: !track.locked })}
          title={track.locked ? t("Unlock track") : t("Lock track")}
          aria-label={t("{action} {name}", { action: track.locked ? t("Unlock") : t("Lock"), name: track.name })}
          aria-pressed={track.locked}
        >
          {track.locked ? <Lock size={11} aria-hidden="true" /> : <Unlock size={11} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );
}
