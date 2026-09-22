---
title: NLP 실행과 모델 배포
description: 선택 NLP의 프로세스 경계, 기억 파생 데이터, 모델 검증과 배포 기준
---

# NLP 실행과 모델 배포

이 문서는 [기억 검색 제품 계약](../product/memory-search.md)의 구현 경계다. 검색 모델·native 라이브러리·생성 LLM은 다른 배포 단위다. 실제 검사 결과와 미완료 항목은 [상태표](../status.md)를 따른다.

## 책임과 데이터

| 위치 | 책임 |
| --- | --- |
| `src-tauri/src/app/tasks.rs` | 작업 종류·epoch·취소·handle 회수와 종료 경계 |
| `src-tauri/src/memory_commands.rs` | 페이지 조회, NLP 설정 명령, 검색·한 건씩 색인 연결 |
| `src-tauri/src/store/search.rs` | FTS5, 내용 버전, 벡터 BLOB, RRF와 현재 기억 재검증 |
| `src-tauri/src/store/analysis.rs` | 발화별 분석 상태 이전, 제출·보류·재시도 |
| `src-tauri/src/nlp/` | 앱 소유 실행기와 모델 파일의 수명·다운로드·검증 |
| `crates/comet-nlp/` | Kiwi C API, ONNX Runtime CPU, Hugging Face tokenizer |
| `src/components/MemorySettings/` | 기억 페이지 편집과 독립 검색 설정 |

`memories.content_version`은 본문·삭제 상태가 바뀔 때 증가한다. `memory_fts`는 ID·원문·Kiwi 토큰을 보관한다. `memory_tokens`와 `memory_vectors`는 기억 ID·내용 버전·모델 profile을 함께 가진다. 벡터는 384개 little-endian f32 BLOB이며 구간은 원문 UTF-8 byte 범위다. 구간별 점수는 원래 기억 ID의 최고 점수로 합친다.

수정과 이전 파생 데이터 무효화는 SQLite transaction 안에서 수행한다. 저장 직전 내용 버전·현재 profile을 확인하고, 프롬프트 작성 직전에 검색 결과를 현재 DB와 다시 대조한다. 앱 상태 이벤트에는 기억 개수·revision만 포함한다. 원문 기록은 검색 색인과 독립적으로 보존한다.

## 제어와 프로토콜

`RuntimePhase` enum과 TypeScript union은 기존 JSON 값 `idle/loading/generating/playing/waiting/analyzing/preparing/story/error`를 유지한다. 숨김·일시정지는 별도 필드다. `action`은 예약·최신성·저장을, `gate`는 생성·재생 직렬화를 담당한다. 표준 mutex guard를 `await` 너머로 보유하지 않는다.

보조 실행기는 stdin/stdout의 버전 있는 JSONL을 사용한다. 요청에는 ID·작업 종류·원문이, 응답에는 ID·모델 profile·토큰·임베딩이 들어간다. stdout은 프로토콜 전용이며 대화 본문·모델 응답을 진단 로그에 쓰지 않는다. 요청 크기·응답 길이·차원·유한 수·원문 범위·요청 ID를 검증한다.

Kiwi는 v0.24.0 CoNg·top-1·추가 오타 교정 없음·스레드 1개다. 기본 사전과 이형태 통합을 사용하고 선택 `multi.dict`는 메모리 사용량을 줄이기 위해 불러오지 않는다. native UTF-16 token 위치는 원문 UTF-8 byte 범위로 변환한다. 검색에는 내용어만 추가하며 불규칙 활용의 POS 접미사는 정규화한다. 이 정책도 profile에 포함한다. E5에는 형태소가 아닌 원문을 넣고 `query: `와 `passage: `, attention-mask mean pooling, L2 정규화를 적용한다. 512토큰을 넘는 기억은 색인에만 겹침 구간을 가진 창으로 나눈다.

ONNX Runtime은 CPU·sequential·intra/inter-op 1·spinning off·CPU arena off·memory pattern off를 사용한다. 한 실행기에 모델별 인스턴스 하나, native 계산 하나만 둔다. 차가운 시작은 기본 검색으로 돌아가고 준비된 요청만 최대 2초 기다린다. 유휴 종료 120초·충돌 후 재기동 60초·종료 정리 5초는 생성 LLM의 별도 수명 정책과 혼동하지 않는다.

