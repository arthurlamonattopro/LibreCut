/// Arguments for the exported audio stream.
///
/// The mix is always built at 48 kHz internally; `-ar` resamples it to the
/// requested output rate, so a different sample rate never changes the edit.
/// Only the codecs the MP4 muxer can carry are accepted here.
pub(super) fn audio_encoder_args(
    codec: Option<&str>,
    bitrate: Option<u32>,
    sample_rate: Option<u32>,
) -> Result<Vec<String>, String> {
    let sample_rate = sample_rate.unwrap_or(48000);
    if !(8000..=192000).contains(&sample_rate) {
        return Err(format!("Unsupported audio sample rate: {sample_rate} Hz."));
    }
    match codec.unwrap_or("aac") {
        "aac" => {
            let bitrate = bitrate.unwrap_or(192);
            if !(32..=512).contains(&bitrate) {
                return Err(format!("Unsupported AAC bitrate: {bitrate} kbps."));
            }
            Ok(vec![
                "-c:a".into(),
                "aac".into(),
                "-b:a".into(),
                format!("{bitrate}k"),
                "-ar".into(),
                sample_rate.to_string(),
            ])
        }
        "alac" => Ok(vec![
            "-c:a".into(),
            "alac".into(),
            "-ar".into(),
            sample_rate.to_string(),
        ]),
        other => Err(format!("Unsupported audio codec: {other}.")),
    }
}

pub(super) fn encoder_args(encoder: Option<&str>, quality: Option<&str>) -> Vec<String> {
    let (crf, cq, global_quality, qp) = match quality.unwrap_or("balanced") {
        "draft" => ("27", "27", "27", "27"),
        "high" => ("16", "16", "16", "16"),
        _ => ("20", "20", "22", "20"),
    };
    match encoder.unwrap_or("libx264") {
        "nvenc" => vec![
            "-c:v".into(),
            "h264_nvenc".into(),
            "-preset".into(),
            "p4".into(),
            "-cq".into(),
            cq.into(),
            "-b:v".into(),
            "0".into(),
        ],
        "qsv" => vec![
            "-c:v".into(),
            "h264_qsv".into(),
            "-global_quality".into(),
            global_quality.into(),
        ],
        "amf" => vec![
            "-c:v".into(),
            "h264_amf".into(),
            "-quality".into(),
            "balanced".into(),
            "-rc".into(),
            "cqp".into(),
            "-qp_i".into(),
            qp.into(),
            "-qp_p".into(),
            qp.into(),
        ],
        _ => vec![
            "-c:v".into(),
            "libx264".into(),
            "-preset".into(),
            "veryfast".into(),
            "-crf".into(),
            crf.into(),
        ],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_defaults_to_aac_192_at_48_khz() {
        assert_eq!(
            audio_encoder_args(None, None, None).unwrap(),
            vec!["-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
        );
    }

    #[test]
    fn aac_accepts_a_bitrate_and_sample_rate() {
        assert_eq!(
            audio_encoder_args(Some("aac"), Some(320), Some(96000)).unwrap(),
            vec!["-c:a", "aac", "-b:a", "320k", "-ar", "96000"]
        );
    }

    #[test]
    fn alac_is_lossless_and_ignores_the_bitrate() {
        assert_eq!(
            audio_encoder_args(Some("alac"), Some(320), Some(44100)).unwrap(),
            vec!["-c:a", "alac", "-ar", "44100"]
        );
    }

    #[test]
    fn unknown_codecs_and_out_of_range_values_are_refused() {
        assert!(audio_encoder_args(Some("vorbis"), None, None).is_err());
        assert!(audio_encoder_args(Some("aac"), Some(9999), None).is_err());
        assert!(audio_encoder_args(Some("aac"), None, Some(1234)).is_err());
    }
}
