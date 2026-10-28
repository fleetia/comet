use image::{AnimationDecoder, ImageDecoder, ImageFormat};
use std::{
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
};


type Result<T> = std::result::Result<T, String>;
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub(crate) struct Media {
    _temporary: TemporaryMedia,
    selected: PathBuf,
    pub mime: &'static str,
    pub width: u32,
    pub height: u32,
}

impl Media {
    pub(crate) fn store(&self, db: &rusqlite::Connection, id: &str) -> Result<()> {
        super::backgrounds::put_media_file(db, id, self.mime, &self.selected)
    }
}

fn gif_repeat(path: &Path) -> Result<Option<image::codecs::gif::Repeat>> {
    let mut file = std::fs::File::open(path).map_err(err)?;
    let mut pending = Vec::new();
    let mut buf = [0u8; 65536];
    loop {
        let n = file.read(&mut buf).map_err(err)?;
        if n == 0 { return Ok(None); }
        pending.extend_from_slice(&buf[..n]);
        if let Some(count) = pending.windows(18).find_map(|chunk| {
            if (&chunk[..14] == b"\x21\xff\x0bNETSCAPE2.0"
                || &chunk[..14] == b"\x21\xff\x0bANIMEXTS1.0")
                && chunk[14] == 3 && chunk[15] == 1 {
                Some(u16::from_le_bytes([chunk[16], chunk[17]]))
            } else { None }
        }) {
            return Ok(Some(if count == 0 { image::codecs::gif::Repeat::Infinite }
                else { image::codecs::gif::Repeat::Finite(count) }));
        }
        let keep = pending.len().min(17);
        pending.drain(..pending.len() - keep);
    }
}

fn resized(width: u32, height: u32) -> (u32, u32) {
    let scale = (2048.0 / width.max(height) as f64).min(1.0);
    (
        (width as f64 * scale).round().max(1.0) as u32,
        (height as f64 * scale).round().max(1.0) as u32,
    )
}

struct TemporaryMedia(PathBuf);

impl TemporaryMedia {
    fn new(source: &Path) -> Result<Self> {
        let dir = std::env::temp_dir().join(format!("comet-image-source-{}", uuid::Uuid::new_v4()));
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&dir).map_err(err)?;
        let temporary = Self(dir);
        std::fs::copy(source, temporary.source()).map_err(err)?;
        Ok(temporary)
    }
    fn source(&self) -> PathBuf { self.0.join("source.mp4") }
    fn output(&self) -> PathBuf { self.0.join("output.mp4") }
}

impl Drop for TemporaryMedia {
    fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); }
}

struct LimitedOutput {
    file: std::fs::File,
    written: u64,
    limit: u64,
}
impl Write for LimitedOutput {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() as u64 > self.limit.saturating_sub(self.written) {
            return Err(std::io::Error::other("encoded image exceeds original size"));
        }
        let n = self.file.write(bytes)?;
        self.written += n as u64;
        Ok(n)
    }
    fn flush(&mut self) -> std::io::Result<()> { self.file.flush() }
}

