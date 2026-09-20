use super::appearance;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{process::Stdio, time::Duration};
use tokio::io::{AsyncRead, AsyncReadExt};

const MAX_RESPONSE_BYTES: usize = 128 * 1024;
const MAX_COMMAND_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone)]
pub struct ConnectionError {
    pub status: String,
    pub message: String,
}

fn failure(status: &str, message: &str) -> ConnectionError {
    ConnectionError {
        status: status.into(),
        message: message.into(),
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct State {
    configured: bool,
    status: String,
    last_success_at: Option<i64>,
    #[serde(default)]
    last_wake_at: Option<i64>,
    error: Option<String>,
    config: Value,
    observation: Option<Value>,
    #[serde(default)]
    appearance: appearance::Appearance,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct WeatherConfig {
    latitude: f64,
    longitude: f64,
    name: String,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct MusicConfig {
    provider: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DeviceConfig {}

pub fn initial(kind: &str) -> Value {
    if !["weather", "music", "device"].contains(&kind) {
        return Value::Null;
    }
    json!({"configured":false,"status":"permission-needed","lastSuccessAt":null,"error":null,"config":{},"observation":null,"appearance":appearance::initial()})
}

pub fn min_interval(kind: &str) -> i64 {
    match kind {
        "weather" => 30 * 60 * 1000,
        "music" => 15 * 1000,
        _ => 60 * 1000,
    }
}

fn weather_config(input: &Value) -> Result<WeatherConfig, String> {
    let config: WeatherConfig = serde_json::from_value(input.clone())
        .map_err(|_| "지역 이름과 위도·경도를 확인해 주세요.")?;
    if !config.latitude.is_finite()
        || !config.longitude.is_finite()
        || !(-90.0..=90.0).contains(&config.latitude)
        || !(-180.0..=180.0).contains(&config.longitude)
        || config.name.trim().is_empty()
        || config.name.chars().count() > 160
        || config.name.chars().any(char::is_control)
    {
        return Err("지역 이름과 위도·경도가 올바르지 않아요.".into());
    }
    Ok(config)
}

fn music_config(input: &Value) -> Result<MusicConfig, String> {
    let config: MusicConfig =
        serde_json::from_value(input.clone()).map_err(|_| "음악 정보 제공 앱을 선택해 주세요.")?;
    if !["music", "spotify"].contains(&config.provider.as_str()) {
        return Err("Music 또는 Spotify를 선택해 주세요.".into());
    }
    Ok(config)
}

pub fn configure(kind: &str, data: &Value, input: &Value) -> Result<Value, String> {
    let config = match kind {
        "weather" => {
            serde_json::to_value(weather_config(input)?).map_err(|error| error.to_string())?
        }
        "music" => serde_json::to_value(music_config(input)?).map_err(|error| error.to_string())?,
        "device" => {
            serde_json::from_value::<DeviceConfig>(input.clone())
                .map_err(|_| "기기 조회 설정이 올바르지 않아요.")?;
            json!({})
        }
        _ => return Err("지원하지 않는 정보 연결이에요.".into()),
    };
    let mut state: State = serde_json::from_value(data.clone())
        .map_err(|_| "저장된 정보 연결 설정을 읽지 못했어요.")?;
    if state.configured && state.config == config {
        return Ok(data.clone());
    }
    state.config = config;
    state.configured = true;
    state.status = "stale".into();
    state.last_success_at = None;
    state.observation = None;
    state.error = None;
    serde_json::to_value(state).map_err(|error| error.to_string())
}

fn client() -> Result<reqwest::Client, ConnectionError> {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(12))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|_| failure("offline", "조회 연결을 준비하지 못했어요."))
}

async fn fetch_json(request: reqwest::RequestBuilder) -> Result<Value, ConnectionError> {
    let mut response = request.send().await.map_err(|_| {
        failure(
            "offline",
            "정보 제공자에 연결하지 못했어요. 마지막 성공 정보는 보존합니다.",
        )
    })?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            401 | 403 => failure(
                "permission-needed",
                "정보 제공자가 조회를 허용하지 않았어요.",
            ),
            429 => failure(
                "offline",
                "정보 제공자의 조회 한도에 도달했어요. 잠시 후 다시 조회해 주세요.",
            ),
            _ => failure("offline", "정보 제공자가 조회에 실패했어요."),
        });
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_RESPONSE_BYTES as u64)
    {
        return Err(failure("offline", "조회 응답이 허용된 크기를 넘었어요."));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| failure("offline", "조회 응답을 끝까지 읽지 못했어요."))?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err(failure("offline", "조회 응답이 허용된 크기를 넘었어요."));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes)
        .map_err(|_| failure("offline", "조회 응답 형식이 올바르지 않아요."))
}

