use super::{AnimationAsset, AssetInfo, PreparedAsset, Result, MAX_ASSET_BYTES, MAX_DECODED_BYTES};
use sha2::{Digest, Sha256};
use std::{collections::BTreeSet, io::Cursor, path::PathBuf};

pub fn read_files(paths: &[PathBuf]) -> Result<Vec<AnimationAsset>> {
    if paths.len() > 64 {
        return Err("이미지는 한 번에 64개까지 선택할 수 있어요.".into());
    }
    let mut assets = Vec::new();
    let mut seen = BTreeSet::new();
    let mut decoded_bytes = 0_u64;
    let mut encoded_bytes = 0_usize;
    for path in paths {
        let bytes = super::read_file_bytes(path)?;
        let frames =
            decode_import_frames(bytes, 64 - assets.len(), MAX_DECODED_BYTES - decoded_bytes)?;
        for frame in frames {
            decoded_bytes += u64::from(frame.info.width) * u64::from(frame.info.height) * 4;
            let payload = frame.payload();
            if seen.insert(frame.asset_id) {
                encoded_bytes += payload.data.len();
                if encoded_bytes > crate::characters::MAX_PACK_BYTES {
                    return Err("선택한 이미지 데이터는 합계 32 MiB 이하여야 해요.".into());
                }
            }
            assets.push(payload);
        }
    }
    Ok(assets)
}

fn decode_import_frames(
    bytes: Vec<u8>,
    remaining_frames: usize,
    remaining_bytes: u64,
) -> Result<Vec<PreparedAsset>> {
    if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
    {
        return Err("애니메이션에는 2 MiB 이하의 PNG·APNG 이미지만 사용할 수 있어요.".into());
    }
    let mut decoder = png::Decoder::new(Cursor::new(&bytes));
    decoder.set_limits(png::Limits {
        bytes: MAX_DECODED_BYTES as usize,
    });
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|_| "PNG·APNG 이미지를 읽지 못했어요.")?;
    let (width, height) = (reader.info().width, reader.info().height);
    if !(1..=4096).contains(&width) || !(1..=4096).contains(&height) {
        return Err("애니메이션 이미지는 가로·세로 4096px 이하여야 해요.".into());
    }
    let animation = reader.info().animation_control;
    let frame_count = animation.map_or(1, |control| control.num_frames) as usize;
    let canvas_bytes = u64::from(width) * u64::from(height) * 4;
    if frame_count == 0 || frame_count > remaining_frames || frame_count > 64 {
        return Err("선택한 이미지의 애니메이션 프레임은 합계 64개 이하여야 해요.".into());
    }
    if canvas_bytes * frame_count as u64 > remaining_bytes {
        return Err("선택한 프레임은 펼쳤을 때 합계 64 MiB 이하여야 해요.".into());
    }
    if animation.is_none() {
        drop(reader);
        return super::prepare_png(bytes).map(|asset| vec![asset]);
    }
    validate_frame_count(&bytes, frame_count)?;
    let separate_default = reader.info().frame_control.is_none();
    let interlaced = reader.info().interlaced;
    let output_size = reader
        .output_buffer_size()
        .filter(|size| *size <= MAX_DECODED_BYTES as usize)
        .ok_or("APNG 이미지가 너무 커요.")?;
    let mut raw = vec![0; output_size];
    let mut canvas = vec![0; canvas_bytes as usize];
    if separate_default {
        reader
            .next_frame(&mut raw)
            .map_err(|_| "APNG의 기본 이미지를 읽지 못했어요.")?;
    }
    let mut frames = Vec::with_capacity(frame_count);
    for _ in 0..frame_count {
        let output = reader
            .next_frame(&mut raw)
            .map_err(|_| "APNG 프레임을 읽지 못했어요.")?;
        let control = reader
            .info()
            .frame_control
            .ok_or("APNG 프레임 정보가 없어요.")?;
        if control.width == 0
            || control.height == 0
            || control
                .x_offset
                .checked_add(control.width)
                .is_none_or(|right| right > width)
            || control
                .y_offset
                .checked_add(control.height)
                .is_none_or(|bottom| bottom > height)
            || output.width != control.width
            || output.height != control.height
            || output.bit_depth != png::BitDepth::Eight
        {
            return Err("APNG 프레임 영역이 올바르지 않아요.".into());
        }
        let previous = (control.dispose_op == png::DisposeOp::Previous).then(|| canvas.clone());
        // png's Adam7 output uses the full image stride, including for subframes.
        let stride = if interlaced {
            width as usize * output.color_type.samples()
        } else {
            output.line_size
        };
        composite(&mut canvas, width, &raw, stride, output.color_type, control)?;
        frames.push(encode_frame(width, height, &canvas)?);
        match control.dispose_op {
            png::DisposeOp::None => {}
            png::DisposeOp::Background => {
                for y in control.y_offset..control.y_offset + control.height {
                    let start = ((y * width + control.x_offset) * 4) as usize;
                    canvas[start..start + control.width as usize * 4].fill(0);
                }
            }
            png::DisposeOp::Previous => {
                canvas = previous.ok_or("APNG의 이전 프레임을 찾지 못했어요.")?
            }
        }
    }
    reader.finish().map_err(|_| "APNG 이미지가 손상됐어요.")?;
    Ok(frames)
}

