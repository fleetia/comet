use super::*;
use std::io::Cursor;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn server(
    responses: Vec<(u16, Vec<u8>, Duration)>,
) -> (
    String,
    Arc<Mutex<Vec<Instant>>>,
    tokio::task::JoinHandle<()>,
) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let endpoint = format!("http://{}", listener.local_addr().unwrap());
    let requests = Arc::new(Mutex::new(Vec::new()));
    let received = Arc::clone(&requests);
    let task = tokio::spawn(async move {
        let mut replies = Vec::new();
        for (status, body, delay) in responses {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = Vec::new();
            while !request.ends_with(b"\r\n\r\n") {
                let byte = socket.read_u8().await.unwrap();
                request.push(byte);
            }
            received.lock().unwrap().push(Instant::now());
            replies.push(tokio::spawn(async move {
                let header = format!(
                    "HTTP/1.1 {status} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    body.len()
                );
                socket.write_all(header.as_bytes()).await.unwrap();
                tokio::time::sleep(delay).await;
                socket.write_all(&body).await.unwrap();
                socket.shutdown().await.unwrap();
            }));
        }
        for reply in replies {
            reply.await.unwrap();
        }
    });
    (endpoint, requests, task)
}

#[tokio::test]
async fn map_cache_expires_after_thirty_days_and_off_does_not_request() {
    let directory = tempfile::tempdir().unwrap();
    let access = Access::default();
    let first = b"\x89PNGfirst".to_vec();
    let second = b"\x89PNGsecond".to_vec();
    let (endpoint, requests, task) = server(vec![
        (200, first.clone(), Duration::ZERO),
        (200, second.clone(), Duration::ZERO),
    ])
    .await;
    let fetch = |enabled| map_tile_bytes(directory.path(), &access, enabled, (0, 0, 0), &endpoint);
    assert!(fetch(false).await.is_err());
    assert!(requests.lock().unwrap().is_empty());
    assert_eq!(fetch(true).await.unwrap(), first);
    assert_eq!(fetch(true).await.unwrap(), first);
    assert_eq!(requests.lock().unwrap().len(), 1);
    let cached = directory.path().join("travel-tiles/0/0/0.png");
    std::fs::File::options()
        .write(true)
        .open(&cached)
        .unwrap()
        .set_modified(SystemTime::now() - TILE_TTL - Duration::from_secs(1))
        .unwrap();
    assert_eq!(fetch(true).await.unwrap(), second);
    assert!(fetch(false).await.is_err());
    assert_eq!(requests.lock().unwrap().len(), 2);
    task.await.unwrap();
}

#[tokio::test]
async fn map_tiles_finish_sequentially_and_concurrent_cache_misses_request_once() {
    let directory = tempfile::tempdir().unwrap();
    let access = Access::default();
    let (endpoint, requests, task) = server(vec![
        (200, b"\x89PNGfirst".to_vec(), Duration::from_millis(200)),
        (200, b"\x89PNGsecond".to_vec(), Duration::ZERO),
    ])
    .await;
    let (first, same, second) = tokio::join!(
        map_tile_bytes(directory.path(), &access, true, (1, 0, 0), &endpoint),
        map_tile_bytes(directory.path(), &access, true, (1, 0, 0), &endpoint),
        map_tile_bytes(directory.path(), &access, true, (1, 1, 0), &endpoint),
    );
    assert_eq!(first.unwrap(), b"\x89PNGfirst");
    assert_eq!(same.unwrap(), b"\x89PNGfirst");
    assert_eq!(second.unwrap(), b"\x89PNGsecond");
    task.await.unwrap();
    let times = requests.lock().unwrap();
    assert_eq!(times.len(), 2);
    assert!(times[1].duration_since(times[0]) >= Duration::from_millis(200));
}

