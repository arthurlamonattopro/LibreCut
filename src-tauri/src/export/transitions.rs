use std::collections::HashMap;

use super::model::*;

/// True when a transition edge asks for a transition.
pub(super) fn transition_enabled(transition: &ExportTransition) -> bool {
    !transition.transition_type.trim().is_empty() && transition.transition_type != "none"
}

/// The opacity a clip gets from a transition edge that has no neighbour.
///
/// A transition that belongs to a cut is rendered with the `xfade` filter and
/// never reaches this function. What is left is an edge that fades against
/// the background, which is what the preview draws as well.
pub(super) fn transition_fade_expr(
    transition: &ExportTransition,
    edge: &str,
    start: f64,
    duration: f64,
) -> String {
    if !transition_enabled(transition) || transition.duration <= 0.0 {
        return "1".to_string();
    }
    let amount = transition.duration.min(duration).max(0.001);
    if edge == "in" {
        format!(
            "if(lt(T,{:.6}),max(0,(T-{start:.6})/{amount:.6}),1)",
            start + amount
        )
    } else {
        format!(
            "if(gt(T,{:.6}),max(0,({:.6}-T)/{amount:.6}),1)",
            start + duration - amount,
            start + duration
        )
    }
}

/// The FFmpeg `xfade` transitions this build knows about.
///
/// Anything else falls back to a plain crossfade, so a project file with an
/// unknown name still renders.
pub const XFADE_TRANSITIONS: &[&str] = &[
    "fade",
    "fadefast",
    "fadeslow",
    "fadeblack",
    "fadewhite",
    "fadegrays",
    "dissolve",
    "wipeleft",
    "wiperight",
    "wipeup",
    "wipedown",
    "smoothleft",
    "smoothright",
    "smoothup",
    "smoothdown",
    "wipetl",
    "wipetr",
    "wipebl",
    "wipebr",
    "diagtl",
    "diagtr",
    "diagbl",
    "diagbr",
    "slideleft",
    "slideright",
    "slideup",
    "slidedown",
    "coverleft",
    "coverright",
    "coverup",
    "coverdown",
    "revealleft",
    "revealright",
    "revealup",
    "revealdown",
    "circleopen",
    "circleclose",
    "circlecrop",
    "rectcrop",
    "vertopen",
    "vertclose",
    "horzopen",
    "horzclose",
    "hlslice",
    "hrslice",
    "vuslice",
    "vdslice",
    "hlwind",
    "hrwind",
    "vuwind",
    "vdwind",
    "pixelize",
    "hblur",
    "radial",
    "distance",
    "zoomin",
    "squeezeh",
    "squeezev",
];

/// The FFmpeg transition name for a transition.
fn xfade_transition(name: &str) -> String {
    let normalized = name.trim().to_ascii_lowercase();
    // `wipe` is the name older projects used for a left-to-right wipe.
    let normalized = if normalized == "wipe" {
        "wiperight".to_string()
    } else {
        normalized
    };
    if XFADE_TRANSITIONS.contains(&normalized.as_str()) {
        normalized
    } else {
        "fade".to_string()
    }
}

/// A transition that plays on the cut between two neighbouring clips.
#[derive(Clone, Debug)]
pub(super) struct CutTransition {
    /// The index of the clip that hands over.
    pub(super) from: usize,
    /// The index of the clip that takes over.
    pub(super) to: usize,
    /// The FFmpeg transition name.
    pub(super) transition: String,
    /// The length of the transition in seconds.
    pub(super) duration: f64,
    /// The time the transition starts on the project timeline.
    pub(super) start: f64,
}

/// Every transition in an export, keyed by the clip it plays into or out of.
#[derive(Default)]
pub(super) struct TransitionPlan {
    /// The transition that plays into a clip.
    pub(super) incoming: HashMap<usize, CutTransition>,
    /// The transition that plays out of a clip.
    pub(super) outgoing: HashMap<usize, CutTransition>,
}

/// Finds the transitions of an export.
///
/// A transition belongs to the cut between two neighbouring clips, so either
/// edge can describe it and the incoming edge wins when both do. The window
/// sits at the start of the incoming clip: the clip that goes away is held on
/// its last frame while the new one moves in.
pub(super) fn plan_transitions(request: &ExportRequest) -> TransitionPlan {
    let mut plan = TransitionPlan::default();
    let mut tracks: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, clip) in request.clips.iter().enumerate() {
        if !clip.has_video && !clip.is_image {
            continue;
        }
        tracks
            .entry(clip.track_id.clone().unwrap_or_default())
            .or_default()
            .push(index);
    }

    for (_, mut indices) in tracks {
        indices.sort_by(|a, b| request.clips[*a].start.total_cmp(&request.clips[*b].start));
        for pair in indices.windows(2) {
            let from = pair[0];
            let to = pair[1];
            let previous = &request.clips[from];
            let next = &request.clips[to];
            // Only clips that touch can hand over to each other.
            if (next.start - (previous.start + previous.duration)).abs() > 0.05 {
                continue;
            }
            let incoming = &next.transition_in;
            let outgoing = &previous.transition_out;
            let source = if transition_enabled(incoming) {
                Some(incoming)
            } else if transition_enabled(outgoing) {
                Some(outgoing)
            } else {
                None
            };
            let Some(source) = source else { continue };
            let duration = source.duration.min(next.duration).clamp(0.04, 5.0);
            let cut = CutTransition {
                from,
                to,
                transition: xfade_transition(&source.transition_type),
                duration,
                start: next.start,
            };
            plan.incoming.insert(to, cut.clone());
            plan.outgoing.insert(from, cut);
        }
    }
    plan
}
