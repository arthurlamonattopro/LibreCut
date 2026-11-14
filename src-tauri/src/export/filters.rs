use std::path::Path;

use super::model::*;

/// Builds the alpha mask of a video clip as an FFmpeg `geq` filter.
pub(super) fn clip_mask_filter(clip: &ExportClip) -> String {
    let mask = clip.mask.as_deref().unwrap_or("none");
    if mask == "none" {
        return String::new();
    }
    let x = clip.mask_x.clamp(0.0, 1.0);
    let y = clip.mask_y.clamp(0.0, 1.0);
    let width = clip.mask_width.clamp(0.01, 4.0);
    let height = clip.mask_height.clamp(0.01, 4.0);

    match mask {
        "circle" => {
            let radius = width / 2.0;
            format!(
                ",geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*if(lte(pow(X-{x:.6}*W,2)+pow(Y-{y:.6}*H,2),pow({radius:.6}*min(W,H),2)),1,0)'"
            )
        }
        "square" | "rectangle" => {
            let half_width = width / 2.0;
            let half_height = if mask == "square" {
                width / 2.0
            } else {
                height / 2.0
            };
            let (sin, cos) = clip.mask_rotation.to_radians().sin_cos();
            let dx = format!("(X-{x:.6}*W)");
            let dy = format!("(Y-{y:.6}*H)");
            let rotated_x = format!("({dx}*{cos:.9}+{dy}*{sin:.9})");
            let rotated_y = format!("(-{dx}*{sin:.9}+{dy}*{cos:.9})");
            format!(
                ",geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*if(lt(abs({rotated_x}),{half_width:.6}*min(W,H))*lt(abs({rotated_y}),{half_height:.6}*min(W,H)),1,0)'"
            )
        }
        "custom" => custom_mask_filter(&clip.mask_points),
        _ => String::new(),
    }
}

/// Point-in-polygon test for a custom mask, expanded as a geq expression.
///
/// The points are normalized, so each vertex is scaled by the frame size. A
/// ray cast to the right counts the edges to the right of every pixel; an odd
/// count means the pixel is inside the polygon.
fn custom_mask_filter(points: &[ExportMaskPoint]) -> String {
    if points.len() < 3 {
        return String::new();
    }
    let points = &points[..points.len().min(32)];
    let mut terms = Vec::new();
    for index in 0..points.len() {
        let from = &points[index];
        let to = &points[(index + 1) % points.len()];
        let from_x = from.x.clamp(-1.0, 2.0);
        let from_y = from.y.clamp(-1.0, 2.0);
        let to_x = to.x.clamp(-1.0, 2.0);
        let to_y = to.y.clamp(-1.0, 2.0);
        if (to_y - from_y).abs() < 1e-6 {
            continue;
        }
        // The two vertices are on opposite sides of the pixel row.
        let crosses = format!("abs(gt({from_y:.6}*H,Y)-gt({to_y:.6}*H,Y))");
        // The edge crosses the horizontal ray to the right of the pixel.
        let intersection = format!(
            "lt(X,(({to_x:.6}-{from_x:.6})/({to_y:.6}-{from_y:.6}))*(Y-{from_y:.6}*H)+{from_x:.6}*W)"
        );
        terms.push(format!("({crosses})*({intersection})"));
    }
    if terms.is_empty() {
        return String::new();
    }
    format!(
        ",geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*if(gt(mod({},2),0.5),1,0)'",
        terms.join("+")
    )
}

pub(super) fn atempo_filters(speed: f64) -> String {
    let mut factor = speed.clamp(0.25, 4.0);
    let mut filters: Vec<String> = Vec::new();
    while factor > 2.0 {
        filters.push("atempo=2.0".to_string());
        factor /= 2.0;
    }
    while factor < 0.5 {
        filters.push("atempo=0.5".to_string());
        factor /= 0.5;
    }
    if (factor - 1.0).abs() > 0.001 {
        filters.push(format!("atempo={factor:.4}"));
    }
    filters.join(",")
}

