use crate::protocol::Token;
use libloading::Library;
use std::{
    ffi::{c_char, c_void, CStr, CString},
    path::Path,
};

type Handle = *mut c_void;
#[repr(C)]
struct AnalyzeOption {
    match_options: i32,
    blocklist: Handle,
    open_ending: i32,
    allowed_dialects: i32,
    dialect_cost: f32,
    typo_transformer: Handle,
    typo_threshold: f32,
}
type Init = unsafe extern "C" fn(*const c_char, i32, i32, i32) -> Handle;
type Close = unsafe extern "C" fn(Handle) -> i32;
type Analyze = unsafe extern "C" fn(Handle, *const u16, i32, AnalyzeOption, Handle) -> Handle;
type Count = unsafe extern "C" fn(Handle, i32) -> i32;
type Text = unsafe extern "C" fn(Handle, i32, i32) -> *const c_char;
type Position = unsafe extern "C" fn(Handle, i32, i32) -> i32;

pub struct Kiwi {
    _library: Library,
    handle: Handle,
    close: Close,
    analyze: Analyze,
    result_close: Close,
    count: Count,
    form: Text,
    tag: Text,
    position: Position,
    length: Position,
}

impl Kiwi {
    pub fn load(library: &Path, model: &Path) -> Result<Self, String> {
        // The pinned library is bundled with the application; paths never come from JSONL.
        unsafe {
            let library = Library::new(library).map_err(|_| "kiwi_library_unavailable")?;
            macro_rules! symbol {
                ($name:literal, $ty:ty) => {
                    *library
                        .get::<$ty>(concat!($name, "\0").as_bytes())
                        .map_err(|_| "kiwi_abi_mismatch")?
                };
            }
            let init = symbol!("kiwi_init", Init);
            let close = symbol!("kiwi_close", Close);
            let analyze = symbol!("kiwi_analyze_w", Analyze);
            let result_close = symbol!("kiwi_res_close", Close);
            let count = symbol!("kiwi_res_word_num", Count);
            let form = symbol!("kiwi_res_form", Text);
            let tag = symbol!("kiwi_res_tag", Text);
            let position = symbol!("kiwi_res_position", Position);
            let length = symbol!("kiwi_res_length", Position);
            let model = CString::new(model.to_string_lossy().as_bytes())
                .map_err(|_| "invalid_model_path")?;
            // CoNg, normalized allomorphs and the default dictionary. Optional multi/typo dictionaries stay unloaded.
            let handle = init(model.as_ptr(), 1, 0x0400 | 1 | 2, 0);
            if handle.is_null() {
                return Err("kiwi_initialization_failed".into());
            }
            Ok(Self {
                _library: library,
                handle,
                close,
                analyze,
                result_close,
                count,
                form,
                tag,
                position,
                length,
            })
        }
    }

    pub fn analyze(&self, text: &str) -> Result<Vec<Token>, String> {
        if text.contains('\0') {
            return Err("kiwi_embedded_nul".into());
        }
        let units: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
        let boundaries = utf16_byte_boundaries(text);
        let option = AnalyzeOption {
            match_options: 0b11_1111,
            blocklist: std::ptr::null_mut(),
            open_ending: 0,
            allowed_dialects: 0,
            dialect_cost: 3.0,
            typo_transformer: std::ptr::null_mut(),
            typo_threshold: 0.0,
        };
        unsafe {
            let result =
                (self.analyze)(self.handle, units.as_ptr(), 1, option, std::ptr::null_mut());
            if result.is_null() {
                return Err("kiwi_analysis_failed".into());
            }
            struct Guard(Handle, Close);
            impl Drop for Guard {
                fn drop(&mut self) {
                    unsafe {
                        (self.1)(self.0);
                    }
                }
            }
            let _guard = Guard(result, self.result_close);
            let count = (self.count)(result, 0);
            if !(0..=65536).contains(&count) {
                return Err("kiwi_invalid_token_count".into());
            }
            let mut tokens = Vec::with_capacity(count as usize);
            for i in 0..count {
                let start = (self.position)(result, 0, i);
                let length = (self.length)(result, 0, i);
                if start < 0 || length < 0 {
                    return Err("kiwi_invalid_span".into());
                }
                let (start, end) = byte_span(&boundaries, start as usize, length as usize)?;
                let form = (self.form)(result, 0, i);
                let tag = (self.tag)(result, 0, i);
                if form.is_null() || tag.is_null() {
                    return Err("kiwi_invalid_token".into());
                }
                tokens.push(Token {
                    form: CStr::from_ptr(form).to_string_lossy().into_owned(),
                    tag: CStr::from_ptr(tag).to_string_lossy().into_owned(),
                    start,
                    end,
                });
            }
            Ok(tokens)
        }
    }
}
impl Drop for Kiwi {
    fn drop(&mut self) {
        unsafe {
            (self.close)(self.handle);
        }
    }
}

fn utf16_byte_boundaries(text: &str) -> Vec<Option<usize>> {
    let mut map = vec![Some(0)];
    for (offset, character) in text.char_indices() {
        if character.len_utf16() == 2 {
            map.push(None);
        }
        map.push(Some(offset + character.len_utf8()));
    }
    map
}
fn byte_span(map: &[Option<usize>], start: usize, length: usize) -> Result<(usize, usize), String> {
    let end = start.checked_add(length).ok_or("kiwi_invalid_span")?;
    match (
        map.get(start).copied().flatten(),
        map.get(end).copied().flatten(),
    ) {
        (Some(a), Some(b)) if a <= b => Ok((a, b)),
        _ => Err("kiwi_invalid_utf16_boundary".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn spans_preserve_original_korean_emoji_combining_crlf() {
        let text = "한😀e\u{301}\r\n글";
        let map = utf16_byte_boundaries(text);
        assert_eq!(byte_span(&map, 1, 2).unwrap(), (3, 7));
        assert_eq!(
            &text[byte_span(&map, 3, 2).unwrap().0..byte_span(&map, 3, 2).unwrap().1],
            "e\u{301}"
        );
        assert!(byte_span(&map, 2, 1).is_err());
        assert_eq!(byte_span(&map, 0, 8).unwrap(), (0, text.len()));
    }
}
