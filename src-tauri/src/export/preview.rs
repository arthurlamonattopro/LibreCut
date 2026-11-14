//! Export-accurate single-frame previews.
//!
//! The live preview is a canvas compositor. That keeps scrubbing fast, but it
//! is a second renderer: scaling, colour processing, font rasterisation, and
//! the `xfade` transitions can all look slightly different from the export.
//!
//! This module renders one frame through the **same** filter graph the export
//! uses. It trims the request down to a short window around the requested
//! frame, seeks each input close to that window, and runs FFmpeg for a single
//! PNG. The result is pixel-for-pixel the export renderer, at the project's
//! native size (including 4K).

use std::path::Path;

use super::filters::{normalize_speed_ramp, speed_source_offset};
use super::graph::build_graph;
use super::model::*;
use super::render::{prepare_lut_files, LutFileCleanup};
use super::transitions::plan_transitions;
use crate::ffmpeg;

/// A rendered preview frame.
pub struct PreviewFrame {
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// The timeline time the frame was rendered for.
    pub time: f64,
}

/// Renders the export frame at `time`.
///
/// `request` is the same request the export dialog builds. The frame is
/// produced by the export graph, so it is identical to the corresponding
/// frame of a full render.
pub async fn render_frame(
    request: &ExportRequest,
    time: f64,
    work_dir: &Path,
) -> Result<PreviewFrame, String> {
    if request.clips.is_empty() {
        return Err("There is nothing to preview.".to_string());
    }
    let (prepared, lut_files) = prepare_lut_files(request, work_dir)?;
    let _lut_cleanup = LutFileCleanup(lut_files);

    let (frame_request, local_time, seeks) = frame_request(&prepared, time);
    let graph = build_graph(&frame_request);
    let script_path = ffmpeg::unique_file(&work_dir.join("previews"), "filter");
    std::fs::write(&script_path, &graph)
        .map_err(|error| format!("Could not prepare the preview frame: {error}"))?;

    let result = run_frame(&frame_request, &seeks, local_time, &script_path).await;
    let _ = std::fs::remove_file(&script_path);
    let mut frame = result?;
    frame.time = time;
    Ok(frame)
}

async fn run_frame(
    request: &ExportRequest,
    seeks: &[f64],
    local_time: f64,
    script_path: &Path,
) -> Result<PreviewFrame, String> {
    let mut command = ffmpeg::command(&ffmpeg::ffmpeg_bin());
    for (index, clip) in request.clips.iter().enumerate() {
        if clip.is_image {
            command.args(["-loop", "1"]);
        } else if seeks.get(index).copied().unwrap_or(0.0) > 0.0005 {
            // The graph starts its trim at zero; the time to skip in the source
            // is passed to the input instead, so FFmpeg can seek without
            // decoding everything before the frame.
            command.arg("-ss").arg(format!("{:.6}", seeks[index]));
        }
        command.arg("-i").arg(&clip.path);
    }
    command.arg("-/filter_complex").arg(script_path);
    command.args(["-map", "[vout]"]);
    command.arg("-an");
    // The graph starts at the beginning of the window. Seeking the filtered
    // output keeps the exact graph intact while discarding the short run-up.
    if local_time > 0.0005 {
        command.arg("-ss").arg(format!("{:.6}", local_time));
    }
    command.args([
        "-frames:v",
        "1",
        "-f",
        "image2pipe",
        "-vcodec",
        "png",
        "pipe:1",
    ]);
    command
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    let output = command
        .output()
        .await
        .map_err(|error| format!("Could not run ffmpeg: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "Could not render the preview frame: {}",
            ffmpeg::tail(&String::from_utf8_lossy(&output.stderr), 8)
        ));
    }
    if output.stdout.is_empty() {
        return Err("The preview frame was empty.".to_string());
    }
    Ok(PreviewFrame {
        png: output.stdout,
        width: request.width,
        height: request.height,
        time: local_time,
    })
}

