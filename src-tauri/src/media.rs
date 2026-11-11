use std::collections::HashMap;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use serde::Serialize;
use serde_json::Value;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::ffmpeg;

#[derive(Default)]
pub struct MediaRegistry {
    entries: RwLock<HashMap<String, PathBuf>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiMediaPayload {
    pub name: String,
    pub mime_type: String,
    pub data_base64: String,
}

#[tauri::command]
pub async fn read_media_for_ai(path: String) -> Result<AiMediaPayload, String> {
    let path = PathBuf::from(path);
    if !path.is_file() {
        return Err(format!("File not found: {}", path.display()));
    }
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("media")
        .to_string();
    let extension = path
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(
        extension.as_str(),
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif"
    ) {
        let data = tokio::fs::read(&path)
            .await
            .map_err(|e| format!("Could not read image file: {e}"))?;
        if data.len() > 25 * 1024 * 1024 {
            return Err("AI image files must be 25 MB or smaller.".into());
        }
        let mime_type = match extension.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "webp" => "image/webp",
            "bmp" => "image/bmp",
            _ => "image/gif",
        };
        return Ok(AiMediaPayload {
            name,
            mime_type: mime_type.into(),
            data_base64: BASE64.encode(data),
        });
    }
    let temp_path =
        std::env::temp_dir().join(format!("librecut-ai-{}.wav", uuid::Uuid::new_v4().simple()));
    let output = ffmpeg::command(&ffmpeg::ffmpeg_bin())
        .args(["-v", "error", "-y", "-i"])
        .arg(&path)
        .args(["-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le"])
        .arg(&temp_path)
        .output()
        .await
        .map_err(|e| format!("Could not extract audio: {e}"))?;
    if !output.status.success() {
        let _ = fs::remove_file(&temp_path);
        return Err(format!(
            "Could not extract audio: {}",
            ffmpeg::tail(&String::from_utf8_lossy(&output.stderr), 6)
        ));
    }
    let result = tokio::fs::read(&temp_path)
        .await
        .map_err(|e| format!("Could not read extracted audio: {e}"));
    let _ = fs::remove_file(&temp_path);
    let data = result?;
    if data.len() > 25 * 1024 * 1024 {
        return Err("AI audio files must be 25 MB or smaller after audio extraction.".into());
    }
    Ok(AiMediaPayload {
        name,
        mime_type: "audio/wav".into(),
        data_base64: BASE64.encode(data),
    })
}

#[tauri::command]
pub async fn save_ai_audio(app: AppHandle, data_base64: String) -> Result<String, String> {
    save_ai_file(app, data_base64, "wav").await
}

#[tauri::command]
pub async fn save_ai_image(app: AppHandle, data_base64: String) -> Result<String, String> {
    save_ai_file(app, data_base64, "png").await
}

async fn save_ai_file(
    app: AppHandle,
    data_base64: String,
    extension: &str,
) -> Result<String, String> {
    let data = BASE64
        .decode(data_base64)
        .map_err(|e| format!("Could not decode generated media: {e}"))?;
    let folder = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("ai-generated");
    tokio::fs::create_dir_all(&folder)
        .await
        .map_err(|e| e.to_string())?;
    let target = folder.join(format!(
        "generated-{}.{}",
        uuid::Uuid::new_v4().simple(),
        extension
    ));
    tokio::fs::write(&target, data)
        .await
        .map_err(|e| format!("Could not save generated media: {e}"))?;
    Ok(target.to_string_lossy().to_string())
}

impl MediaRegistry {
    pub fn insert(&self, path: PathBuf) -> String {
        let id = uuid::Uuid::new_v4().simple().to_string();
        if let Ok(mut entries) = self.entries.write() {
            entries.insert(id.clone(), path);
        }
        id
    }

    pub fn get(&self, id: &str) -> Option<PathBuf> {
        self.entries.read().ok()?.get(id).cloned()
    }