#[derive(Deserialize)]
struct RegionResponse {
    #[serde(default)]
    results: Vec<Region>,
}
#[derive(Deserialize)]
struct Region {
    id: u64,
    name: String,
    latitude: f64,
    longitude: f64,
    country: Option<String>,
    admin1: Option<String>,
}

fn parse_regions(value: Value) -> Result<Value, ConnectionError> {
    if value["error"] == true
        || (!value["results"].is_array() && !value["generationtime_ms"].is_number())
    {
        return Err(failure(
            "offline",
            "지역 검색이 정상적으로 완료되지 않았어요.",
        ));
    }
    let response: RegionResponse = serde_json::from_value(value)
        .map_err(|_| failure("offline", "지역 검색 결과를 읽지 못했어요."))?;
    if response.results.len() > 10 {
        return Err(failure("offline", "지역 검색 결과가 너무 많아요."));
    }
    let mut regions = vec![];
    for region in response.results {
        let config =
            json!({"name":region.name,"latitude":region.latitude,"longitude":region.longitude});
        weather_config(&config)
            .map_err(|_| failure("offline", "지역 검색 결과의 좌표가 올바르지 않아요."))?;
        let mut result = config;
        result["id"] = json!(region.id);
        result["country"] = json!(region
            .country
            .map(|text| text.chars().take(160).collect::<String>()));
        result["admin1"] = json!(region
            .admin1
            .map(|text| text.chars().take(160).collect::<String>()));
        regions.push(result);
    }
    Ok(json!(regions))
}

pub async fn search_regions(query: &str) -> Result<Value, ConnectionError> {
    let query = query.trim();
    if !(2..=100).contains(&query.chars().count()) || query.chars().any(char::is_control) {
        return Err(failure(
            "permission-needed",
            "지역 이름을 2자 이상 100자 이하로 입력해 주세요.",
        ));
    }
    let value = fetch_json(
        client()?
            .get("https://geocoding-api.open-meteo.com/v1/search")
            .query(&[
                ("name", query),
                ("count", "10"),
                ("language", "ko"),
                ("format", "json"),
            ]),
    )
    .await?;
    parse_regions(value)
}

#[derive(Deserialize)]
struct WeatherResponse {
    current: CurrentWeather,
}
#[derive(Deserialize)]
struct CurrentWeather {
    time: i64,
    temperature_2m: f64,
    weather_code: u8,
}

fn parse_weather(value: Value, config: &WeatherConfig, now: i64) -> Result<Value, ConnectionError> {
    let response: WeatherResponse = serde_json::from_value(value)
        .map_err(|_| failure("offline", "날씨 응답에 현재 정보가 없어요."))?;
    let current = response.current;
    if !current.temperature_2m.is_finite()
        || !(-100.0..=70.0).contains(&current.temperature_2m)
        || ![
            0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82,
            85, 86, 95, 96, 99,
        ]
        .contains(&current.weather_code)
    {
        return Err(failure("offline", "날씨 응답의 값이 올바르지 않아요."));
    }
    let observed_at = current
        .time
        .checked_mul(1000)
        .ok_or_else(|| failure("offline", "날씨의 관측 시각이 올바르지 않아요."))?;
    if observed_at < 0 || observed_at > now.saturating_add(30 * 60 * 1000) {
        return Err(failure("offline", "날씨의 관측 시각이 올바르지 않아요."));
    }
    Ok(
        json!({"name":config.name,"latitude":config.latitude,"longitude":config.longitude,
        "temperature":current.temperature_2m,"temperatureUnit":"°C","weatherCode":current.weather_code,
        "observedAt":observed_at,"source":"Open-Meteo","sourceUrl":"https://open-meteo.com/",
        "measurementType":"weather-model","attribution":"Weather data by Open-Meteo (CC BY 4.0)"}),
    )
}