/// Trims a full export request down to the frames needed for one frame.
///
/// The returned request is evaluated from local time zero; the second value is
/// the time inside that window that should be captured.
fn frame_request(request: &ExportRequest, time: f64) -> (ExportRequest, f64, Vec<f64>) {
    let fps = if request.fps > 0.0 { request.fps } else { 30.0 };
    let frame = 1.0 / fps;
    let time = time.clamp(0.0, request.duration.max(0.0));
    let plan = plan_transitions(request);

    // A transition stream only starts at its cut. To render a frame inside the
    // transition we have to start the graph at the beginning of the cut. In an
    // effect with motion blur, the preceding frames also contribute.
    let mut window_start = time;
    for cut in plan.incoming.values() {
        if time >= cut.start - 1e-6 && time < cut.start + cut.duration + 1e-6 {
            window_start = window_start.min(cut.start);
        }
    }
    if request
        .effects
        .iter()
        .any(|effect| active(effect.start, effect.duration, time) && effect.motion_blur > 0.001)
    {
        window_start = window_start.min((time - 0.25).max(0.0));
    }
    let window_start = window_start.max(0.0);
    let local_time = (time - window_start).max(0.0);

    let mut clips = Vec::new();
    let mut seeks = Vec::new();
    let mut kept = Vec::new();
    for (index, clip) in request.clips.iter().enumerate() {
        if !clip.has_video && !clip.is_image {
            continue;
        }
        let outgoing = plan.incoming.values().find(|cut| {
            cut.from == index && time >= cut.start - 1e-6 && time < cut.start + cut.duration + 1e-6
        });
        let visible = active(clip.start, clip.duration, time);
        if !visible && outgoing.is_none() {
            continue;
        }

        let mut next = clip.clone();
        next.has_audio = false;
        let mut seek = 0.0;

        if outgoing.is_some() {
            // The clip that goes away is held on its last frame during the
            // transition. A constant-speed clip only needs a short tail around
            // that frame; a speed ramp is kept in full because the ramp points
            // are anchored to the start of the clip and shortening it would
            // change the curve.
            let ramped = normalize_speed_ramp(&clip.speed_ramp, clip.duration).len() >= 2;
            let source_length = source_end(clip);
            if ramped || clip.is_image || source_length <= 0.1 {
                next.start = clip.start - window_start;
            } else {
                let speed = clip.speed.clamp(0.25, 4.0);
                // A tenth of a second of source covers a few source frames at
                // any common frame rate. In timeline seconds it is shorter
                // when the clip is sped up and longer when it is slowed down.
                let source_window = 0.1;
                // The filter graph writes timings with millisecond precision.
                // The guard has to be larger than that rounding, or the frame
                // at the clip end slips into the tail and the transition holds
                // a different frame than the export.
                let margin = 0.002;
                let keep = ((source_window - margin) / speed).max(0.001);
                seek = (clip.trim_in.max(0.0) + source_length - source_window).max(0.0);
                next.start = -keep;
                next.duration = keep;
                next.trim_in = 0.0;
                next.keyframes = slice_keyframes(&clip.keyframes, (clip.duration - keep).max(0.0));
            }
        } else if clip.start < window_start {
            let elapsed = window_start - clip.start;
            if normalize_speed_ramp(&clip.speed_ramp, clip.duration).len() >= 2 {
                // A piecewise speed ramp is sampled in the graph. Keeping the
                // original timing makes the preview exactly match the export,
                // and the run-up to the playhead is the price for that.
                next.start = clip.start - window_start;
                next.duration = clip.duration;
                next.trim_in = clip.trim_in.max(0.0);
            } else {
                let speed = clip.speed.clamp(0.25, 4.0);
                next.start = 0.0;
                next.duration = (clip.start + clip.duration - window_start).max(0.04);
                seek = clip.trim_in.max(0.0) + elapsed * speed;
                next.trim_in = 0.0;
                next.keyframes = slice_keyframes(&clip.keyframes, elapsed);
            }
        } else {
            next.start = clip.start - window_start;
            next.duration = clip.duration;
            seek = clip.trim_in.max(0.0);
            next.trim_in = 0.0;
        }
        clips.push(next);
        seeks.push(seek);
        kept.push(index);
    }

    // A transition only exists between two neighbouring clips. When the other
    // half of a cut is not part of this window, the graph must not fall back to
    // fading the clip against the background: the export renders that edge
    // with `xfade` (or has already passed it), never as an edge fade.
    for (position, index) in kept.iter().enumerate() {
        if let Some(cut) = plan.incoming.get(index) {
            if !kept.contains(&cut.from) {
                clips[position].transition_in = ExportTransition::default();
            }
        }
        if let Some(cut) = plan.outgoing.get(index) {
            if !kept.contains(&cut.to) {
                clips[position].transition_out = ExportTransition::default();
            }
        }
    }

    let mut texts = Vec::new();
    for text in &request.texts {
        if !active(text.start, text.duration, time) {
            continue;
        }
        let mut next = text.clone();
        // Text timing is already relative to the shifted window, so keyframes
        // stay untouched.
        next.start -= window_start;
        texts.push(next);
    }

    let mut effects = Vec::new();
    for effect in &request.effects {
        if !active(effect.start, effect.duration, time) {
            continue;
        }
        let mut next = effect.clone();
        next.start -= window_start;
        effects.push(next);
    }

    (
        ExportRequest {
            output: String::new(),
            width: request.width,
            height: request.height,
            fps,
            // One frame is enough, but a little slack lets effects settle.
            duration: local_time + frame * 2.0,
            clips,
            texts,
            effects,
            encoder: None,
            quality: None,
            audio_codec: None,
            audio_bitrate: None,
            audio_sample_rate: None,
        },
        local_time,
        seeks,
    )
}

