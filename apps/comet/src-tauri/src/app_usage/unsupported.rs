use super::{Application, Sample};

pub(super) fn applications() -> Result<Vec<Application>, String> {
    Err("앱 전면 사용 측정은 현재 Windows에서만 지원해요. macOS와 Linux는 잠금 상태를 확실히 확인할 수 없어 아직 지원하지 않아요. 집중 타이머는 그대로 사용할 수 있어요.".into())
}

pub(super) fn sample() -> Sample {
    // Do not infer an unlocked session from undocumented/sparse macOS flags or
    // from X11 foreground data; Wayland also hides other apps' foreground state.
    Sample::inactive("unsupported")
}
