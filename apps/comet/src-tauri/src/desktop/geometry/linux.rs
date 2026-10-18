//! Read-only local X11 snapshots. XWayland cannot see native Wayland windows, so
//! a Wayland session is explicitly unsupported instead of pretending it is empty.
use super::{from_snapshot, Geometry, Rect};
use rustix::{
    event::{poll, PollFd, PollFlags, Timespec},
    net::{connect, socket_with, AddressFamily, SocketAddrUnix, SocketFlags, SocketType},
};
use std::{
    cell::{Cell, RefCell},
    error::Error,
    io::{self, IoSlice},
    os::unix::net::UnixStream,
    sync::{mpsc, OnceLock},
    time::{Duration, Instant},
};
use x11rb::{
    connection::{Connection, RequestConnection},
    errors::ReplyError,
    protocol::{
        randr::{self, ConnectionExt as _},
        xproto::{Atom, AtomEnum, ConnectionExt as _, MapState, Window},
        ErrorKind,
    },
    reexports::x11rb_protocol::{parse_display, xauth},
    rust_connection::{DefaultStream, PollMode, RustConnection, Stream},
    utils::RawFdContainer,
};

type XResult<T> = Result<T, Box<dyn Error>>;
type XConnection = RustConnection<DeadlineStream>;
const SNAPSHOT_BUDGET: Duration = Duration::from_millis(250);
const CURSOR_BUDGET: Duration = Duration::from_millis(20);
const MAX_CLIENTS: u32 = 4096;
const WAYLAND_UNSUPPORTED: &str = "Wayland에서는 다른 앱 창과 전체 화면 상태를 확인할 수 없어요. Linux 자동 대화는 X11 세션에서 사용할 수 있어요.";

// A single absolute deadline bounds X11 socket I/O during setup and every
// request, including a stalled server. Auth-file lookup has a bounded worker
// below, so an unavailable filesystem cannot block the caller either.
struct DeadlineStream {
    inner: DefaultStream,
    deadline: Cell<Instant>,
}
impl DeadlineStream {
    fn remaining(&self) -> io::Result<Duration> {
        self.deadline
            .get()
            .checked_duration_since(Instant::now())
            .filter(|left| !left.is_zero())
            .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "X11 geometry query timed out"))
    }
}
impl Stream for DeadlineStream {
    fn poll(&self, mode: PollMode) -> io::Result<()> {
        let mut flags = PollFlags::empty();
        if mode.readable() {
            flags |= PollFlags::IN;
        }
        if mode.writable() {
            flags |= PollFlags::OUT;
        }
        loop {
            let left = self.remaining()?;
            let timeout = Timespec {
                tv_sec: left.as_secs() as _,
                tv_nsec: left.subsec_nanos() as _,
            };
            match poll(&mut [PollFd::new(&self.inner, flags)], Some(&timeout)) {
                Ok(0) => {
                    return Err(io::Error::new(
                        io::ErrorKind::TimedOut,
                        "X11 geometry query timed out",
                    ))
                }
                Ok(_) => return Ok(()),
                Err(rustix::io::Errno::INTR) => continue,
                Err(error) => return Err(error.into()),
            }
        }
    }
    fn read(&self, buf: &mut [u8], fds: &mut Vec<RawFdContainer>) -> io::Result<usize> {
        self.remaining()?;
        self.inner.read(buf, fds)
    }
    fn write(&self, buf: &[u8], fds: &mut Vec<RawFdContainer>) -> io::Result<usize> {
        self.remaining()?;
        self.inner.write(buf, fds)
    }
    fn write_vectored(
        &self,
        bufs: &[IoSlice<'_>],
        fds: &mut Vec<RawFdContainer>,
    ) -> io::Result<usize> {
        self.remaining()?;
        self.inner.write_vectored(bufs, fds)
    }
}

x11rb::atom_manager! {
    Atoms: AtomsCookie {
        _NET_SUPPORTED,
        _NET_CLIENT_LIST_STACKING,
        _NET_CURRENT_DESKTOP,
        _NET_WM_DESKTOP,
        _NET_WM_PID,
        _NET_WM_STATE,
        _NET_WM_STATE_FULLSCREEN,
        _NET_WM_STATE_HIDDEN,
        _NET_WM_WINDOW_TYPE,
        _NET_WM_WINDOW_TYPE_DESKTOP,
        _NET_WM_WINDOW_TYPE_DOCK,
        _NET_WM_WINDOW_TYPE_TOOLTIP,
        _NET_WM_WINDOW_TYPE_NOTIFICATION,
        _NET_FRAME_EXTENTS,
    }
}

struct Session {
    connection: XConnection,
    root: Window,
    atoms: Atoms,
    randr_version: Option<(u32, u32)>,
}
#[derive(Default)]
struct Cache {
    session: Option<Session>,
    retry_after: Option<Instant>,
}
thread_local! {
    // Cursor polling does not reconnect on every animation frame. The cache is
    // thread-local: no UI/worker waits on another thread's X11 connection lock.
    static SESSION: RefCell<Cache> = RefCell::new(Cache::default());
}

fn session_supported(
    session_type: Option<&str>,
    wayland_display: Option<&str>,
) -> Result<(), &'static str> {
    if session_type.is_some_and(|kind| kind.eq_ignore_ascii_case("wayland"))
        || wayland_display.is_some_and(|display| !display.is_empty())
    {
        Err(WAYLAND_UNSUPPORTED)
    } else {
        Ok(())
    }
}