#[tokio::test]
async fn map_errors_do_not_cache_and_a_later_request_recovers() {
    let directory = tempfile::tempdir().unwrap();
    let access = Access::default();
    let (endpoint, requests, task) = server(vec![
        (503, Vec::new(), Duration::ZERO),
        (200, b"not a tile".to_vec(), Duration::ZERO),
        (200, b"\x89PNGrecovered".to_vec(), Duration::ZERO),
    ])
    .await;
    let cached = directory.path().join("travel-tiles/0/0/0.png");
    for expected in ["HTTP 503", "형식"] {
        let result = map_tile_bytes(directory.path(), &access, true, (0, 0, 0), &endpoint).await;
        assert!(result.unwrap_err().contains(expected));
        assert!(!cached.exists());
    }
    assert_eq!(
        map_tile_bytes(directory.path(), &access, true, (0, 0, 0), &endpoint)
            .await
            .unwrap(),
        b"\x89PNGrecovered"
    );
    task.await.unwrap();
    assert_eq!(requests.lock().unwrap().len(), 3);
    let closed = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let offline = format!("http://{}", closed.local_addr().unwrap());
    drop(closed);
    assert!(
        map_tile_bytes(directory.path(), &access, true, (1, 0, 0), &offline)
            .await
            .unwrap_err()
            .contains("네트워크")
    );
    assert_eq!(
        map_tile_bytes(directory.path(), &access, true, (0, 0, 0), &offline)
            .await
            .unwrap(),
        b"\x89PNGrecovered"
    );
    let (online, recovered_requests, recovered_task) =
        server(vec![(200, b"\x89PNGonline".to_vec(), Duration::ZERO)]).await;
    assert_eq!(
        map_tile_bytes(directory.path(), &access, true, (1, 0, 0), &online)
            .await
            .unwrap(),
        b"\x89PNGonline"
    );
    recovered_task.await.unwrap();
    assert_eq!(recovered_requests.lock().unwrap().len(), 1);
    assert_eq!(
        std::fs::read(directory.path().join("travel-tiles/1/0/0.png")).unwrap(),
        b"\x89PNGonline"
    );
}

#[tokio::test]
async fn address_search_throttles_failed_requests_and_recovers_without_traffic_when_off() {
    let access = Access::default();
    let (endpoint, requests, task) = server(vec![
        (503, Vec::new(), Duration::ZERO),
        (200, b"invalid json".to_vec(), Duration::ZERO),
        (
            200,
            br#"[{"lat":"35","lon":"139","display_name":"Tokyo"}]"#.to_vec(),
            Duration::ZERO,
        ),
    ])
    .await;
    assert!(geocode_places(&access, false, "Tokyo", &endpoint)
        .await
        .is_err());
    assert!(requests.lock().unwrap().is_empty());
    assert!(geocode_places(&access, true, "Tokyo", &endpoint)
        .await
        .err()
        .unwrap()
        .contains("HTTP 503"));
    assert!(geocode_places(&access, true, "Tokyo", &endpoint)
        .await
        .err()
        .unwrap()
        .contains("응답"));
    let places = geocode_places(&access, true, "Tokyo", &endpoint)
        .await
        .unwrap();
    assert_eq!((places[0].lat, places[0].lng), (35_000_000, 139_000_000));
    task.await.unwrap();
    let times = requests.lock().unwrap();
    assert_eq!(times.len(), 3);
    for pair in times.windows(2) {
        assert!(pair[1].duration_since(pair[0]) >= Duration::from_secs(1));
    }
}

fn exif_fixture() -> Vec<u8> {
    let ascii = |tag, text: &[u8]| exif::Field {
        tag,
        ifd_num: exif::In::PRIMARY,
        value: exif::Value::Ascii(vec![text.to_vec()]),
    };
    let coordinate = |tag, degrees| exif::Field {
        tag,
        ifd_num: exif::In::PRIMARY,
        value: exif::Value::Rational(vec![
            exif::Rational {
                num: degrees,
                denom: 1,
            },
            exif::Rational { num: 0, denom: 1 },
            exif::Rational { num: 0, denom: 1 },
        ]),
    };
    let fields = [
        ascii(exif::Tag::DateTimeOriginal, b"2026:10:23 09:30:00"),
        ascii(exif::Tag::OffsetTimeOriginal, b"-07:00"),
        ascii(exif::Tag::GPSLatitudeRef, b"S"),
        coordinate(exif::Tag::GPSLatitude, 35),
        ascii(exif::Tag::GPSLongitudeRef, b"W"),
        coordinate(exif::Tag::GPSLongitude, 139),
    ];
    let mut writer = exif::experimental::Writer::new();
    for field in &fields {
        writer.push_field(field);
    }
    let mut buffer = Cursor::new(Vec::new());
    writer.write(&mut buffer, false).unwrap();
    buffer.into_inner()
}

