use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde_json::Value;
use tokio::process::Command;

/// Resolve the FFmpeg binary. A bundled sidecar or a user override can be
/// supplied through environment variables; development falls back to PATH.
pub fn ffmpeg_bin() -> String {
    std::env::var("LIBRECUT_FFMPEG").unwrap_or_else(|_| "ffmpeg".to_string())
}

pub fn ffprobe_bin() -> String {
    std::env::var("LIBRECUT_FFPROBE").unwrap_or_else(|_| "ffprobe".to_string())
}

pub fn command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    cmd.stdin(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.as_std_mut().creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub async fn probe_json(path: &Path) -> Result<Value, String> {
    let output = command(&ffprobe_bin())
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(path)
        .output()
        .await
        .map_err(|e| format!("Could not run ffprobe: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(format!("ffprobe failed: {}", err.trim()));
    }

    serde_json::from_slice(&output.stdout).map_err(|e| format!("Invalid ffprobe output: {e}"))
}

pub fn parse_rate(value: Option<&Value>) -> f64 {
    let Some(raw) = value.and_then(Value::as_str) else {
        return 0.0;
    };
    let mut parts = raw.split('/');
    let num = parts
        .next()
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(0.0);
    let den = parts
        .next()
        .and_then(|v| v.parse::<f64>().ok())
        .unwrap_or(1.0);
    if den <= 0.0 {
        0.0
    } else {
        num / den
    }
}

pub fn parse_f64(value: Option<&Value>) -> f64 {
    match value {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.parse::<f64>().unwrap_or(0.0),
        _ => 0.0,
    }
}

pub fn parse_u32(value: Option<&Value>) -> u32 {
    parse_f64(value).max(0.0) as u32
}

pub fn tail(text: &str, lines: usize) -> String {
    let collected: Vec<&str> = text.lines().collect();
    collected[collected.len().saturating_sub(lines)..].join("\n")
}

pub fn ensure_parent(path: &Path) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Could not create {}: {e}", parent.display()))?;
    }
    Ok(())
}

pub fn cache_key(path: &Path) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    path.hash(&mut hasher);
    if let Ok(meta) = std::fs::metadata(path) {
        meta.len().hash(&mut hasher);
        if let Ok(modified) = meta.modified() {
            if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                duration.as_nanos().hash(&mut hasher);
            }
        }
    }
    format!("{:016x}", hasher.finish())
}

pub fn unique_file(dir: &Path, extension: &str) -> PathBuf {
    let _ = std::fs::create_dir_all(dir);
    dir.join(format!("{}.{}", uuid::Uuid::new_v4().simple(), extension))
}
