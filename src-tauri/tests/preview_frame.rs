//! Checks that the export-frame preview is the export renderer.
//!
//! A frame rendered by `render_frame` is compared with the same frame of a
//! full export. If the two ever drift apart, the preview stops being a
//! trustworthy check of the finished file.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use librecut_lib::export::{
    render_frame, render_with_progress, ExportClip, ExportEffect, ExportRequest, ExportSpeedPoint,
    ExportText, ExportTransition,
};
use librecut_lib::ffmpeg;

struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "librecut-preview-frame-{label}-{}",
            uuid::Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        Self(dir)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        if std::env::var("LIBRECUT_KEEP_TEMP").is_err() {
            let _ = std::fs::remove_dir_all(&self.0);
        } else {
            eprintln!("kept {}", self.0.display());
        }
    }
}

async fn ffmpeg_ready() -> bool {
    ffmpeg::command(&ffmpeg::ffmpeg_bin())
        .arg("-version")
        .output()
        .await
        .map(|output| output.status.success())
        .unwrap_or(false)
}

fn clip(path: &Path, start: f64, duration: f64) -> ExportClip {
    ExportClip {
        path: path.to_string_lossy().to_string(),
        track_id: Some("video-1".to_string()),
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
        width: 320,
        height: 240,
        fps: 30.0,
        duration,
        clips,
        texts: Vec::new(),
        effects: Vec::new(),
        encoder: Some("libx264".to_string()),
        // Use the highest quality available so the comparison measures the
        // graphs, not x264's quantiser.
        quality: Some("high".to_string()),
    }
}

async fn make_video(dir: &Path) -> PathBuf {
    let output_path = dir.join("source.mp4");
    let output = ffmpeg::command(&ffmpeg::ffmpeg_bin())
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "testsrc2=size=320x240:rate=30",
            "-t",
            "6",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
        ])
        .arg(&output_path)
        .output()
        .await
        .expect("run ffmpeg");
    assert!(
        output.status.success(),
        "could not generate source media: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output_path
}

/// Mean PSNR between two frames, or a low value when the comparison fails.
async fn psnr(first: &Path, second: &Path) -> f64 {
    let output = ffmpeg::command(&ffmpeg::ffmpeg_bin())
        .args(["-v", "info", "-i"])
        .arg(first)
        .arg("-i")
        .arg(second)
        .args(["-lavfi", "psnr", "-f", "null", "-"])
        .output()
        .await
        .expect("run psnr");
    let text = String::from_utf8_lossy(&output.stderr);
    let marker = "average:";
    let Some(index) = text.rfind(marker) else {
        return 0.0;
    };
    text[index + marker.len()..]
        .split_whitespace()
        .next()
        .and_then(|value| value.parse::<f64>().ok())
        .unwrap_or(0.0)
}

async fn compare_frames(
    request: &ExportRequest,
    output: &Path,
    times: &[f64],
    temp: &Path,
    label: &str,
) {
    for time in times {
        let time = *time;
        let exported = temp.join(format!("exported-{label}-{time}.png"));
        let extracted = ffmpeg::command(&ffmpeg::ffmpeg_bin())
            .args(["-v", "error", "-y", "-ss", &format!("{time:.3}"), "-i"])
            .arg(output)
            .args(["-frames:v", "1"])
            .arg(&exported)
            .output()
            .await
            .expect("extract a frame");
        assert!(
            extracted.status.success(),
            "could not extract the export frame: {}",
            String::from_utf8_lossy(&extracted.stderr)
        );

        let frame = render_frame(request, time, temp)
            .await
            .expect("render the preview frame");
        let preview = temp.join(format!("preview-{label}-{time}.png"));
        std::fs::write(&preview, &frame.png).expect("write the preview frame");

        let score = psnr(&exported, &preview).await;
        assert!(
            score > 30.0,
            "the preview frame at {time}s should match the export (PSNR {score:.2})"
        );
    }
}

