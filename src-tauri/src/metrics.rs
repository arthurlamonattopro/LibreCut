use std::sync::Mutex;

use serde::Serialize;
use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};

/// Working-set numbers for the editor and for the FFmpeg children it spawns.
///
/// The profiler in `docs/performance.md` needs the two numbers separately:
/// the editor budget covers LibreCut itself, while FFmpeg peaks are recorded
/// on their own because proxy encoding and export run in child processes.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemorySnapshot {
    /// Resident memory of the LibreCut process.
    pub app_working_set_bytes: u64,
    /// Highest resident memory observed for the LibreCut process.
    pub app_peak_working_set_bytes: u64,
    /// Resident memory of the FFmpeg children spawned by LibreCut.
    pub ffmpeg_working_set_bytes: u64,
    /// Highest combined FFmpeg resident memory observed.
    pub ffmpeg_peak_working_set_bytes: u64,
    /// Number of live FFmpeg children.
    pub ffmpeg_process_count: usize,
}

#[derive(Default)]
pub struct Peaks {
    pub app: u64,
    pub ffmpeg: u64,
}

/// Keeps the high-water marks between samples.
#[derive(Default)]
pub struct MemoryTracker {
    pub peaks: Mutex<Peaks>,
}

fn is_ffmpeg(name: &str) -> bool {
    let name = name.to_ascii_lowercase();
    name.starts_with("ffmpeg") || name.starts_with("ffprobe")
}

/// Reports the current working set of the editor and of its FFmpeg children.
#[tauri::command]
pub async fn runtime_memory(
    tracker: tauri::State<'_, MemoryTracker>,
) -> Result<MemorySnapshot, String> {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_memory(),
    );

    let own_pid = std::process::id();
    let mut snapshot = MemorySnapshot::default();
    for (pid, process) in system.processes() {
        let memory = process.memory();
        if pid.as_u32() == own_pid {
            snapshot.app_working_set_bytes = memory;
            continue;
        }
        // FFmpeg is always started directly by LibreCut, so the parent check
        // keeps unrelated FFmpeg sessions on the machine out of the numbers.
        if process.parent().map(|parent| parent.as_u32()) == Some(own_pid)
            && is_ffmpeg(&process.name().to_string_lossy())
        {
            snapshot.ffmpeg_working_set_bytes += memory;
            snapshot.ffmpeg_process_count += 1;
        }
    }

    if let Ok(mut peaks) = tracker.peaks.lock() {
        peaks.app = peaks.app.max(snapshot.app_working_set_bytes);
        peaks.ffmpeg = peaks.ffmpeg.max(snapshot.ffmpeg_working_set_bytes);
        snapshot.app_peak_working_set_bytes = peaks.app;
        snapshot.ffmpeg_peak_working_set_bytes = peaks.ffmpeg;
    }

    Ok(snapshot)
}