fn active(start: f64, duration: f64, time: f64) -> bool {
    time >= start - 1e-6 && time < start + duration.max(0.04) - 1e-6
}

/// The source position at the end of a clip, in seconds.
fn source_end(clip: &ExportClip) -> f64 {
    if clip.is_image {
        return 0.0;
    }
    let ramp = normalize_speed_ramp(&clip.speed_ramp, clip.duration);
    if ramp.len() >= 2 {
        speed_source_offset(&ramp, clip.duration)
    } else {
        clip.duration * clip.speed.clamp(0.25, 4.0)
    }
}

/// Moves a keyframe animation forward by `offset` seconds.
///
/// A keyframe curve is linear between its points. Inserting the interpolated
/// value at time zero and shifting the remaining points preserves that curve
/// exactly, which keeps animated transforms in step with the export.
fn slice_keyframes(frames: &[ExportKeyframe], offset: f64) -> Vec<ExportKeyframe> {
    if frames.is_empty() || offset <= 1e-6 {
        return frames.to_vec();
    }
    let mut properties: Vec<&str> = frames.iter().map(|frame| frame.property.as_str()).collect();
    properties.sort_unstable();
    properties.dedup();

    let mut result = Vec::new();
    for property in properties {
        let mut points: Vec<&ExportKeyframe> = frames
            .iter()
            .filter(|frame| frame.property == property && frame.time.is_finite())
            .collect();
        points.sort_by(|a, b| a.time.total_cmp(&b.time));
        if points.is_empty() {
            continue;
        }
        let value_at = |at: f64| -> f64 {
            if at <= points[0].time {
                return points[0].value;
            }
            for pair in points.windows(2) {
                let (from, to) = (pair[0], pair[1]);
                if at <= to.time {
                    let span = (to.time - from.time).max(1e-6);
                    return from.value + (to.value - from.value) * ((at - from.time) / span);
                }
            }
            points.last().map(|point| point.value).unwrap_or(0.0)
        };
        result.push(ExportKeyframe {
            property: property.to_string(),
            time: 0.0,
            value: value_at(offset),
        });
        for point in points {
            if point.time > offset + 1e-6 {
                result.push(ExportKeyframe {
                    property: property.to_string(),
                    time: point.time - offset,
                    value: point.value,
                });
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(path: &str, start: f64, duration: f64) -> ExportClip {
        ExportClip {
            path: path.to_string(),
            track_id: Some("track".to_string()),
            start,
            duration,
            trim_in: 0.0,
            speed: 1.0,
            speed_ramp: Vec::new(),
            volume: 1.0,
            opacity: 1.0,
            has_audio: false,
            has_video: true,
            is_image: false,
            fit: Some("contain".to_string()),
            x: 0.0,
            y: 0.0,
            scale: 1.0,
            rotation: 0.0,
            mask: Some("none".to_string()),
            mask_x: 0.5,
            mask_y: 0.5,
            mask_width: 0.6,
            mask_height: 0.6,
            mask_rotation: 0.0,
            mask_points: Vec::new(),
            chroma_key: None,
            fade_in: 0.0,
            fade_out: 0.0,
            pitch: 0.0,
            bass: 0.0,
            treble: 0.0,
            mid: 0.0,
            bass_frequency: 180.0,
            mid_frequency: 1000.0,
            mid_width: 1.0,
            treble_frequency: 4000.0,
            pan: 0.0,
            compressor: None,
            duck_segments: Vec::new(),
            keyframes: Vec::new(),
            transition_in: ExportTransition::default(),
            transition_out: ExportTransition::default(),
        }
    }

    fn request(clips: Vec<ExportClip>, duration: f64) -> ExportRequest {
        ExportRequest {
            output: String::new(),
            width: 1920,
            height: 1080,
            fps: 30.0,
            duration,
            clips,
            texts: Vec::new(),
            effects: Vec::new(),
            encoder: None,
            quality: None,
            audio_codec: None,
            audio_bitrate: None,
            audio_sample_rate: None,
        }
    }

    #[test]
    fn a_frame_inside_a_clip_becomes_a_one_frame_window() {
        let mut source = clip("a.mp4", 0.0, 4.0);
        source.trim_in = 2.0;
        let (window, local, seeks) = frame_request(&request(vec![source], 4.0), 1.0);

        assert_eq!(local, 0.0);
        assert_eq!(window.clips.len(), 1);
        assert_eq!(window.clips[0].start, 0.0);
        assert_eq!(window.clips[0].trim_in, 0.0);
        assert!((seeks[0] - 3.0).abs() < 1e-9);
        assert!((window.clips[0].duration - 3.0).abs() < 1e-9);
        assert!(!window.clips[0].has_audio);
    }

    #[test]
    fn a_frame_inside_a_transition_starts_at_the_cut() {
        let first = clip("a.mp4", 0.0, 2.0);
        let mut second = clip("b.mp4", 2.0, 2.0);
        second.transition_in = ExportTransition {
            transition_type: "wiperight".to_string(),
            duration: 0.5,
        };
        let (window, local, _seeks) = frame_request(&request(vec![first, second], 4.0), 2.25);

        assert!((local - 0.25).abs() < 1e-9);
        assert_eq!(window.clips.len(), 2);
        // The outgoing clip only keeps a short tail around its last frame.
        assert!(window.clips[0].start < 0.0);
        assert!(window.clips[0].duration <= 0.1 + 1e-9);
        // The incoming clip starts at the cut and has its full remaining run.
        assert!((window.clips[1].start - 0.0).abs() < 1e-9);
        assert!((window.clips[1].duration - 2.0).abs() < 1e-9);
        assert!(build_graph(&window).contains("xfade=transition=wiperight"));
    }

    #[test]
    fn a_frame_outside_a_transition_only_keeps_the_visible_clip() {
        let first = clip("a.mp4", 0.0, 2.0);
        let mut second = clip("b.mp4", 2.0, 2.0);
        second.transition_in = ExportTransition {
            transition_type: "wiperight".to_string(),
            duration: 0.5,
        };
        let (window, local, _seeks) = frame_request(&request(vec![first, second], 4.0), 3.0);

        assert_eq!(local, 0.0);
        assert_eq!(window.clips.len(), 1);
        assert_eq!(window.clips[0].path, "b.mp4");
        // The clip that hands over is not in the window, so the edge must not
        // turn into a fade against the background.
        assert!(window.clips[0].transition_in.transition_type.is_empty());
    }

    #[test]
    fn keyframes_are_sliced_at_the_window() {
        let frames = vec![
            ExportKeyframe {
                property: "x".to_string(),
                time: 0.0,
                value: 0.0,
            },
            ExportKeyframe {
                property: "x".to_string(),
                time: 2.0,
                value: 1.0,
            },
            ExportKeyframe {
                property: "x".to_string(),
                time: 4.0,
                value: 0.0,
            },
        ];
        let sliced = slice_keyframes(&frames, 1.0);

        assert_eq!(sliced.len(), 3);
        assert!((sliced[0].value - 0.5).abs() < 1e-9);
        assert_eq!(sliced[0].time, 0.0);
        assert!((sliced[1].time - 1.0).abs() < 1e-9);
        assert!((sliced[1].value - 1.0).abs() < 1e-9);
        assert!((sliced[2].time - 3.0).abs() < 1e-9);
    }

    #[test]
    fn text_and_effects_keep_their_relative_time() {
        let mut req = request(vec![clip("a.mp4", 0.0, 4.0)], 4.0);
        req.texts.push(ExportText {
            text: "Hello".to_string(),
            start: 0.5,
            duration: 2.0,
            x: 0.5,
            y: 0.5,
            size: 40.0,
            color: "#ffffff".to_string(),
            font_weight: None,
            italic: false,
            font_family: None,
            align: None,
            underline: false,
            character_spacing: 0.0,
            line_height: 1.2,
            outline_color: None,
            outline_width: 0.0,
            background_color: None,
            background_opacity: 0.0,
            brightness: 1.0,
            shadow: 0.0,
            shadow_color: None,
            curve: 0.0,
            rotation: 0.0,
            opacity: 1.0,
            keyframes: Vec::new(),
            transition_in: ExportTransition::default(),
            transition_out: ExportTransition::default(),
        });

        let (window, _, _) = frame_request(&req, 1.0);
        assert_eq!(window.texts.len(), 1);
        assert!((window.texts[0].start - (-0.5)).abs() < 1e-9);
    }
}