async fn weather(config: &WeatherConfig, now: i64) -> Result<Value, ConnectionError> {
    let value = fetch_json(
        client()?
            .get("https://api.open-meteo.com/v1/forecast")
            .query(&[
                ("latitude", config.latitude.to_string()),
                ("longitude", config.longitude.to_string()),
                ("current", "temperature_2m,weather_code".into()),
                ("timeformat", "unixtime".into()),
                ("timezone", "UTC".into()),
                ("temperature_unit", "celsius".into()),
            ]),
    )
    .await?;
    parse_weather(value, config, now)
}

async fn read_bounded(reader: impl AsyncRead + Unpin) -> Result<Vec<u8>, ConnectionError> {
    let mut bytes = Vec::new();
    reader
        .take(MAX_COMMAND_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .await
        .map_err(|_| failure("offline", "기기 조회 응답을 읽지 못했어요."))?;
    if bytes.len() > MAX_COMMAND_BYTES {
        return Err(failure("offline", "기기 조회 응답이 너무 커요."));
    }
    Ok(bytes)
}

async fn run_read_command(program: &str, args: &[&str]) -> Result<String, ConnectionError> {
    let mut child = tokio::process::Command::new(program)
        .args(args)
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|_| failure("unsupported", "이 기기에서 조회 도구를 사용할 수 없어요."))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| failure("offline", "조회 출력을 준비하지 못했어요."))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| failure("offline", "조회 출력을 준비하지 못했어요."))?;
    let operation = async {
        let (output, errors, status) =
            tokio::try_join!(read_bounded(stdout), read_bounded(stderr), async {
                child
                    .wait()
                    .await
                    .map_err(|_| failure("offline", "기기 조회를 완료하지 못했어요."))
            })?;
        if !status.success() {
            let message = String::from_utf8_lossy(&errors);
            return Err(
                if message.contains("-1743")
                    || message.contains("not authorized")
                    || message.contains("Not authorized")
                {
                    failure("permission-needed", "시스템 설정의 개인정보 보호 및 보안 → 자동화에서 음악 앱 정보 조회를 허용해 주세요.")
                } else {
                    failure("offline", "기기에서 현재 정보를 읽지 못했어요.")
                },
            );
        }
        String::from_utf8(output)
            .map_err(|_| failure("offline", "기기 응답의 문자 형식이 올바르지 않아요."))
    };
    tokio::time::timeout(Duration::from_secs(8), operation)
        .await
        .map_err(|_| failure("offline", "기기 정보 조회 시간이 초과됐어요."))?
}

#[cfg(target_os = "macos")]
const MUSIC_SCRIPT: &str = r#"const app = Application('com.apple.Music');
if (!app.running()) { JSON.stringify({running:false,playing:false,title:null,artist:null,album:null}); }
else if (app.playerState() !== 'playing') { JSON.stringify({running:true,playing:false,title:null,artist:null,album:null}); }
else { const track = app.currentTrack(); JSON.stringify({running:true,playing:true,title:track.name(),artist:track.artist(),album:track.album()}); }"#;

#[cfg(target_os = "macos")]
const SPOTIFY_SCRIPT: &str = r#"const app = Application('com.spotify.client');
if (!app.running()) { JSON.stringify({running:false,playing:false,title:null,artist:null,album:null}); }
else if (app.playerState() !== 'playing') { JSON.stringify({running:true,playing:false,title:null,artist:null,album:null}); }
else { const track = app.currentTrack(); JSON.stringify({running:true,playing:true,title:track.name(),artist:track.artist(),album:track.album()}); }"#;

#[derive(Deserialize, Serialize)]
struct MusicObservation {
    running: bool,
    playing: bool,
    title: Option<String>,
    artist: Option<String>,
    album: Option<String>,
}

