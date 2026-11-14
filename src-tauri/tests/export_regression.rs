//! Export regression checks.
//!
//! The filter graph is the contract between the timeline and FFmpeg. These
//! checks keep the graph stable for the edit shapes that ship with the
//! editor: cuts with transitions, speed ramps, audio processing, effects,
//! LUTs, and text. The render checks at the end produce real media, so a
//! graph that only looks right still has to work.

use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use librecut_lib::export::{
    build_graph, render_with_progress, ExportClip, ExportCompressor, ExportDuckSegment,
    ExportEffect, ExportKeyframe, ExportLut, ExportRequest, ExportSpeedPoint, ExportTransition,
};
use librecut_lib::ffmpeg;
use librecut_lib::media;

struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "librecut-regression-{label}-{}",
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
            "FFmpeg is required for the export regression checks. Run scripts/fetch-ffmpeg.ps1 or put ffmpeg on PATH."
        );
    }
    eprintln!("Skipping the render checks: ffmpeg/ffprobe were not found.");
    true
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

fn request(clips: Vec<ExportClip>, duration: f64) -> ExportRequest {
    ExportRequest {
        output: "out.mp4".to_string(),
        width: 320,
        height: 240,
        fps: 30.0,
        duration,
        clips,
        texts: Vec::new(),
        effects: Vec::new(),
        encoder: Some("libx264".to_string()),
        quality: Some("draft".to_string()),
        audio_codec: None,
        audio_bitrate: None,
        audio_sample_rate: None,
    }
}

#[test]
fn a_cut_between_two_clips_becomes_an_xfade() {
    let mut first = video_clip(Path::new("source.mp4"));
    first.duration = 2.0;
    let mut second = video_clip(Path::new("source.mp4"));
    second.start = 2.0;
    second.duration = 2.0;
    second.transition_in = ExportTransition {
        transition_type: "wiperight".to_string(),
        duration: 0.5,
    };

    let graph = build_graph(&request(vec![first, second], 4.0));
    assert!(graph.contains("xfade=transition=wiperight:duration=0.500"));
    // The clip that goes away is held on its last frame.
    assert!(graph.contains("tpad=stop_mode=clone"));
    assert!(graph.contains("[vout]"));
}

#[test]
fn the_legacy_wipe_transition_is_rendered_as_a_wipe_to_the_right() {
    let mut first = video_clip(Path::new("source.mp4"));
    first.duration = 2.0;
    let mut second = video_clip(Path::new("source.mp4"));
    second.start = 2.0;
    second.duration = 2.0;
    second.transition_in = ExportTransition {
        transition_type: "wipe".to_string(),
        duration: 0.5,
    };

    let graph = build_graph(&request(vec![first, second], 4.0));
    assert!(graph.contains("xfade=transition=wiperight"));
    assert!(!graph.contains("transition=wipe:"));
}

#[test]
fn an_unknown_transition_falls_back_to_a_crossfade() {
    let mut first = video_clip(Path::new("source.mp4"));
    first.duration = 2.0;
    let mut second = video_clip(Path::new("source.mp4"));
    second.start = 2.0;
    second.duration = 2.0;
    second.transition_in = ExportTransition {
        transition_type: "not-a-transition".to_string(),
        duration: 0.5,
    };

    let graph = build_graph(&request(vec![first, second], 4.0));
    assert!(graph.contains("xfade=transition=fade"));
}

#[test]
fn a_gap_between_two_clips_has_no_transition() {
    let mut first = video_clip(Path::new("source.mp4"));
    first.duration = 2.0;
    let mut second = video_clip(Path::new("source.mp4"));
    second.start = 3.0;
    second.duration = 2.0;
    second.transition_in = ExportTransition {
        transition_type: "wiperight".to_string(),
        duration: 0.5,
    };

    let graph = build_graph(&request(vec![first, second], 5.0));
    assert!(!graph.contains("xfade="));
}

#[test]
fn a_speed_ramp_becomes_a_continuous_setpts_and_atempo() {
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

    let graph = build_graph(&request(vec![clip], 4.0));
    // The expression is quoted: a comma inside it would otherwise end the
    // filter and FFmpeg would not find the filter at all.
    assert!(graph.contains("setpts='(if(lt((T-STARTT),"));
    // The inverse of a linear ramp is quadratic, so the picture is retimed
    // continuously instead of in constant-speed steps.
    assert!(graph.contains("sqrt("));
    assert!(graph.contains("asplit="));
    assert!(graph.contains("concat=n="));
    assert!(graph.contains("atempo="));
    // A label is never followed by a comma.
    assert!(!graph.contains("[concat0],"));
    assert!(!graph.contains("[0:a],"));
}