    pub fn remove(&self, id: &str) {
        if let Ok(mut entries) = self.entries.write() {
            entries.remove(id);
        }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfo {
    pub name: String,
    pub path: String,
    pub duration: f64,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub is_vfr: bool,
    pub rotation: i32,
    pub video_codec: Option<String>,
    pub audio_codec: Option<String>,
    pub audio_channels: u32,
    pub sample_rate: u32,
    pub has_video: bool,
    pub has_audio: bool,
    pub size_bytes: u64,
    pub is_image: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredMedia {
    pub id: String,
    pub path: String,
    pub info: MediaInfo,
}

fn is_image_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .as_deref(),
        Some("png" | "jpg" | "jpeg" | "webp" | "bmp" | "gif" | "avif")
    )
}

pub async fn probe(path: &Path) -> Result<MediaInfo, String> {
    let json = ffmpeg::probe_json(path).await?;
    let empty = Vec::new();
    let streams = json
        .get("streams")
        .and_then(Value::as_array)
        .unwrap_or(&empty);

    let video = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(Value::as_str) == Some("video"));
    let audio = streams
        .iter()
        .find(|s| s.get("codec_type").and_then(Value::as_str) == Some("audio"));

    let format = json.get("format");
    let duration = ffmpeg::parse_f64(format.and_then(|f| f.get("duration")))
        .max(ffmpeg::parse_f64(video.and_then(|s| s.get("duration"))))
        .max(ffmpeg::parse_f64(audio.and_then(|s| s.get("duration"))));

    let mut rotation = 0i32;
    if let Some(video) = video {
        if let Some(list) = video.get("side_data_list").and_then(Value::as_array) {
            for item in list {
                if let Some(value) = item.get("rotation") {
                    rotation = ffmpeg::parse_f64(Some(value)) as i32;
                }
            }
        }
        if rotation == 0 {
            rotation = video
                .get("tags")
                .and_then(|t| t.get("rotate"))
                .and_then(Value::as_str)
                .and_then(|v| v.parse::<i32>().ok())
                .unwrap_or(0);
        }
    }

    let size_bytes = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    let name = path
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("Untitled")
        .to_string();

    let average_fps = ffmpeg::parse_rate(video.and_then(|s| s.get("avg_frame_rate")));
    let nominal_fps = ffmpeg::parse_rate(video.and_then(|s| s.get("r_frame_rate")));
    Ok(MediaInfo {
        name,
        path: path.to_string_lossy().to_string(),
        duration,
        width: ffmpeg::parse_u32(video.and_then(|s| s.get("width"))),
        height: ffmpeg::parse_u32(video.and_then(|s| s.get("height"))),
        fps: average_fps,
        is_vfr: average_fps > 0.0 && nominal_fps > 0.0 && (average_fps - nominal_fps).abs() > 0.05,
        rotation,
        video_codec: video
            .and_then(|s| s.get("codec_name"))
            .and_then(Value::as_str)
            .map(str::to_string),
        audio_codec: audio
            .and_then(|s| s.get("codec_name"))
            .and_then(Value::as_str)
            .map(str::to_string),
        audio_channels: ffmpeg::parse_u32(audio.and_then(|s| s.get("channels"))),
        sample_rate: ffmpeg::parse_u32(audio.and_then(|s| s.get("sample_rate"))),
        has_video: video.is_some(),
        has_audio: audio.is_some(),
        size_bytes,
        is_image: is_image_extension(path),
    })
}

#[tauri::command]
pub async fn register_media(
    path: String,
    registry: State<'_, MediaRegistry>,
) -> Result<RegisteredMedia, String> {
    let path = PathBuf::from(&path);
    if !path.is_file() {
        return Err(format!("File not found: {}", path.display()));
    }
    let info = probe(&path).await?;
    let id = registry.insert(path.clone());
    Ok(RegisteredMedia {
        id,
        path: path.to_string_lossy().to_string(),
        info,
    })
}

fn thumbs_dir(app: &AppHandle, source: &Path) -> PathBuf {
    let cache = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("librecut"));
    cache.join("thumbs").join(ffmpeg::cache_key(source))
}