fn compress(source: &Path, output: &Path, mime: &str, width: u32, height: u32) -> Result<()> {
    let (w, h) = resized(width, height);
    let limit = std::fs::metadata(source).map_err(err)?.len();
    let open = || -> Result<BufReader<std::fs::File>> {
        Ok(BufReader::new(std::fs::File::open(source).map_err(err)?))
    };
    match mime {
        "image/gif" => {
            let mut decoder = image::codecs::gif::GifDecoder::new(open()?).map_err(err)?;
            decoder.set_limits(image::Limits::default()).map_err(err)?;
            let mut encoder = image::codecs::gif::GifEncoder::new_with_speed(
                LimitedOutput { file: std::fs::File::create(output).map_err(err)?, written: 0, limit }, 10);
            if let Some(repeat) = gif_repeat(source)? { encoder.set_repeat(repeat).map_err(err)?; }
            for frame in decoder.into_frames() {
                let frame = frame.map_err(err)?;
                let delay = frame.delay();
                let pixels = image::imageops::resize(&frame.into_buffer(), w, h, image::imageops::FilterType::Lanczos3);
                encoder.encode_frame(image::Frame::from_parts(pixels, 0, 0, delay)).map_err(err)?;
            }
        }
        "image/png" => {
            let decoder = image::codecs::png::PngDecoder::with_limits(open()?, image::Limits::default()).map_err(err)?;
            if decoder.is_apng().map_err(err)? {
                let reader = png::Decoder::new(open()?).read_info().map_err(err)?;
                let animation = reader.info().animation_control.ok_or("APNG 애니메이션 정보가 없어요.")?;
                let mut encoder = png::Encoder::new(
                    LimitedOutput { file: std::fs::File::create(output).map_err(err)?, written: 0, limit }, w, h);
                encoder.set_color(png::ColorType::Rgba);
                encoder.set_depth(png::BitDepth::Eight);
                encoder.set_animated(animation.num_frames, animation.num_plays).map_err(err)?;
                encoder.set_blend_op(png::BlendOp::Source).map_err(err)?;
                let mut writer = encoder.write_header().map_err(err)?;
                for frame in decoder.apng().map_err(err)?.into_frames() {
                    let frame = frame.map_err(err)?;
                    let (numer, denom) = frame.delay().numer_denom_ms();
                    let denom = denom.checked_mul(1000).ok_or("프레임 지연이 너무 커요.")?;
                    let gcd = gcd(numer, denom);
                    writer.set_frame_delay(u16::try_from(numer / gcd).map_err(err)?, u16::try_from(denom / gcd).map_err(err)?).map_err(err)?;
                    let pixels = image::imageops::resize(&frame.into_buffer(), w, h, image::imageops::FilterType::Lanczos3);
                    writer.write_image_data(&pixels).map_err(err)?;
                }
                writer.finish().map_err(err)?;
            } else {
                let image = image::DynamicImage::from_decoder(decoder).map_err(err)?;
                image.resize_exact(w, h, image::imageops::FilterType::Lanczos3)
                    .write_to(&mut std::fs::File::create(output).map_err(err)?, ImageFormat::Png).map_err(err)?;
            }
        }
        "image/jpeg" => {
            let mut decoder = image::codecs::jpeg::JpegDecoder::new(open()?).map_err(err)?;
            decoder.set_limits(image::Limits::default()).map_err(err)?;
            let orientation = decoder.orientation().map_err(err)?;
            let mut image = image::DynamicImage::from_decoder(decoder).map_err(err)?;
            image.apply_orientation(orientation);
            image.resize_exact(w, h, image::imageops::FilterType::Lanczos3)
                .write_to(&mut std::fs::File::create(output).map_err(err)?, ImageFormat::Jpeg).map_err(err)?;
        }
        "image/webp" => {
            let mut decoder = image::codecs::webp::WebPDecoder::new(open()?).map_err(err)?;
            decoder.set_limits(image::Limits::default()).map_err(err)?;
            if decoder.has_animation() { return Err("움직이는 WebP 원본을 사용해요.".into()); }
            let image = image::DynamicImage::from_decoder(decoder).map_err(err)?;
            image.resize_exact(w, h, image::imageops::FilterType::Lanczos3)
                .write_to(&mut std::fs::File::create(output).map_err(err)?, ImageFormat::WebP).map_err(err)?;
        }
        _ => return Err("원본 형식을 유지해요.".into()),
    }
    Ok(())
}

fn gcd(mut a: u32, mut b: u32) -> u32 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a.max(1)
}

fn svg_dimensions(bytes: &[u8]) -> Result<(u32, u32)> {
    let text = std::str::from_utf8(bytes).map_err(err)?;
    let start = text.find("<svg").ok_or("SVG를 읽을 수 없어요.")?;
    let tag = text[start..]
        .split('>')
        .next()
        .ok_or("SVG를 읽을 수 없어요.")?;
    let attr = |name: &str| -> Option<&str> {
        let index = tag.find(name)? + name.len();
        let rest = tag[index..].trim_start().strip_prefix('=')?.trim_start();
        let quote = rest.chars().next()?;
        if quote != '\'' && quote != '"' {
            return None;
        }
        rest[1..].split(quote).next()
    };
    let length = |value: &str| {
        value
            .trim()
            .trim_end_matches("px")
            .parse::<f64>()
            .ok()
            .filter(|v| v.is_finite() && *v > 0.0)
    };
    let view = attr("viewBox").and_then(|v| {
        let parts: Vec<f64> = v
            .split(|c: char| c.is_whitespace() || c == ',')
            .filter(|s| !s.is_empty())
            .filter_map(|s| s.parse().ok())
            .collect();
        if parts.len() == 4 {
            Some((parts[2], parts[3]))
        } else {
            None
        }
    });
    let w = attr("width")
        .and_then(length)
        .or(view.map(|v| v.0))
        .unwrap_or(300.0);
    let h = attr("height")
        .and_then(length)
        .or(view.map(|v| v.1))
        .unwrap_or(150.0);
    if !w.is_finite()
        || !h.is_finite()
        || w <= 0.0
        || h <= 0.0
        || w > u32::MAX as f64
        || h > u32::MAX as f64
    {
        return Err("이미지 크기가 올바르지 않아요.".into());
    }
    Ok((w.round().max(1.0) as u32, h.round().max(1.0) as u32))
}

