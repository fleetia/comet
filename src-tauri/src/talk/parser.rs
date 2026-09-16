use super::{expr, Diagnostic, Program, Registry, Scene, Span, Statement, TextPart};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    path::{Path, PathBuf},
};
const FILE_LIMIT: u64 = 1024 * 1024;
const BUNDLE_LIMIT: usize = 4 * 1024 * 1024;

struct Import {
    path: String,
    pair: Option<[String; 2]>,
    span: Span,
}
struct Parsed {
    scenes: Vec<Scene>,
    imports: Vec<Import>,
}
fn span(path: &Path, line: usize, column: usize) -> Span {
    Span {
        path: path.display().to_string(),
        line,
        column,
        end_line: line,
        end_column: column,
    }
}
fn file_error(path: &Path, code: &str, message: impl Into<String>) -> Vec<Diagnostic> {
    vec![span(path, 1, 1).error(code, message)]
}
pub fn load(entry: &Path, registry: &Registry) -> Result<Program, Vec<Diagnostic>> {
    let lexical_root = entry
        .parent()
        .filter(|path| !path.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    let root = fs::canonicalize(lexical_root)
        .map_err(|error| file_error(entry, "IMPORT_IO", error.to_string()))?;
    let mut loader = Loader {
        root,
        registry,
        program: Program {
            files: BTreeSet::new(),
            sources: BTreeMap::new(),
            scenes: Vec::new(),
        },
        visited: BTreeSet::new(),
        stack: BTreeSet::new(),
        keys: BTreeSet::new(),
        bytes: 0,
    };
    loader.visit(entry, None, 0)?;
    Ok(loader.program)
}
struct Loader<'a> {
    root: PathBuf,
    registry: &'a Registry,
    program: Program,
    visited: BTreeSet<(PathBuf, Option<[String; 2]>)>,
    stack: BTreeSet<PathBuf>,
    keys: BTreeSet<String>,
    bytes: usize,
}
impl Loader<'_> {
    fn visit(
        &mut self,
        path: &Path,
        pair: Option<[String; 2]>,
        depth: usize,
    ) -> Result<(), Vec<Diagnostic>> {
        if depth > 32 {
            return Err(file_error(
                path,
                "IMPORT_DEPTH",
                "import 중첩은 32단계 이하여야 해요.",
            ));
        }
        let canonical = fs::canonicalize(path)
            .map_err(|error| file_error(path, "IMPORT_IO", error.to_string()))?;
        if !canonical.starts_with(&self.root) {
            return Err(file_error(
                path,
                "IMPORT_OUTSIDE_ROOT",
                "import는 entry 파일 폴더 안에 있어야 해요.",
            ));
        }
        if self.stack.contains(&canonical) {
            return Err(file_error(
                path,
                "IMPORT_CYCLE",
                "순환 import는 허용하지 않아요.",
            ));
        }
        let mut normalized = pair.clone();
        if let Some(ids) = &mut normalized {
            ids.sort();
        }
        let identity = (canonical.clone(), normalized);
        if self.visited.contains(&identity) {
            return Ok(());
        }
        if !self.program.files.contains(&canonical) && self.program.files.len() >= 128 {
            return Err(file_error(
                path,
                "FILE_LIMIT",
                "대본 파일은 128개 이하여야 해요.",
            ));
        }
        if self.visited.len() >= 2048 {
            return Err(file_error(
                path,
                "IMPORT_LIMIT",
                "파일과 scope 조합은 2048개 이하여야 해요.",
            ));
        }
        let source = if let Some(source) = self.program.sources.get(&canonical) {
            source.clone()
        } else {
            let metadata = fs::metadata(&canonical)
                .map_err(|error| file_error(path, "IMPORT_IO", error.to_string()))?;
            if !metadata.is_file() || metadata.len() > FILE_LIMIT {
                return Err(file_error(
                    path,
                    "FILE_SIZE",
                    "대본은 1 MiB 이하의 일반 파일이어야 해요.",
                ));
            }
            // Bound the read even if a file changes between metadata and reading.
            use std::io::Read;
            let file = fs::File::open(&canonical)
                .map_err(|error| file_error(path, "IMPORT_IO", error.to_string()))?;
            let mut data = Vec::new();
            file.take(FILE_LIMIT + 1)
                .read_to_end(&mut data)
                .map_err(|error| file_error(path, "IMPORT_IO", error.to_string()))?;
            if data.len() > FILE_LIMIT as usize {
                return Err(file_error(
                    path,
                    "FILE_SIZE",
                    "대본 파일은 1 MiB 이하여야 해요.",
                ));
            }
            self.bytes += data.len();
            if self.bytes > BUNDLE_LIMIT {
                return Err(file_error(
                    path,
                    "BUNDLE_SIZE",
                    "대본 전체는 4 MiB 이하여야 해요.",
                ));
            }
            let source = String::from_utf8(data)
                .map_err(|_| file_error(path, "ENCODING", "UTF-8 대본이 필요해요."))?;
            self.program
                .sources
                .insert(canonical.clone(), source.clone());
            source
        };
        let parsed = parse_file(&canonical, &source, pair.clone(), self.registry, depth == 0)?;
        self.stack.insert(canonical.clone());
        self.visited.insert(identity);
        self.program.files.insert(canonical.clone());
        for scene in parsed.scenes {
            if !self.keys.insert(scene.key.clone()) {
                return Err(vec![scene.span.error(
                    "DUPLICATE_SCENE",
                    format!("같은 scope의 scene ID가 중복돼요: {}", scene.id),
                )]);
            }
            self.program.scenes.push(scene);
            if self.program.scenes.len() > 2048 {
                return Err(file_error(
                    path,
                    "SCENE_LIMIT",
                    "scene은 2048개 이하여야 해요.",
                ));
            }
        }
        for import in parsed.imports {
            let imported = Path::new(&import.path);
            if imported.is_absolute() {
                return Err(vec![import
                    .span
                    .error("IMPORT_PATH", "상대 import 경로가 필요해요.")]);
            }
            if pair.is_some() && import.pair.is_some() && pair != import.pair {
                return Err(vec![import.span.error(
                    "IMPORT_SCOPE",
                    "상속한 pair scope를 다른 pair로 바꿀 수 없어요.",
                )]);
            }
            let scope = import.pair.or_else(|| pair.clone());
            let resolved = canonical.parent().unwrap_or(&self.root).join(imported);
            self.visit(&resolved, scope, depth + 1)?;
        }
        self.stack.remove(&canonical);
        Ok(())
    }
}
pub fn validate_source(
    path: &Path,
    source: &str,
    registry: &Registry,
) -> Result<Program, Vec<Diagnostic>> {
    if source.len() > FILE_LIMIT as usize {
        return Err(file_error(
            path,
            "FILE_SIZE",
            "대본 파일은 1 MiB 이하여야 해요.",
        ));
    }
    let parsed = parse_file(path, source, None, registry, true)?;
    if let Some(import) = parsed.imports.first() {
        return Err(vec![import.span.error(
            "IMPORT_REQUIRES_FILE",
            "import 검증은 저장된 entry 파일을 load해 주세요.",
        )]);
    }
    let mut keys = BTreeSet::new();
    for scene in &parsed.scenes {
        if !keys.insert(&scene.key) {
            return Err(vec![scene
                .span
                .error("DUPLICATE_SCENE", "scene ID가 중복돼요.")]);
        }
    }
    Ok(Program {
        files: BTreeSet::from([path.to_owned()]),
        sources: BTreeMap::from([(path.to_owned(), source.into())]),
        scenes: parsed.scenes,
    })
}
fn parse_file(
    path: &Path,
    source: &str,
    pair: Option<[String; 2]>,
    registry: &Registry,
    require_format: bool,
) -> Result<Parsed, Vec<Diagnostic>> {
    let mut reader = Reader {
        path,
        lines: source.split('\n').collect(),
        at: 0,
        registry,
    };
    reader.skip();
    let has_format = reader.current().is_some_and(|line| {
        line.split_once(':')
            .is_some_and(|(key, value)| key.trim() == "format" && value.trim() == "1")
    });
    if require_format && !has_format {
        return Err(file_error(
            path,
            "FORMAT",
            "첫 항목은 format: 1이어야 해요.",
        ));
    }
    if has_format {
        reader.at += 1;
    }
    let mut parsed = Parsed {
        scenes: Vec::new(),
        imports: Vec::new(),
    };
    loop {
        reader.skip();
        let Some(line) = reader.current() else {
            break;
        };
        if line.trim_start().starts_with("import ") {
            parsed
                .imports
                .push(parse_import(line.trim(), &reader.location())?);
            reader.at += 1;
        } else {
            parsed.scenes.push(reader.scene(pair.clone())?);
            if parsed.scenes.len() > 2048 {
                return Err(file_error(
                    path,
                    "SCENE_LIMIT",
                    "scene은 2048개 이하여야 해요.",
                ));
            }
        }
    }
    Ok(parsed)
}
fn json_string(source: &str) -> Result<(String, &str), String> {
    let mut stream = serde_json::Deserializer::from_str(source).into_iter::<String>();
    let value = stream
        .next()
        .ok_or("따옴표 문자열이 필요해요.")?
        .map_err(|_| "문자열 형식이 잘못됐어요.")?;
    Ok((value, &source[stream.byte_offset()..]))
}
fn parse_import(source: &str, location: &Span) -> Result<Import, Vec<Diagnostic>> {
    let fail = |message: String| vec![location.error("IMPORT_SYNTAX", message)];
    let (path, rest) = json_string(source[7..].trim_start()).map_err(fail)?;
    if path.is_empty() {
        return Err(fail("import 경로가 비어 있어요.".into()));
    }
    let rest = rest.trim();
    let pair = if rest.is_empty() {
        None
    } else {
        let rest = rest
            .strip_prefix("for pair(")
            .ok_or_else(|| fail("for pair(\"A ID\", \"B ID\")가 필요해요.".into()))?;
        let (a, rest) = json_string(rest.trim_start()).map_err(fail)?;
        let rest = rest
            .trim_start()
            .strip_prefix(',')
            .ok_or_else(|| fail("pair 사이 쉼표가 필요해요.".into()))?;
        let (b, rest) = json_string(rest.trim_start()).map_err(fail)?;
        if rest.trim() != ")" || a.is_empty() || b.is_empty() || a == b {
            return Err(fail("서로 다른 두 캐릭터 ID가 필요해요.".into()));
        }
        Some([a, b])
    };
    Ok(Import {
        path,
        pair,
        span: location.clone(),
    })
}
struct Reader<'a> {
    path: &'a Path,
    lines: Vec<&'a str>,
    at: usize,
    registry: &'a Registry,
}
impl Reader<'_> {
    fn current(&self) -> Option<&str> {
        self.lines.get(self.at).copied()
    }
    fn location(&self) -> Span {
        span(self.path, self.at + 1, 1)
    }
    fn finish_span(&self, mut location: Span) -> Span {
        location.end_line = self.at.max(location.line);
        location.end_column = self
            .lines
            .get(self.at.saturating_sub(1))
            .map_or(1, |line| line.chars().count() + 1);
        location
    }
    fn skip(&mut self) {
        while self
            .current()
            .is_some_and(|line| line.trim().is_empty() || line.trim_start().starts_with('#'))
        {
            self.at += 1;
        }
    }
    fn scene(&mut self, pair: Option<[String; 2]>) -> Result<Scene, Vec<Diagnostic>> {
        let location = self.location();
        let mut headers: BTreeMap<String, (String, Span)> = BTreeMap::new();
        loop {
            self.skip();
            let line = self.current().ok_or_else(|| {
                vec![location.error("SCENE_BODY", "scene 본문을 여는 ---가 필요해요.")]
            })?;
            if line.trim() == "---" {
                self.at += 1;
                break;
            }
            let (name, value) = line.split_once(':').ok_or_else(|| {
                vec![self
                    .location()
                    .error("HEADER", "name: value 형식의 header가 필요해요.")]
            })?;
            let name = name.trim();
            if !["scene", "on", "when", "cooldown"].contains(&name) {
                return Err(vec![self
                    .location()
                    .error("UNKNOWN_HEADER", format!("알 수 없는 header: {name}"))]);
            }
            if headers.contains_key(name) {
                return Err(vec![self
                    .location()
                    .error("DUPLICATE_HEADER", format!("중복 header: {name}"))]);
            }
            let mut value_span = self.location();
            value_span.column = line.chars().take_while(|c| *c != ':').count()
                + 2
                + value.chars().take_while(|c| c.is_whitespace()).count();
            headers.insert(name.into(), (value.trim().into(), value_span));
            self.at += 1;
        }
        let id = headers
            .get("scene")
            .map(|entry| entry.0.clone())
            .filter(|id| {
                !id.is_empty()
                    && id.len() <= 128
                    && id
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'.'))
            })
            .ok_or_else(|| {
                vec![location.error(
                    "SCENE_ID",
                    "scene ID는 1~128자의 영문·숫자·_·-·.으로 작성해 주세요.",
                )]
            })?;
        let trigger = headers
            .get("on")
            .map(|entry| entry.0.clone())
            .ok_or_else(|| vec![location.error("TRIGGER", "on header가 필요해요.")])?;
        if trigger != "idle" && !self.registry.events.contains(&trigger) {
            return Err(vec![headers["on"]
                .1
                .error("UNKNOWN_EVENT", format!("등록되지 않은 event: {trigger}"))]);
        }
        let condition = headers
            .get("when")
            .map(|(source, span)| expr::parse(source, self.registry, span))
            .transpose()
            .map_err(|error| vec![error])?;
        let cooldown_ms = headers
            .get("cooldown")
            .map(|(value, span)| {
                duration(value).ok_or_else(|| {
                    vec![span.error(
                        "COOLDOWN",
                        "cooldown은 0 또는 정수와 ms/s/m/h/d 단위로 작성해 주세요.",
                    )]
                })
            })
            .transpose()?
            .unwrap_or(0);
        let body = self.body(0)?;
        if self.current().map(str::trim) != Some("===") {
            return Err(vec![self
                .location()
                .error("SCENE_END", "scene을 닫는 ===가 필요해요.")]);
        }
        self.at += 1;
        if body.is_empty() {
            return Err(vec![
                location.error("EMPTY_SCENE", "scene에 대사가 필요해요.")
            ]);
        }
        let mut references = BTreeSet::new();
        if let Some(condition) = &condition {
            expr::references(condition, &mut references);
        }
        collect(&body, &mut references);
        let dependencies = references
            .iter()
            .filter_map(|name| {
                self.registry
                    .variables
                    .get(name)
                    .and_then(|variable| variable.widget.clone())
            })
            .collect();
        let mut normalized = pair.clone();
        if let Some(ids) = &mut normalized {
            ids.sort();
        }
        let key = serde_json::to_string(&(normalized, &id))
            .map_err(|error| vec![location.error("SCENE_KEY", error.to_string())])?;
        Ok(Scene {
            key,
            id,
            pair,
            trigger,
            condition,
            cooldown_ms,
            body,
            dependencies,
            references,
            span: self.finish_span(location),
        })
    }
    fn body(&mut self, depth: usize) -> Result<Vec<Statement>, Vec<Diagnostic>> {
        if depth > 32 {
            return Err(vec![self
                .location()
                .error("BODY_DEPTH", "대사 조건 중첩은 32단계 이하여야 해요.")]);
        }
        let mut body = Vec::new();
        loop {
            self.skip();
            let Some(line) = self.current().map(str::to_owned) else {
                break;
            };
            let trimmed = line.trim();
            if ["===", "@else", "@endif"].contains(&trimmed) {
                break;
            }
            let location = self.location();
            if let Some(source) = trimmed.strip_prefix("@if ") {
                let condition =
                    expr::parse(source, self.registry, &location).map_err(|error| vec![error])?;
                self.at += 1;
                let yes = self.body(depth + 1)?;
                let no = if self.current().map(str::trim) == Some("@else") {
                    self.at += 1;
                    self.body(depth + 1)?
                } else {
                    Vec::new()
                };
                if self.current().map(str::trim) != Some("@endif") {
                    return Err(vec![self
                        .location()
                        .error("IF_END", "@if를 닫는 @endif가 필요해요.")]);
                }
                self.at += 1;
                body.push(Statement::If {
                    condition,
                    yes,
                    no,
                    span: self.finish_span(location),
                });
            } else {
                let (label, text) = line.split_once(':').ok_or_else(|| {
                    vec![location.error("DIALOGUE", "A[표정]: 대사 형식이 필요해요.")]
                })?;
                let label = label.trim();
                let speaker = match label.chars().next() {
                    Some('A') => 0,
                    Some('B') => 1,
                    _ => return Err(vec![location.error("SPEAKER", "화자는 A 또는 B여야 해요.")]),
                };
                let suffix = &label[1..];
                let expression = if suffix.is_empty() {
                    "평온"
                } else {
                    suffix
                        .strip_prefix('[')
                        .and_then(|value| value.strip_suffix(']'))
                        .ok_or_else(|| {
                            vec![location.error("EXPRESSION", "표정은 [표정]으로 작성해 주세요.")]
                        })?
                };
                if !["평온", "기쁨", "호기심", "생각중", "걱정", "장난"].contains(&expression)
                {
                    return Err(vec![
                        location.error("EXPRESSION", format!("허용되지 않는 표정: {expression}"))
                    ]);
                }
                self.at += 1;
                let text = text.strip_prefix(' ').unwrap_or(text);
                let text = if text.trim() == "\"\"\"" {
                    let mut lines = Vec::new();
                    while let Some(line) = self.current() {
                        if line.trim() == "\"\"\"" {
                            break;
                        }
                        lines.push(line.to_owned());
                        self.at += 1;
                    }
                    if self.current().is_none() {
                        return Err(vec![location
                            .error("MULTILINE_END", "여러 줄 대사를 닫는 따옴표가 필요해요.")]);
                    }
                    self.at += 1;
                    lines.join("\n")
                } else {
                    text.trim_end_matches('\r').to_owned()
                };
                let parts =
                    text_parts(&text, self.registry, &location).map_err(|error| vec![error])?;
                body.push(Statement::Line {
                    speaker,
                    expression: expression.into(),
                    parts,
                    span: self.finish_span(location),
                });
            }
        }
        Ok(body)
    }
}
fn duration(source: &str) -> Option<i64> {
    if source == "0" {
        return Some(0);
    }
    for (suffix, multiplier) in [
        ("ms", 1),
        ("s", 1000),
        ("m", 60_000),
        ("h", 3_600_000),
        ("d", 86_400_000),
    ] {
        if let Some(number) = source.strip_suffix(suffix) {
            if number.is_empty() || !number.bytes().all(|c| c.is_ascii_digit()) {
                return None;
            }
            return number.parse::<i64>().ok()?.checked_mul(multiplier);
        }
    }
    None
}
fn text_parts(
    source: &str,
    registry: &Registry,
    location: &Span,
) -> Result<Vec<TextPart>, Diagnostic> {
    let mut parts = Vec::new();
    let mut text = String::new();
    let mut chars = source.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\\' {
            let escaped = chars
                .next()
                .ok_or_else(|| location.error("TEXT_ESCAPE", "escape 뒤에 문자가 필요해요."))?;
            text.push(match escaped {
                'n' => '\n',
                't' => '\t',
                '\\' | '$' | '"' | '#' | '@' | ':' | '{' | '}' => escaped,
                _ => {
                    return Err(
                        location.error("TEXT_ESCAPE", format!("알 수 없는 escape: \\{escaped}"))
                    )
                }
            });
        } else if c == '$' && chars.peek() == Some(&'{') {
            chars.next();
            let mut name = String::new();
            let mut closed = false;
            for c in chars.by_ref() {
                if c == '}' {
                    closed = true;
                    break;
                }
                name.push(c);
            }
            if !closed {
                return Err(location.error("INTERPOLATION", "변수 치환을 닫는 }가 필요해요."));
            }
            if !registry.variables.contains_key(&name) {
                return Err(
                    location.error("UNKNOWN_VARIABLE", format!("등록되지 않은 변수: {name}"))
                );
            }
            if !text.is_empty() {
                parts.push(TextPart::Text(std::mem::take(&mut text)));
            }
            parts.push(TextPart::Variable(name));
        } else {
            text.push(c);
        }
    }
    if !text.is_empty() {
        parts.push(TextPart::Text(text));
    }
    Ok(parts)
}
fn collect(body: &[Statement], references: &mut BTreeSet<String>) {
    for statement in body {
        match statement {
            Statement::Line { parts, .. } => {
                for part in parts {
                    if let TextPart::Variable(name) = part {
                        references.insert(name.clone());
                    }
                }
            }
            Statement::If {
                condition, yes, no, ..
            } => {
                expr::references(condition, references);
                collect(yes, references);
                collect(no, references);
            }
        }
    }
}
