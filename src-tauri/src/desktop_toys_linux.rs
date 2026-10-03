use gtk::prelude::*;

// GTK stores this region while unrealized and applies it when a GDK window is
// created. An empty region passes every pointer event through; None restores it.
// Unlike Tao's GDK-level setter, this never unwraps or realizes a hidden window.
pub(super) fn set_input_passthrough(window: &impl IsA<gtk::Widget>, ignore: bool) {
    let region = ignore.then(gtk::cairo::Region::create);
    window.input_shape_combine_region(region.as_ref());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires an isolated X11 display; run under xvfb-run in Linux CI"]
    fn linux_input_shape_survives_hidden_realized_and_destroyed_windows() {
        gtk::init().expect("GTK requires an X11 test display");
        let window = gtk::Window::new(gtk::WindowType::Toplevel);
        window.set_default_size(56, 56);
        assert!(!window.is_realized());
        assert!(window.window().is_none());
        for ignore in [true, false, true] {
            set_input_passthrough(&window, ignore);
            assert!(!window.is_realized());
            assert!(!window.is_visible());
        }
        window.realize();
        assert!(window.window().is_some());
        assert!(!window.is_visible());
        for ignore in [false, true, false] {
            set_input_passthrough(&window, ignore);
        }
        window.show();
        window.hide();
        window.unrealize();
        assert!(window.window().is_none());
        set_input_passthrough(&window, true);
        assert!(!window.is_realized());
        // A stale native reference remains safe after close; it must not map or
        // recreate the window. The host also drops updates after label removal.
        unsafe {
            window.destroy();
        }
        set_input_passthrough(&window, true);
        set_input_passthrough(&window, false);
        assert!(!window.is_visible());
        assert!(window.window().is_none());
    }
}
