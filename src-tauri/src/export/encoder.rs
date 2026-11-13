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