pub(super) fn normalize_speed_ramp(points: &[ExportSpeedPoint], duration: f64) -> Vec<(f64, f64)> {
    let safe_duration = duration.max(0.1);
    let mut ramp: Vec<(f64, f64)> = points
        .iter()
        .filter(|point| point.time.is_finite() && point.speed.is_finite())
        .map(|point| {
            (
                point.time.clamp(0.0, safe_duration),
                point.speed.clamp(0.25, 4.0),
            )
        })
        .collect();
    ramp.sort_by(|a, b| a.0.total_cmp(&b.0));

    let mut unique: Vec<(f64, f64)> = Vec::new();
    for point in ramp {
        if let Some(last) = unique.last_mut() {
            if (last.0 - point.0).abs() < 1e-4 {
                *last = point;
                continue;
            }
        }
        unique.push(point);
    }

    if unique.len() < 2 {
        return Vec::new();
    }
    if unique[0].0 > 1e-4 {
        unique.insert(0, (0.0, unique[0].1));
    }
    if unique[unique.len() - 1].0 < safe_duration - 1e-4 {
        let speed = unique[unique.len() - 1].1;
        unique.push((safe_duration, speed));
    }
    unique
}

fn speed_at(ramp: &[(f64, f64)], time: f64) -> f64 {
    for index in 0..ramp.len().saturating_sub(1) {
        let (from_time, from_speed) = ramp[index];
        let (to_time, to_speed) = ramp[index + 1];
        if time <= to_time {
            let span = (to_time - from_time).max(1e-6);
            return from_speed + (to_speed - from_speed) * ((time - from_time) / span);
        }
    }
    ramp.last().map(|point| point.1).unwrap_or(1.0)
}

/// How finely a ramp is split for the audio graph. Video uses the continuous
/// curve below; `atempo` can only hold a constant factor, so audio is sampled.
const RAMP_SEGMENT_SECONDS: f64 = 0.02;
const RAMP_SPEED_STEP: f64 = 0.01;
const MAX_RAMP_SEGMENTS: usize = 600;

pub(super) fn speed_segments(points: &[ExportSpeedPoint], duration: f64) -> Vec<SpeedSegment> {
    let safe_duration = duration.max(0.05);
    let ramp = normalize_speed_ramp(points, safe_duration);
    if ramp.len() < 2 {
        return vec![SpeedSegment {
            speed: 1.0,
            source_start: 0.0,
            source_duration: safe_duration,
        }];
    }

    // Sampling follows the curve rather than the clock alone: a fast ramp gets
    // short segments where the speed moves, targeting one percent of speed and
    // twenty milliseconds of output time, capped at MAX_RAMP_SEGMENTS.
    let speed_span: f64 = ramp
        .windows(2)
        .map(|pair| (pair[1].1 - pair[0].1).abs())
        .sum();
    let by_change = (speed_span / RAMP_SPEED_STEP).ceil() as usize;
    let by_time = (safe_duration / RAMP_SEGMENT_SECONDS).ceil() as usize;
    let sample_count = MAX_RAMP_SEGMENTS.min((ramp.len() - 1).max(by_change).max(by_time).max(1));
    let step = safe_duration / sample_count as f64;
    let mut segments = Vec::with_capacity(sample_count);
    let mut source_cursor = 0.0;
    for index in 0..sample_count {
        let start = index as f64 * step;
        let end = if index == sample_count - 1 {
            safe_duration
        } else {
            (index + 1) as f64 * step
        };
        let speed = speed_at(&ramp, (start + end) / 2.0).clamp(0.25, 4.0);
        let segment_duration = end - start;
        let source_duration = speed * segment_duration;
        segments.push(SpeedSegment {
            speed,
            source_start: source_cursor,
            source_duration,
        });
        source_cursor += source_duration;
    }
    segments
}

/// Source seconds consumed by the ramp from the clip start to `time`.
pub(super) fn speed_source_offset(ramp: &[(f64, f64)], time: f64) -> f64 {
    let mut source = 0.0;
    for pair in ramp.windows(2) {
        let (from_time, from_speed) = pair[0];
        let (to_time, to_speed) = pair[1];
        if time <= from_time {
            break;
        }
        let end = time.min(to_time);
        let span = (end - from_time).max(0.0);
        if span <= 0.0 {
            continue;
        }
        let span_total = (to_time - from_time).max(1e-6);
        let slope = (to_speed - from_speed) / span_total;
        source += from_speed * span + 0.5 * slope * span * span;
        if time <= to_time {
            break;
        }
    }
    source
}