#[tauri::command]
pub async fn generate_thumbnails(app: AppHandle, path: String) -> Result<Vec<String>, String> {
    let source = PathBuf::from(path);
    let info = probe(&source).await?;
    if !info.has_video || (info.duration <= 0.0 && !info.is_image) {
        return Ok(Vec::new());
    }

    let dir = thumbs_dir(&app, &source);
    if dir.exists() {
        let _ = fs::remove_dir_all(&dir);
    }
    fs::create_dir_all(&dir).map_err(|e| format!("Could not create thumbnail cache: {e}"))?;

    let count = if info.is_image { 1 } else { 12 };
    let pattern = dir.join("thumb_%03d.jpg");
    let mut command = ffmpeg::command(&ffmpeg::ffmpeg_bin());
    command.args(["-v", "error", "-y", "-i"]).arg(&source);
    if info.is_image {
        command.args(["-frames:v", "1", "-vf", "scale=180:-2"]);
    } else {
        let fps = (count as f64 / info.duration.max(0.1)).clamp(0.1, 4.0);
        command.args([
            "-vf",
            &format!("fps={fps:.4},scale=180:-2"),
            "-frames:v",
            &count.to_string(),
        ]);
    }
    let output = command
        .args(["-q:v", "6"])
        .arg(&pattern)
        .output()
        .await
        .map_err(|e| format!("Could not run ffmpeg: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Thumbnail generation failed: {}",
            ffmpeg::tail(&String::from_utf8_lossy(&output.stderr), 6)
        ));
    }

    let mut files: Vec<PathBuf> = fs::read_dir(&dir)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|e| e.to_str()) == Some("jpg"))
        .collect();
    files.sort();

    let mut result = Vec::with_capacity(files.len());
    for file in files {
        let bytes = fs::read(&file).map_err(|e| e.to_string())?;
        result.push(format!("data:image/jpeg;base64,{}", BASE64.encode(bytes)));
    }
    Ok(result)
}

