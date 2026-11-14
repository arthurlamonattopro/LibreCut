use serde::{Deserialize, Serialize};

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportClip {
    pub path: String,
    /// The track the clip belongs to, used to find neighbouring clips.
    #[serde(default)]
    pub track_id: Option<String>,
    pub start: f64,
    pub duration: f64,
    pub trim_in: f64,
    #[serde(default = "default_speed")]
    pub speed: f64,
    #[serde(default)]
    pub speed_ramp: Vec<ExportSpeedPoint>,
    pub volume: f64,
    pub opacity: f64,
    pub has_audio: bool,
    #[serde(default)]
    pub has_video: bool,
    pub is_image: bool,
    #[serde(default)]
    pub fit: Option<String>,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default = "default_scale")]
    pub scale: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default)]
    pub mask: Option<String>,
    #[serde(default = "default_mask_x")]
    pub mask_x: f64,
    #[serde(default = "default_mask_y")]
    pub mask_y: f64,
    #[serde(default = "default_mask_size")]
    pub mask_width: f64,
    #[serde(default = "default_mask_size")]
    pub mask_height: f64,
    #[serde(default)]
    pub mask_rotation: f64,
    #[serde(default)]
    pub mask_points: Vec<ExportMaskPoint>,
    #[serde(default)]
    pub chroma_key: Option<ExportChromaKey>,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    #[serde(default)]
    pub pitch: f64,
    #[serde(default)]
    pub bass: f64,
    #[serde(default)]
    pub treble: f64,
    #[serde(default)]
    pub mid: f64,
    #[serde(default = "default_bass_frequency")]
    pub bass_frequency: f64,
    #[serde(default = "default_mid_frequency")]
    pub mid_frequency: f64,
    #[serde(default = "default_mid_width")]
    pub mid_width: f64,
    #[serde(default = "default_treble_frequency")]
    pub treble_frequency: f64,
    #[serde(default)]
    pub pan: f64,
    #[serde(default)]
    pub compressor: Option<ExportCompressor>,
    #[serde(default)]
    pub duck_segments: Vec<ExportDuckSegment>,
    #[serde(default)]
    pub keyframes: Vec<ExportKeyframe>,
    #[serde(default)]
    pub transition_in: ExportTransition,
    #[serde(default)]
    pub transition_out: ExportTransition,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportMaskPoint {
    pub x: f64,
    pub y: f64,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportCompressor {
    #[serde(default)]
    pub enabled: bool,
    /// Threshold in decibels.
    #[serde(default)]
    pub threshold: f64,
    #[serde(default = "default_ratio")]
    pub ratio: f64,
    /// Attack time in milliseconds.
    #[serde(default = "default_compressor_attack")]
    pub attack: f64,
    /// Release time in milliseconds.
    #[serde(default = "default_compressor_release")]
    pub release: f64,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportDuckSegment {
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: f64,
    #[serde(default = "default_duck_from")]
    pub from: f64,
    #[serde(default = "default_duck_from")]
    pub to: f64,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportSpeedPoint {
    #[serde(default)]
    pub time: f64,
    #[serde(default = "default_speed")]
    pub speed: f64,
}

#[derive(Clone, Debug)]
pub(super) struct SpeedSegment {
    pub(super) speed: f64,
    pub(super) source_start: f64,
    pub(super) source_duration: f64,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportChromaKey {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub similarity: f64,
    #[serde(default)]
    pub softness: f64,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportText {
    pub text: String,
    pub start: f64,
    pub duration: f64,
    pub x: f64,
    pub y: f64,
    pub size: f64,
    pub color: String,
    #[serde(default)]
    pub font_weight: Option<String>,
    #[serde(default)]
    pub italic: bool,
    #[serde(default)]
    pub font_family: Option<String>,
    #[serde(default)]
    pub align: Option<String>,
    #[serde(default)]
    pub underline: bool,
    #[serde(default)]
    pub character_spacing: f64,
    #[serde(default = "default_line_height")]
    pub line_height: f64,
    #[serde(default)]
    pub outline_color: Option<String>,
    #[serde(default)]
    pub outline_width: f64,
    #[serde(default)]
    pub background_color: Option<String>,
    #[serde(default)]
    pub background_opacity: f64,
    #[serde(default = "default_text_brightness")]
    pub brightness: f64,
    #[serde(default)]
    pub shadow: f64,
    #[serde(default)]
    pub shadow_color: Option<String>,
    #[serde(default)]
    pub curve: f64,
    #[serde(default)]
    pub rotation: f64,
    #[serde(default = "default_text_brightness")]
    pub opacity: f64,
    #[serde(default)]
    pub keyframes: Vec<ExportKeyframe>,
    #[serde(default)]
    pub transition_in: ExportTransition,
    #[serde(default)]
    pub transition_out: ExportTransition,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportKeyframe {
    pub property: String,
    pub time: f64,
    pub value: f64,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ExportTransition {
    #[serde(rename = "type", default)]
    pub transition_type: String,
    #[serde(default)]
    pub duration: f64,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportEffect {
    pub start: f64,
    pub duration: f64,
    pub opacity: f64,
    pub brightness: f64,
    pub contrast: f64,
    pub saturation: f64,
    pub hue: f64,
    #[serde(default)]
    pub sepia: f64,
    pub blur: f64,
    #[serde(default)]
    pub vignette: f64,
    #[serde(default)]
    pub motion_blur: f64,
    #[serde(default)]
    pub fade_in: f64,
    #[serde(default)]
    pub fade_out: f64,
    pub mask: String,
    pub mask_x: f64,
    pub mask_y: f64,
    pub mask_size: f64,
    #[serde(default)]
    pub lut: Option<ExportLut>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportLut {
    pub title: String,
    pub size: usize,
    pub cube_text: String,
    pub strength: f64,
    #[serde(default)]
    pub lut_path: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub output: String,
    pub width: u32,
    pub height: u32,
    pub fps: f64,
    pub duration: f64,
    pub clips: Vec<ExportClip>,
    pub texts: Vec<ExportText>,
    #[serde(default)]
    pub effects: Vec<ExportEffect>,
    #[serde(default)]
    pub encoder: Option<String>,
    #[serde(default)]
    pub quality: Option<String>,
    /// Output audio codec: `aac` (default) or `alac`.
    #[serde(default)]
    pub audio_codec: Option<String>,
    /// AAC bitrate in kbps. Ignored by lossless codecs.
    #[serde(default)]
    pub audio_bitrate: Option<u32>,
    /// Output sample rate in hertz. The mix is rendered at 48 kHz internally.
    #[serde(default)]
    pub audio_sample_rate: Option<u32>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub output: String,
    pub elapsed_ms: u128,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgress {
    pub percent: f64,
    pub time: f64,
    pub speed: String,
    pub fps: f64,
}

fn default_speed() -> f64 {
    1.0
}

fn default_scale() -> f64 {
    1.0
}
fn default_mask_x() -> f64 {
    0.5
}
fn default_mask_y() -> f64 {
    0.5
}
fn default_mask_size() -> f64 {
    0.6
}
fn default_text_brightness() -> f64 {
    1.0
}
fn default_line_height() -> f64 {
    1.2
}
fn default_bass_frequency() -> f64 {
    180.0
}
fn default_mid_frequency() -> f64 {
    1000.0
}
fn default_mid_width() -> f64 {
    1.0
}
fn default_treble_frequency() -> f64 {
    4000.0
}
fn default_ratio() -> f64 {
    4.0
}
fn default_compressor_attack() -> f64 {
    12.0
}
fn default_compressor_release() -> f64 {
    180.0
}
fn default_duck_from() -> f64 {
    1.0
}