/// Inverse of [`speed_source_offset`] for one linear ramp interval: the output
/// time at which the given amount of source has been consumed.
fn interval_inverse(
    from_time: f64,
    from_speed: f64,
    to_speed: f64,
    source_start: f64,
    span: f64,
) -> String {
    let slope = (to_speed - from_speed) / span.max(1e-6);
    let source = format!("((T-STARTT)-{source_start:.6})");
    if slope.abs() < 1e-6 {
        format!("{from_time:.6}+({source})/{from_speed:.6}")
    } else {
        // Solve source = s0*d + slope*d^2/2 for d, the time into the interval.
        format!(
            "{from_time:.6}+(sqrt({from_speed:.6}*{from_speed:.6}+2*({slope:.6})*({source}))-{from_speed:.6})/({slope:.6})"
        )
    }
}

/// `setpts` expression that maps trimmed source time back to output time for
/// the continuous, linearly interpolated speed curve.
///
/// A ramp is linear between its points, so each interval inverts exactly with
/// one quadratic expression. The graph therefore carries one branch per ramp
/// point, not a fixed number of constant-speed steps.
pub(super) fn speed_setpts_expr(ramp: &[(f64, f64)]) -> String {
    if ramp.len() < 2 {
        return "(T-STARTT)".to_string();
    }

    let mut source_starts = Vec::with_capacity(ramp.len());
    source_starts.push(0.0);
    let mut source = 0.0;
    for pair in ramp.windows(2) {
        let (from_time, from_speed) = pair[0];
        let (to_time, to_speed) = pair[1];
        source += (from_speed + to_speed) * 0.5 * (to_time - from_time).max(0.0);
        source_starts.push(source);
    }

    let last = ramp.len() - 2;
    let mut expr = interval_inverse(
        ramp[last].0,
        ramp[last].1,
        ramp[last + 1].1,
        source_starts[last],
        ramp[last + 1].0 - ramp[last].0,
    );
    for index in (0..last).rev() {
        let interval = interval_inverse(
            ramp[index].0,
            ramp[index].1,
            ramp[index + 1].1,
            source_starts[index],
            ramp[index + 1].0 - ramp[index].0,
        );
        expr = format!(
            "if(lt((T-STARTT),{:.6}),{interval},{expr})",
            source_starts[index + 1]
        );
    }
    let end_time = ramp[last + 1].0;
    let end_speed = ramp[last + 1].1;
    let end_source = source_starts[last + 1];
    format!(
        "if(lt((T-STARTT),{end_source:.6}),{expr},{end_time:.6}+((T-STARTT)-{end_source:.6})/{end_speed:.6})"
    )
}

pub(super) fn escape_text(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace(':', "\\:")
        .replace('%', "\\%")
        .replace('\n', "\\n")
}

/// Wraps a filter option value that holds an expression in quotes.
///
/// FFmpeg reads a comma as the end of a filter, so an expression with a comma
/// inside it — a keyframe ramp or a speed ramp — has to be quoted before it
/// goes into the graph. The quotes are stripped again when FFmpeg parses the
/// option, so the expression itself stays untouched.
pub(super) fn quoted(value: &str) -> String {
    format!("'{value}'")
}

pub(super) fn drawtext_color(color: &str, brightness: f64) -> String {
    if let Some(hex) = color.strip_prefix('#') {
        if hex.len() == 6 {
            let scaled: Vec<u8> = (0..3)
                .map(|i| {
                    let channel = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap_or(255);
                    (channel as f64 * brightness.clamp(0.0, 2.0))
                        .round()
                        .clamp(0.0, 255.0) as u8
                })
                .collect();
            format!("0x{:02x}{:02x}{:02x}", scaled[0], scaled[1], scaled[2])
        } else {
            format!("0x{hex}")
        }
    } else {
        color.to_string()
    }
}