fn validate_frame_count(bytes: &[u8], expected: usize) -> Result<()> {
    let mut position = 8_usize;
    let mut frames = 0_usize;
    while let Some(header) = bytes.get(position..position + 8) {
        let length = u32::from_be_bytes(
            header[..4]
                .try_into()
                .map_err(|_| "APNG 청크가 손상됐어요.")?,
        ) as usize;
        let end = position
            .checked_add(12)
            .and_then(|value| value.checked_add(length))
            .filter(|end| *end <= bytes.len())
            .ok_or("APNG 청크가 손상됐어요.")?;
        if &header[4..] == b"fcTL" {
            frames += 1;
        }
        if &header[4..] == b"IEND" {
            return if frames == expected {
                Ok(())
            } else {
                Err("APNG에 선언된 프레임 수와 실제 프레임 수가 다릅니다.".into())
            };
        }
        position = end;
    }
    Err("APNG 이미지의 끝을 찾지 못했어요.".into())
}

fn composite(
    canvas: &mut [u8],
    canvas_width: u32,
    raw: &[u8],
    stride: usize,
    color: png::ColorType,
    control: png::FrameControl,
) -> Result<()> {
    let channels = color.samples();
    for y in 0..control.height as usize {
        for x in 0..control.width as usize {
            let index = y * stride + x * channels;
            let pixel = raw
                .get(index..index + channels)
                .ok_or("APNG 프레임 데이터가 부족해요.")?;
            let rgba = match color {
                png::ColorType::Rgba => [pixel[0], pixel[1], pixel[2], pixel[3]],
                png::ColorType::Rgb => [pixel[0], pixel[1], pixel[2], 255],
                png::ColorType::GrayscaleAlpha => [pixel[0], pixel[0], pixel[0], pixel[1]],
                png::ColorType::Grayscale => [pixel[0], pixel[0], pixel[0], 255],
                png::ColorType::Indexed => return Err("APNG 색상 정보를 펼치지 못했어요.".into()),
            };
            let destination = ((y + control.y_offset as usize) * canvas_width as usize
                + x
                + control.x_offset as usize)
                * 4;
            let target = &mut canvas[destination..destination + 4];
            if control.blend_op == png::BlendOp::Source {
                target.copy_from_slice(&rgba);
            } else {
                over(target, rgba);
            }
        }
    }
    Ok(())
}

fn over(target: &mut [u8], source: [u8; 4]) {
    let source_alpha = u32::from(source[3]);
    let target_alpha = u32::from(target[3]);
    let inverse = 255 - source_alpha;
    let alpha = source_alpha * 255 + target_alpha * inverse;
    if alpha == 0 {
        target.fill(0);
        return;
    }
    for channel in 0..3 {
        let weighted = u32::from(source[channel]) * source_alpha * 255
            + u32::from(target[channel]) * target_alpha * inverse;
        target[channel] = ((weighted + alpha / 2) / alpha) as u8;
    }
    target[3] = ((alpha + 127) / 255) as u8;
}