#[tauri::command]
pub async fn generate_waveform(path: String, buckets: Option<u32>) -> Result<Vec<f32>, String> {
    let source = PathBuf::from(path);
    let bucket_count = buckets.unwrap_or(1200).clamp(64, 8000) as usize;

    let output = ffmpeg::command(&ffmpeg::ffmpeg_bin())
        .args(["-v", "error", "-i"])
        .arg(&source)
        .args([
            "-vn", "-ac", "1", "-ar", "8000", "-t", "1800", "-f", "f32le", "pipe:1",
        ])
        .output()
        .await
        .map_err(|e| format!("Could not run ffmpeg: {e}"))?;

    if !output.status.success() {
        return Err(format!(
            "Waveform generation failed: {}",
            ffmpeg::tail(&String::from_utf8_lossy(&output.stderr), 6)
        ));
    }

    let samples: Vec<f32> = output
        .stdout
        .chunks_exact(4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect();

    if samples.is_empty() {
        return Ok(vec![0.0; bucket_count * 2]);
    }

    let mut peaks = vec![0.0f32; bucket_count * 2];
    for (index, sample) in samples.iter().enumerate() {
        let bucket = (index * bucket_count / samples.len()).min(bucket_count - 1);
        let value = sample.clamp(-1.0, 1.0);
        peaks[bucket * 2] = peaks[bucket * 2].min(value);
        peaks[bucket * 2 + 1] = peaks[bucket * 2 + 1].max(value);
    }
    Ok(peaks)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MediaProgress {
    kind: &'static str,
    path: String,
    percent: f64,
}

#[tauri::command]
pub async fn create_proxy(
    app: AppHandle,
    path: String,
    height: Option<u32>,
) -> Result<RegisteredMedia, String> {
    let source = PathBuf::from(&path);
    if !source.is_file() {
        return Err(format!("File not found: {}", source.display()));
    }

    let info = probe(&source).await?;
    if !info.has_video {
        return Err("This file has no video stream.".to_string());
    }

    let height = height.unwrap_or(720).clamp(240, 1080);
    let cache = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("librecut"));
    let target =
        cache
            .join("proxies")
            .join(format!("{}_{}p.mp4", ffmpeg::cache_key(&source), height));

    let cached_proxy_is_valid = if target.is_file() {
        probe(&target).await.is_ok()
    } else {
        false
    };
    if !cached_proxy_is_valid {
        // An interrupted FFmpeg process can leave a partial file at the stable
        // cache path. Remove it so the next attempt regenerates a valid proxy.
        let _ = fs::remove_file(&target);
        ffmpeg::ensure_parent(&target)?;
        let mut child = ffmpeg::command(&ffmpeg::ffmpeg_bin())
            .args(["-v", "error", "-y", "-i"])
            .arg(&source)
            .args([
                "-vf",
                &format!("scale=-2:{height}"),
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "23",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "160k",
                "-movflags",
                "+faststart",
                "-progress",
                "pipe:1",
                "-nostats",
            ])
            .arg(&target)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Could not start ffmpeg: {e}"))?;

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
        while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? {
            if let Some(raw) = line.strip_prefix("out_time_ms=") {
                let micros = raw.parse::<f64>().unwrap_or(0.0);
                let percent = if info.duration > 0.0 {
                    (micros / 1_000_000.0 / info.duration * 100.0).clamp(0.0, 100.0)
                } else {
                    0.0
                };
                let _ = app.emit(
                    "media-progress",
                    MediaProgress {
                        kind: "proxy",
                        path: path.clone(),
                        percent,
                    },
                );
            }
        }

        let status = child.wait().await.map_err(|e| e.to_string())?;
        let stderr_text = stderr_task.await.unwrap_or_default();
        if !status.success() {
            let _ = fs::remove_file(&target);
            return Err(format!(
                "Proxy generation failed: {}",
                ffmpeg::tail(&stderr_text, 8)
            ));
        }
        let _ = app.emit(
            "media-progress",
            MediaProgress {
                kind: "proxy",
                path: path.clone(),
                percent: 100.0,
            },
        );
    }

    let info = probe(&target).await?;
    let id = app.state::<MediaRegistry>().insert(target.clone());
    Ok(RegisteredMedia {
        id,
        path: target.to_string_lossy().to_string(),
        info,
    })
}

#[tauri::command]
pub fn remove_proxy_cache(
    app: AppHandle,
    registry: State<'_, MediaRegistry>,
    proxy_id: String,
) -> Result<(), String> {
    let target = registry.get(&proxy_id).ok_or_else(|| {
        "This proxy is no longer registered. Reopen the project and retry.".to_string()
    })?;
    let cache = app
        .path()
        .app_cache_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("librecut"));
    let proxy_dir = cache.join("proxies");
    let canonical_dir = proxy_dir
        .canonicalize()
        .map_err(|error| format!("Could not access the proxy cache: {error}"))?;
    let canonical_target = target
        .canonicalize()
        .map_err(|error| format!("Could not access the cached proxy: {error}"))?;
    if !canonical_target.starts_with(&canonical_dir) {
        return Err("Refusing to remove a file outside the proxy cache.".to_string());
    }
    fs::remove_file(&canonical_target)
        .map_err(|error| format!("Could not remove the cached proxy: {error}"))?;
    registry.remove(&proxy_id);
    Ok(())
}

fn mime_for(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("mp4" | "m4v") => "video/mp4",
        Some("mov") => "video/quicktime",
        Some("webm") => "video/webm",
        Some("mkv") => "video/x-matroska",
        Some("avi") => "video/x-msvideo",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("m4a") => "audio/mp4",
        Some("aac") => "audio/aac",
        Some("ogg" | "opus") => "audio/ogg",
        Some("flac") => "audio/flac",
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("avif") => "image/avif",
        Some("gif") => "image/gif",
        _ => "application/octet-stream",
    }
}

