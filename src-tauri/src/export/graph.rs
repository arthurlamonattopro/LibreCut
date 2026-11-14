use std::collections::HashMap;

use super::filters::*;
use super::model::*;
use super::transitions::*;

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
    let plan = plan_transitions(request);
    // The label of the chain of every clip, and the extra labels a clip needs
    // when it feeds a transition.
    let mut overlay_labels: HashMap<usize, String> = HashMap::new();
    let mut hold_labels: HashMap<usize, String> = HashMap::new();
    let mut head_labels: HashMap<usize, String> = HashMap::new();
    let mut positions: HashMap<usize, (String, String)> = HashMap::new();
    let mut chain_ends: HashMap<usize, f64> = HashMap::new();

    // First the chain of every clip that carries video.
    for (index, clip) in request.clips.iter().enumerate() {
        if !clip.has_video && !clip.is_image {
            continue;
        }
        // A preview window can start in the middle of a clip. The clip then
        // keeps its original timing, which puts its start before the window;
        // a normal export never has a negative start.
        let start = clip.start;
        let clip_duration = clip.duration.max(0.04);
        let speed = if clip.is_image {
            1.0
        } else {
            clip.speed.clamp(0.25, 4.0)
        };
        let speed_ramp = if clip.is_image {
            Vec::new()
        } else {
            normalize_speed_ramp(&clip.speed_ramp, clip_duration)
        };
        let ramped = speed_ramp.len() >= 2;
        let source_duration = if ramped {
            speed_source_offset(&speed_ramp, clip_duration)
        } else {
            clip_duration * speed
        };
        let trim = clip.trim_in.max(0.0);
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
        } else if !ramped {
            format!(
                "trim=start={trim:.3}:duration={source_duration:.3},setpts=(PTS-STARTPTS)/{speed:.4}+{start:.3}/TB"
            )
        } else {
            let expr = speed_setpts_expr(&speed_ramp);
            format!(
                "trim=start={trim:.3}:duration={source_duration:.3},setpts={}",
                quoted(&format!("({expr})/TB+{start:.3}/TB"))
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
        let mask = clip_mask_filter(clip);
        let opacity_expr = keyframe_expr(
            &clip.keyframes,
            "opacity",
            clip.opacity,
            &format!("(T-{start:.6})"),
        );
        // A transition that belongs to a cut is rendered by the `xfade`
        // filter, so the clip keeps its opacity on that edge.
        let fade_in = if plan.incoming.contains_key(&index) {
            "1".to_string()
        } else {
            transition_fade_expr(&clip.transition_in, "in", start, clip_duration)
        };
        let fade_out = if plan.outgoing.contains_key(&index) {
            "1".to_string()
        } else {
            transition_fade_expr(&clip.transition_out, "out", start, clip_duration)
        };
        let alpha = format!(
            "({:.4})*({opacity_expr})*({fade_in})*({fade_out})",
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
        lines.push(format!("[{index}:v]{timing},{scaling}{scale_filter},setsar=1,fps={fps},format=rgba{chroma}{mask}{rotate},geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*({alpha})'[vchain{index}]"));

        let x_expr = keyframe_expr(&clip.keyframes, "x", clip.x, &local_t);
        let y_expr = keyframe_expr(&clip.keyframes, "y", clip.y, &local_t);
        positions.insert(index, (x_expr, y_expr));
        // The chain only holds as much material as the source has. A source
        // that is shorter than the clip ends the chain early.
        let chain_end = if ramped {
            start + clip_duration
        } else {
            start + source_duration / speed
        };
        chain_ends.insert(index, chain_end);

        // A clip feeds its own overlay and, when it takes part in a
        // transition, the transition stream as well.
        let holds = plan.outgoing.contains_key(&index);
        let heads = plan.incoming.contains_key(&index);
        let outputs = 1 + usize::from(holds) + usize::from(heads);
        if outputs > 1 {
            let labels: Vec<String> = (0..outputs)
                .map(|slot| format!("v{index}s{slot}"))
                .collect();
            lines.push(format!(
                "[vchain{index}]split={outputs}{}",
                labels
                    .iter()
                    .map(|label| format!("[{label}]"))
                    .collect::<String>()
            ));
            overlay_labels.insert(index, labels[0].clone());
            if holds {
                hold_labels.insert(index, labels[1].clone());
            }
            if heads {
                head_labels.insert(index, labels[labels.len() - 1].clone());
            }
        } else {
            overlay_labels.insert(index, format!("vchain{index}"));
        }
    }

    // Then the transitions. Each one blends the last frame of the clip that
    // goes away with the head of the clip that comes in.
    for (to, cut) in &plan.incoming {
        let Some(hold) = hold_labels.get(&cut.from) else {
            continue;
        };
        let Some(head) = head_labels.get(to) else {
            continue;
        };
        let previous = &request.clips[cut.from];
        let next = &request.clips[*to];
        // The clip that goes away is held on its last frame. A source that
        // ends before the clip does leaves less to hold on to.
        let hold_start = chain_ends
            .get(&cut.from)
            .copied()
            .unwrap_or(previous.start + previous.duration)
            .min(previous.start + previous.duration);
        lines.push(format!(
            "[{hold}]tpad=stop_mode=clone:stop_duration={:.3},trim=start={:.3}:duration={:.3},setpts=PTS-STARTPTS[hold{to}]",
            cut.duration, hold_start, cut.duration
        ));
        lines.push(format!(
            "[{head}]trim=start={:.3}:duration={:.3},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={:.3}[head{to}]",
            next.start, cut.duration, cut.duration
        ));
        lines.push(format!(
            "[hold{to}][head{to}]xfade=transition={}:duration={:.3}:offset=0[xf{to}]",
            cut.transition, cut.duration
        ));
        lines.push(format!("[xf{to}]setpts=PTS+{:.3}/TB[xfp{to}]", cut.start));
    }

    // And finally the compositing of every clip onto the canvas.
    for (index, clip) in request.clips.iter().enumerate() {
        if !clip.has_video && !clip.is_image {
            continue;
        }
        // Start times may be negative while a single export frame is
        // previewed: the graph is then evaluated from a window that begins
        // before the frame, so transitions have their full history. A normal
        // export never has a negative start.
        let start = clip.start;
        let end = start + clip.duration.max(0.04);
        let Some(label) = overlay_labels.get(&index) else {
            continue;
        };
        // While a transition runs, the transition stream takes the place of
        // the incoming clip.
        let overlay_start = match plan.incoming.get(&index) {
            Some(cut) => cut.start + cut.duration,
            None => start,
        };
        let (x_expr, y_expr) = positions
            .get(&index)
            .cloned()
            .unwrap_or_else(|| ("0".to_string(), "0".to_string()));
        lines.push(format!(
            "[{base}][{label}]overlay=x={}:y={}:eof_action=pass:enable='between(t,{overlay_start:.3},{end:.3})'[bg{index}]",
            quoted(&format!("(W-w)/2+W*({x_expr})")),
            quoted(&format!("(H-h)/2+H*({y_expr})")),
        ));
        base = format!("bg{index}");

        if let Some(cut) = plan.outgoing.get(&index) {
            let (x_expr, y_expr) = positions
                .get(&cut.to)
                .cloned()
                .unwrap_or_else(|| ("0".to_string(), "0".to_string()));
            lines.push(format!(
                "[{base}][xfp{}]overlay=x={}:y={}:eof_action=pass:enable='between(t,{:.3},{:.3})'[bgx{}]",
                cut.to,
                quoted(&format!("(W-w)/2+W*({x_expr})")),
                quoted(&format!("(H-h)/2+H*({y_expr})")),
                cut.start,
                cut.start + cut.duration,
                cut.to
            ));
            base = format!("bgx{}", cut.to);
        }
    }

    for (index, effect) in request.effects.iter().enumerate() {
        let start = effect.start;
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
        let lut_filter = effect
            .lut
            .as_ref()
            .and_then(|lut| lut.lut_path.as_deref())
            .map(|path| {
                let path = path
                    .replace('\\', "/")
                    .replace(':', "\\:")
                    .replace('\'', "\\'");
                format!(",lut3d=file='{path}':interp=tetrahedral")
            })
            .unwrap_or_default();
        let effect_strength = effect
            .lut
            .as_ref()
            .map(|lut| lut.strength.clamp(0.0, 1.0))
            .unwrap_or(1.0);
        let combined_alpha = format!("({alpha})*{effect_strength:.3}");
        lines.push(format!("[{from}]eq=brightness={:.4}:contrast={:.4}:saturation={:.4},hue=h={:.3},colorchannelmixer=rr={rr:.4}:rg={rg:.4}:rb={rb:.4}:gr={gr:.4}:gg={gg:.4}:gb={gb:.4}:br={br:.4}:bg={bg:.4}:bb={bb:.4}{blur}{vignette}{motion_blur}{lut_filter},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*({combined_alpha})'{mask}[{filtered}]",
            effect.brightness.clamp(-1.0, 1.0), effect.contrast.clamp(0.0, 2.0), effect.saturation.clamp(0.0, 2.0), effect.hue.clamp(-180.0, 180.0)));
        lines.push(format!("[{original}][{filtered}]overlay=0:0:eof_action=pass:enable='between(t,{start:.3},{end:.3})'[{output}]"));
        base = output;
    }

    for (index, text) in request.texts.iter().enumerate() {
        let start = text.start;
        let end = (text.start + text.duration.max(0.04)).max(start + 0.04);
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
            if transition_enabled(&text.transition_in) && text.transition_in.duration > 0.0 {
                let d = text.transition_in.duration.min(text.duration).max(0.001);
                format!("if(lt({local_t},{d:.6}),max(0,{local_t}/{d:.6}),1)")
            } else {
                "1".to_string()
            };
        let text_fade_out =
            if transition_enabled(&text.transition_out) && text.transition_out.duration > 0.0 {
                let d = text.transition_out.duration.min(text.duration).max(0.001);
                format!(
                    "if(gt({local_t},{:.6}),max(0,({:.6}-{local_t})/{d:.6}),1)",
                    text.duration - d,
                    text.duration
                )
            } else {
                "1".to_string()
            };
        let font = font_file(
            text.font_weight.as_deref(),
            text.font_family.as_deref(),
            text.italic,
        );
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
        let shadow_color = text.shadow_color.as_deref().unwrap_or("#000000");
        let line_height = text.line_height.clamp(0.8, 3.0);
        let line_spacing = ((line_height - 1.0) * size).max(0.0);
        let text_lines: Vec<&str> = text.text.split('\n').collect();
        let line_count = text_lines.len() as f64;
        let widest = text_lines
            .iter()
            .map(|line| line.chars().count() as f64)
            .fold(1.0, f64::max);
        let box_width = (widest * size * 0.6 + text.character_spacing * widest).max(size * 0.6);
        let box_height = line_count * size * line_height;
        let box_padding = size * 0.2;
        let common = format!("fontfile='{}':fontcolor={}:fontsize={}:borderw={:.2}:bordercolor={}:shadowcolor={}@{shadow:.3}:shadowx={:.2}:shadowy={:.2}:line_spacing={line_spacing:.2}:alpha='({opacity_expr})*({text_fade_in})*({text_fade_out})'",
            font, color, size, text.outline_width.max(0.0), drawtext_color(outline, 1.0), drawtext_color(shadow_color, 1.0), shadow * 3.0, shadow * 3.0);
        if text.background_opacity > 0.001 {
            let background =
                drawtext_color(text.background_color.as_deref().unwrap_or("#000000"), 1.0);
            let box_x = match align {
                "left" => format!("w*({x_expr})-{box_padding:.2}"),
                "right" => format!("w*({x_expr})-{box_width:.2}-{box_padding:.2}"),
                _ => format!("w*({x_expr})-{:.2}-{box_padding:.2}", box_width / 2.0),
            };
            let label = format!("txt{index}_bg");
            lines.push(format!("[{base}]drawbox=x={}:y={}:w={:.2}:h={:.2}:color={background}@{:.3}:t=fill:enable='between(t,{start:.3},{end:.3})'[{label}]",
                quoted(&box_x),
                quoted(&format!("h*({y_expr})-{:.2}", box_height / 2.0 + box_padding)),
                box_width + box_padding * 2.0,
                box_height + box_padding * 2.0,
                text.background_opacity.clamp(0.0, 1.0)));
            base = label;
        }
        if text.curve.abs() < 1.0
            && text.character_spacing.abs() < 0.01
            && text.rotation.abs() < 0.01
            && !rotation_animated
        {
            let label = format!("txt{index}");
            let dynamic_anchor = format!("w*({x_expr})");
            let dynamic_y = format!("h*({y_expr})-text_h/2");
            lines.push(format!("[{base}]drawtext={common}:text='{}':x={}:y={}:enable='between(t,{start:.3},{end:.3})'[{label}]",
                escape_text(&text.text),
                quoted(&format!("{dynamic_anchor}-{offset}")),
                quoted(&dynamic_y)));
            base = label;
        } else if text.text.contains('\n') {
            let anchor_x = format!("w*({x_expr})");
            for (line_index, line_text) in text_lines.iter().enumerate() {
                let line_y = format!(
                    "h*({y_expr})+{:.2}-text_h/2",
                    (line_index as f64 - (line_count - 1.0) / 2.0) * size * line_height
                );
                let label = format!("txt{index}_line{line_index}");
                lines.push(format!("[{base}]drawtext={common}:text='{}':x={}:y={}:enable='between(t,{start:.3},{end:.3})'[{label}]",
                    escape_text(line_text),
                    quoted(&format!("{anchor_x}-{offset}")),
                    quoted(&line_y)));
                base = label;
            }
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
                lines.push(format!("[{base}]drawtext={common}:text='{}':x={}:y={}:enable='between(t,{start:.3},{end:.3})'[{label}]",
                    escape_text(&ch.to_string()),
                    quoted(&format!("{world_x}-text_w/2")),
                    quoted(&format!("{world_y}-text_h/2"))));
                base = label;
                cursor += advance;
            }
        }
        if text.underline {
            for (line_index, line_text) in text_lines.iter().enumerate() {
                let count = line_text.chars().count() as f64;
                let underline_width =
                    (count * size * 0.6 + text.character_spacing * count).max(1.0);
                let anchor_x = format!("w*({x_expr})");
                let underline_x = match align {
                    "left" => anchor_x.to_string(),
                    "right" => format!("{anchor_x}-{underline_width:.2}"),
                    _ => format!("{anchor_x}-{:.2}", underline_width / 2.0),
                };
                let line_offset =
                    (line_index as f64 - (line_count - 1.0) / 2.0) * size * line_height;
                let label = format!("txt{index}_underline{line_index}");
                lines.push(format!("[{base}]drawbox=x={}:y={}:w={underline_width:.2}:h={:.2}:color={}@{:.3}:t=fill:enable='between(t,{start:.3},{end:.3})'[{label}]",
                    quoted(&underline_x),
                    quoted(&format!("h*({y_expr})+{:.2}", line_offset + size * 0.55)),
                    (size * 0.045).max(1.0), color, text.opacity.clamp(0.0, 1.0)));
                base = label;
            }
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
            let clip_duration = clip.duration.max(0.04);
            let ramp = normalize_speed_ramp(&clip.speed_ramp, clip_duration);
            let ramp_active = ramp.len() >= 2;
            let source_duration = if ramp_active {
                speed_source_offset(&ramp, clip_duration)
            } else {
                clip_duration * speed
            };
            // Every filter of the chain is a separate entry. The chain is
            // joined with commas, and a label is followed by the name of the
            // first filter — a comma right after a label would leave FFmpeg
            // with an empty filter.
            let mut chain: Vec<String> = Vec::new();
            // The head is the label the chain starts from. Both branches set
            // it, so it is left uninitialised until they do.
            let head;
            if ramp_active {
                let segments = speed_segments(&clip.speed_ramp, clip_duration);
                let count = segments.len();
                let split_labels: Vec<String> = (0..count)
                    .map(|segment| format!("sp{index}_{segment}"))
                    .collect();
                let split_outputs: Vec<String> = (0..count)
                    .map(|segment| format!("sp{index}_{segment}o"))
                    .collect();
                lines.push(format!(
                    "[{index}:a]asplit={count}{}",
                    split_labels
                        .iter()
                        .map(|label| format!("[{label}]"))
                        .collect::<String>()
                ));
                for (segment_index, segment) in segments.iter().enumerate() {
                    let tempo = atempo_filters(segment.speed);
                    let tempo_filter = if tempo.is_empty() {
                        String::new()
                    } else {
                        format!(",{tempo}")
                    };
                    lines.push(format!(
                        "[{}]atrim=start={:.3}:duration={:.3},asetpts=PTS-STARTPTS{}[{}]",
                        split_labels[segment_index],
                        clip.trim_in.max(0.0) + segment.source_start,
                        segment.source_duration,
                        tempo_filter,
                        split_outputs[segment_index]
                    ));
                }
                lines.push(format!(
                    "{}concat=n={count}:v=0:a=1[concat{index}]",
                    split_outputs
                        .iter()
                        .map(|label| format!("[{label}]"))
                        .collect::<String>()
                ));
                head = format!("[concat{index}]");
            } else {
                head = format!("[{index}:a]");
                chain.push(format!(
                    "atrim=start={:.3}:duration={source_duration:.3},asetpts=PTS-STARTPTS",
                    clip.trim_in.max(0.0)
                ));
            }
            let pitch_ratio = 2.0f64.powf(clip.pitch.clamp(-12.0, 12.0) / 12.0);
            if (pitch_ratio - 1.0).abs() > 0.001 {
                chain.push(format!("asetrate=48000*{pitch_ratio:.6}"));
                chain.push("aresample=48000".to_string());
                chain.push(format!("atempo={:.6}", 1.0 / pitch_ratio));
            }
            if !ramp_active {
                // A ramp changes the speed of every segment on its own.
                let tempo = atempo_filters(speed);
                if !tempo.is_empty() {
                    chain.push(tempo);
                }
            }
            chain.push("aresample=48000".to_string());
            chain.push(
                "aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo".to_string(),
            );
            if clip.bass.abs() > 0.01 {
                chain.push(format!(
                    "bass=g={:.2}:f={:.1}",
                    clip.bass.clamp(-12.0, 12.0),
                    clip.bass_frequency.clamp(20.0, 20000.0)
                ));
            }
            if clip.mid.abs() > 0.01 {
                chain.push(format!(
                    "equalizer=f={:.1}:t=o:w={:.3}:g={:.2}",
                    clip.mid_frequency.clamp(20.0, 20000.0),
                    clip.mid_width.clamp(0.1, 6.0),
                    clip.mid.clamp(-24.0, 24.0)
                ));
            }
            if clip.treble.abs() > 0.01 {
                chain.push(format!(
                    "treble=g={:.2}:f={:.1}",
                    clip.treble.clamp(-12.0, 12.0),
                    clip.treble_frequency.clamp(20.0, 20000.0)
                ));
            }
            if clip.pan.abs() > 0.001 {
                let (left, right) = pan_gains(clip.pan);
                chain.push(format!("pan=stereo|c0={left:.4}*c0|c1={right:.4}*c1"));
            }
            if let Some(compressor) = clip.compressor.as_ref() {
                if compressor.enabled {
                    let threshold = 10f64.powf(compressor.threshold.clamp(-60.0, 0.0) / 20.0);
                    chain.push(format!(
                        "acompressor=threshold={threshold:.6}:ratio={:.2}:attack={:.2}:release={:.2}:makeup=1",
                        compressor.ratio.clamp(1.0, 20.0),
                        compressor.attack.clamp(0.01, 2000.0),
                        compressor.release.clamp(0.01, 9000.0)
                    ));
                }
            }
            let fade_in = clip.fade_in.clamp(0.0, clip.duration.max(0.0));
            let fade_out = clip.fade_out.clamp(0.0, clip.duration.max(0.0));
            // A cut transition fades the audio of the clip that takes over and
            // fades the audio of the clip that goes away, which crossfades the
            // two in the mix.
            let cut_in = plan.incoming.get(index).map(|cut| cut.duration);
            let cut_out = plan.outgoing.get(index).map(|cut| cut.duration);
            let transition_in = match cut_in {
                Some(duration) => duration,
                None if transition_enabled(&clip.transition_in) => {
                    clip.transition_in.duration.min(clip.duration).max(0.0)
                }
                None => 0.0,
            };
            let transition_out = match cut_out {
                Some(duration) => duration,
                None if transition_enabled(&clip.transition_out) => {
                    clip.transition_out.duration.min(clip.duration).max(0.0)
                }
                None => 0.0,
            };
            let volume_expr = keyframe_expr(&clip.keyframes, "volume", clip.volume, "t");
            chain.push(format!("volume='{volume_expr}':eval=frame"));
            if fade_in > 0.0 {
                chain.push(format!("afade=t=in:st=0:d={fade_in:.3}"));
            }
            if fade_out > 0.0 {
                chain.push(format!(
                    "afade=t=out:st={:.3}:d={fade_out:.3}",
                    (clip.duration - fade_out).max(0.0)
                ));
            }
            if transition_in > 0.0 {
                chain.push(format!("afade=t=in:st=0:d={transition_in:.3}"));
            }
            if transition_out > 0.0 {
                if cut_out.is_some() {
                    // The clip runs on for the length of the transition so
                    // its audio can crossfade into the next clip.
                    chain.push(format!("apad=pad_dur={transition_out:.3}"));
                    chain.push(format!(
                        "afade=t=out:st={:.3}:d={transition_out:.3}",
                        clip.duration.max(0.0)
                    ));
                } else {
                    chain.push(format!(
                        "afade=t=out:st={:.3}:d={transition_out:.3}",
                        (clip.duration - transition_out).max(0.0)
                    ));
                }
            }
            chain.push(format!("adelay={start_ms}|{start_ms}"));
            if let Some(expr) = duck_volume_expr(&clip.duck_segments) {
                chain.push(format!("volume='{expr}':eval=frame"));
            }
            lines.push(format!("{}{}[a{index}]", head, chain.join(",")));
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
