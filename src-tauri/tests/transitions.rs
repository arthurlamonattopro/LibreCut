use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;

use librecut_lib::export::{
    build_graph, render_with_progress, ExportClip, ExportRequest, ExportTransition,
    XFADE_TRANSITIONS,
};
use librecut_lib::ffmpeg;
use librecut_lib::media;

struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        let dir = std::env::temp_dir().join(format!(
            "librecut-transitions-{label}-{}",
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

fn clip(path: &str, track: &str, start: f64, duration: f64) -> ExportClip {
    ExportClip {
        path: path.to_string(),
        track_id: Some(track.to_string()),
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

fn transition(kind: &str, duration: f64) -> ExportTransition {
    ExportTransition {
        transition_type: kind.to_string(),
        duration,
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
    }
}

#[test]
fn a_transition_between_neighbours_becomes_an_xfade() {
    let first = clip("a.mp4", "video-1", 0.0, 2.0);
    let mut second = clip("b.mp4", "video-1", 2.0, 2.0);
    second.transition_in = transition("wipeup", 0.5);

    let graph = build_graph(&request(vec![first, second], 4.0));

    assert!(
        graph.contains("xfade=transition=wipeup:duration=0.500"),
        "graph should crossfade the cut:\n{graph}"
    );
    assert!(
        graph.contains("tpad=stop_mode=clone"),
        "the clip that goes away should be held on its last frame:\n{graph}"
    );
    // The incoming clip only shows once the transition is over.
    assert!(
        graph.contains("between(t,2.500,4.000)"),
        "the incoming clip should start after the transition:\n{graph}"
    );
}

#[test]
fn a_transition_on_the_outgoing_edge_becomes_an_xfade() {
    let mut first = clip("a.mp4", "video-1", 0.0, 2.0);
    let second = clip("b.mp4", "video-1", 2.0, 2.0);
    first.transition_out = transition("circleopen", 0.75);

    let graph = build_graph(&request(vec![first, second], 4.0));

    assert!(
        graph.contains("xfade=transition=circleopen:duration=0.750"),
        "the outgoing edge should describe the cut:\n{graph}"
    );
}

#[test]
fn the_incoming_edge_wins_when_both_edges_describe_the_cut() {
    let mut first = clip("a.mp4", "video-1", 0.0, 2.0);
    let mut second = clip("b.mp4", "video-1", 2.0, 2.0);
    first.transition_out = transition("circleopen", 0.75);
    second.transition_in = transition("dissolve", 0.25);

    let graph = build_graph(&request(vec![first, second], 4.0));

    assert!(
        graph.contains("xfade=transition=dissolve:duration=0.250"),
        "the incoming edge wins:\n{graph}"
    );
    assert!(
        !graph.contains("xfade=transition=circleopen"),
        "only one transition plays on a cut:\n{graph}"
    );
}

#[test]
fn clips_on_different_tracks_do_not_crossfade() {
    let first = clip("a.mp4", "video-1", 0.0, 2.0);
    let mut second = clip("b.mp4", "video-2", 2.0, 2.0);
    second.transition_in = transition("fade", 0.5);

    let graph = build_graph(&request(vec![first, second], 4.0));

    assert!(
        !graph.contains("xfade="),
        "clips on different tracks are not neighbours:\n{graph}"
    );
}

#[test]
fn clips_that_are_not_neighbours_do_not_crossfade() {
    let first = clip("a.mp4", "video-1", 0.0, 2.0);
    let mut second = clip("b.mp4", "video-1", 3.0, 2.0);
    second.transition_in = transition("fade", 0.5);

    let graph = build_graph(&request(vec![first, second], 5.0));

    assert!(
        !graph.contains("xfade="),
        "a gap between two clips is not a cut:\n{graph}"
    );
}

#[test]
fn an_edge_without_a_neighbour_fades_instead() {
    let mut only = clip("a.mp4", "video-1", 0.0, 2.0);
    only.transition_in = transition("fade", 0.5);

    let graph = build_graph(&request(vec![only], 2.0));

    assert!(
        !graph.contains("xfade="),
        "there is nothing to crossfade with:\n{graph}"
    );
    assert!(
        graph.contains("max(0,(T-0.000000)/0.500000)"),
        "the clip should fade in against the background:\n{graph}"
    );
}

#[test]
fn unknown_transition_names_fall_back_to_a_crossfade() {
    let first = clip("a.mp4", "video-1", 0.0, 2.0);
    let mut second = clip("b.mp4", "video-1", 2.0, 2.0);
    second.transition_in = transition("not-a-transition", 0.5);

    let graph = build_graph(&request(vec![first, second], 4.0));

    assert!(
        graph.contains("xfade=transition=fade:"),
        "an unknown name should still render:\n{graph}"
    );
}

#[test]
fn the_legacy_wipe_name_maps_onto_a_wipe() {
    let first = clip("a.mp4", "video-1", 0.0, 2.0);
    let mut second = clip("b.mp4", "video-1", 2.0, 2.0);
    second.transition_in = transition("wipe", 0.5);

    let graph = build_graph(&request(vec![first, second], 4.0));

    assert!(
        graph.contains("xfade=transition=wiperight:"),
        "older projects used a single wipe name:\n{graph}"
    );
}

#[test]
fn a_chain_of_clips_plays_a_transition_on_every_cut() {
    let first = clip("a.mp4", "video-1", 0.0, 2.0);
    let mut second = clip("b.mp4", "video-1", 2.0, 2.0);
    let mut third = clip("c.mp4", "video-1", 4.0, 2.0);
    second.transition_in = transition("dissolve", 0.5);
    third.transition_in = transition("circleopen", 0.5);

    let graph = build_graph(&request(vec![first, second, third], 6.0));

    assert!(
        graph.contains("xfade=transition=dissolve:duration=0.500"),
        "the first cut should crossfade:\n{graph}"
    );
    assert!(
        graph.contains("xfade=transition=circleopen:duration=0.500"),
        "the second cut should crossfade:\n{graph}"
    );
    // The clip in the middle feeds its overlay and both transitions.
    assert!(
        graph.contains("[vchain1]split=3"),
        "the middle clip feeds three consumers:\n{graph}"
    );
}

#[test]
fn the_catalogue_and_the_exporter_agree_on_the_transitions() {
    // The exporter and the editor keep the list of transitions in two
    // languages. This test makes sure they do not drift apart.
    let catalogue = std::fs::read_to_string("../src/lib/transitions.ts")
        .expect("read the transition catalogue");
    let mut missing = Vec::new();
    for transition in XFADE_TRANSITIONS {
        if !catalogue.contains(&format!("\"{transition}\"")) {
            missing.push(*transition);
        }
    }
    assert!(
        missing.is_empty(),
        "the exporter supports transitions the editor does not offer: {missing:?}"
    );
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

#[tokio::test]
async fn export_renders_a_transition() {
    if !ffmpeg_ready().await {
        eprintln!("Skipping transition render test: ffmpeg was not found.");
        return;
    }
    let temp = TempDir::new("render");
    let source = temp.path().join("source.mp4");
    let output = temp.path().join("transition.mp4");
    let generated = ffmpeg::command(&ffmpeg::ffmpeg_bin())
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
        .arg(&source)
        .output()
        .await
        .expect("run ffmpeg");
    assert!(generated.status.success(), "ffmpeg should build the source");

    // Three clips in a row with a transition on every cut.
    let path = source.to_string_lossy().to_string();
    let first = clip(&path, "video-1", 0.0, 2.0);
    let mut second = clip(&path, "video-1", 2.0, 2.0);
    let mut third = clip(&path, "video-1", 4.0, 2.0);
    second.transition_in = transition("dissolve", 0.5);
    third.transition_in = transition("circleopen", 0.5);

    let mut request = request(vec![first, second, third], 6.0);
    request.output = output.to_string_lossy().to_string();
    let cancel = AtomicBool::new(false);
    render_with_progress(&request, temp.path(), &cancel, &|_progress| {})
        .await
        .expect("export a timeline with a transition");

    let info = media::probe(&output).await.expect("probe exported video");
    assert!(info.has_video);
    assert!(
        (info.duration - 6.0).abs() < 0.4,
        "the transition should not change the length of the timeline: {}",
        info.duration
    );
}