#[tokio::test]
async fn a_preview_frame_matches_the_full_export() {
    if !ffmpeg_ready().await {
        eprintln!("Skipping preview frame test: ffmpeg was not found.");
        return;
    }
    let temp = TempDir::new("compare");
    let source = make_video(temp.path()).await;
    let output = temp.path().join("export.mp4");

    let first = clip(&source, 0.0, 2.0);
    let mut second = clip(&source, 2.0, 2.0);
    second.trim_in = 1.0;
    second.transition_in = ExportTransition {
        transition_type: "wiperight".to_string(),
        duration: 0.5,
    };
    let mut req = request(vec![first, second], 4.0);
    req.output = output.to_string_lossy().to_string();
    let cancel = AtomicBool::new(false);
    render_with_progress(&req, temp.path(), &cancel, &|_progress| {})
        .await
        .expect("render the full export");

    // Frame-aligned times: 2.3s is frame 69, inside the 2.0-2.5s transition.
    compare_frames(&req, &output, &[1.0, 2.3, 3.0], temp.path(), "plain").await;
}

#[tokio::test]
async fn a_preview_frame_matches_speed_text_effects_and_exotic_transitions() {
    if !ffmpeg_ready().await {
        eprintln!("Skipping preview frame test: ffmpeg was not found.");
        return;
    }
    let temp = TempDir::new("compare-rich");
    let source = make_video(temp.path()).await;
    let output = temp.path().join("export.mp4");

    let mut first = clip(&source, 0.0, 2.0);
    // A ramp exercises the path that keeps the original clip timing instead of
    // seeking to a short tail.
    first.speed_ramp = vec![
        ExportSpeedPoint {
            time: 0.0,
            speed: 1.0,
        },
        ExportSpeedPoint {
            time: 2.0,
            speed: 2.0,
        },
    ];
    let mut second = clip(&source, 2.0, 2.0);
    second.trim_in = 1.0;
    second.transition_in = ExportTransition {
        transition_type: "wiperight".to_string(),
        duration: 0.5,
    };

    let mut req = request(vec![first, second], 4.0);
    req.texts.push(ExportText {
        text: "LibreCut\nRésumé".to_string(),
        start: 0.4,
        duration: 3.0,
        x: 0.5,
        y: 0.35,
        size: 28.0,
        color: "#f5f5f5".to_string(),
        font_weight: Some("bold".to_string()),
        italic: false,
        font_family: None,
        align: Some("center".to_string()),
        underline: true,
        character_spacing: 0.5,
        line_height: 1.25,
        outline_color: Some("#000000".to_string()),
        outline_width: 1.5,
        background_color: Some("#000000".to_string()),
        background_opacity: 0.25,
        brightness: 1.0,
        shadow: 0.3,
        shadow_color: Some("#000000".to_string()),
        curve: 0.0,
        rotation: 0.0,
        opacity: 1.0,
        keyframes: Vec::new(),
        transition_in: ExportTransition::default(),
        transition_out: ExportTransition::default(),
    });
    req.effects.push(ExportEffect {
        start: 0.2,
        duration: 3.5,
        opacity: 0.9,
        brightness: 0.05,
        contrast: 1.1,
        saturation: 1.2,
        hue: 10.0,
        sepia: 0.2,
        blur: 1.0,
        vignette: 0.3,
        motion_blur: 0.0,
        fade_in: 0.0,
        fade_out: 0.0,
        mask: "none".to_string(),
        mask_x: 0.5,
        mask_y: 0.5,
        mask_size: 0.6,
        lut: None,
    });
    req.output = output.to_string_lossy().to_string();
    let cancel = AtomicBool::new(false);
    render_with_progress(&req, temp.path(), &cancel, &|_progress| {})
        .await
        .expect("render the full export");

    // 1.2s is inside the ramped clip, 2.35s inside the transition, and 3.2s
    // sits in the incoming clip with text and the effect still running.
    compare_frames(&req, &output, &[1.2, 2.35, 3.2], temp.path(), "rich").await;
}
