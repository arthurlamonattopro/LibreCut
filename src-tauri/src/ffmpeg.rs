use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde::Serialize;
use serde_json::Value;
use tokio::process::Command;

const EXE_SUFFIX: &str = if cfg!(windows) { ".exe" } else { "" };

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatus {
    pub name: String,
    pub path: String,
    pub version: Option<String>,
    pub source: String,
    pub available: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStatus {
    pub ready: bool,
    pub ffmpeg: ToolStatus,
    pub ffprobe: ToolStatus,
}

fn target_triple() -> String {
    tauri::utils::platform::target_triple().unwrap_or_default()
}

fn candidate_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            // Installed app: sidecars live next to LibreCut.exe.
            dirs.push(parent.to_path_buf());
            // `cargo test` runs from target/debug/deps, while `tauri dev` stages
            // sidecars in target/debug.
            if parent.file_name().and_then(|name| name.to_str()) == Some("deps") {
                if let Some(grandparent) = parent.parent() {
                    dirs.push(grandparent.to_path_buf());
                }
            }
        }
    }
    // Development fallback before the sidecars have been staged.
    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries"));
    dirs
}

fn candidate_names(stem: &str) -> Vec<String> {
    let mut names = Vec::new();
    let triple = target_triple();
    if !triple.is_empty() {
        names.push(format!("{stem}-{triple}{EXE_SUFFIX}"));
    }
    names.push(format!("{stem}{EXE_SUFFIX}"));
    names.push(stem.to_string());
    names
}

/// Resolve a tool by checking, in order: an explicit environment override, the
/// sidecars bundled next to the executable, and finally PATH.
fn resolve_tool(env_var: &str, stem: &str) -> (String, String) {
    if let Ok(override_path) = std::env::var(env_var) {
        let path = PathBuf::from(&override_path);
        if path.is_file() {
            return (path.to_string_lossy().to_string(), "override".to_string());
        }
    }

    for dir in candidate_dirs() {
        for name in candidate_names(stem) {
            let path = dir.join(&name);
            if path.is_file() {
                return (path.to_string_lossy().to_string(), "bundled".to_string());
            }
        }
    }

    (stem.to_string(), "path".to_string())
}

/// Resolve the FFmpeg binary. A bundled sidecar or a user override can be
/// supplied through environment variables; development falls back to PATH.
pub fn ffmpeg_bin() -> String {
    resolve_tool("LIBRECUT_FFMPEG", "ffmpeg").0
}

pub fn ffprobe_bin() -> String {
    resolve_tool("LIBRECUT_FFPROBE", "ffprobe").0
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

/// The number of threads background media work may use.
///
/// Poster frames, waveforms and proxies run while the editor is in use. FFmpeg
/// would otherwise claim every core and make the UI stutter, so background
/// jobs keep a core free for the renderer.
pub fn background_threads() -> usize {
    let cores = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4);
    // At least one thread, and never more than half of the machine, so a
    // 4K proxy encode cannot starve the editor.
    (cores / 2).clamp(1, 8)
}

async fn probe_tool(env_var: &str, stem: &str) -> ToolStatus {
    let (path, source) = resolve_tool(env_var, stem);
    let output = command(&path).arg("-version").output().await;
    let (available, version) = match output {
        Ok(output) if output.status.success() => {
            let text = String::from_utf8_lossy(&output.stdout);
            (
                true,
                text.lines()
                    .next()
                    .map(|line| line.trim().to_string())
                    .filter(|line| !line.is_empty()),
            )
        }
        _ => (false, None),
    };

    ToolStatus {
        name: stem.to_string(),
        path,
        version,
        source: if available {
            source
        } else {
            "missing".to_string()
        },
        available,
    }
}

/// Reports where FFmpeg/ffprobe were found so the UI can guide first-run setup
/// and surface a clear message when a release install is incomplete.
#[tauri::command]
pub async fn runtime_status() -> RuntimeStatus {
    let (ffmpeg, ffprobe) = tokio::join!(
        probe_tool("LIBRECUT_FFMPEG", "ffmpeg"),
        probe_tool("LIBRECUT_FFPROBE", "ffprobe")
    );
    RuntimeStatus {
        ready: ffmpeg.available && ffprobe.available,
        ffmpeg,
        ffprobe,
    }
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