FTS 후보는 원문과 Kiwi 내용어로 구한다. 대명사·질문용 표현을 제거하고, 내용어가 여러 개이면 최소 두 개이면서 전체의 2/3 이상이 일치해야 선택한다. 원문과 형태소의 일치 개수는 합산하지 않는다. 한 단어 검색은 그대로 허용한다. 이 보수적인 조건은 무관한 기억 주입을 줄이지만 표현이 다른 긴 질문의 회수율은 낮다. 의미 검색의 별도 후보와 RRF로 합치며 최신 기억으로 빈자리를 채우지 않는다.

## 배포 원칙

native 실행기와 라이브러리는 설치물에 포함한다. 모델은 선택 다운로드하며 Python은 개발 시 변환 도구로만 사용할 수 있다. NLP 라이브러리는 `binaries/nlp-runtime`에 두어 기존 llama.cpp 준비 과정의 `binaries/runtime` 정리와 분리한다.

Rust 1.85와 `ort = 2.0.0-rc.10`·ORT 1.22를 고정하고 tokenizer·전이 의존성까지 실제 빌드로 확인한다. E5는 고정한 공식 FP32 원본에서 Windows x64·macOS arm64 CPU INT8 파일을 재현 가능하게 변환한다. AVX512 전용 파일을 공통 기본값으로 쓰지 않는다. manifest에는 원본 revision·변환 환경·크기·SHA-256·라이선스와 tokenizer·pooling·prefix·정규화 fingerprint를 포함한다.

다운로드는 임시 파일의 크기·SHA-256을 검증한 뒤 원자적으로 활성화한다. 배포 파일이나 품질 검증이 준비되지 않은 profile은 사용 가능하다고 표시하지 않는다. 모델 제거는 해당 모델과 파생 캐시만 대상으로 한다. Windows 생성 LLM GPU 경로 추가는 이번 변경 범위 밖이다.

## 개발 명령

`corepack pnpm prepare:nlp`는 고정 native 라이브러리와 `comet-nlp` release 실행기를 준비한다. `corepack pnpm build:desktop`은 llama.cpp·NLP 준비 후 앱을 묶는다. 준비 과정은 검색 모델을 사용자 데이터에 자동 설치하지 않는다.

```sh
cargo +1.85.0 test --locked --manifest-path crates/comet-nlp/Cargo.toml
cargo +1.85.0 test --locked --manifest-path src-tauri/Cargo.toml
```

E5 변환 환경은 `scripts/requirements-nlp-export.txt`, 변환 절차는 `scripts/export-e5.py`로 고정한다. 로컬 산출물은 `nlp/artifacts/`에 두고 Git에 포함하지 않는다. 각 플랫폼 manifest의 파일 URL은 검증한 실제 산출물을 게시한 뒤 설정한다. URL이 없는 모델을 내려받을 수 있다고 안내하지 않는다.

## 검증 근거

자동 검증은 원문·단어장 순서, 취소·선점, 미전송 발화 잔류, migration 보존, 늦은 색인 차단, 기억·색인·완료 상태 rollback, 긴 원문의 인용·정정 경계를 다룬다. Kiwi 원문 범위는 emoji·결합 문자·줄바꿈을 포함해 확인한다.

모델 품질 threshold는 한국어 검증셋에서 무관 질문 오탐률 5% 이하를 만족하면서 회수율이 가장 높은 값으로 정한다. 고정한 profile과 fixture revision에 검증 결과를 연결한다. 합성 벡터 테스트와 실제 모델 품질 측정을 구분하며, macOS 측정값을 Windows 저사양 실측으로 바꾸어 기록하지 않는다.

참고: [Kiwi v0.24.0](https://github.com/bab2min/Kiwi/releases/tag/v0.24.0), [E5 사용법](https://huggingface.co/intfloat/multilingual-e5-small#usage), [ORT 스레드 설정](https://onnxruntime.ai/docs/performance/tune-performance/threading.html), [ort rc.10](https://github.com/pykeio/ort/blob/v2.0.0-rc.10/Cargo.toml).