fn with_session<T>(
    budget: Duration,
    query: impl FnOnce(&Session) -> XResult<T>,
) -> Result<T, String> {
    session_supported(
        std::env::var("XDG_SESSION_TYPE").ok().as_deref(),
        std::env::var("WAYLAND_DISPLAY").ok().as_deref(),
    )?;
    SESSION.with(|cache| {
        let mut cache = cache.borrow_mut();
        let now = Instant::now();
        if cache.retry_after.is_some_and(|retry| now < retry) {
            return Err("X11 화면 조회가 실패하여 잠시 후 다시 확인해요.".into());
        }
        let result = (|| {
            if cache.session.is_none() {
                cache.session = Some(Session::connect(now + budget)?);
            }
            let session = cache.session.as_ref().expect("initialized X11 session");
            session.connection.stream().deadline.set(now + budget);
            query(session)
        })();
        match result {
            Ok(value) => Ok(value),
            Err(error) => {
                cache.session = None;
                cache.retry_after = Some(Instant::now() + Duration::from_secs(1));
                Err(format!("X11 화면 상태를 읽지 못했어요: {error}"))
            }
        }
    })
}

type Auth = (Vec<u8>, Vec<u8>);
struct AuthRequest {
    family: xauth::Family,
    address: Vec<u8>,
    display: u16,
    deadline: Instant,
    reply: mpsc::SyncSender<io::Result<Auth>>,
}

fn bounded_reply<T>(receiver: mpsc::Receiver<T>, deadline: Instant) -> io::Result<T> {
    let remaining = deadline
        .checked_duration_since(Instant::now())
        .ok_or_else(|| io::Error::new(io::ErrorKind::TimedOut, "X11 auth lookup timed out"))?;
    receiver
        .recv_timeout(remaining)
        .map_err(|error| match error {
            mpsc::RecvTimeoutError::Timeout => {
                io::Error::new(io::ErrorKind::TimedOut, "X11 auth lookup timed out")
            }
            mpsc::RecvTimeoutError::Disconnected => {
                io::Error::new(io::ErrorKind::BrokenPipe, "X11 auth lookup unavailable")
            }
        })
}

