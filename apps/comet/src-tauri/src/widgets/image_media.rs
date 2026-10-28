use image::{AnimationDecoder, ImageDecoder, ImageFormat};
use std::{
    io::{Cursor, Write},
    path::Path,
};


type Result<T> = std::result::Result<T, String>;
fn err(error: impl std::fmt::Display) -> String {
    error.to_string()
}

pub(crate) struct Media {
    pub bytes: Vec<u8>,
    pub mime: &'static str,
    pub width: u32,
    pub height: u32,
}

fn gif_repeat(bytes: &[u8]) -> Option<image::codecs::gif::Repeat> {
    bytes.windows(18).find_map(|chunk| {
        if (&chunk[..14] != b"\x21\xff\x0bNETSCAPE2.0"
            && &chunk[..14] != b"\x21\xff\x0bANIMEXTS1.0")
            || chunk[14] != 3
            || chunk[15] != 1
        {
            return None;
        }
        let count = u16::from_le_bytes([chunk[16], chunk[17]]);
        Some(if count == 0 {
            image::codecs::gif::Repeat::Infinite
        } else {
            image::codecs::gif::Repeat::Finite(count)
        })
    })
}

fn resized(width: u32, height: u32) -> (u32, u32) {
    let scale = (2048.0 / width.max(height) as f64).min(1.0);
    (
        (width as f64 * scale).round().max(1.0) as u32,
        (height as f64 * scale).round().max(1.0) as u32,
    )
}

struct LimitedOutput<'a> {
    data: &'a mut Vec<u8>,
    limit: usize,
}

struct TemporaryVideo(std::path::PathBuf);

impl TemporaryVideo {
    fn new(bytes: &[u8]) -> Result<Self> {
        let dir = std::env::temp_dir().join(format!("comet-image-source-{}", uuid::Uuid::new_v4()));
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder.create(&dir).map_err(err)?;
        let video = Self(dir);
        std::fs::write(video.0.join("source.mp4"), bytes).map_err(err)?;
        Ok(video)
    }

    fn path(&self) -> std::path::PathBuf {
        self.0.join("source.mp4")
    }
}