pub(super) fn font_file(weight: Option<&str>, family: Option<&str>, italic: bool) -> String {
    if let Ok(override_font) = std::env::var("LIBRECUT_FONT") {
        return override_font;
    }
    let bold = weight == Some("bold");
    let family = family.unwrap_or("Segoe UI").to_ascii_lowercase();
    let faces = match family.as_str() {
        "georgia" => (
            "georgia.ttf",
            "georgiab.ttf",
            "georgiai.ttf",
            "georgiaz.ttf",
        ),
        "times new roman" => ("times.ttf", "timesbd.ttf", "timesi.ttf", "timesbi.ttf"),
        "courier new" => ("cour.ttf", "courbd.ttf", "couri.ttf", "courbi.ttf"),
        "impact" => ("impact.ttf", "impact.ttf", "impact.ttf", "impact.ttf"),
        "trebuchet ms" => ("trebuc.ttf", "trebucbd.ttf", "trebucit.ttf", "trebucbi.ttf"),
        "verdana" => (
            "verdana.ttf",
            "verdanab.ttf",
            "verdanai.ttf",
            "verdanaz.ttf",
        ),
        "arial" => ("arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf"),
        _ => (
            "segoeui.ttf",
            "segoeuib.ttf",
            "segoeuii.ttf",
            "segoeuiz.ttf",
        ),
    };
    let file = match (bold, italic) {
        (true, true) => faces.3,
        (true, false) => faces.1,
        (false, true) => faces.2,
        (false, false) => faces.0,
    };
    let fallback = if bold { "arialbd.ttf" } else { "arial.ttf" };
    let chosen = if Path::new(&format!(r"C:\Windows\Fonts\{file}")).is_file() {
        file
    } else {
        fallback
    };
    if Path::new(&format!(r"C:\Windows\Fonts\{chosen}")).is_file() {
        format!("C\\:/Windows/Fonts/{chosen}")
    } else if bold {
        "Arial Bold".to_string()
    } else {
        "Arial".to_string()
    }
}

pub(super) fn keyframe_expr(
    keyframes: &[ExportKeyframe],
    property: &str,
    base: f64,
    local: &str,
) -> String {
    let mut frames: Vec<&ExportKeyframe> = keyframes
        .iter()
        .filter(|frame| frame.property == property)
        .collect();
    frames.sort_by(|a, b| a.time.total_cmp(&b.time));
    if frames.is_empty() {
        return format!("{base:.6}");
    }
    let mut expr = format!("{:.6}", frames.last().unwrap().value);
    if frames.len() > 1 {
        for index in (0..frames.len() - 1).rev() {
            let from = frames[index];
            let to = frames[index + 1];
            let span = (to.time - from.time).max(0.001);
            expr = format!(
                "if(lt({local},{:.6}),{:.6}+({:.6})*(({local}-{:.6})/{span:.6}),{expr})",
                to.time,
                from.value,
                to.value - from.value,
                from.time
            );
        }
    }
    format!("if(lt({local},{:.6}),{base:.6},{expr})", frames[0].time)
}

/// Stereo pan gains that match the Web Audio API panning law.
pub(super) fn pan_gains(pan: f64) -> (f64, f64) {
    let value = pan.clamp(-1.0, 1.0);
    if value < 0.0 {
        ((value * std::f64::consts::PI / 2.0).cos(), 1.0 + value)
    } else if value > 0.0 {
        (1.0 - value, (value * std::f64::consts::PI / 2.0).sin())
    } else {
        (1.0, 1.0)
    }
}

/// Builds a volume expression that applies a ducking envelope on the project
/// timeline. Segments are absolute time ramps with a start and end gain.
pub(super) fn duck_volume_expr(segments: &[ExportDuckSegment]) -> Option<String> {
    let mut usable: Vec<&ExportDuckSegment> = segments
        .iter()
        .filter(|segment| segment.end > segment.start)
        .collect();
    if usable.is_empty() {
        return None;
    }
    usable.sort_by(|a, b| a.start.total_cmp(&b.start));

    let mut expr = String::from("1");
    for segment in usable.iter().rev() {
        let span = segment.end - segment.start;
        let ramp = if span > 0.0005 {
            format!(
                "({:.6})+({:.6})*max(0,min(1,(t-{:.6})/{:.6}))",
                segment.from,
                segment.to - segment.from,
                segment.start,
                span
            )
        } else {
            format!("{:.6}", segment.to)
        };
        expr = format!("if(lt(t,{:.6}),{ramp},{expr})", segment.end);
    }
    Some(expr)
}