fn lookup_auth(
    family: xauth::Family,
    address: Vec<u8>,
    display: u16,
    deadline: Instant,
) -> XResult<Auth> {
    // x11rb's standard auth reader may wait on a FIFO/network filesystem. One
    // process-wide worker and a capacity-one queue bound both waiting and thread
    // growth. Timed-out requests never leave an unbounded backlog. No cookies
    // are logged, persisted, or sent anywhere except the local X11 handshake.
    static WORKER: OnceLock<Result<mpsc::SyncSender<AuthRequest>, String>> = OnceLock::new();
    let worker = WORKER
        .get_or_init(|| {
            let (sender, receiver) = mpsc::sync_channel::<AuthRequest>(1);
            std::thread::Builder::new()
                .name("comet-x11-auth".into())
                .spawn(move || {
                    while let Ok(request) = receiver.recv() {
                        if Instant::now() >= request.deadline {
                            continue;
                        }
                        // A missing cookie is not an authorization grant: an ACL-based
                        // local server still accepts/rejects the normal handshake.
                        let auth = match xauth::get_auth(
                            request.family,
                            &request.address,
                            request.display,
                        ) {
                            Ok(auth) => Ok(auth.unwrap_or_default()),
                            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                                Ok(Auth::default())
                            }
                            Err(error) => Err(error),
                        };
                        let _ = request.reply.send(auth);
                    }
                })
                .map(|_| sender)
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(|error| error.as_str())?;
    let (reply, receiver) = mpsc::sync_channel(1);
    worker
        .try_send(AuthRequest {
            family,
            address,
            display,
            deadline,
            reply,
        })
        .map_err(|_| "X11 auth lookup is already busy or unavailable")?;
    Ok(bounded_reply(receiver, deadline)??)
}

impl Session {
    fn connect(deadline: Instant) -> XResult<Self> {
        let display = parse_display::parse_display(None)?;
        // Local Unix sockets only: do not contact a remote DISPLAY or block on DNS.
        let path = display
            .connect_instruction()
            .find_map(|address| match address {
                parse_display::ConnectAddress::Socket(path) => Some(path),
                _ => None,
            })
            .ok_or("원격 X11 화면 조회는 지원하지 않아요.")?;
        let mut connected = None;
        for address in [
            SocketAddrUnix::new_abstract_name(path.as_bytes())?,
            SocketAddrUnix::new(path.as_str())?,
        ] {
            let fd = socket_with(
                AddressFamily::UNIX,
                SocketType::STREAM,
                SocketFlags::NONBLOCK | SocketFlags::CLOEXEC,
                None,
            )?;
            // NONBLOCK also bounds a connect against a full local socket backlog.
            if connect(&fd, &address).is_ok() {
                connected = Some(UnixStream::from(fd));
                break;
            }
        }
        let (stream, (family, address)) =
            DefaultStream::from_unix_stream(connected.ok_or("로컬 X11 서버에 연결할 수 없어요.")?)?;
        let (auth_name, auth_data) = lookup_auth(family, address, display.display, deadline)?;
        let connection = XConnection::connect_to_stream_with_auth_info(
            DeadlineStream {
                inner: stream,
                deadline: Cell::new(deadline),
            },
            display.screen as usize,
            auth_name,
            auth_data,
        )?;
        let root = connection
            .setup()
            .roots
            .get(display.screen as usize)
            .ok_or("X11 화면이 없어요.")?
            .root;
        let atoms = Atoms::new(&connection)?.reply()?;
        let randr_version = if connection
            .extension_information(randr::X11_EXTENSION_NAME)?
            .is_some()
        {
            let version = connection.randr_query_version(1, 5)?.reply()?;
            Some((version.major_version, version.minor_version))
        } else {
            None
        };
        Ok(Self {
            connection,
            root,
            atoms,
            randr_version,
        })
    }

    fn property(
        &self,
        window: Window,
        atom: Atom,
        kind: AtomEnum,
        limit: u32,
    ) -> XResult<Vec<u32>> {
        let reply = self
            .connection
            .get_property(false, window, atom, kind, 0, limit)?
            .reply()?;
        if reply.type_ == u32::from(AtomEnum::NONE) {
            if window == self.root && atom == self.atoms._NET_CLIENT_LIST_STACKING {
                return Err("X11 창 목록을 확인할 수 없어요.".into());
            }
            return Ok(Vec::new());
        }
        if reply.type_ != u32::from(kind) || reply.format != 32 || reply.bytes_after != 0 {
            return Err("X11 속성 형식이나 크기가 올바르지 않아요.".into());
        }
        let values = reply
            .value32()
            .ok_or("X11 속성을 읽을 수 없어요.")?
            .collect();
        Ok(values)
    }

    fn monitors(&self) -> XResult<Vec<Rect>> {
        let mut monitors = Vec::new();
        if self.randr_version.is_some_and(|version| version >= (1, 5)) {
            let reply = self
                .connection
                .randr_get_monitors(self.root, true)?
                .reply()?;
            if reply.monitors.len() > 64 {
                return Err("X11 화면 수가 조회 한도를 넘었어요.".into());
            }
            for monitor in reply.monitors {
                if monitor.width > 0 && monitor.height > 0 {
                    monitors.push(Rect {
                        x: monitor.x as f64,
                        y: monitor.y as f64,
                        width: monitor.width as f64,
                        height: monitor.height as f64,
                    });
                }
            }
        } else if self.randr_version.is_some_and(|version| version >= (1, 2)) {
            let resources = self
                .connection
                .randr_get_screen_resources(self.root)?
                .reply()?;
            if resources.crtcs.len() > 64 {
                return Err("X11 화면 수가 조회 한도를 넘었어요.".into());
            }
            for crtc in resources.crtcs {
                let info = self
                    .connection
                    .randr_get_crtc_info(crtc, resources.config_timestamp)?
                    .reply()?;
                if info.mode != 0 && info.width > 0 && info.height > 0 {
                    monitors.push(Rect {
                        x: info.x as f64,
                        y: info.y as f64,
                        width: info.width as f64,
                        height: info.height as f64,
                    });
                }
            }
        }
        if monitors.is_empty() {
            // A server without RandR exposes one root screen. Query current root
            // dimensions rather than caching the initial connection setup size.
            let root = self.connection.get_geometry(self.root)?.reply()?;
            monitors.push(Rect {
                x: 0.0,
                y: 0.0,
                width: root.width as f64,
                height: root.height as f64,
            });
        }
        Ok(monitors)
    }

    fn window(&self, window: Window, desktop: Option<u32>) -> XResult<Option<(Rect, bool)>> {
        let c = &self.connection;
        let a = &self.atoms;
        if c.get_window_attributes(window)?.reply()?.map_state != MapState::VIEWABLE {
            return Ok(None);
        }
        let pid = self
            .property(window, a._NET_WM_PID, AtomEnum::CARDINAL, 1)?
            .first()
            .copied();
        let types = self.property(window, a._NET_WM_WINDOW_TYPE, AtomEnum::ATOM, 32)?;
        let states = self.property(window, a._NET_WM_STATE, AtomEnum::ATOM, 64)?;
        let window_desktop = self
            .property(window, a._NET_WM_DESKTOP, AtomEnum::CARDINAL, 1)?
            .first()
            .copied();
        if !visible_client(pid, &types, &states, window_desktop, desktop, a) {
            return Ok(None);
        }
        let geometry = c.get_geometry(window)?.reply()?;
        let position = c.translate_coordinates(window, self.root, 0, 0)?.reply()?;
        let extents = self.property(window, a._NET_FRAME_EXTENTS, AtomEnum::CARDINAL, 4)?;
        let (left, right, top, bottom) = match extents.as_slice() {
            [left, right, top, bottom] if extents.iter().all(|extent| *extent <= 4096) => {
                (*left, *right, *top, *bottom)
            }
            [] => (0, 0, 0, 0),
            _ => return Err("X11 창 테두리 크기가 올바르지 않아요.".into()),
        };
        let rect = Rect {
            x: position.dst_x as f64 - left as f64,
            y: position.dst_y as f64 - top as f64,
            width: geometry.width as f64 + left as f64 + right as f64,
            height: geometry.height as f64 + top as f64 + bottom as f64,
        };
        Ok((rect.width > 1.0 && rect.height > 1.0)
            .then_some((rect, states.contains(&a._NET_WM_STATE_FULLSCREEN))))
    }

    fn capture(&self) -> XResult<Geometry> {
        let a = &self.atoms;
        let supported = self.property(self.root, a._NET_SUPPORTED, AtomEnum::ATOM, 4096)?;
        if ![
            a._NET_CLIENT_LIST_STACKING,
            a._NET_WM_STATE,
            a._NET_WM_STATE_FULLSCREEN,
        ]
        .iter()
        .all(|atom| supported.contains(atom))
        {
            return Err(
                "이 X11 창 관리자는 창 순서와 전체 화면 상태 조회를 지원하지 않아요.".into(),
            );
        }
        let monitors = self.monitors()?;
        let desktop = self
            .property(self.root, a._NET_CURRENT_DESKTOP, AtomEnum::CARDINAL, 1)?
            .first()
            .copied();
        let clients = self.property(
            self.root,
            a._NET_CLIENT_LIST_STACKING,
            AtomEnum::WINDOW,
            MAX_CLIENTS,
        )?;
        let mut windows = Vec::new();
        for window in clients.into_iter().rev() {
            match self.window(window, desktop) {
                Ok(Some((rect, is_fullscreen))) => {
                    windows.push((rect, is_fullscreen));
                }
                Ok(None) => {},
                // A window may close between reading the stack and its attributes.
                // Only that race is ignored; timeouts/malformed data are failures.
                Err(error) if error.downcast_ref::<ReplyError>().is_some_and(|error| matches!(error, ReplyError::X11Error(error) if matches!(error.error_kind, ErrorKind::Window | ErrorKind::Drawable))) => {},
                Err(error) => return Err(error),
            }
        }
        let fullscreen = foreground_fullscreen(&monitors, &windows);
        Ok(from_snapshot(
            monitors,
            windows.into_iter().map(|(rect, _)| rect).collect(),
            fullscreen,
        ))
    }
}

fn foreground_fullscreen(monitors: &[Rect], front_to_back: &[(Rect, bool)]) -> bool {
    monitors.iter().any(|monitor| {
        front_to_back
            .iter()
            .find(|(window, _)| intersects(*window, *monitor))
            .is_some_and(|(_, fullscreen)| *fullscreen)
    })
}

fn intersects(a: Rect, b: Rect) -> bool {
    a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}
fn visible_client(
    pid: Option<u32>,
    types: &[Atom],
    states: &[Atom],
    desktop: Option<u32>,
    current: Option<u32>,
    atoms: &Atoms,
) -> bool {
    pid != Some(std::process::id())
        && !states.contains(&atoms._NET_WM_STATE_HIDDEN)
        && !types.iter().any(|kind| {
            [
                atoms._NET_WM_WINDOW_TYPE_DESKTOP,
                atoms._NET_WM_WINDOW_TYPE_DOCK,
                atoms._NET_WM_WINDOW_TYPE_TOOLTIP,
                atoms._NET_WM_WINDOW_TYPE_NOTIFICATION,
            ]
            .contains(kind)
        })
        && !matches!((desktop, current), (Some(window), Some(current)) if window != u32::MAX && window != current)
}

pub(super) fn capture() -> Result<Geometry, String> {
    with_session(SNAPSHOT_BUDGET, Session::capture)
}
pub(super) fn cursor_position() -> Option<(f64, f64)> {
    with_session(CURSOR_BUDGET, |session| {
        let pointer = session.connection.query_pointer(session.root)?.reply()?;
        if !pointer.same_screen {
            return Err("포인터가 다른 X11 화면에 있어요.".into());
        }
        Ok((pointer.root_x as f64, pointer.root_y as f64))
    })
    .ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Run only from an actual X11 desktop session; no windows are changed.
    #[test]
    #[ignore = "requires a real local X11 desktop and EWMH window manager"]
    fn native_x11_geometry_probe() {
        let geometry = capture().expect("native X11 geometry snapshot");
        println!(
            "monitors={:?}; external_windows_available={}; fullscreen={}; edges={}; cursor={:?}",
            geometry.monitors,
            geometry.external_windows_available,
            geometry.fullscreen,
            geometry.edges.len(),
            cursor_position()
        );
        assert!(!geometry.monitors.is_empty());
        assert!(geometry.external_windows_available);
    }

    #[test]
    fn wayland_is_explicitly_unavailable_even_with_xwayland_display() {
        assert_eq!(
            session_supported(Some("wayland"), None),
            Err(WAYLAND_UNSUPPORTED)
        );
        assert_eq!(
            session_supported(Some("x11"), Some("wayland-0")),
            Err(WAYLAND_UNSUPPORTED)
        );
        assert!(session_supported(Some("x11"), None).is_ok());
        assert!(session_supported(None, None).is_ok());
    }

    #[test]
    fn stalled_auth_reader_cannot_block_snapshot_caller() {
        let (_sender, receiver) = mpsc::sync_channel::<io::Result<Auth>>(1);
        let start = Instant::now();
        let result = bounded_reply(receiver, start + Duration::from_millis(10));
        assert_eq!(result.unwrap_err().kind(), io::ErrorKind::TimedOut);
        assert!(start.elapsed() < Duration::from_secs(1));
    }

    #[test]
    fn stalled_x_server_has_a_bounded_deadline() {
        let (socket, _peer) = UnixStream::pair().unwrap();
        let (inner, _) = DefaultStream::from_unix_stream(socket).unwrap();
        let stream = DeadlineStream {
            inner,
            deadline: Cell::new(Instant::now() + Duration::from_millis(10)),
        };
        let start = Instant::now();
        assert_eq!(
            stream.poll(PollMode::Readable).unwrap_err().kind(),
            io::ErrorKind::TimedOut
        );
        assert!(start.elapsed() < Duration::from_secs(1));
        assert_eq!(
            stream
                .read(&mut [0; 1], &mut Vec::new())
                .unwrap_err()
                .kind(),
            io::ErrorKind::TimedOut
        );
    }

    #[test]
    fn explicit_fullscreen_state_is_distinct_from_maximized_geometry() {
        let area = Rect {
            x: 0.0,
            y: 0.0,
            width: 1920.0,
            height: 1080.0,
        };
        let maximized = from_snapshot(vec![area], vec![area], false);
        assert!(!maximized.fullscreen);
        assert!(maximized.external_windows_available);
        assert!(from_snapshot(vec![area], vec![area], true).fullscreen);
        assert!(foreground_fullscreen(&[area], &[(area, true)]));
        assert!(!foreground_fullscreen(
            &[area],
            &[(area, false), (area, true)]
        ));
        assert!(!foreground_fullscreen(&[area], &[]));
        let other = Rect { x: -1920.0, ..area };
        assert!(foreground_fullscreen(
            &[area, other],
            &[(area, false), (other, true)]
        ));
    }

    #[test]
    fn own_shell_hidden_and_other_workspace_windows_are_excluded() {
        let a = Atoms {
            _NET_SUPPORTED: 1,
            _NET_CLIENT_LIST_STACKING: 2,
            _NET_CURRENT_DESKTOP: 3,
            _NET_WM_DESKTOP: 4,
            _NET_WM_PID: 5,
            _NET_WM_STATE: 6,
            _NET_WM_STATE_FULLSCREEN: 7,
            _NET_WM_STATE_HIDDEN: 8,
            _NET_WM_WINDOW_TYPE: 9,
            _NET_WM_WINDOW_TYPE_DESKTOP: 10,
            _NET_WM_WINDOW_TYPE_DOCK: 11,
            _NET_WM_WINDOW_TYPE_TOOLTIP: 12,
            _NET_WM_WINDOW_TYPE_NOTIFICATION: 13,
            _NET_FRAME_EXTENTS: 14,
        };
        assert!(visible_client(None, &[], &[], Some(0), Some(0), &a));
        assert!(visible_client(None, &[], &[7], Some(u32::MAX), Some(0), &a));
        assert!(!visible_client(
            Some(std::process::id()),
            &[],
            &[],
            None,
            None,
            &a
        ));
        assert!(!visible_client(None, &[10], &[], None, None, &a));
        assert!(!visible_client(None, &[11], &[], None, None, &a));
        assert!(!visible_client(None, &[], &[8], None, None, &a));
        assert!(!visible_client(None, &[], &[], Some(1), Some(0), &a));
    }
}