impl Drop for TemporaryVideo {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

impl Write for LimitedOutput<'_> {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if bytes.len() > self.limit.saturating_sub(self.data.len()) {
            return Err(std::io::Error::other("encoded image exceeds original size"));
        }
        self.data.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn compress(bytes: &[u8], mime: &str, width: u32, height: u32) -> Result<Vec<u8>> {
    let (w, h) = resized(width, height);
    let mut result = Vec::new();
    match mime {
        "image/gif" => {
            let mut decoder =
                image::codecs::gif::GifDecoder::new(Cursor::new(bytes)).map_err(err)?;
            decoder.set_limits(image::Limits::default()).map_err(err)?;
            let mut encoder = image::codecs::gif::GifEncoder::new_with_speed(
                LimitedOutput {
                    data: &mut result,
                    limit: bytes.len(),
                },
                10,
            );
            if let Some(repeat) = gif_repeat(bytes) {
                encoder.set_repeat(repeat).map_err(err)?;
            }
            for frame in decoder.into_frames() {
                let frame = frame.map_err(err)?;
                let delay = frame.delay();
                let pixels = image::imageops::resize(
                    &frame.into_buffer(),
                    w,
                    h,
                    image::imageops::FilterType::Lanczos3,
                );
                encoder
                    .encode_frame(image::Frame::from_parts(pixels, 0, 0, delay))
                    .map_err(err)?;
            }
        }
        "image/png" => {
            let decoder = image::codecs::png::PngDecoder::with_limits(
                Cursor::new(bytes),
                image::Limits::default(),
            )
            .map_err(err)?;
            if decoder.is_apng().map_err(err)? {
                let reader = png::Decoder::new(Cursor::new(bytes))
                    .read_info()
                    .map_err(err)?;
                let animation = reader
                    .info()
                    .animation_control
                    .ok_or("APNG 애니메이션 정보가 없어요.")?;
                let mut encoder = png::Encoder::new(
                    LimitedOutput {
                        data: &mut result,
                        limit: bytes.len(),
                    },
                    w,
                    h,
                );
                encoder.set_color(png::ColorType::Rgba);
                encoder.set_depth(png::BitDepth::Eight);
                encoder
                    .set_animated(animation.num_frames, animation.num_plays)
                    .map_err(err)?;
                encoder.set_blend_op(png::BlendOp::Source).map_err(err)?;
                let mut writer = encoder.write_header().map_err(err)?;
                for frame in decoder.apng().map_err(err)?.into_frames() {
                    let frame = frame.map_err(err)?;
                    let (numer, denom) = frame.delay().numer_denom_ms();
                    let denom = denom.checked_mul(1000).ok_or("프레임 지연이 너무 커요.")?;
                    let gcd = gcd(numer, denom);
                    writer
                        .set_frame_delay(
                            u16::try_from(numer / gcd).map_err(err)?,
                            u16::try_from(denom / gcd).map_err(err)?,
                        )
                        .map_err(err)?;
                    let pixels = image::imageops::resize(
                        &frame.into_buffer(),
                        w,
                        h,
                        image::imageops::FilterType::Lanczos3,
                    );
                    writer.write_image_data(&pixels).map_err(err)?;
                }
                writer.finish().map_err(err)?;
            } else {
                let image =
                    image::load_from_memory_with_format(bytes, ImageFormat::Png).map_err(err)?;
                image
                    .resize_exact(w, h, image::imageops::FilterType::Lanczos3)
                    .write_to(&mut Cursor::new(&mut result), ImageFormat::Png)
                    .map_err(err)?;
            }
        }
        "image/jpeg" | "image/webp" => {
            let format = if mime == "image/jpeg" {
                ImageFormat::Jpeg
            } else {
                ImageFormat::WebP
            };
            if mime == "image/webp"
                && image::codecs::webp::WebPDecoder::new(Cursor::new(bytes))
                    .map_err(err)?
                    .has_animation()
            {
                return Ok(bytes.to_vec());
            }
            let image = image::load_from_memory_with_format(bytes, format).map_err(err)?;
            image
                .resize_exact(w, h, image::imageops::FilterType::Lanczos3)
                .write_to(&mut Cursor::new(&mut result), format)
                .map_err(err)?;
        }
        _ => return Ok(bytes.to_vec()),
    }
    Ok(result)
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

pub(crate) fn read(path: &Path) -> Result<Media> {
    let bytes = std::fs::read(path).map_err(err)?;
    if bytes.is_empty() {
        return Err("파일이 비어 있어요.".into());
    }
    let mp4 = bytes.len() >= 12 && &bytes[4..8] == b"ftyp";
    let mime = if mp4 {
        "video/mp4"
    } else {
        crate::characters::sprites::detect_mime(&bytes)
            .ok_or("SVG·PNG·GIF·WebP·JPEG·MP4 파일만 사용할 수 있어요.")?
    };
    let video = if mp4 {
        Some(TemporaryVideo::new(&bytes)?)
    } else {
        None
    };
    let (width, height) = if let Some(video) = &video {
        super::image_video::dimensions(&video.path())?
    } else if mime == "image/svg+xml" {
        svg_dimensions(&bytes)?
    } else {
        let reader = image::ImageReader::new(Cursor::new(&bytes))
            .with_guessed_format()
            .map_err(err)?;
        reader.into_dimensions().map_err(err)?
    };
    if width == 0 || height == 0 {
        return Err("이미지 크기가 올바르지 않아요.".into());
    }
    let compressed = if let Some(video) = &video {
        super::image_video::transcode(&video.path())
    } else {
        compress(&bytes, mime, width, height)
    };
    let bytes = compressed
        .ok()
        .filter(|output| !output.is_empty() && output.len() < bytes.len())
        .unwrap_or(bytes);
    Ok(Media {
        bytes,
        mime,
        width,
        height,
    })
}
