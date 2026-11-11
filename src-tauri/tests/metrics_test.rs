use librecut_lib::metrics::{MemorySnapshot, MemoryTracker};

#[test]
fn the_memory_tracker_keeps_the_high_water_mark() {
    let tracker = MemoryTracker::default();
    let mut peaks = tracker.peaks.lock().expect("lock");
    peaks.app = 100;
    peaks.ffmpeg = 40;
    assert_eq!(peaks.app, 100);
    assert_eq!(peaks.ffmpeg, 40);
}

#[test]
fn a_memory_snapshot_reports_the_editor_and_ffmpeg_separately() {
    let snapshot = MemorySnapshot {
        app_working_set_bytes: 120_000_000,
        app_peak_working_set_bytes: 150_000_000,
        ffmpeg_working_set_bytes: 80_000_000,
        ffmpeg_peak_working_set_bytes: 90_000_000,
        ffmpeg_process_count: 2,
    };
    // The editor budget excludes the FFmpeg children, so the two have to be
    // reported apart from each other.
    assert!(snapshot.app_working_set_bytes < snapshot.app_peak_working_set_bytes);
    assert!(snapshot.ffmpeg_working_set_bytes < snapshot.ffmpeg_peak_working_set_bytes);
    assert_eq!(snapshot.ffmpeg_process_count, 2);
}
