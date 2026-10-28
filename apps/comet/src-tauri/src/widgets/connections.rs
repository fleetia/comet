use super::appearance;
use chrono::{Datelike, Duration as ChronoDuration};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[cfg(any(target_os = "macos", target_os = "windows"))]
use std::process::Stdio;
use std::time::Duration;
#[cfg(any(target_os = "macos", target_os = "windows", test))]
use tokio::io::{AsyncRead, AsyncReadExt};

const MAX_RESPONSE_BYTES: usize = 128 * 1024;
#[cfg(any(target_os = "macos", target_os = "windows", test))]
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
    forecast: Option<Value>,
    #[serde(default)]
    last_year: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    spicetify_pairing_id: Option<String>,
    #[serde(default)]
    appearance: appearance::Appearance,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct WeatherConfig {
    latitude: f64,
    longitude: f64,
    name: String,
    #[serde(default = "temperature_unit")]
    temperature_unit: String,
    #[serde(default = "enabled")]
    show_apparent: bool,
    #[serde(default)]
    show_details: bool,
    #[serde(default = "enabled")]
    allow_talk: bool,
    #[serde(default = "weather_interval")]
    refresh_interval_minutes: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct MusicConfig {
    provider: String,
    #[serde(default)]
    allowed_providers: Vec<String>,
    #[serde(default = "enabled")]
    show_artwork: bool,
    #[serde(default = "enabled")]
    show_lyrics: bool,
    #[serde(default = "enabled")]
    hide_missing: bool,
    #[serde(default = "enabled")]
    allow_talk: bool,
    #[serde(default = "music_priority")]
    priority: String,
}
fn temperature_unit() -> String {
    "celsius".into()
}
fn weather_interval() -> u32 {
    30
}
fn music_priority() -> String {
    "last-played".into()
}
fn enabled() -> bool {
    true
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
pub fn refresh_interval(kind: &str, data: &Value) -> i64 {
    if kind == "weather" {
        return data["config"]["refreshIntervalMinutes"]
            .as_i64()
            .filter(|v| (15..=1440).contains(v))
            .unwrap_or(30)
            * 60_000;
    }
    min_interval(kind)
}

fn weather_config(input: &Value) -> Result<WeatherConfig, String> {
    let mut input = input.clone();
    if let Some(object) = input.as_object_mut() {
        if object
            .remove("showTomorrow")
            .is_some_and(|value| !value.is_boolean())
        {
            return Err("날씨 표시 설정이 올바르지 않아요.".into());
        }
    }
    let config: WeatherConfig =
        serde_json::from_value(input).map_err(|_| "지역 이름과 위도·경도를 확인해 주세요.")?;
    if !config.latitude.is_finite()
        || !config.longitude.is_finite()
        || !(-90.0..=90.0).contains(&config.latitude)
        || !(-180.0..=180.0).contains(&config.longitude)
        || config.name.trim().is_empty()
        || config.name.chars().count() > 160
        || config.name.chars().any(char::is_control)
        || !["celsius", "fahrenheit"].contains(&config.temperature_unit.as_str())
        || !(15..=1440).contains(&config.refresh_interval_minutes)
    {
        return Err("지역 이름과 위도·경도가 올바르지 않아요.".into());
    }
    Ok(config)
}

fn music_config(input: &Value) -> Result<MusicConfig, String> {
    let config: MusicConfig =
        serde_json::from_value(input.clone()).map_err(|_| "음악 정보 제공 앱을 선택해 주세요.")?;
    if !["auto", "music", "spotify", "system", "spicetify"].contains(&config.provider.as_str()) {
        return Err("지원되는 음악 연결을 선택해 주세요.".into());
    }
    if config.allowed_providers.len() > 3
        || config
            .allowed_providers
            .iter()
            .any(|provider| !["music", "spotify", "system"].contains(&provider.as_str()))
        || (config.provider == "auto" && config.allowed_providers.is_empty())
    {
        return Err("자동 선택에서 조회를 허용할 앱을 선택해 주세요.".into());
    }
    if !["last-played", "music", "spotify", "system"].contains(&config.priority.as_str()) {
        return Err("음악 앱 우선순위를 확인해 주세요.".into());
    }
    Ok(config)
}

pub fn configure(kind: &str, data: &Value, input: &Value) -> Result<Value, String> {
    let config = match kind {
        "weather" => {
            let mut config =
                serde_json::to_value(weather_config(input)?).map_err(|error| error.to_string())?;
            config["showTomorrow"] = json!(input["showTomorrow"].as_bool().unwrap_or(true));
            config
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
    if kind == "music"
        && !uses_music_bridge(&config)
        && (state.config["provider"] != config["provider"] || uses_music_bridge(&state.config))
    {
        state.spicetify_pairing_id = None;
    }
    let same_source = match kind {
        "weather" => ["latitude", "longitude", "name"]
            .iter()
            .all(|key| state.config[*key] == config[*key]),
        "music" => ["provider", "allowedProviders"]
            .iter()
            .all(|key| state.config[*key] == config[*key]),
        _ => false,
    };
    state.config = config;
    state.configured = true;
    if !same_source {
        state.status = "stale".into();
        state.last_success_at = None;
        state.observation = None;
        state.forecast = None;
        state.last_year = None;
        state.error = None;
    }
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
    #[serde(default)]
    daily: Option<Value>,
    #[serde(default)]
    timezone: Option<String>,
}
#[derive(Deserialize)]
struct CurrentWeather {
    time: i64,
    temperature_2m: f64,
    weather_code: u8,
    #[serde(default)]
    apparent_temperature: Option<f64>,
    #[serde(default)]
    relative_humidity_2m: Option<f64>,
    #[serde(default)]
    wind_speed_10m: Option<f64>,
}

fn weather_name(code: u8) -> &'static str {
    match code {
        0 => "맑음",
        1..=2 => "구름 조금",
        3 => "흐림",
        45..=48 => "안개",
        51..=67 => "비",
        71..=77 => "눈",
        80..=82 => "소나기",
        85..=86 => "눈 소나기",
        _ => "뇌우",
    }
}

fn valid_weather_code(code: u64) -> bool {
    [
        0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85,
        86, 95, 96, 99,
    ]
    .contains(&code)
}

fn daily_value(daily: &Value, key: &str, index: usize) -> Option<f64> {
    daily[key]
        .as_array()?
        .get(index)?
        .as_f64()
        .filter(|v| v.is_finite())
}

fn daily_day(daily: &Value, index: usize, timezone: chrono_tz::Tz) -> Option<String> {
    let timestamp = daily["time"].as_array()?.get(index)?.as_i64()?;
    Some(
        chrono::DateTime::from_timestamp(timestamp, 0)?
            .with_timezone(&timezone)
            .date_naive()
            .to_string(),
    )
}

fn daily_entry(daily: &Value, index: usize, timezone: chrono_tz::Tz) -> Option<Value> {
    let date = daily_day(daily, index, timezone)?;
    let code = daily["weather_code"]
        .as_array()?
        .get(index)?
        .as_u64()
        .filter(|v| valid_weather_code(*v))?;
    let max =
        daily_value(daily, "temperature_2m_max", index).filter(|v| (-100.0..=70.0).contains(v))?;
    let min = daily_value(daily, "temperature_2m_min", index)
        .filter(|v| (-100.0..=70.0).contains(v) && *v <= max)?;
    Some(json!({"date":date,"code":code,"name":weather_name(code as u8),"tMax":max,"tMin":min}))
}

fn parse_weather_result(
    value: Value,
    config: &WeatherConfig,
    now: i64,
) -> Result<(Value, Option<Value>), ConnectionError> {
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
        || current
            .apparent_temperature
            .is_some_and(|v| !v.is_finite() || !(-150.0..=100.0).contains(&v))
        || current
            .relative_humidity_2m
            .is_some_and(|v| !v.is_finite() || !(0.0..=100.0).contains(&v))
        || current
            .wind_speed_10m
            .is_some_and(|v| !v.is_finite() || !(0.0..=150.0).contains(&v))
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
    let forecast = (|| {
        let timezone = response.timezone.as_ref()?.parse::<chrono_tz::Tz>().ok()?;
        let local_today = chrono::DateTime::from_timestamp_millis(now)?
            .with_timezone(&timezone)
            .date_naive();
        let today = response
            .daily
            .as_ref()
            .and_then(|daily| daily_entry(daily, 0, timezone))
            .filter(|entry| entry["date"].as_str() == Some(local_today.to_string().as_str()));
        let tomorrow = response.daily.as_ref().and_then(|daily| {
            let mut entry = daily_entry(daily, 1, timezone)?;
            if entry["date"].as_str()? != local_today.succ_opt()?.to_string() {
                return None;
            }
            let probability = daily_value(daily, "precipitation_probability_max", 1)
                .filter(|v| (0.0..=100.0).contains(v))?;
            entry["precipProb"] = json!(probability);
            Some(entry)
        });
        Some(
            json!({"today":today,"tomorrow":tomorrow,"fetchedAt":now,"timezone":timezone.to_string()}),
        )
    })();
    Ok((
        json!({"name":config.name,"latitude":config.latitude,"longitude":config.longitude,
        "temperature":current.temperature_2m,"temperatureUnit":"°C","weatherCode":current.weather_code,
        "apparentTemperature":current.apparent_temperature,"humidity":current.relative_humidity_2m,"windSpeed":current.wind_speed_10m,
        "observedAt":observed_at,"source":"Open-Meteo","sourceUrl":"https://open-meteo.com/",
        "measurementType":"weather-model","attribution":"Weather data by Open-Meteo (CC BY 4.0)"}),
        forecast,
    ))
}

#[cfg(test)]
fn parse_weather(value: Value, config: &WeatherConfig, now: i64) -> Result<Value, ConnectionError> {
    parse_weather_result(value, config, now).map(|(observation, _)| observation)
}

async fn weather(
    config: &WeatherConfig,
    now: i64,
) -> Result<(Value, Option<Value>), ConnectionError> {
    let value = fetch_json(
        client()?
            .get("https://api.open-meteo.com/v1/forecast")
            .query(&[
                ("latitude", config.latitude.to_string()),
                ("longitude", config.longitude.to_string()),
                ("current", "temperature_2m,weather_code,apparent_temperature,relative_humidity_2m,wind_speed_10m".into()),
                ("timeformat", "unixtime".into()),
                ("timezone", "auto".into()),
                ("daily", "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max".into()),
                ("forecast_days", "2".into()),
                ("temperature_unit", "celsius".into()),
                ("wind_speed_unit", "ms".into()),
            ]),
    )
    .await?;
    parse_weather_result(value, config, now)
}

pub struct ArchiveRequest {
    latitude: f64,
    longitude: f64,
    start: chrono::NaiveDate,
    end: chrono::NaiveDate,
    key: String,
    attempted_at: i64,
    previous_attempts: u64,
}

fn history_location(data: &Value) -> Option<(f64, f64, String)> {
    let lat = (data["config"]["latitude"].as_f64()? * 10.0).round() / 10.0;
    let lon = (data["config"]["longitude"].as_f64()? * 10.0).round() / 10.0;
    let lat = if lat == 0.0 { 0.0 } else { lat };
    let lon = if lon == 0.0 { 0.0 } else { lon };
    Some((lat, lon, format!("weather-archive:{lat:.1},{lon:.1}")))
}

fn forecast_day(data: &Value, now: i64) -> Option<chrono::NaiveDate> {
    let timezone = data["forecast"]["timezone"]
        .as_str()?
        .parse::<chrono_tz::Tz>()
        .ok()?;
    Some(
        chrono::DateTime::from_timestamp_millis(now)?
            .with_timezone(&timezone)
            .date_naive(),
    )
}

pub fn reserve_weather_archive(
    db: &rusqlite::Connection,
    data: &Value,
    now: i64,
) -> Result<Option<ArchiveRequest>, String> {
    let Some((latitude, longitude, key)) = history_location(data) else {
        return Ok(None);
    };
    let Some(today) = forecast_day(data, now) else {
        return Ok(None);
    };
    let count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM weather_history WHERE lat=?1 AND lon=?2",
            params![latitude, longitude],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if count >= 300 {
        return Ok(None);
    }
    let marker: Option<String> = db
        .query_row(
            "SELECT value FROM widget_preferences WHERE key=?1",
            [&key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    let marker = marker
        .and_then(|value| serde_json::from_str::<Value>(&value).ok())
        .unwrap_or_else(|| json!({}));
    let attempts = marker["attempts"].as_u64().unwrap_or(0);
    if marker["success"] == true
        || attempts >= 2
        || marker["lastAttemptAt"]
            .as_i64()
            .is_some_and(|last| now.saturating_sub(last) < 24 * 60 * 60 * 1000)
    {
        return Ok(None);
    }
    let value = json!({"attempts":attempts + 1,"lastAttemptAt":now,"success":false});
    db.execute("INSERT INTO widget_preferences(key,value) VALUES(?1,?2) ON CONFLICT(key) DO UPDATE SET value=excluded.value", params![&key, value.to_string()]).map_err(|e| e.to_string())?;
    Ok(Some(ArchiveRequest {
        latitude: data["config"]["latitude"].as_f64().unwrap_or(latitude),
        longitude: data["config"]["longitude"].as_f64().unwrap_or(longitude),
        start: today - ChronoDuration::days(400),
        end: today - ChronoDuration::days(6),
        key,
        attempted_at: now,
        previous_attempts: attempts,
    }))
}

pub fn cancel_weather_archive(
    db: &rusqlite::Connection,
    request: &ArchiveRequest,
) -> Result<(), String> {
    let value = json!({"attempts":request.previous_attempts,"lastAttemptAt":request.attempted_at,"success":false});
    db.execute("UPDATE widget_preferences SET value=?1 WHERE key=?2 AND json_extract(value,'$.lastAttemptAt')=?3 AND json_extract(value,'$.success')=0", params![value.to_string(),request.key,request.attempted_at]).map_err(|e| e.to_string())?;
    Ok(())
}

pub async fn fetch_weather_archive(request: &ArchiveRequest) -> Result<Value, ConnectionError> {
    let value = fetch_json(
        client()?
            .get("https://archive-api.open-meteo.com/v1/archive")
            .query(&[
                ("latitude", request.latitude.to_string()),
                ("longitude", request.longitude.to_string()),
                ("start_date", request.start.to_string()),
                ("end_date", request.end.to_string()),
                (
                    "daily",
                    "weather_code,temperature_2m_max,temperature_2m_min".into(),
                ),
                ("timezone", "auto".into()),
            ]),
    )
    .await?;
    let daily = &value["daily"];
    let dates = daily["time"]
        .as_array()
        .ok_or_else(|| failure("offline", "과거 날씨 응답을 읽지 못했어요."))?;
    if dates.len() > 400 {
        return Err(failure("offline", "과거 날씨 응답이 너무 길어요."));
    }
    let mut entries = Vec::new();
    for (index, date) in dates.iter().enumerate() {
        let Some(day) = date
            .as_str()
            .and_then(|date| chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").ok())
        else {
            continue;
        };
        if day < request.start || day > request.end {
            continue;
        }
        let Some(code) = daily["weather_code"]
            .as_array()
            .and_then(|values| values.get(index))
            .and_then(Value::as_u64)
            .filter(|code| valid_weather_code(*code))
        else {
            continue;
        };
        let Some(max) =
            daily_value(daily, "temperature_2m_max", index).filter(|v| (-100.0..=70.0).contains(v))
        else {
            continue;
        };
        let Some(min) = daily_value(daily, "temperature_2m_min", index)
            .filter(|v| (-100.0..=70.0).contains(v) && *v <= max)
        else {
            continue;
        };
        entries.push(json!({"date":day.to_string(),"code":code,"tMax":max,"tMin":min}));
    }
    if entries.is_empty() {
        return Err(failure("offline", "과거 날씨 자료가 없어요."));
    }
    Ok(json!(entries))
}

pub fn save_weather_history(
    db: &rusqlite::Connection,
    data: &mut Value,
    now: i64,
    archive: Option<&Result<Value, ConnectionError>>,
) -> Result<(), String> {
    let Some((lat, lon, key)) = history_location(data) else {
        return Ok(());
    };
    let Some(today) = forecast_day(data, now) else {
        data["lastYear"] = Value::Null;
        return Ok(());
    };
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    if let Some(Ok(entries)) = archive {
        for entry in entries.as_array().into_iter().flatten() {
            tx.execute("INSERT OR IGNORE INTO weather_history(day,lat,lon,code,tMax,tMin,tObserved,source) VALUES(?1,?2,?3,?4,?5,?6,NULL,'archive')", params![entry["date"].as_str(), lat, lon, entry["code"].as_i64(), entry["tMax"].as_f64(), entry["tMin"].as_f64()]).map_err(|e| e.to_string())?;
        }
        tx.execute("UPDATE widget_preferences SET value=json_set(value,'$.success',json('true')) WHERE key=?1", [&key]).map_err(|e| e.to_string())?;
    }
    let entry = &data["forecast"]["today"];
    if entry["date"].as_str() == Some(today.to_string().as_str()) {
        tx.execute("INSERT INTO weather_history(day,lat,lon,code,tMax,tMin,tObserved,source) VALUES(?1,?2,?3,?4,?5,?6,?7,'live') ON CONFLICT(day,lat,lon) DO UPDATE SET tObserved=excluded.tObserved,code=excluded.code,tMax=excluded.tMax,tMin=excluded.tMin,source='live'", params![today.to_string(),lat,lon,entry["code"].as_i64(),entry["tMax"].as_f64(),entry["tMin"].as_f64(),data["observation"]["temperature"].as_f64()]).map_err(|e| e.to_string())?;
    } else {
        tx.execute("UPDATE weather_history SET tObserved=?1 WHERE day=?2 AND lat=?3 AND lon=?4 AND source='live'", params![data["observation"]["temperature"].as_f64(), today.to_string(), lat, lon]).map_err(|e| e.to_string())?;
    }
    tx.execute(
        "DELETE FROM weather_history WHERE day<?1",
        [(today - ChronoDuration::days(400)).to_string()],
    )
    .map_err(|e| e.to_string())?;
    let last_year_day = today
        .with_year(today.year() - 1)
        .or_else(|| today.pred_opt()?.with_year(today.year() - 1));
    data["lastYear"] = if let Some(day) = last_year_day {
        tx.query_row("SELECT code,tMax,tMin,source FROM weather_history WHERE day=?1 AND lat=?2 AND lon=?3", params![day.to_string(),lat,lon], |row| {
            let code: u8 = row.get(0)?;
            Ok(json!({"date":day.to_string(),"code":code,"name":weather_name(code),"tMax":row.get::<_,f64>(1)?,"tMin":row.get::<_,f64>(2)?,"source":row.get::<_,String>(3)?}))
        }).optional().map_err(|e| e.to_string())?.unwrap_or(Value::Null)
    } else {
        Value::Null
    };
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
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

#[cfg(any(target_os = "macos", target_os = "windows"))]
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

pub(crate) fn uses_music_bridge(config: &Value) -> bool {
    config["provider"] == "spicetify"
        || config["provider"] == "auto"
            && config["allowedProviders"]
                .as_array()
                .is_some_and(|values| values.iter().any(|value| value == "spotify"))
}

pub(crate) fn select_music(
    candidates: Vec<Value>,
    previous: &Value,
    priority: &str,
    now: i64,
) -> Option<Value> {
    let previous_source = previous["sourceId"].as_str();
    let previous_provider = previous["provider"].as_str();
    let same = |item: &Value| {
        item["provider"].as_str() == previous_provider
            && item["sourceId"].as_str() == previous_source
    };
    let mut states = serde_json::Map::new();
    for candidate in &candidates {
        let key = format!(
            "{}:{}",
            candidate["provider"].as_str().unwrap_or(""),
            candidate["sourceId"].as_str().unwrap_or("")
        );
        let old = &previous["sourceStates"][&key];
        let started_at = if candidate["playing"] == true
            && (old["playing"] != true || old["trackId"] != candidate["trackId"])
        {
            now
        } else {
            old["startedAt"].as_i64().unwrap_or(0)
        };
        states.insert(key, json!({"playing":candidate["playing"],"trackId":candidate["trackId"],"startedAt":started_at}));
    }
    let started = |item: &Value| {
        let key = format!(
            "{}:{}",
            item["provider"].as_str().unwrap_or(""),
            item["sourceId"].as_str().unwrap_or("")
        );
        states
            .get(&key)
            .and_then(|state| state["startedAt"].as_i64())
            .unwrap_or(0)
    };
    let selected = candidates
        .iter()
        .find(|item| {
            priority != "last-played" && item["provider"] == priority && item["playing"] == true
        })
        .or_else(|| {
            candidates
                .iter()
                .enumerate()
                .filter(|(_, item)| item["playing"] == true)
                .max_by_key(|(index, item)| (started(item), same(item), std::cmp::Reverse(*index)))
                .map(|(_, item)| item)
        })
        .or_else(|| {
            candidates
                .iter()
                .find(|item| item["running"] == true && same(item))
        })
        .or_else(|| candidates.iter().find(|item| item["running"] == true))
        .or_else(|| candidates.first());
    selected.cloned().map(|mut item| {
        item["sourceStates"] = Value::Object(states);
        item
    })
}

async fn music(config: &MusicConfig, previous: &Value, now: i64) -> Result<Value, ConnectionError> {
    if config.provider != "auto" {
        return super::music_native::observe_source(&config.provider, None, now).await;
    }
    let candidates = music_candidates(&config.allowed_providers, now).await?;
    select_music(candidates, previous, &config.priority, now).ok_or_else(|| {
        failure(
            "permission-needed",
            "조회가 허용된 음악 앱을 선택해 주세요.",
        )
    })
}

pub(crate) async fn music_candidates(
    allowed: &[String],
    now: i64,
) -> Result<Vec<Value>, ConnectionError> {
    let providers = ["music", "spotify", "system"]
        .into_iter()
        .filter(|provider| allowed.iter().any(|allowed| allowed == provider));
    let results = futures_util::future::join_all(
        providers.map(|provider| super::music_native::observe_source(provider, None, now)),
    )
    .await;
    let mut candidates = vec![];
    let mut error = None;
    for result in results {
        match result {
            Ok(value) => candidates.push(value),
            Err(failure) => error = Some(failure),
        }
    }
    if candidates.is_empty() {
        return Err(error.unwrap_or_else(|| {
            failure(
                "permission-needed",
                "조회가 허용된 음악 앱을 선택해 주세요.",
            )
        }));
    }
    Ok(candidates)
}

#[cfg(any(target_os = "macos", test))]
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
            let (observation, forecast) = weather(
                &weather_config(&state.config)
                    .map_err(|message| failure("permission-needed", &message))?,
                now,
            )
            .await?;
            state.forecast = forecast;
            observation
        }
        "music" => {
            music(
                &music_config(&state.config)
                    .map_err(|message| failure("permission-needed", &message))?,
                state.observation.as_ref().unwrap_or(&Value::Null),
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
    fn music_pairing_survives_preferences_but_not_provider_changes_or_input_injection() {
        let pair = uuid::Uuid::new_v4().to_string();
        let mut data =
            configure("music", &initial("music"), &json!({"provider":"spicetify"})).unwrap();
        data["spicetifyPairingId"] = json!(pair);
        let changed = configure(
            "music",
            &data,
            &json!({"provider":"spicetify","showArtwork":false}),
        )
        .unwrap();
        assert_eq!(changed["spicetifyPairingId"], pair);
        let other = configure("music", &changed, &json!({"provider":"spotify"})).unwrap();
        assert!(other["spicetifyPairingId"].is_null());
        assert!(configure(
            "music",
            &initial("music"),
            &json!({"provider":"spicetify","spicetifyPairingId":pair})
        )
        .is_err());
    }

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
            temperature_unit: temperature_unit(),
            show_apparent: true,
            show_details: false,
            allow_talk: true,
            refresh_interval_minutes: weather_interval(),
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
    fn automatic_music_selection_uses_latest_start_and_explicit_priority() {
        let apple = json!({"provider":"music","sourceId":"music","running":true,"playing":true,"trackId":"a"});
        let spotify = json!({"provider":"spotify","sourceId":"spotify","running":true,"playing":true,"trackId":"b"});
        let previous = select_music(
            vec![apple.clone(), spotify.clone()],
            &spotify,
            "last-played",
            100,
        )
        .unwrap();
        assert_eq!(previous["provider"], "spotify");
        let mut changed = apple.clone();
        changed["trackId"] = json!("new-song");
        let latest = select_music(
            vec![changed, spotify.clone()],
            &previous,
            "last-played",
            200,
        )
        .unwrap();
        assert_eq!(latest["provider"], "music");
        assert_eq!(
            select_music(
                vec![apple.clone(), spotify.clone()],
                &latest,
                "spotify",
                300
            )
            .unwrap()["provider"],
            "spotify"
        );
        assert_eq!(
            select_music(vec![apple.clone()], &spotify, "last-played", 100).unwrap()["provider"],
            "music"
        );
        assert_eq!(
            select_music(vec![apple, spotify], &Value::Null, "last-played", 100).unwrap()
                ["provider"],
            "music"
        );
        assert!(select_music(vec![], &Value::Null, "last-played", 100).is_none());
    }

    #[test]
    fn weather_preferences_preserve_observations_and_validate_units_and_intervals() {
        let initial = configure(
            "weather",
            &initial("weather"),
            &json!({"name":"서울","latitude":37.5,"longitude":127}),
        )
        .unwrap();
        let mut ready = initial;
        ready["status"] = json!("ready");
        ready["observation"] = json!({"temperature":21.5});
        ready["lastSuccessAt"] = json!(123);
        let mut config = ready["config"].clone();
        config["temperatureUnit"] = json!("fahrenheit");
        config["showDetails"] = json!(true);
        config["allowTalk"] = json!(false);
        config["refreshIntervalMinutes"] = json!(15);
        let updated = configure("weather", &ready, &config).unwrap();
        assert_eq!(updated["observation"], ready["observation"]);
        assert_eq!(updated["lastSuccessAt"], ready["lastSuccessAt"]);
        assert_eq!(updated["status"], "ready");
        assert_eq!(refresh_interval("weather", &updated), 900_000);
        config["refreshIntervalMinutes"] = json!(14);
        assert!(configure("weather", &ready, &config).is_err());
        config["refreshIntervalMinutes"] = json!(30);
        config["temperatureUnit"] = json!("kelvin");
        assert!(configure("weather", &ready, &config).is_err());
    }

    #[test]
    fn music_config_requires_explicit_auto_sources_and_preserves_legacy_provider() {
        assert!(music_config(&json!({"provider":"auto"})).is_err());
        assert!(music_config(&json!({"provider":"auto","allowedProviders":["unknown"]})).is_err());
        assert!(
            music_config(&json!({"provider":"auto","allowedProviders":["music","spotify"]}))
                .is_ok()
        );
        let legacy = music_config(&json!({"provider":"spotify"})).unwrap();
        assert!(legacy.allowed_providers.is_empty());
        assert!(legacy.allow_talk);
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

    #[test]
    fn macos_battery_zero_is_present_and_unreadable_percent_is_an_error() {
        let empty = parse_macos_battery("Now drawing from 'AC Power'\n", 100).unwrap();
        assert_eq!(empty["hasBattery"], false);
        assert_eq!(empty["batteries"], json!([]));

        let zero = parse_macos_battery(
            "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=123)\t0%; discharging; (no estimate) present: true\n",
            100,
        )
        .unwrap();
        assert_eq!(zero["hasBattery"], true);
        assert_eq!(zero["batteries"][0]["percent"], 0);
        assert_eq!(zero["batteries"][0]["status"], "discharging");
        assert_eq!(zero["observedAt"], 100);

        let unreadable = parse_macos_battery(
            "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=123)\tunknown%; discharging; (no estimate) present: true\n",
            100,
        )
        .unwrap_err();
        assert_eq!(unreadable.status, "offline");
        assert_eq!(unreadable.message, "배터리 잔량을 읽지 못했어요.");
    }

    #[test]
    fn windows_battery_absent_zero_and_unknown_percent_remain_distinct() {
        let absent = parse_windows_battery("[]", 100).unwrap();
        assert_eq!(absent["hasBattery"], false);
        assert_eq!(absent["batteries"], json!([]));

        let zero =
            parse_windows_battery(r#"[{"EstimatedChargeRemaining":0,"BatteryStatus":1}]"#, 100)
                .unwrap();
        assert_eq!(zero["hasBattery"], true);
        assert_eq!(zero["batteries"][0]["percent"], 0);
        assert_eq!(zero["batteries"][0]["status"], "discharging");

        for output in [
            r#"[{"EstimatedChargeRemaining":null,"BatteryStatus":null}]"#,
            r#"[{}]"#,
        ] {
            let unknown = parse_windows_battery(output, 100).unwrap();
            assert_eq!(unknown["hasBattery"], true);
            assert_eq!(unknown["batteries"][0]["percent"], Value::Null);
            assert_eq!(unknown["batteries"][0]["status"], "unknown");
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn configured_linux_battery_refresh_reports_platform_support() {
        let data = configure("device", &initial("device"), &json!({})).unwrap();
        let error = refresh("device", &data, 100).await.unwrap_err();
        assert_eq!(error.status, "unsupported");
        assert_eq!(
            error.message,
            "현재 배터리 정보 조회는 macOS와 Windows를 지원해요."
        );
    }

    #[tokio::test]
    async fn subprocess_reader_rejects_oversized_output_without_retaining_it() {
        let bytes = vec![b'a'; MAX_COMMAND_BYTES + 2];
        assert!(read_bounded(bytes.as_slice()).await.is_err());
        assert_eq!(read_bounded(&b"safe"[..]).await.unwrap(), b"safe");
    }
}