fn svg_dimensions_from_file(path: &Path) -> Result<(u32, u32)> {
    let mut input = std::fs::File::open(path).map_err(err)?;
    let mut buffer = [0u8; 8192];
    let mut tag = Vec::new();
    let mut searching = true;
    loop {
        let count = input.read(&mut buffer).map_err(err)?;
        if count == 0 { return Err("SVG를 읽을 수 없어요.".into()); }
        tag.extend_from_slice(&buffer[..count]);
        if searching {
            if let Some(start) = tag.windows(4).position(|window| window == b"<svg") {
                tag.drain(..start);
                searching = false;
            } else {
                let keep = tag.len().min(3);
                tag.drain(..tag.len() - keep);
            }
        }
        if !searching {
            if let Some(end) = tag.iter().position(|byte| *byte == b'>') {
                return svg_dimensions(&tag[..=end]);
            }
        }
    }
}

pub(crate) fn read(path: &Path) -> Result<Media> {
    let temporary = TemporaryMedia::new(path)?;
    let source = temporary.source();
    let size = std::fs::metadata(&source).map_err(err)?.len();
    if size == 0 { return Err("파일이 비어 있어요.".into()); }
    let mut header = [0u8; 4096];
    let count = usize::try_from(size.min(header.len() as u64)).map_err(err)?;
    std::fs::File::open(&source).map_err(err)?.read_exact(&mut header[..count]).map_err(err)?;
    let mp4 = count >= 12 && &header[4..8] == b"ftyp";
    let mime = if mp4 { "video/mp4" } else {
        crate::characters::sprites::detect_mime(&header[..count])
            .ok_or("SVG·PNG·GIF·WebP·JPEG·MP4 파일만 사용할 수 있어요.")?
    };
    let (width, height) = if mp4 {
        super::image_video::dimensions(&source)?
    } else if mime == "image/svg+xml" {
        svg_dimensions_from_file(&source)?
    } else if mime == "image/jpeg" {
        let mut decoder = image::codecs::jpeg::JpegDecoder::new(BufReader::new(std::fs::File::open(&source).map_err(err)?)).map_err(err)?;
        let (width, height) = decoder.dimensions();
        let orientation = decoder.orientation().map_err(err)?;
        use image::metadata::Orientation;
        if matches!(orientation, Orientation::Rotate90 | Orientation::Rotate270 | Orientation::Rotate90FlipH | Orientation::Rotate270FlipH) {
            (height, width)
        } else { (width, height) }
    } else {
        image::ImageReader::new(BufReader::new(std::fs::File::open(&source).map_err(err)?))
            .with_guessed_format().map_err(err)?.into_dimensions().map_err(err)?
    };
    if width == 0 || height == 0 { return Err("이미지 크기가 올바르지 않아요.".into()); }
    let output = temporary.output();
    let compressed = if mp4 {
        super::image_video::transcode(&source, &output)
    } else {
        compress(&source, &output, mime, width, height)
    };
    let selected = if compressed.is_ok() && output.metadata().is_ok_and(|meta| meta.len() > 0 && meta.len() < size) {
        output
    } else { source };
    Ok(Media { _temporary: temporary, selected, mime, width, height })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jpeg_orientation_is_preserved_by_compression_and_fallback_dimensions() {
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("portrait.jpg");
        let output = directory.path().join("compressed.jpg");
        let image = image::DynamicImage::new_rgb8(4, 2);
        let mut encoded = std::io::Cursor::new(Vec::new());
        image.write_to(&mut encoded, ImageFormat::Jpeg).unwrap();
        let encoded = encoded.into_inner();
        let exif: &[u8] = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
        let mut oriented = vec![0xff, 0xd8, 0xff, 0xe1];
        oriented.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        oriented.extend_from_slice(exif);
        oriented.extend_from_slice(&encoded[2..]);
        std::fs::write(&source, oriented).unwrap();
        let media = read(&source).unwrap();
        assert_eq!((media.width, media.height), (2, 4));
        compress(&source, &output, "image/jpeg", 2, 4).unwrap();
        let decoded = image::open(&output).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (2, 4));
    }
}
