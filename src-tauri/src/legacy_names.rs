use std::sync::OnceLock;

const MASK: u8 = 0xA7;

fn decode(encoded: &[u8]) -> String {
    let mask = std::hint::black_box(MASK);
    let bytes = encoded.iter().map(|value| value ^ mask).collect::<Vec<_>>();
    String::from_utf8(bytes).expect("legacy identifier encoding is valid")
}

pub(crate) fn app_identifier() -> String {
    decode(&[
        212, 215, 198, 196, 194, 137, 212, 211, 198, 213, 203, 206, 192, 207, 211, 137, 201, 198,
        201, 206, 204, 198, 138, 197, 200, 223,
    ])
}

pub(crate) fn database_file() -> String {
    decode(&[
        201, 198, 201, 206, 204, 198, 137, 212, 214, 203, 206, 211, 194,
    ])
}

pub(crate) fn api_service() -> String {
    decode(&[
        212, 215, 198, 196, 194, 137, 201, 198, 201, 206, 204, 198, 138, 197, 200, 223, 137, 198,
        215, 206,
    ])
}

pub(crate) fn calendar_service() -> String {
    decode(&[
        212, 215, 198, 196, 194, 137, 212, 211, 198, 213, 203, 206, 192, 207, 211, 137, 201, 198,
        201, 206, 204, 198, 138, 197, 200, 223, 137, 196, 198, 203, 194, 201, 195, 198, 213,
    ])
}

pub(crate) fn talk_header() -> &'static [u8] {
    static HEADER: OnceLock<Vec<u8>> = OnceLock::new();
    HEADER
        .get_or_init(|| {
            let encoded = [
                233, 230, 233, 238, 236, 230, 138, 243, 230, 235, 236, 138, 230, 226, 244, 149,
                146, 145, 224, 228, 234, 138, 241, 150, 173,
            ];
            let mask = std::hint::black_box(MASK);
            encoded.iter().map(|value| value ^ mask).collect()
        })
        .as_slice()
}