fn encode_frame(width: u32, height: u32, rgba: &[u8]) -> Result<PreparedAsset> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder
            .write_header()
            .map_err(|_| "APNG 프레임을 PNG로 변환하지 못했어요.")?;
        writer
            .write_image_data(rgba)
            .map_err(|_| "APNG 프레임을 PNG로 변환하지 못했어요.")?;
        writer
            .finish()
            .map_err(|_| "APNG 프레임을 저장하지 못했어요.")?;
    }
    if bytes.len() > MAX_ASSET_BYTES {
        return Err("APNG에서 펼친 한 프레임이 2 MiB를 넘어요. 이미지 크기를 줄여 주세요.".into());
    }
    Ok(PreparedAsset {
        asset_id: hex::encode(Sha256::digest(&bytes)),
        info: AssetInfo {
            mime: "image/png".into(),
            width,
            height,
        },
        bytes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn control(
        width: u32,
        x: u32,
        blend: png::BlendOp,
        dispose: png::DisposeOp,
    ) -> png::FrameControl {
        png::FrameControl {
            width,
            height: 1,
            x_offset: x,
            blend_op: blend,
            dispose_op: dispose,
            ..Default::default()
        }
    }
    fn apng(
        width: u32,
        default: Option<&[u8]>,
        frames: &[(png::FrameControl, Vec<u8>)],
    ) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, 1);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            encoder.set_animated(frames.len() as u32, 0).unwrap();
            encoder.set_sep_def_img(default.is_some()).unwrap();
            let mut writer = encoder.write_header().unwrap();
            if let Some(default) = default {
                writer.write_image_data(default).unwrap();
            }
            for (frame, pixels) in frames {
                writer.reset_frame_position().unwrap();
                writer
                    .set_frame_dimension(frame.width, frame.height)
                    .unwrap();
                writer
                    .set_frame_position(frame.x_offset, frame.y_offset)
                    .unwrap();
                writer.set_blend_op(frame.blend_op).unwrap();
                writer.set_dispose_op(frame.dispose_op).unwrap();
                writer.write_image_data(pixels).unwrap();
            }
            writer.finish().unwrap();
        }
        bytes
    }
    fn pixels(frame: &PreparedAsset) -> Vec<u8> {
        let mut reader = png::Decoder::new(Cursor::new(&frame.bytes))
            .read_info()
            .unwrap();
        assert!(reader.info().animation_control.is_none());
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        let output = reader.next_frame(&mut pixels).unwrap();
        assert_eq!(output.color_type, png::ColorType::Rgba);
        pixels.truncate(output.buffer_size());
        pixels
    }

    fn replace_declared_count(mut bytes: Vec<u8>, count: u32) -> Vec<u8> {
        let kind = bytes.windows(4).position(|part| part == b"acTL").unwrap();
        bytes[kind + 4..kind + 8].copy_from_slice(&count.to_be_bytes());
        let mut checksum = flate2::Crc::new();
        checksum.update(&bytes[kind..kind + 12]);
        bytes[kind + 12..kind + 16].copy_from_slice(&checksum.sum().to_be_bytes());
        bytes
    }

    #[test]
    fn apng_composites_source_over_alpha_and_none_background_previous_disposal() {
        use png::{
            BlendOp::{Over, Source},
            DisposeOp::{Background, None, Previous},
        };
        let bytes = apng(
            2,
            Option::None,
            &[
                (
                    control(2, 0, Source, None),
                    vec![255, 0, 0, 255, 0, 0, 255, 128],
                ),
                (control(1, 0, Source, Background), vec![0, 255, 0, 0]),
                (control(1, 0, Over, Previous), vec![0, 255, 0, 128]),
                (control(1, 1, Over, None), vec![255, 0, 0, 128]),
            ],
        );
        let frames = decode_import_frames(bytes, 64, MAX_DECODED_BYTES).unwrap();
        assert_eq!(frames.len(), 4);
        assert!(frames
            .iter()
            .all(|frame| frame.info.width == 2 && frame.info.height == 1));
        assert_eq!(pixels(&frames[0]), vec![255, 0, 0, 255, 0, 0, 255, 128]);
        assert_eq!(pixels(&frames[1]), vec![0, 255, 0, 0, 0, 0, 255, 128]);
        assert_eq!(pixels(&frames[2]), vec![0, 255, 0, 128, 0, 0, 255, 128]);
        assert_eq!(pixels(&frames[3]), vec![0, 0, 0, 0, 170, 0, 85, 192]);
        for frame in frames {
            super::super::prepare_assets(vec![frame.payload()]).unwrap();
        }
    }

    #[test]
    fn apng_ignores_separate_default_and_previous_on_first_frame_restores_transparency() {
        use png::{
            BlendOp::Source,
            DisposeOp::{None, Previous},
        };
        let bytes = apng(
            2,
            Some(&[255, 0, 0, 255, 255, 0, 0, 255]),
            &[
                (control(1, 1, Source, Previous), vec![0, 0, 255, 255]),
                (control(1, 0, Source, None), vec![0, 255, 0, 255]),
            ],
        );
        let frames = decode_import_frames(bytes, 64, MAX_DECODED_BYTES).unwrap();
        assert_eq!(frames.len(), 2);
        assert_eq!(pixels(&frames[0]), vec![0, 0, 0, 0, 0, 0, 255, 255]);
        assert_eq!(pixels(&frames[1]), vec![0, 255, 0, 255, 0, 0, 0, 0]);
    }

    #[test]
    fn apng_limits_count_displayed_frames_even_when_every_frame_is_identical() {
        let frame = (
            control(1, 0, png::BlendOp::Source, png::DisposeOp::None),
            vec![255; 4],
        );
        let bytes = apng(1, None, &vec![frame.clone(); 64]);
        let frames = decode_import_frames(bytes.clone(), 64, 256).unwrap();
        assert_eq!(frames.len(), 64);
        assert!(frames
            .iter()
            .all(|value| value.asset_id == frames[0].asset_id));
        assert!(decode_import_frames(bytes.clone(), 63, MAX_DECODED_BYTES).is_err());
        assert!(decode_import_frames(bytes.clone(), 64, 255).is_err());
        assert!(decode_import_frames(
            replace_declared_count(bytes.clone(), 1),
            64,
            MAX_DECODED_BYTES
        )
        .is_err());
        assert!(
            decode_import_frames(bytes[..bytes.len() - 8].to_vec(), 64, MAX_DECODED_BYTES).is_err()
        );
        assert!(
            decode_import_frames(apng(1, None, &vec![frame; 65]), 64, MAX_DECODED_BYTES).is_err()
        );
    }

    #[test]
    fn picker_preserves_file_order_and_expands_apng_in_display_order() {
        let directory = tempfile::tempdir().unwrap();
        let still = directory.path().join("still.png");
        let animated = directory.path().join("animated.apng");
        let still_bytes = super::super::png_fixture(1, 1, 0, false);
        std::fs::write(&still, &still_bytes).unwrap();
        std::fs::write(
            &animated,
            apng(
                1,
                None,
                &[
                    (
                        control(1, 0, png::BlendOp::Source, png::DisposeOp::None),
                        vec![255, 0, 0, 255],
                    ),
                    (
                        control(1, 0, png::BlendOp::Source, png::DisposeOp::None),
                        vec![0, 0, 255, 255],
                    ),
                ],
            ),
        )
        .unwrap();
        let selected = read_files(&[still.clone(), animated, still]).unwrap();
        assert_eq!(selected.len(), 4);
        assert_eq!(selected[0], selected[3]);
        let first = super::super::prepare_assets(vec![selected[1].clone()])
            .unwrap()
            .remove(0);
        let second = super::super::prepare_assets(vec![selected[2].clone()])
            .unwrap()
            .remove(0);
        assert_eq!(pixels(&first), vec![255, 0, 0, 255]);
        assert_eq!(pixels(&second), vec![0, 0, 255, 255]);
    }
}