fn parse_music(output: &str, provider: &str, now: i64) -> Result<Value, ConnectionError> {
    let mut track: MusicObservation = serde_json::from_str(output)
        .map_err(|_| failure("offline", "현재 곡 정보를 읽지 못했어요."))?;
    if track.playing
        && (!track.running
            || track
                .title
                .as_ref()
                .is_none_or(|title| title.trim().is_empty()))
    {
        return Err(failure(
            "offline",
            "재생 중인 곡의 제목을 확인하지 못했어요.",
        ));
    }
    if !track.playing {
        track.title = None;
        track.artist = None;
        track.album = None;
    }
    for text in [&track.title, &track.artist, &track.album]
        .into_iter()
        .flatten()
    {
        if text.chars().count() > 1000 {
            return Err(failure("offline", "곡 정보가 너무 길어요."));
        }
    }
    let mut value =
        serde_json::to_value(track).map_err(|_| failure("offline", "곡 정보를 읽지 못했어요."))?;
    value["provider"] = json!(provider);
    value["source"] = json!(if provider == "music" {
        "Apple Music"
    } else {
        "Spotify"
    });
    value["observedAt"] = json!(now);
    Ok(value)
}

async fn music(config: &MusicConfig, now: i64) -> Result<Value, ConnectionError> {
    #[cfg(target_os = "macos")]
    {
        let script = if config.provider == "music" {
            MUSIC_SCRIPT
        } else {
            SPOTIFY_SCRIPT
        };
        let output =
            run_read_command("/usr/bin/osascript", &["-l", "JavaScript", "-e", script]).await?;
        parse_music(&output, &config.provider, now)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (config, now);
        Err(failure(
            "unsupported",
            "현재 음악 정보 연결은 macOS의 Music·Spotify를 지원해요.",
        ))
    }
}

fn parse_macos_battery(output: &str, now: i64) -> Result<Value, ConnectionError> {
    let first = output.lines().next().unwrap_or_default();
    let power = if first.contains("'AC Power'") {
        "ac"
    } else if first.contains("'Battery Power'") {
        "battery"
    } else {
        return Err(failure("offline", "기기의 전원 정보를 읽지 못했어요."));
    };
    let mut batteries = vec![];
    for line in output
        .lines()
        .skip(1)
        .filter(|line| !line.trim().is_empty())
    {
        let Some((before, after)) = line.split_once('%') else {
            return Err(failure("offline", "배터리 응답 형식이 올바르지 않아요."));
        };
        let digits = before
            .trim_end()
            .rsplit(|character: char| !character.is_ascii_digit())
            .next()
            .unwrap_or_default();
        let percent = digits
            .parse::<u8>()
            .ok()
            .filter(|percent| *percent <= 100)
            .ok_or_else(|| failure("offline", "배터리 잔량을 읽지 못했어요."))?;
        let status = after
            .trim()
            .trim_start_matches(';')
            .trim()
            .split(';')
            .next()
            .unwrap_or_default()
            .trim();
        let status = match status {
            "charging" => "charging",
            "discharging" => "discharging",
            "charged" => "charged",
            "not charging" => "not-charging",
            "finishing charge" => "charging",
            _ => "unknown",
        };
        batteries.push(json!({"percent":percent,"status":status}));
    }
    Ok(
        json!({"hasBattery":!batteries.is_empty(),"batteries":batteries,"powerSource":power,"observedAt":now,"source":"macOS pmset"}),
    )
}

#[cfg(any(target_os = "windows", test))]
#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct WindowsBattery {
    estimated_charge_remaining: Option<u8>,
    battery_status: Option<u16>,
}

#[cfg(any(target_os = "windows", test))]
fn parse_windows_battery(output: &str, now: i64) -> Result<Value, ConnectionError> {
    let rows: Vec<WindowsBattery> = serde_json::from_str(output.trim_start_matches('\u{feff}'))
        .map_err(|_| failure("offline", "Windows 배터리 응답을 읽지 못했어요."))?;
    if rows.len() > 32 {
        return Err(failure("offline", "배터리 응답 수가 제한을 넘었어요."));
    }
    let mut batteries = vec![];
    for row in rows {
        if row
            .estimated_charge_remaining
            .is_some_and(|percent| percent > 100)
        {
            return Err(failure("offline", "배터리 잔량이 올바르지 않아요."));
        }
        let status = match row.battery_status {
            Some(1) => "discharging",
            Some(3) => "charged",
            Some(6..=9) => "charging",
            Some(2) => "ac",
            _ => "unknown",
        };
        batteries.push(json!({"percent":row.estimated_charge_remaining,"status":status}));
    }
    Ok(
        json!({"hasBattery":!batteries.is_empty(),"batteries":batteries,"powerSource":"unknown","observedAt":now,"source":"Windows Win32_Battery"}),
    )
}

