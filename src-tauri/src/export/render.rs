use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, BufReader};

use crate::ffmpeg;

use super::encoder::encoder_args;
use super::graph::build_graph;
use super::model::*;

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
    let partial_output = output.with_file_name(format!(
        ".{}.{}.partial.mp4",
        output
            .file_stem()
            .and_then(|stem| stem.to_str())
            .unwrap_or("export"),
        uuid::Uuid::new_v4().simple()
    ));

    let (export_request, lut_files) = prepare_lut_files(request, work_dir)?;
    let _lut_cleanup = LutFileCleanup(lut_files);

    let script_path = ffmpeg::unique_file(&work_dir.join("exports"), "filter");
    let graph = build_graph(&export_request);
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
    command.args(encoder_args(
        request.encoder.as_deref(),
        request.quality.as_deref(),
    ));
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
    command.arg(&partial_output);
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
            let _ = std::fs::remove_file(&partial_output);
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
                let _ = child.kill().await;
                let _ = stderr_task.await;
                let _ = std::fs::remove_file(&partial_output);
                let _ = std::fs::remove_file(&script_path);
                return Err(format!("Could not read ffmpeg output: {error}"));
            }
            Err(_) => continue,
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let stderr_text = stderr_task.await.unwrap_or_default();
    if !status.success() {
        let _ = std::fs::remove_file(&partial_output);
        let _ = std::fs::remove_file(&script_path);
        return Err(format!("Export failed: {}", ffmpeg::tail(&stderr_text, 10)));
    }

    // Commit the completed render only after FFmpeg succeeds, so cancellation,
    // crashes, and encoder errors cannot leave a truncated file at the chosen path.
    let previous_output = output.with_file_name(format!(
        ".{}.{}.previous",
        output
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("export.mp4"),
        uuid::Uuid::new_v4().simple()
    ));
    let had_previous_output = output.exists();
    if had_previous_output {
        std::fs::rename(&output, &previous_output)
            .map_err(|error| format!("Could not preserve the previous export: {error}"))?;
    }
    if let Err(error) = std::fs::rename(&partial_output, &output) {
        if had_previous_output {
            let _ = std::fs::rename(&previous_output, &output);
        }
        let _ = std::fs::remove_file(&partial_output);
        return Err(format!("Could not finalize the export file: {error}"));
    }
    if had_previous_output {
        let _ = std::fs::remove_file(&previous_output);
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

/// Writes the `.cube` files an export graph refers to.
///
/// The project document stores the LUT text, not a path, so every render has
/// to materialise the data first. Both the full export and the single-frame
/// preview use this helper, which keeps their colour processing identical.
pub(super) fn prepare_lut_files(
    request: &ExportRequest,
    work_dir: &Path,
) -> Result<(ExportRequest, Vec<PathBuf>), String> {
    let mut prepared = request.clone();
    let mut lut_files = Vec::new();
    for effect in &mut prepared.effects {
        let Some(lut) = effect.lut.as_mut() else {
            continue;
        };
        if lut.size < 2 || lut.size > 64 || lut.cube_text.len() > 16 * 1024 * 1024 {
            return Err("The project contains an unsupported or oversized 3D LUT.".to_string());
        }
        let sample_count = lut
            .cube_text
            .lines()
            .filter(|line| {
                let line = line.split('#').next().unwrap_or("").trim();
                let fields = line.split_whitespace().collect::<Vec<_>>();
                fields.len() == 3 && fields.iter().all(|value| value.parse::<f64>().is_ok())
            })
            .count();
        if sample_count != lut.size.pow(3) {
            return Err(format!("The {} LUT data is malformed.", lut.title));
        }
        let path = ffmpeg::unique_file(&work_dir.join("exports"), "cube");
        std::fs::write(&path, &lut.cube_text)
            .map_err(|error| format!("Could not prepare LUT for export: {error}"))?;
        lut.lut_path = Some(path.to_string_lossy().to_string());
        lut_files.push(path);
    }
    Ok((prepared, lut_files))
}

pub(super) struct LutFileCleanup(pub(super) Vec<PathBuf>);

impl Drop for LutFileCleanup {
    fn drop(&mut self) {
        for path in &self.0 {
            let _ = std::fs::remove_file(path);
        }
    }
}