fn image_container(extension: &str, tiff: &[u8]) -> Vec<u8> {
    match extension {
        "jpg" | "jpeg" => {
            let mut bytes = b"\xff\xd8\xff\xe1".to_vec();
            bytes.extend_from_slice(&((tiff.len() + 8) as u16).to_be_bytes());
            bytes.extend_from_slice(b"Exif\0\0");
            bytes.extend_from_slice(tiff);
            bytes.extend_from_slice(b"\xff\xd9");
            bytes
        }
        "png" => {
            let mut bytes = b"\x89PNG\r\n\x1a\n".to_vec();
            bytes.extend_from_slice(&(tiff.len() as u32).to_be_bytes());
            bytes.extend_from_slice(b"eXIf");
            bytes.extend_from_slice(tiff);
            bytes.extend_from_slice(&[0; 4]);
            bytes
        }
        "webp" => {
            let mut body = b"WEBPEXIF".to_vec();
            body.extend_from_slice(&(tiff.len() as u32).to_le_bytes());
            body.extend_from_slice(tiff);
            if tiff.len() % 2 != 0 {
                body.push(0);
            }
            let mut bytes = b"RIFF".to_vec();
            bytes.extend_from_slice(&(body.len() as u32).to_le_bytes());
            bytes.extend(body);
            bytes
        }
        "heic" | "heif" => {
            let atom = |kind: &[u8; 4], body: &[u8]| {
                let mut bytes = ((body.len() + 8) as u32).to_be_bytes().to_vec();
                bytes.extend_from_slice(kind);
                bytes.extend_from_slice(body);
                bytes
            };
            let mut info = vec![0, 0, 0, 0, 0, 1];
            info.extend(atom(b"infe", b"\x02\0\0\0\0\x01\0\0Exif"));
            let mut data = vec![0; 4];
            data.extend_from_slice(tiff);
            let mut meta = vec![0; 4];
            meta.extend(atom(
                b"iloc",
                &[1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1],
            ));
            meta.extend(atom(b"iinf", &info));
            meta.extend(atom(b"idat", &data));
            let mut bytes = atom(b"ftyp", b"heic\0\0\0\0mif1heic");
            bytes.extend(atom(b"meta", &meta));
            bytes
        }
        _ => unreachable!(),
    }
}

#[test]
fn photo_containers_preserve_originals_and_extract_date_offset_and_signed_gps() {
    let directory = tempfile::tempdir().unwrap();
    let tiff = exif_fixture();
    for extension in ["jpg", "jpeg", "png", "webp", "heic", "heif"] {
        let path = directory.path().join(format!("사진.{extension}"));
        let bytes = image_container(extension, &tiff);
        std::fs::write(&path, &bytes).unwrap();
        let before = std::fs::metadata(&path).unwrap();
        let mut readonly = before.permissions();
        readonly.set_readonly(true);
        std::fs::set_permissions(&path, readonly).unwrap();
        let meta = photo_meta(&path);
        assert_eq!(meta.path, path.to_string_lossy());
        assert_eq!(
            meta.taken_at.as_deref(),
            Some("2026-10-23T09:30"),
            "{extension}"
        );
        assert_eq!(meta.offset_minutes, Some(-420), "{extension}");
        assert_eq!(
            (meta.lat, meta.lng),
            (Some(-35_000_000), Some(-139_000_000)),
            "{extension}"
        );
        assert_eq!(photo_original_bytes(&path).unwrap(), bytes);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(
            std::fs::metadata(&path).unwrap().modified().unwrap(),
            before.modified().unwrap()
        );
        std::fs::set_permissions(&path, before.permissions()).unwrap();
    }
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 6);
    assert!(!directory.path().join("travel").exists());
}