#[test]
fn a_chroma_key_is_written_into_the_clip_chain() {
    let mut clip = video_clip(Path::new("source.mp4"));
    clip.chroma_key = Some(librecut_lib::export::ExportChromaKey {
        enabled: true,
        color: "#00ff00".to_string(),
        similarity: 0.3,
        softness: 0.1,
    });

    let graph = build_graph(&request(vec![clip], 2.0));
    assert!(graph.contains("chromakey=0x00ff00:0.3000:0.1000"));
}

#[test]
fn a_keyframed_scale_is_evaluated_per_frame() {
    let mut clip = video_clip(Path::new("source.mp4"));
    clip.keyframes = vec![ExportKeyframe {
        property: "scale".to_string(),
        time: 0.0,
        value: 1.0,
    }];

    let graph = build_graph(&request(vec![clip], 2.0));
    assert!(graph.contains("eval=frame"));
}

#[test]
fn a_clip_without_audio_stays_out_of_the_mix() {
    let mut silent = video_clip(Path::new("source.mp4"));
    silent.has_audio = false;
    silent.duration = 2.0;
    let mut loud = video_clip(Path::new("source.mp4"));
    loud.start = 2.0;
    loud.duration = 2.0;

    let graph = build_graph(&request(vec![silent, loud], 4.0));
    assert!(graph.contains("amix=inputs=1"));
}

#[test]
fn the_audio_graph_holds_the_track_processing() {
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
    clip.duck_segments = vec![ExportDuckSegment {
        start: 0.0,
        end: 1.0,
        from: 1.0,
        to: 0.5,
    }];

    let graph = build_graph(&request(vec![clip], 2.0));
    assert!(graph.contains("bass=g=3.00:f=220.0"));
    assert!(graph.contains("equalizer=f=1500.0:t=o:w=1.500:g=-4.00"));
    assert!(graph.contains("treble=g=2.00:f=6000.0"));
    assert!(graph.contains("pan=stereo|"));
    assert!(graph.contains("acompressor=threshold="));
}

#[test]
fn a_lut_effect_reads_its_cube_file() {
    let mut effect = ExportEffect {
        start: 0.0,
        duration: 2.0,
        opacity: 1.0,
        brightness: 0.0,
        contrast: 1.0,
        saturation: 1.0,
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
        lut: Some(ExportLut {
            title: "Teal Orange".to_string(),
            size: 2,
            cube_text: "LUT_3D_SIZE 2\n".to_string(),
            strength: 0.8,
            lut_path: Some("C:/temp/teal.cube".to_string()),
        }),
    };
    effect.opacity = 1.0;

    let mut req = request(vec![video_clip(Path::new("source.mp4"))], 2.0);
    req.effects = vec![effect];
    let graph = build_graph(&req);
    assert!(graph.contains("lut3d=file='C\\:/temp/teal.cube':interp=tetrahedral"));
}

#[test]
fn an_effect_fades_at_its_edges() {
    let mut req = request(vec![video_clip(Path::new("source.mp4"))], 2.0);
    req.effects = vec![ExportEffect {
        start: 0.0,
        duration: 2.0,
        opacity: 0.5,
        brightness: 0.0,
        contrast: 1.0,
        saturation: 1.0,
        hue: 0.0,
        sepia: 0.0,
        blur: 0.0,
        vignette: 0.0,
        motion_blur: 0.0,
        fade_in: 0.5,
        fade_out: 0.5,
        mask: "none".to_string(),
        mask_x: 0.5,
        mask_y: 0.5,
        mask_size: 0.5,
        lut: None,
    }];

    let graph = build_graph(&req);
    assert!(graph.contains("if(lt(t-0.000,0.500)"));
    assert!(graph.contains("if(lt(2.000-t,0.500)"));
}