fn parse_range(value: &str, len: u64) -> Option<(u64, u64)> {
    let spec = value.strip_prefix("bytes=")?;
    let (start, end) = spec.split_once('-')?;
    if start.is_empty() {
        let suffix = end.parse::<u64>().ok()?;
        if suffix == 0 {
            return None;
        }
        return Some((len.saturating_sub(suffix), len.saturating_sub(1)));
    }
    let start = start.parse::<u64>().ok()?;
    let end = if end.is_empty() {
        len.saturating_sub(1)
    } else {
        end.parse::<u64>().ok()?.min(len.saturating_sub(1))
    };
    if start > end || start >= len {
        return None;
    }
    Some((start, end))
}

fn with_common_headers(builder: tauri::http::response::Builder) -> tauri::http::response::Builder {
    builder
        .header("Access-Control-Allow-Origin", "*")
        .header(
            "Access-Control-Expose-Headers",
            "Content-Range, Content-Length, Accept-Ranges",
        )
        .header("Accept-Ranges", "bytes")
        .header("Cache-Control", "no-store")
}

fn not_found() -> Response<Vec<u8>> {
    with_common_headers(Response::builder().status(StatusCode::NOT_FOUND))
        .header("Content-Type", "text/plain")
        .body(b"Media not found".to_vec())
        .unwrap()
}

pub fn handle_protocol<R: Runtime>(
    app: &AppHandle<R>,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if request.method() == tauri::http::Method::OPTIONS {
        return with_common_headers(Response::builder().status(StatusCode::NO_CONTENT))
            .body(Vec::new())
            .unwrap();
    }

    let path = request.uri().path().trim_start_matches('/');
    let mut parts = path.split('/');
    let scope = parts.next().unwrap_or_default();
    let id = parts.next().unwrap_or_default();
    if scope != "media" {
        return not_found();
    }

    let decoded = percent_encoding::percent_decode_str(id)
        .decode_utf8_lossy()
        .to_string();
    let Some(file_path) = app.state::<MediaRegistry>().get(&decoded) else {
        return not_found();
    };
    let Ok(mut file) = fs::File::open(&file_path) else {
        return not_found();
    };
    let Ok(meta) = file.metadata() else {
        return not_found();
    };
    let len = meta.len();
    let mime = mime_for(&file_path);

    let range_header = request
        .headers()
        .get("range")
        .and_then(|value| value.to_str().ok());

    if request.method() == tauri::http::Method::HEAD {
        return with_common_headers(Response::builder().status(StatusCode::OK))
            .header("Content-Type", mime)
            .header("Content-Length", len.to_string())
            .body(Vec::new())
            .unwrap();
    }

    if let Some(range) = range_header {
        let Some((start, end)) = parse_range(range, len) else {
            return with_common_headers(
                Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header("Content-Range", format!("bytes */{len}")),
            )
            .body(Vec::new())
            .unwrap();
        };
        let length = end - start + 1;
        let mut buffer = vec![0u8; length as usize];
        if file.seek(SeekFrom::Start(start)).is_err() || file.read_exact(&mut buffer).is_err() {
            return not_found();
        }
        return with_common_headers(Response::builder().status(StatusCode::PARTIAL_CONTENT))
            .header("Content-Type", mime)
            .header("Content-Length", length.to_string())
            .header("Content-Range", format!("bytes {start}-{end}/{len}"))
            .body(buffer)
            .unwrap();
    }

    // Full responses are only expected for small files. Browsers issue range
    // requests for video, which is the common path above.
    if len > 256 * 1024 * 1024 {
        return with_common_headers(
            Response::builder()
                .status(StatusCode::RANGE_NOT_SATISFIABLE)
                .header("Content-Range", format!("bytes */{len}")),
        )
        .body(Vec::new())
        .unwrap();
    }

    let mut buffer = Vec::with_capacity(len as usize);
    if file.read_to_end(&mut buffer).is_err() {
        return not_found();
    }
    with_common_headers(Response::builder().status(StatusCode::OK))
        .header("Content-Type", mime)
        .header("Content-Length", len.to_string())
        .body(buffer)
        .unwrap()
}