async fn device(now: i64) -> Result<Value, ConnectionError> {
    #[cfg(target_os = "macos")]
    {
        parse_macos_battery(
            &run_read_command("/usr/bin/pmset", &["-g", "batt"]).await?,
            now,
        )
    }
    #[cfg(target_os = "windows")]
    {
        const SCRIPT: &str = "$ErrorActionPreference='Stop'; [Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $batteries=@(Get-CimInstance -ClassName Win32_Battery | Select-Object EstimatedChargeRemaining,BatteryStatus); ConvertTo-Json -InputObject $batteries -Compress";
        let output = run_read_command(
            "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
            &["-NoProfile", "-NonInteractive", "-Command", SCRIPT],
        )
        .await?;
        parse_windows_battery(&output, now)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = now;
        Err(failure(
            "unsupported",
            "현재 배터리 정보 조회는 macOS와 Windows를 지원해요.",
        ))
    }
}

pub async fn refresh(kind: &str, data: &Value, now: i64) -> Result<Value, ConnectionError> {
    let mut state: State = serde_json::from_value(data.clone())
        .map_err(|_| failure("permission-needed", "정보 연결 설정을 다시 확인해 주세요."))?;
    if !state.configured {
        return Err(failure(
            "permission-needed",
            "먼저 조회할 정보 연결을 설정해 주세요.",
        ));
    }
    let observation = match kind {
        "weather" => {
            weather(
                &weather_config(&state.config)
                    .map_err(|message| failure("permission-needed", &message))?,
                now,
            )
            .await?
        }
        "music" => {
            music(
                &music_config(&state.config)
                    .map_err(|message| failure("permission-needed", &message))?,
                now,
            )
            .await?
        }
        "device" => {
            serde_json::from_value::<DeviceConfig>(state.config.clone()).map_err(|_| {
                failure("permission-needed", "기기 조회 설정을 다시 확인해 주세요.")
            })?;
            device(now).await?
        }
        _ => return Err(failure("unsupported", "지원하지 않는 정보 연결이에요.")),
    };
    let stale = kind == "weather"
        && observation["observedAt"]
            .as_i64()
            .is_some_and(|time| now.saturating_sub(time) > 2 * 60 * 60 * 1000);
    state.status = if stale { "stale" } else { "ready" }.into();
    state.error = None;
    state.observation = Some(observation);
    state.last_success_at = Some(now);
    serde_json::to_value(state)
        .map_err(|_| failure("offline", "조회 정보를 저장 형식으로 바꾸지 못했어요."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn explicit_region_config_rejects_invalid_coordinates_and_resets_old_region_cache() {
        assert!(configure(
            "weather",
            &initial("weather"),
            &json!({"name":"Seoul","latitude":91,"longitude":127})
        )
        .is_err());
        assert!(configure(
            "music",
            &initial("music"),
            &json!({"provider":"music; do shell script"})
        )
        .is_err());
        let mut old = configure(
            "weather",
            &initial("weather"),
            &json!({"name":"Seoul","latitude":37.56,"longitude":126.97}),
        )
        .unwrap();
        old["observation"] = json!({"temperature":25});
        old["lastSuccessAt"] = json!(100);
        let new = configure(
            "weather",
            &old,
            &json!({"name":"Busan","latitude":35.17,"longitude":129.07}),
        )
        .unwrap();
        assert!(new["observation"].is_null());
        assert!(new["lastSuccessAt"].is_null());
        assert_eq!(new["config"]["name"], "Busan");
    }

    #[test]
    fn weather_preserves_model_time_and_missing_data_is_not_zero_degrees() {
        let config = WeatherConfig {
            name: "Seoul".into(),
            latitude: 37.56,
            longitude: 126.97,
        };
        let observation = parse_weather(
            json!({"current":{"time":1000,"temperature_2m":21.5,"weather_code":3}}),
            &config,
            1_100_000,
        )
        .unwrap();
        assert_eq!(observation["observedAt"], 1_000_000);
        assert_eq!(observation["temperature"], 21.5);
        assert_eq!(observation["measurementType"], "weather-model");
        assert!(parse_weather(json!({"current":null}), &config, 1_100_000).is_err());
        assert!(parse_weather(
            json!({"current":{"time":1000,"temperature_2m":null,"weather_code":3}}),
            &config,
            1_100_000
        )
        .is_err());
    }

    #[test]
    fn successful_empty_search_differs_from_invalid_provider_response() {
        assert_eq!(
            parse_regions(json!({"generationtime_ms":0.2})).unwrap(),
            json!([])
        );
        assert!(parse_regions(json!({"results":"invalid"})).is_err());
        assert!(parse_regions(json!({"error":true,"reason":"provider unavailable"})).is_err());
        assert!(parse_regions(
            json!({"results":[{"id":1,"name":"Bad","latitude":200,"longitude":0}]})
        )
        .is_err());
    }

    #[test]
    fn music_empty_and_paused_states_never_retain_a_current_song() {
        let closed = parse_music(
            r#"{"running":false,"playing":false,"title":null,"artist":null,"album":null}"#,
            "music",
            100,
        )
        .unwrap();
        assert_eq!(closed["running"], false);
        assert!(closed["title"].is_null());
        let paused = parse_music(r#"{"running":true,"playing":false,"title":"Old song","artist":"Artist","album":"Album"}"#, "spotify", 100).unwrap();
        assert!(paused["title"].is_null());
        let playing = parse_music(
            r#"{"running":true,"playing":true,"title":"한 줄\n다음 줄","artist":"A","album":"B"}"#,
            "music",
            100,
        )
        .unwrap();
        assert_eq!(playing["title"], "한 줄\n다음 줄");
        assert!(parse_music(
            r#"{"running":false,"playing":true,"title":"Old song"}"#,
            "music",
            100
        )
        .is_err());
    }

    #[test]
    fn battery_desktop_empty_and_discharging_are_distinct_observations() {
        let desktop = parse_macos_battery("Now drawing from 'AC Power'\n", 100).unwrap();
        assert_eq!(desktop["hasBattery"], false);
        assert_eq!(desktop["powerSource"], "ac");
        let laptop = parse_macos_battery("Now drawing from 'Battery Power'\n -InternalBattery-0 (id=123)\t42%; discharging; 2:10 remaining present: true\n",100).unwrap();
        assert_eq!(laptop["batteries"][0]["percent"], 42);
        assert_eq!(laptop["batteries"][0]["status"], "discharging");
        assert!(parse_macos_battery("query failed", 100).is_err());
        let windows = parse_windows_battery(
            r#"[{"EstimatedChargeRemaining":70,"BatteryStatus":6}]"#,
            100,
        )
        .unwrap();
        assert_eq!(windows["batteries"][0]["status"], "charging");
        assert_eq!(
            parse_windows_battery("[]", 100).unwrap()["hasBattery"],
            false
        );
        assert!(parse_windows_battery(
            r#"[{"EstimatedChargeRemaining":255,"BatteryStatus":1}]"#,
            100
        )
        .is_err());
    }

    #[tokio::test]
    async fn unconfigured_refresh_cannot_start_an_external_query() {
        for kind in ["weather", "music", "device"] {
            let error = refresh(kind, &initial(kind), 100).await.unwrap_err();
            assert_eq!(error.status, "permission-needed");
        }
    }

    #[tokio::test]
    async fn subprocess_reader_rejects_oversized_output_without_retaining_it() {
        let bytes = vec![b'a'; MAX_COMMAND_BYTES + 2];
        assert!(read_bounded(bytes.as_slice()).await.is_err());
        assert_eq!(read_bounded(&b"safe"[..]).await.unwrap(), b"safe");
    }
}