async fn make_video(dir: &Path, name: &str, seconds: u32) -> PathBuf {
    let output_path = dir.join(name);
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
            &seconds.to_string(),
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

#[tokio::test]
async fn renders_a_timeline_with_a_transition() {
    if skip_without_ffmpeg().await {
        return;
    }
    let temp = TempDir::new("transition");
    let source = make_video(temp.path(), "source.mp4", 4).await;
    let output = temp.path().join("transition.mp4");

    let mut first = video_clip(&source);
    first.duration = 2.0;
    let mut second = video_clip(&source);
    second.start = 2.0;
    second.duration = 2.0;
    second.transition_in = ExportTransition {
        transition_type: "wiperight".to_string(),
        duration: 0.5,
    };

    let mut req = request(vec![first, second], 4.0);
    req.output = output.to_string_lossy().to_string();
    let cancel = AtomicBool::new(false);
    render_with_progress(&req, temp.path(), &cancel, &|_progress| {})
        .await
        .expect("export a timeline with a transition");

    let info = media::probe(&output)
        .await
        .expect("probe the exported video");
    assert!(info.has_video);
    assert!(info.has_audio);
    assert!(
        (info.duration - 4.0).abs() < 0.4,
        "duration {}",
        info.duration
    );
}

#[tokio::test]
async fn renders_a_timeline_with_a_speed_ramp() {
    if skip_without_ffmpeg().await {
        return;
    }
    let temp = TempDir::new("ramp");
    let source = make_video(temp.path(), "source.mp4", 4).await;
    let output = temp.path().join("ramp.mp4");

    let mut clip = video_clip(&source);
    clip.duration = 2.0;
    clip.speed_ramp = vec![
        ExportSpeedPoint {
            time: 0.0,
            speed: 1.0,
        },
        ExportSpeedPoint {
            time: 2.0,
            speed: 2.0,
        },
    ];

    let mut req = request(vec![clip], 2.0);
    req.output = output.to_string_lossy().to_string();
    let cancel = AtomicBool::new(false);
    render_with_progress(&req, temp.path(), &cancel, &|_progress| {})
        .await
        .expect("export a timeline with a speed ramp");

    let info = media::probe(&output)
        .await
        .expect("probe the exported video");
    assert!(info.has_video);
    assert!(info.has_audio);
    assert!(
        (info.duration - 2.0).abs() < 0.4,
        "duration {}",
        info.duration
    );
}

#[tokio::test]
async fn renders_the_requested_audio_codec_and_sample_rate() {
    if skip_without_ffmpeg().await {
        return;
    }
    let temp = TempDir::new("audio-settings");
    let source = make_video(temp.path(), "source.mp4", 2).await;
    let output = temp.path().join("lossless.mp4");

    let mut req = request(vec![video_clip(&source)], 2.0);
    req.output = output.to_string_lossy().to_string();
    req.audio_codec = Some("alac".to_string());
    req.audio_bitrate = Some(320);
    req.audio_sample_rate = Some(44100);
    let cancel = AtomicBool::new(false);
    render_with_progress(&req, temp.path(), &cancel, &|_progress| {})
        .await
        .expect("export lossless audio");

    let info = media::probe(&output)
        .await
        .expect("probe the exported video");
    assert_eq!(info.audio_codec.as_deref(), Some("alac"));
    assert_eq!(info.sample_rate, 44100);
}

#[tokio::test]
async fn renders_a_timeline_with_an_effect_and_a_text() {
    if skip_without_ffmpeg().await {
        return;
    }
    let temp = TempDir::new("effect");
    let source = make_video(temp.path(), "source.mp4", 2).await;
    let output = temp.path().join("effect.mp4");

    let mut req = request(vec![video_clip(&source)], 2.0);
    req.output = output.to_string_lossy().to_string();
    req.effects = vec![ExportEffect {
        start: 0.0,
        duration: 2.0,
        opacity: 0.5,
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
    }];
    req.texts = vec![librecut_lib::export::ExportText {
        text: "Regression".to_string(),
        start: 0.0,
        duration: 2.0,
        x: 0.5,
        y: 0.8,
        size: 24.0,
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
    }];

    let cancel = AtomicBool::new(false);
    render_with_progress(&req, temp.path(), &cancel, &|_progress| {})
        .await
        .expect("export a timeline with an effect and a text");

    let info = media::probe(&output)
        .await
        .expect("probe the exported video");
    assert!(info.has_video);
    assert!(info.has_audio);
}
