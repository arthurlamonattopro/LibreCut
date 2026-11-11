use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::ffmpeg;

#[derive(Default)]
pub struct ExportState {
    cancel: AtomicBool,
    running: AtomicBool,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportClip {
    pub path: String,
    pub start: f64,
    pub duration: f64,
    pub trim_in: f64,
    #[serde(default = "default_speed")]
    pub speed: f64,
    pub volume: f64,
    pub opacity: f64,
    pub has_audio: bool,
    #[serde(default)]
    pub has_video: bool,
    pub is_image: bool,
    #[serde(default)]
    pub fit: Option<String>,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_scale")]
    pub scale: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default)]
    pub mask: Option<String>,
    #[serde(default)]
    pub chroma_key: Option<ExportChromaKey>,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    #[serde(default)]
    pub pitch: f64,
    #[serde(default)]
    pub bass: f64,
    #[serde(default)]
    pub treble: f64,
    #[serde(default)]
    pub keyframes: Vec<ExportKeyframe>,
    #[serde(default)]
    pub transition_in: ExportTransition,
    #[serde(default)]
    pub transition_out: ExportTransition,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportChromaKey {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub similarity: f64,
    #[serde(default)]
    pub softness: f64,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportText {
    pub text: String,
    pub start: f64,
    pub duration: f64,
    pub x: f64,
    pub y: f64,
    pub size: f64,
    pub color: String,
    #[serde(default)]
    pub font_weight: Option<String>,
    #[serde(default)]
    pub align: Option<String>,
    #[serde(default)]
    pub underline: bool,
    #[serde(default)]
    pub character_spacing: f64,
    #[serde(default)]
    pub outline_color: Option<String>,
    #[serde(default)]
    pub outline_width: f64,
    #[serde(default = "default_text_brightness")]
    pub brightness: f64,
    #[serde(default)]
    pub shadow: f64,
    #[serde(default)]
    pub curve: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default = "default_text_brightness")]
    pub opacity: f64,
    #[serde(default)]
    pub keyframes: Vec<ExportKeyframe>,
    #[serde(default)]
    pub transition_in: ExportTransition,
    #[serde(default)]
    pub transition_out: ExportTransition,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportKeyframe {
    pub property: String,
    pub time: f64,
    pub value: f64,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportTransition {
    #[serde(rename = "type", default)]
    pub transition_type: String,
    #[serde(default)]
    pub duration: f64,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportEffect {
    pub start: f64,
    pub duration: f64,
    pub opacity: f64,
    pub brightness: f64,
    pub contrast: f64,
    pub saturation: f64,
    pub hue: f64,
    #[serde(default)]
    pub sepia: f64,
    pub blur: f64,
    #[serde(default)]
    pub vignette: f64,
    #[serde(default)]
    pub motion_blur: f64,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    pub mask: String,
    pub mask_x: f64,
    pub mask_y: f64,
    pub mask_size: f64,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub output: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration: f64,
    pub clips: Vec<ExportClip>,
    pub texts: Vec<ExportText>,
    #[serde(default)]
    pub effects: Vec<ExportEffect>,
    #[serde(default)]
    pub encoder: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub output: String,
    pub elapsed_ms: u128,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub percent: f64,
    pub time: f64,
    pub speed: String,
    pub fps: f64,
}

fn default_speed() -> f64 {
    1.0
}

fn default_scale() -> f64 {
    1.0
}
fn default_text_brightness() -> f64 {
    1.0
}

fn atempo_filters(speed: f64) -> String {
    let mut factor = speed.clamp(0.25, 4.0);
    let mut filters: Vec<String> = Vec::new();
    while factor > 2.0 {
        filters.push("atempo=2.0".to_string());
        factor /= 2.0;
    }
    while factor < 0.5 {
        filters.push("atempo=0.5".to_string());
        factor /= 0.5;
    }
    if (factor - 1.0).abs() > 0.001 {
        filters.push(format!("atempo={factor:.4}"));
    }
    filters.join(",")
}

fn escape_text(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace(':', "\\:")
        .replace('%', "\\%")
        .replace('\n', "\\n")
}

fn drawtext_color(color: &str, brightness: f64) -> String {
    if let Some(hex) = color.strip_prefix('#') {
        if hex.len() == 6 {
            let scaled: Vec<u8> = (0..3)
                .map(|i| {
                    let channel = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap_or(255);
                    (channel as f64 * brightness.clamp(0.0, 2.0))
                        .round()
                        .clamp(0.0, 255.0) as u8
                })
                .collect();
            format!("0x{:02x}{:02x}{:02x}", scaled[0], scaled[1], scaled[2])
        } else {
            format!("0x{hex}")
        }
    } else {
        color.to_string()
    }
}

fn font_file(weight: Option<&str>) -> String {
    std::env::var("LIBRECUT_FONT").unwrap_or_else(|_| {
        let windows_font = Path::new(if weight == Some("bold") {
            r"C:\Windows\Fonts\arialbd.ttf"
        } else {
            r"C:\Windows\Fonts\arial.ttf"
        });
        if windows_font.is_file() {
            if weight == Some("bold") {
                r"C\:/Windows/Fonts/arialbd.ttf".to_string()
            } else {
                r"C\:/Windows/Fonts/arial.ttf".to_string()
            }
        } else {
            if weight == Some("bold") {
                "Arial Bold".to_string()
            } else {
                "Arial".to_string()
            }
        }
    })
}

fn keyframe_expr(keyframes: &[ExportKeyframe], property: &str, base: f64, local: &str) -> String {
    let mut frames: Vec<&ExportKeyframe> = keyframes
        .iter()
        .filter(|frame| frame.property == property)
        .collect();
    frames.sort_by(|a, b| a.time.total_cmp(&b.time));
    if frames.is_empty() {
        return format!("{base:.6}");
    }
    let mut expr = format!("{:.6}", frames.last().unwrap().value);
    if frames.len() > 1 {
        for index in (0..frames.len() - 1).rev() {
            let from = frames[index];
            let to = frames[index + 1];
            let span = (to.time - from.time).max(0.001);
            expr = format!(
                "if(lt({local},{:.6}),{:.6}+({:.6})*(({local}-{:.6})/{span:.6}),{expr})",
                to.time,
                from.value,
                to.value - from.value,
                from.time
            );
        }
    }
    format!("if(lt({local},{:.6}),{base:.6},{expr})", frames[0].time)
}

fn transition_fade_expr(
    transition: &ExportTransition,
    edge: &str,
    start: f64,
    duration: f64,
) -> String {
    if transition.transition_type != "fade" || transition.duration <= 0.0 {
        return "1".to_string();
    }
    let amount = transition.duration.min(duration).max(0.001);
    if edge == "in" {
        format!(
            "if(lt(T,{:.6}),max(0,(T-{start:.6})/{amount:.6}),1)",
            start + amount
        )
    } else {
        format!(
            "if(gt(T,{:.6}),max(0,({:.6}-T)/{amount:.6}),1)",
            start + duration - amount,
            start + duration
        )
    }
}

/// Builds an FFmpeg filter graph using overlay-by-timestamp compositing.
/// This keeps the graph deterministic and supports gaps and overlaps without
/// requiring the timeline to be pre-flattened into a concat sequence.
pub fn build_graph(request: &ExportRequest) -> String {
    let width = request.width.max(16);
    let height = request.height.max(16);
    let duration = request.duration.max(0.04);
    let fps = if request.fps > 0.0 { request.fps } else { 30.0 };
    let mut lines: Vec<String> = Vec::new();

    lines.push(format!(
        "color=c=0x101012:s={width}x{height}:r={fps}:d={duration:.3}[base0]"
    ));

    let mut base = "base0".to_string();
    for (index, clip) in request.clips.iter().enumerate() {
        if !clip.has_video && !clip.is_image {
            continue;
        }
        let start = clip.start.max(0.0);
        let clip_duration = clip.duration.max(0.04);
        let speed = if clip.is_image {
            1.0
        } else {
            clip.speed.clamp(0.25, 4.0)
        };
        let source_duration = clip_duration * speed;
        let trim = clip.trim_in.max(0.0);
        let end = start + clip_duration;
        let fit = clip.fit.as_deref().unwrap_or("contain");
        let scaling = if fit == "cover" {
            format!(
                "scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
            )
        } else {
            format!(
                "scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"
            )
        };
        let timing = if clip.is_image {
            format!("trim=duration={clip_duration:.3},setpts=PTS-STARTPTS+{start:.3}/TB")
        } else {
            format!(
                "trim=start={trim:.3}:duration={source_duration:.3},setpts=(PTS-STARTPTS)/{speed:.4}+{start:.3}/TB"
            )
        };
        let local_t = format!("(t-{start:.6})");
        let scale_expr = keyframe_expr(&clip.keyframes, "scale", clip.scale, &local_t);
        let rotation_expr = keyframe_expr(&clip.keyframes, "rotation", clip.rotation, &local_t);
        let scale_filter = format!(",scale=w='max(2,round({width}*({scale_expr})/2)*2)':h='max(2,round({height}*({scale_expr})/2)*2)':eval=frame");
        let rotate = if clip.rotation.abs() > 0.01
            || clip
                .keyframes
                .iter()
                .any(|frame| frame.property == "rotation")
        {
            format!(",rotate='({rotation_expr})*PI/180':ow=rotw(iw):oh=roth(ih):c=black@0")
        } else {
            String::new()
        };
        let mask = if clip.mask.as_deref() == Some("circle") {
            ",geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*if(lte(pow(X-W/2,2)+pow(Y-H/2,2),pow(min(W,H)/2,2)),1,0)'"
        } else {
            ""
        };
        let opacity_expr = keyframe_expr(
            &clip.keyframes,
            "opacity",
            clip.opacity,
            &format!("(T-{start:.6})"),
        );
        let fade_in = transition_fade_expr(&clip.transition_in, "in", start, clip_duration);
        let fade_out = transition_fade_expr(&clip.transition_out, "out", start, clip_duration);
        let wipe_in =
            if clip.transition_in.transition_type == "wipe" && clip.transition_in.duration > 0.0 {
                let d = clip.transition_in.duration.min(clip_duration).max(0.001);
                format!(
                    "*if(lt(T,{:.6}),if(lte(X,W*(T-{start:.6})/{d:.6}),1,0),1)",
                    start + d
                )
            } else {
                String::new()
            };
        let wipe_out = if clip.transition_out.transition_type == "wipe"
            && clip.transition_out.duration > 0.0
        {
            let d = clip.transition_out.duration.min(clip_duration).max(0.001);
            let begin = start + clip_duration - d;
            format!("*if(gt(T,{begin:.6}),if(gte(X,W*(T-{begin:.6})/{d:.6}),1,0),1)")
        } else {
            String::new()
        };
        let alpha = format!(
            "({:.4})*({opacity_expr})*({fade_in})*({fade_out}){wipe_in}{wipe_out}",
            clip.opacity.clamp(0.0, 1.0)
        );
        let chroma = clip
            .chroma_key
            .as_ref()
            .filter(|key| key.enabled)
            .map(|key| {
                let color = key.color.trim_start_matches('#');
                let safe_color = if color.len() == 6 && color.chars().all(|c| c.is_ascii_hexdigit())
                {
                    format!("0x{color}")
                } else {
                    "0x00ff00".to_string()
                };
                format!(
                    ",chromakey={safe_color}:{:.4}:{:.4}",
                    key.similarity.clamp(0.0, 1.0),
                    key.softness.clamp(0.0, 1.0)
                )
            })
            .unwrap_or_default();
        lines.push(format!("[{index}:v]{timing},{scaling}{scale_filter},setsar=1,fps={fps},format=rgba{chroma}{rotate}{mask},geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*({alpha})'[v{index}]"));
        let x_expr = keyframe_expr(&clip.keyframes, "x", clip.x, &local_t);
        let y_expr = keyframe_expr(&clip.keyframes, "y", clip.y, &local_t);
        lines.push(format!(
            "[{base}][v{index}]overlay=(W-w)/2+W*({x_expr}):(H-h)/2+H*({y_expr}):eof_action=pass:enable='between(t,{start:.3},{end:.3})'[bg{index}]"
        ));
        base = format!("bg{index}");
    }

    for (index, effect) in request.effects.iter().enumerate() {
        let start = effect.start.max(0.0);
        let end = (effect.start + effect.duration.max(0.04)).max(start + 0.04);
        let from = format!("fxsrc{index}");
        let original = format!("fxorig{index}");
        let filtered = format!("fx{index}");
        let output = format!("fxout{index}");
        let blur = if effect.blur > 0.01 {
            format!(",gblur=sigma={:.2}", effect.blur.clamp(0.5, 20.0))
        } else {
            String::new()
        };
        let vignette = if effect.vignette > 0.001 {
            format!(
                ",vignette=angle={:.4}",
                0.3 + effect.vignette.clamp(0.0, 1.0) * 0.9
            )
        } else {
            String::new()
        };
        let motion_blur = if effect.motion_blur > 0.001 {
            let frames = 2 + (effect.motion_blur.clamp(0.0, 1.0) * 6.0).round() as usize;
            let weights = (1..=frames)
                .map(|weight| weight.to_string())
                .collect::<Vec<_>>()
                .join(" ");
            format!(",tmix=frames={frames}:weights='{weights}'")
        } else {
            String::new()
        };
        let sepia = effect.sepia.clamp(0.0, 1.0);
        let rr = 1.0 - sepia * (1.0 - 0.393);
        let rg = sepia * 0.769;
        let rb = sepia * 0.189;
        let gr = sepia * 0.349;
        let gg = 1.0 - sepia * (1.0 - 0.686);
        let gb = sepia * 0.168;
        let br = sepia * 0.272;
        let bg = sepia * 0.534;
        let bb = 1.0 - sepia * (1.0 - 0.131);
        let mask = if effect.mask == "circle" {
            let cx = effect.mask_x.clamp(0.0, 1.0) * width as f64;
            let cy = effect.mask_y.clamp(0.0, 1.0) * height as f64;
            let radius = (width.min(height) as f64 * effect.mask_size.clamp(0.05, 1.5)) / 2.0;
            format!(",geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*if(lte(pow(X-{cx:.2},2)+pow(Y-{cy:.2},2),pow({radius:.2},2)),1,0)'")
        } else {
            String::new()
        };
        let fade_in = if effect.fade_in > 0.001 {
            let fade = effect.fade_in.min(end - start).max(0.001);
            format!("if(lt(t-{start:.3},{fade:.3}),(t-{start:.3})/{fade:.3},1)")
        } else {
            "1".to_string()
        };
        let fade_out = if effect.fade_out > 0.001 {
            let fade = effect.fade_out.min(end - start).max(0.001);
            format!("if(lt({end:.3}-t,{fade:.3}),({end:.3}-t)/{fade:.3},1)")
        } else {
            "1".to_string()
        };
        let alpha = format!("{:.3}*{fade_in}*{fade_out}", effect.opacity.clamp(0.0, 1.0));
        lines.push(format!("[{base}]split[{original}][{from}]"));
        lines.push(format!("[{from}]eq=brightness={:.4}:contrast={:.4}:saturation={:.4},hue=h={:.3},colorchannelmixer=rr={rr:.4}:rg={rg:.4}:rb={rb:.4}:gr={gr:.4}:gg={gg:.4}:gb={gb:.4}:br={br:.4}:bg={bg:.4}:bb={bb:.4}{blur}{vignette}{motion_blur},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*({alpha})'{mask}[{filtered}]",
            effect.brightness.clamp(-1.0, 1.0), effect.contrast.clamp(0.0, 2.0), effect.saturation.clamp(0.0, 2.0), effect.hue.clamp(-180.0, 180.0)));
        lines.push(format!("[{original}][{filtered}]overlay=0:0:eof_action=pass:enable='between(t,{start:.3},{end:.3})'[{output}]"));
        base = output;
    }

    for (index, text) in request.texts.iter().enumerate() {
        let start = text.start.max(0.0);
        let end = (text.start + text.duration.max(0.04)).max(start + 0.04);
        let x = (text.x.clamp(0.0, 1.0) * 100.0).round() / 100.0;
        let y = (text.y.clamp(0.0, 1.0) * 100.0).round() / 100.0;
        let local_t = format!("(t-{start:.6})");
        let x_expr = keyframe_expr(&text.keyframes, "x", text.x, &local_t);
        let y_expr = keyframe_expr(&text.keyframes, "y", text.y, &local_t);
        let opacity_expr = keyframe_expr(&text.keyframes, "opacity", text.opacity, &local_t);
        let rotation_expr = keyframe_expr(&text.keyframes, "rotation", text.rotation, &local_t);
        let rotation_animated = text
            .keyframes
            .iter()
            .any(|frame| frame.property == "rotation");
        let text_fade_in =
            if text.transition_in.transition_type != "none" && text.transition_in.duration > 0.0 {
                let d = text.transition_in.duration.min(text.duration).max(0.001);
                format!("if(lt({local_t},{d:.6}),max(0,{local_t}/{d:.6}),1)")
            } else {
                "1".to_string()
            };
        let text_fade_out = if text.transition_out.transition_type != "none"
            && text.transition_out.duration > 0.0
        {
            let d = text.transition_out.duration.min(text.duration).max(0.001);
            format!(
                "if(gt({local_t},{:.6}),max(0,({:.6}-{local_t})/{d:.6}),1)",
                text.duration - d,
                text.duration
            )
        } else {
            "1".to_string()
        };
        let font = font_file(text.font_weight.as_deref());
        let color = drawtext_color(&text.color, text.brightness);
        let outline = text.outline_color.as_deref().unwrap_or("#000000");
        let size = text.size.max(8.0).round();
        let align = text.align.as_deref().unwrap_or("center");
        let offset = match align {
            "left" => "0",
            "right" => "text_w",
            _ => "text_w/2",
        };
        let shadow = text.shadow.clamp(0.0, 1.0);
        let common = format!("fontfile='{}':fontcolor={}:fontsize={}:borderw={:.2}:bordercolor={}:shadowcolor=black@{shadow:.3}:shadowx={:.2}:shadowy={:.2}:alpha='({opacity_expr})*({text_fade_in})*({text_fade_out})'",
            font, color, size, text.outline_width.max(0.0), drawtext_color(outline, 1.0), shadow * 3.0, shadow * 3.0);
        if text.curve.abs() < 1.0
            && text.character_spacing.abs() < 0.01
            && text.rotation.abs() < 0.01
            && !rotation_animated
        {
            let label = format!("txt{index}");
            let dynamic_anchor = format!("w*({x_expr})");
            let dynamic_y = format!("h*({y_expr})-text_h/2");
            lines.push(format!("[{base}]drawtext={common}:text='{}':x={dynamic_anchor}-{offset}:y={dynamic_y}:enable='between(t,{start:.3},{end:.3})'[{label}]", escape_text(&text.text)));
            base = label;
        } else {
            let chars: Vec<char> = text.text.chars().collect();
            let widths: Vec<f64> = chars
                .iter()
                .map(|ch| (if ch.is_ascii() { size * 0.6 } else { size }) + text.character_spacing)
                .collect();
            let glyph_width: f64 = widths.iter().sum();
            let arc = text.curve.abs().to_radians();
            let total_width = glyph_width.max(arc * size * 1.15);
            let extra_gap = if chars.len() > 1 {
                (total_width - glyph_width) / (chars.len() - 1) as f64
            } else {
                0.0
            };
            let anchor_x = format!("w*({x_expr})");
            let anchor_y = format!("h*({y_expr})");
            let flat_start = match align {
                "left" => 0.0,
                "right" => -total_width,
                _ => -total_width / 2.0,
            };
            let radius = total_width / arc.max(0.01);
            let mut cursor = 0.0;
            for (char_index, ch) in chars.iter().enumerate() {
                let advance = widths[char_index]
                    + if char_index < chars.len() - 1 {
                        extra_gap
                    } else {
                        0.0
                    };
                let (local_x, local_y) = if text.curve.abs() < 1.0 {
                    (flat_start + cursor + advance / 2.0, 0.0)
                } else {
                    let angle = (cursor + advance / 2.0 - total_width / 2.0) / total_width * arc;
                    (
                        text.curve.signum() * radius * angle.sin(),
                        text.curve.signum() * radius * (1.0 - angle.cos()),
                    )
                };
                let world_x = format!("({anchor_x})+({local_x:.2})*cos(({rotation_expr})*PI/180)-({local_y:.2})*sin(({rotation_expr})*PI/180)");
                let world_y = format!("({anchor_y})+({local_x:.2})*sin(({rotation_expr})*PI/180)+({local_y:.2})*cos(({rotation_expr})*PI/180)");
                let label = format!("txt{index}_{char_index}");
                lines.push(format!("[{base}]drawtext={common}:text='{}':x={world_x}-text_w/2:y={world_y}-text_h/2:enable='between(t,{start:.3},{end:.3})'[{label}]", escape_text(&ch.to_string())));
                base = label;
                cursor += advance;
            }
        }
        if text.underline {
            let underline_width = (text.text.chars().count() as f64 * size * 0.6
                + text.character_spacing * text.text.chars().count() as f64)
                .max(1.0);
            let underline_x = match align {
                "left" => format!("w*{x:.3}"),
                "right" => format!("w*{x:.3}-{underline_width:.2}"),
                _ => format!("w*{x:.3}-{:.2}", underline_width / 2.0),
            };
            let label = format!("txt{index}_underline");
            lines.push(format!("[{base}]drawbox=x={underline_x}:y=h*{y:.3}+{:.2}:w={underline_width:.2}:h={:.2}:color={}@{:.3}:t=fill:enable='between(t,{start:.3},{end:.3})'[{label}]", size * 0.55, (size * 0.045).max(1.0), color, text.opacity.clamp(0.0, 1.0)));
            base = label;
        }
    }

    let audio_clips: Vec<(usize, &ExportClip)> = request
        .clips
        .iter()
        .enumerate()
        .filter(|(_, clip)| clip.has_audio)
        .collect();

    if !audio_clips.is_empty() {
        for (index, clip) in &audio_clips {
            let start_ms = (clip.start.max(0.0) * 1000.0).round() as u64;
            let speed = clip.speed.clamp(0.25, 4.0);
            let source_duration = clip.duration.max(0.04) * speed;
            let tempo = atempo_filters(speed);
            let tempo_part = if tempo.is_empty() {
                String::new()
            } else {
                format!(",{tempo}")
            };
            let pitch_ratio = 2.0f64.powf(clip.pitch.clamp(-12.0, 12.0) / 12.0);
            let pitch_filter = if (pitch_ratio - 1.0).abs() > 0.001 {
                format!(
                    ",asetrate=48000*{pitch_ratio:.6},aresample=48000,atempo={:.6}",
                    1.0 / pitch_ratio
                )
            } else {
                String::new()
            };
            let bass_filter = if clip.bass.abs() > 0.01 {
                format!(",bass=g={:.2}:f=180", clip.bass.clamp(-12.0, 12.0))
            } else {
                String::new()
            };
            let treble_filter = if clip.treble.abs() > 0.01 {
                format!(",treble=g={:.2}:f=4000", clip.treble.clamp(-12.0, 12.0))
            } else {
                String::new()
            };
            let fade_in = clip.fade_in.clamp(0.0, clip.duration.max(0.0));
            let fade_out = clip.fade_out.clamp(0.0, clip.duration.max(0.0));
            let transition_in = if clip.transition_in.transition_type != "none" {
                clip.transition_in.duration.min(clip.duration).max(0.0)
            } else {
                0.0
            };
            let transition_out = if clip.transition_out.transition_type != "none" {
                clip.transition_out.duration.min(clip.duration).max(0.0)
            } else {
                0.0
            };
            let fade_filters = format!(
                "{}{}{}{}",
                if fade_in > 0.0 {
                    format!(",afade=t=in:st=0:d={fade_in:.3}")
                } else {
                    String::new()
                },
                if fade_out > 0.0 {
                    format!(
                        ",afade=t=out:st={:.3}:d={fade_out:.3}",
                        (clip.duration - fade_out).max(0.0)
                    )
                } else {
                    String::new()
                },
                if transition_in > 0.0 {
                    format!(",afade=t=in:st=0:d={transition_in:.3}")
                } else {
                    String::new()
                },
                if transition_out > 0.0 {
                    format!(
                        ",afade=t=out:st={:.3}:d={transition_out:.3}",
                        (clip.duration - transition_out).max(0.0)
                    )
                } else {
                    String::new()
                }
            );
            let volume_expr = keyframe_expr(&clip.keyframes, "volume", clip.volume, "t");
            lines.push(format!(
                "[{index}:a]atrim=start={:.3}:duration={source_duration:.3},asetpts=PTS-STARTPTS{pitch_filter}{tempo_part},aresample=48000,aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo{bass_filter}{treble_filter},volume='{volume_expr}':eval=frame{fade_filters},adelay={start_ms}|{start_ms}[a{index}]",
                clip.trim_in.max(0.0),
            ));
        }
        let inputs: String = audio_clips
            .iter()
            .map(|(index, _)| format!("[a{index}]"))
            .collect();
        lines.push(format!(
            "{inputs}amix=inputs={}:duration=longest:dropout_transition=0:normalize=0,apad,atrim=0:{duration:.3}[aout]",
            audio_clips.len()
        ));
    }

    lines.push(format!("[{base}]format=yuv420p[vout]"));
    lines.join(";\n")
}

fn encoder_args(encoder: Option<&str>) -> Vec<String> {
    match encoder.unwrap_or("libx264") {
        "nvenc" => vec![
            "-c:v".into(),
            "h264_nvenc".into(),
            "-preset".into(),
            "p4".into(),
            "-cq".into(),
            "20".into(),
            "-b:v".into(),
            "0".into(),
        ],
        "qsv" => vec![
            "-c:v".into(),
            "h264_qsv".into(),
            "-global_quality".into(),
            "22".into(),
        ],
        "amf" => vec![
            "-c:v".into(),
            "h264_amf".into(),
            "-quality".into(),
            "balanced".into(),
            "-rc".into(),
            "cqp".into(),
            "-qp_i".into(),
            "20".into(),
            "-qp_p".into(),
            "20".into(),
        ],
        _ => vec![
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "veryfast".into(),
            "-crf".into(),
            "20".into(),
        ],
    }
}

/// Render a request through FFmpeg. This is the testable core of the export
/// command: it has no Tauri handle and reports progress through a callback.
pub async fn render_with_progress(
    request: &ExportRequest,
    work_dir: &Path,
    cancel: &AtomicBool,
    on_progress: &(dyn Fn(ExportProgress) + Send + Sync),
) -> Result<ExportResult, String> {
    if request.clips.is_empty() {
        return Err("There is nothing to export.".to_string());
    }

    let started = Instant::now();
    let output = PathBuf::from(&request.output);
    ffmpeg::ensure_parent(&output)?;

    let script_path = ffmpeg::unique_file(&work_dir.join("exports"), "filter");
    let graph = build_graph(request);
    std::fs::write(&script_path, graph)
        .map_err(|e| format!("Could not write export graph: {e}"))?;

    let mut command = ffmpeg::command(&ffmpeg::ffmpeg_bin());
    for clip in &request.clips {
        if clip.is_image {
            command.args(["-loop", "1"]);
        }
        command.arg("-i").arg(&clip.path);
    }
    command.arg("-/filter_complex").arg(&script_path);
    command.args(["-map", "[vout]"]);
    if request.clips.iter().any(|clip| clip.has_audio) {
        command.args(["-map", "[aout]"]);
    } else {
        command.arg("-an");
    }
    command
        .arg("-t")
        .arg(format!("{:.3}", request.duration.max(0.04)));
    command.args(encoder_args(request.encoder.as_deref()));
    command.args([
        "-pix_fmt",
        "yuv420p",
        "-r",
        &format!("{:.3}", if request.fps > 0.0 { request.fps } else { 30.0 }),
        "-fps_mode",
        "cfr",
    ]);
    if request.clips.iter().any(|clip| clip.has_audio) {
        command.args(["-c:a", "aac", "-b:a", "192k", "-ar", "48000"]);
    }
    command.args(["-movflags", "+faststart", "-progress", "pipe:1", "-nostats"]);
    command.arg(&output);
    command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let mut child = command.spawn().map_err(|e| {
        let _ = std::fs::remove_file(&script_path);
        format!("Could not start ffmpeg: {e}")
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or("Could not capture ffmpeg output")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("Could not capture ffmpeg errors")?;

    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        let mut text = String::new();
        let mut line = String::new();
        while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
            text.push_str(&line);
            line.clear();
        }
        text
    });

    let mut lines = BufReader::new(stdout).lines();
    let mut last_time = 0.0f64;
    let mut last_fps = 0.0f64;
    let mut last_speed = String::new();

    loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill().await;
            let _ = stderr_task.await;
            let _ = std::fs::remove_file(&output);
            let _ = std::fs::remove_file(&script_path);
            return Err("Export cancelled.".to_string());
        }

        let next = tokio::time::timeout(Duration::from_millis(200), lines.next_line()).await;
        match next {
            Ok(Ok(Some(line))) => {
                if let Some(value) = line.strip_prefix("out_time_us=") {
                    last_time = value.parse::<f64>().unwrap_or(0.0) / 1_000_000.0;
                } else if let Some(value) = line.strip_prefix("out_time_ms=") {
                    last_time = value.parse::<f64>().unwrap_or(0.0) / 1_000_000.0;
                } else if let Some(value) = line.strip_prefix("fps=") {
                    last_fps = value.parse::<f64>().unwrap_or(0.0);
                } else if let Some(value) = line.strip_prefix("speed=") {
                    last_speed = value.to_string();
                }
                let percent = if request.duration > 0.0 {
                    (last_time / request.duration * 100.0).clamp(0.0, 99.5)
                } else {
                    0.0
                };
                on_progress(ExportProgress {
                    percent,
                    time: last_time,
                    speed: last_speed.clone(),
                    fps: last_fps,
                });
            }
            Ok(Ok(None)) => break,
            Ok(Err(error)) => {
                let _ = std::fs::remove_file(&script_path);
                return Err(format!("Could not read ffmpeg output: {error}"));
            }
            Err(_) => continue,
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let stderr_text = stderr_task.await.unwrap_or_default();
    if !status.success() {
        let _ = std::fs::remove_file(&output);
        let _ = std::fs::remove_file(&script_path);
        return Err(format!("Export failed: {}", ffmpeg::tail(&stderr_text, 10)));
    }

    on_progress(ExportProgress {
        percent: 100.0,
        time: request.duration,
        speed: last_speed,
        fps: last_fps,
    });

    let _ = std::fs::remove_file(&script_path);
    Ok(ExportResult {
        output: output.to_string_lossy().to_string(),
        elapsed_ms: started.elapsed().as_millis(),
    })
}

async fn run_export(
    app: AppHandle,
    state: &ExportState,
    request: ExportRequest,
) -> Result<ExportResult, String> {
    let cache = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("librecut"));
    render_with_progress(&request, &cache, &state.cancel, &|progress| {
        let _ = app.emit("export-progress", progress);
    })
    .await
}

#[tauri::command]
pub async fn export_project(
    app: AppHandle,
    state: State<'_, ExportState>,
    request: ExportRequest,
) -> Result<ExportResult, String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("An export is already running.".to_string());
    }
    state.cancel.store(false, Ordering::SeqCst);
    let result = run_export(app, &state, request).await;
    state.running.store(false, Ordering::SeqCst);
    result
}

#[tauri::command]
pub fn cancel_export(state: State<'_, ExportState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[tauri::command]
pub fn is_exporting(state: State<'_, ExportState>) -> bool {
    state.running.load(Ordering::SeqCst)
}
