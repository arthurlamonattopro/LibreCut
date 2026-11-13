use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use librecut_lib::export::{
    build_graph, render_with_progress, ExportClip, ExportCompressor, ExportDuckSegment,
    ExportEffect, ExportRequest, ExportSpeedPoint, ExportText, ExportTransition,
};
use librecut_lib::ffmpeg;
use librecut_lib::media;

struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "librecut-e2e-{label}-{}",
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
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

async fn ffmpeg_ready() -> bool {
    match ffmpeg::command(&ffmpeg::ffmpeg_bin())
        .arg("-version")
        .output()
        .await
    {
        Ok(output) => output.status.success(),
        Err(_) => false,
    }
}

async fn skip_without_ffmpeg() -> bool {
    if ffmpeg_ready().await {
        return false;
    }
    if std::env::var("LIBRECUT_REQUIRE_FFMPEG").as_deref() == Ok("1") {
        panic!(
            "FFmpeg is required for end-to-end tests. Run scripts/fetch-ffmpeg.ps1 or put ffmpeg on PATH."
        );
    }
    eprintln!("Skipping real-media test: ffmpeg/ffprobe were not found.");
    true
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
            "-f",
            "lavfi",
            "-i",
            "sine=frequency=440:sample_rate=48000",
            "-t",
            "2",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-pix_fmt",
            "yuv420p",
            "-c:a",
            "aac",
            "-b:a",
            "96k",
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

async fn make_image(dir: &Path) -> PathBuf {
    let output_path = dir.join("overlay.png");
    let output = ffmpeg::command(&ffmpeg::ffmpeg_bin())
        .args([
            "-v",
            "error",
            "-y",
            "-f",
            "lavfi",
            "-i",
            "color=c=0xff5500:s=320x240",
            "-frames:v",
            "1",
        ])
        .arg(&output_path)
        .output()
        .await
        .expect("run ffmpeg");
    assert!(
        output.status.success(),
        "could not generate image media: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    output_path
}

fn video_clip(path: &Path) -> ExportClip {
    ExportClip {
        path: path.to_string_lossy().to_string(),
        track_id: Some("video-1".to_string()),
        start: 0.0,
        duration: 2.0,
        trim_in: 0.0,
        speed: 1.0,
        speed_ramp: Vec::new(),
        volume: 1.0,
        opacity: 1.0,
        has_audio: true,
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

fn text_overlay() -> ExportText {
    ExportText {
        text: "LibreCut E2E".to_string(),
        start: 0.1,
        duration: 1.5,
        x: 0.5,
        y: 0.8,
        size: 28.0,
        color: "#ffffff".to_string(),
        font_weight: Some("bold".to_string()),
        italic: false,
        font_family: Some("Segoe UI".to_string()),
        align: Some("center".to_string()),
        underline: false,
        character_spacing: 0.0,
        line_height: 1.2,
        outline_color: Some("#000000".to_string()),
        outline_width: 1.0,
        background_color: Some("#000000".to_string()),
        background_opacity: 0.0,
        brightness: 1.0,
        shadow: 0.4,
        shadow_color: Some("#000000".to_string()),
        curve: 0.0,
        rotation: 0.0,
        opacity: 1.0,
        keyframes: Vec::new(),
        transition_in: ExportTransition::default(),
        transition_out: ExportTransition::default(),
    }
}

fn request(output: &Path, clips: Vec<ExportClip>, duration: f64) -> ExportRequest {
    ExportRequest {
        output: output.to_string_lossy().to_string(),
        width: 320,
        height: 240,
        fps: 30.0,
        duration,
        clips,
        texts: vec![text_overlay()],
        effects: vec![ExportEffect {
            start: 0.0,
            duration,
            opacity: 0.35,
            brightness: 0.05,
            contrast: 1.1,
            saturation: 1.15,
            hue: 0.0,
            sepia: 0.0,
            blur: 0.0,
            vignette: 0.0,
            motion_blur: 0.0,
            fade_in: 0.0,
            fade_out: 0.0,
            mask: "none".to_string(),
            mask_x: 0.5,
            mask_y: 0.5,
            mask_size: 0.5,
            lut: None,
        }],
        encoder: Some("libx264".to_string()),
        quality: Some("draft".to_string()),
    }
}

#[tokio::test]
async fn runtime_status_reports_usable_tools() {
    if skip_without_ffmpeg().await {
        return;
    }
    let status = ffmpeg::runtime_status().await;
    assert!(status.ready, "runtime status should be ready");
    assert!(status.ffmpeg.available);
    assert!(status.ffprobe.available);
    assert!(status
        .ffmpeg
        .version
        .as_deref()
        .unwrap_or_default()
        .to_ascii_lowercase()
        .contains("ffmpeg"));
}

#[tokio::test]
async fn probe_reads_generated_video_and_waveform() {
    if skip_without_ffmpeg().await {
        return;
    }
    let temp = TempDir::new("probe");
    let source = make_video(temp.path()).await;

    let info = media::probe(&source).await.expect("probe generated video");
    assert!(info.has_video);
    assert!(info.has_audio);
    assert_eq!(info.width, 320);
    assert_eq!(info.height, 240);
    assert!((info.fps - 30.0).abs() < 0.1);
    assert!(
        (info.duration - 2.0).abs() < 0.35,
        "duration {}",
        info.duration
    );
    assert_eq!(info.video_codec.as_deref(), Some("h264"));
    assert_eq!(info.audio_codec.as_deref(), Some("aac"));

    let peaks = media::generate_waveform(source.to_string_lossy().to_string(), Some(128))
        .await
        .expect("generate waveform");
    assert_eq!(peaks.len(), 256);
    assert!(
        peaks.iter().any(|peak| peak.abs() > 0.05),
        "waveform should contain audible peaks"
    );
}

#[tokio::test]
async fn export_renders_video_text_effects_and_audio() {
    if skip_without_ffmpeg().await {
        return;
    }
    let temp = TempDir::new("export");
    let source = make_video(temp.path()).await;
    let output = temp.path().join("rendered.mp4");

    let request = request(&output, vec![video_clip(&source)], 2.0);
    let cancel = AtomicBool::new(false);
    let updates = AtomicUsize::new(0);
    let result = render_with_progress(&request, temp.path(), &cancel, &|_progress| {
        updates.fetch_add(1, Ordering::Relaxed);
    })
    .await
    .expect("export rendered video");

    assert_eq!(result.output, output.to_string_lossy().to_string());
    assert!(output.is_file());
    assert!(
        updates.load(Ordering::Relaxed) > 0,
        "export should report progress"
    );

    let info = media::probe(&output).await.expect("probe exported video");
    assert!(info.has_video);
    assert!(info.has_audio);
    assert_eq!(info.width, 320);
    assert_eq!(info.height, 240);
    assert!(
        (info.duration - 2.0).abs() < 0.35,
        "duration {}",
        info.duration
    );
    assert_eq!(info.video_codec.as_deref(), Some("h264"));
    assert_eq!(info.audio_codec.as_deref(), Some("aac"));
    assert!(std::fs::metadata(&output).unwrap().len() > 10_000);
}

#[tokio::test]
async fn export_handles_overlapping_image_and_video_layers() {
    if skip_without_ffmpeg().await {
        return;
    }
    let temp = TempDir::new("layers");
    let source = make_video(temp.path()).await;
    let image = make_image(temp.path()).await;
    let output = temp.path().join("layered.mp4");

    let mut image_clip = video_clip(&image);
    image_clip.is_image = true;
    image_clip.has_audio = false;
    image_clip.duration = 1.5;
    image_clip.start = 0.0;

    let mut video_layer = video_clip(&source);
    video_layer.start = 0.5;
    video_layer.duration = 1.0;
    video_layer.trim_in = 0.25;
    video_layer.opacity = 0.8;
    video_layer.scale = 0.6;

    let request = request(&output, vec![image_clip, video_layer], 1.5);
    let cancel = AtomicBool::new(false);
    render_with_progress(&request, temp.path(), &cancel, &|_progress| {})
        .await
        .expect("export layered video");

    let info = media::probe(&output).await.expect("probe layered video");
    assert!(info.has_video);
    assert!(info.has_audio);
    assert!(
        (info.duration - 1.5).abs() < 0.35,
        "duration {}",
        info.duration
    );
}

#[tokio::test]
async fn export_deletes_partial_output_when_ffmpeg_fails() {
    if skip_without_ffmpeg().await {
        return;
    }
    let temp = TempDir::new("failure");
    let output = temp.path().join("missing-input.mp4");
    let missing = temp.path().join("does-not-exist.mp4");

    let request = request(&output, vec![video_clip(&missing)], 1.0);
    let cancel = AtomicBool::new(false);
    let error = render_with_progress(&request, temp.path(), &cancel, &|_progress| {})
        .await
        .expect_err("missing input should fail");
    assert!(
        error.contains("Export failed") || error.contains("No such file"),
        "unexpected error: {error}"
    );
    assert!(!output.exists(), "partial output should be removed");
}

#[tokio::test]
async fn export_renders_circle_masks() {
    if skip_without_ffmpeg().await {
        return;
    }
    let temp = TempDir::new("masks");
    let source = make_video(temp.path()).await;
    let output = temp.path().join("masked.mp4");

    let mut clip = video_clip(&source);
    clip.mask = Some("circle".to_string());
    clip.duration = 1.5;

    let mut request = request(&output, vec![clip], 1.5);
    request.effects[0].mask = "circle".to_string();

    let cancel = AtomicBool::new(false);
    render_with_progress(&request, temp.path(), &cancel, &|_progress| {})
        .await
        .expect("export masked video");

    let info = media::probe(&output).await.expect("probe masked video");
    assert!(info.has_video);
    assert!(
        (info.duration - 1.5).abs() < 0.35,
        "duration {}",
        info.duration
    );
}

#[test]
fn graph_builder_composes_video_text_effects_and_audio() {
    let request = request(
        Path::new("out.mp4"),
        vec![video_clip(Path::new("source.mp4"))],
        2.0,
    );
    let graph = build_graph(&request);
    assert!(graph.contains("color=c=0x101012"));
    assert!(graph.contains("overlay="));
    assert!(graph.contains("drawtext="));
    assert!(graph.contains("eq=brightness="));
    assert!(graph.contains("amix=inputs=1"));
    assert!(graph.contains("[vout]"));
    assert!(graph.contains("[aout]"));
    assert!(graph.contains("geq=r='r(X,Y)'"));
}

#[test]
fn graph_builder_expresses_speed_ramps() {
    let mut clip = video_clip(Path::new("source.mp4"));
    clip.duration = 4.0;
    clip.speed_ramp = vec![
        ExportSpeedPoint {
            time: 0.0,
            speed: 0.5,
        },
        ExportSpeedPoint {
            time: 4.0,
            speed: 2.0,
        },
    ];
    let request = request(Path::new("out.mp4"), vec![clip], 4.0);
    let graph = build_graph(&request);
    // The setpts expression is quoted: FFmpeg reads a comma as the end of a
    // filter, and the expression holds the commas of its own.
    assert!(graph.contains("setpts='(if(lt((T-STARTT),"));
    assert!(graph.contains("asplit="));
    assert!(graph.contains("concat=n="));
    assert!(graph.contains("atempo="));
}

#[test]
fn graph_builder_expresses_eq_pan_compression_and_ducking() {
    let mut clip = video_clip(Path::new("source.mp4"));
    clip.bass = 3.0;
    clip.bass_frequency = 220.0;
    clip.mid = -4.0;
    clip.mid_frequency = 1500.0;
    clip.mid_width = 1.5;
    clip.treble = 2.0;
    clip.treble_frequency = 6000.0;
    clip.pan = -0.5;
    clip.compressor = Some(ExportCompressor {
        enabled: true,
        threshold: -18.0,
        ratio: 4.0,
        attack: 12.0,
        release: 180.0,
    });
    clip.duck_segments = vec![
        ExportDuckSegment {
            start: 0.0,
            end: 0.25,
            from: 1.0,
            to: 0.5,
        },
        ExportDuckSegment {
            start: 0.25,
            end: 1.75,
            from: 0.5,
            to: 0.5,
        },
        ExportDuckSegment {
            start: 1.75,
            end: 2.0,
            from: 0.5,
            to: 1.0,
        },
    ];

    let request = request(Path::new("out.mp4"), vec![clip], 2.0);
    let graph = build_graph(&request);
    assert!(graph.contains("bass=g=3.00:f=220.0"));
    assert!(graph.contains("equalizer=f=1500.0:t=o:w=1.500:g=-4.00"));
    assert!(graph.contains("treble=g=2.00:f=6000.0"));
    assert!(graph.contains("pan=stereo|"));
    assert!(graph.contains("acompressor=threshold="));
    assert!(graph.contains("eval=frame"));
}

#[tokio::test]
async fn export_renders_processed_audio() {
    if skip_without_ffmpeg().await {
        return;
    }
    let temp = TempDir::new("audio");
    let source = make_video(temp.path()).await;
    let output = temp.path().join("processed.mp4");

    let mut clip = video_clip(&source);
    clip.bass = 4.0;
    clip.mid = -3.0;
    clip.treble = 2.0;
    clip.pan = -0.5;
    clip.compressor = Some(ExportCompressor {
        enabled: true,
        threshold: -18.0,
        ratio: 4.0,
        attack: 12.0,
        release: 180.0,
    });
    clip.duck_segments = vec![
        ExportDuckSegment {
            start: 0.0,
            end: 0.25,
            from: 1.0,
            to: 0.5,
        },
        ExportDuckSegment {
            start: 0.25,
            end: 1.75,
            from: 0.5,
            to: 0.5,
        },
        ExportDuckSegment {
            start: 1.75,
            end: 2.0,
            from: 0.5,
            to: 1.0,
        },
    ];

    let request = request(&output, vec![clip], 2.0);
    let cancel = AtomicBool::new(false);
    render_with_progress(&request, temp.path(), &cancel, &|_progress| {})
        .await
        .expect("export processed audio");

    let info = media::probe(&output).await.expect("probe processed video");
    assert!(info.has_video);
    assert!(info.has_audio);
    assert!(
        (info.duration - 2.0).abs() < 0.35,
        "duration {}",
        info.duration
    );
}
