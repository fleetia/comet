---
title: 로컬 모델 카탈로그와 실험 후보
description: Kanana 한국어 비교 후보의 출처·라이선스·고정 GGUF 파일과 검증 제한, 자동 추천 제외 정책
---

# 로컬 모델 카탈로그와 실험 후보

2026-10-02 추가한 Kanana 1.5 Instruct Q4_K_M 2종의 공급 출처와 검증 범위다. 기존 모델 8종을 유지해 카탈로그는 10종이며, 직접 지정한 GGUF는 별도 선택이다. 선택·다운로드·저장 화면은 [AI 연결](../product/settings.md#사용자대화ai일반), 전체 구현·실기 상태는 [상태표](../status.md)를 따른다.

## 선택과 추천 정책

- **Kanana 1.5 2.1B Instruct**: 한국어 경량 비교용 실험 후보다.
- **Kanana 1.5 8B Instruct**: 한국어 8B 비교용 실험 후보다. CPU 응답 지연이 생길 수 있다.
- 두 후보 모두 **실제 대화 미검증**으로 표시한다. 기존 모델보다 품질이 좋거나 환각이 적다는 뜻이 아니다.
- 사용자에게 선택·다운로드·저장을 제공하되, 실제 앱 대화 품질을 확인하기 전까지 `automatic_recommendation_eligible`에서 두 후보를 제외한다. 기존 모델의 적합도 계산·동률 순서·CPU 4B 이하 추천 기준은 유지한다.
- 8 GiB Apple Silicon의 Qwen3.8 2B, 36 GiB Windows의 Qwen3.5 4B 등 기존 추천 결과를 보존한다. 기본값은 Qwen3.5 4B이며 기존 저장값을 바꾸지 않는다.
- 두 후보는 모두 9B 이하이므로 기존 정책에 따라 위젯 제작·수정·복구에 사용할 수 없다.
- 기본 Windows 배포 경로는 CPU sidecar다. RTX 3080 보유만으로 GPU 가속·VRAM 적합도·응답 속도를 보장하지 않으며, 이 추가는 GPU backend나 실행 옵션을 바꾸지 않는다.

## 고정 파일

크기는 십진 바이트다. 모델 가중치는 앱에 동봉하지 않고 선택 시 Hugging Face에서 내려받는다. `src-tauri/src/models.rs`의 URL은 `main` 대신 아래 전체 commit을 고정하며, 기존 다운로드 경로에서 크기와 전체 파일 SHA-256을 확인한다.

| 항목 | 경량 후보 | 8B 후보 |
| --- | --- | --- |
| 화면 이름 | Kanana 1.5 2.1B Instruct | Kanana 1.5 8B Instruct |
| 설정 ID | `kanana-1.5-2.1b-instruct-2505` | `kanana-1.5-8b-instruct-2505` |
| 카탈로그 크기 표기 | 2.1B | 8B |
| HF 전체 parameter 수 | 2,316,824,832 | 8,030,285,824 |
| 양자화 | Q4_K_M | Q4_K_M |
| 파일 크기 | 1,522,796,768 bytes | 4,920,765,472 bytes |
| GGUF revision | `4d3b6203857d893ebfcaca6c51901e3ea1d00d00` | `4ac8eab32701b37555f225ee2c34dfa4edcdc99d` |

카탈로그 parameter 수는 기존 모델들과 마찬가지로 공개된 크기 이름을 사용한다. 전체 tensor parameter 수와 혼동하지 않는다.

### Kanana 1.5 2.1B

- GGUF 변환 공급자: DevQuasar. Kakao 공식 가중치의 커뮤니티 양자화이며 Kakao 공식 GGUF 배포본으로 표시하지 않는다.
- 파일: `kakaocorp.kanana-1.5-2.1b-instruct-2505.Q4_K_M.gguf`
- SHA-256 / LFS OID: `24d3db59d0af2c85c0afc0bbc99da1174b73ef6728bce2650bd91bec28ad1c81`
- [고정 다운로드](https://huggingface.co/DevQuasar/kakaocorp.kanana-1.5-2.1b-instruct-2505-GGUF/resolve/4d3b6203857d893ebfcaca6c51901e3ea1d00d00/kakaocorp.kanana-1.5-2.1b-instruct-2505.Q4_K_M.gguf)
- [고정 HF API 메타데이터](https://huggingface.co/api/models/DevQuasar/kakaocorp.kanana-1.5-2.1b-instruct-2505-GGUF/revision/4d3b6203857d893ebfcaca6c51901e3ea1d00d00?blobs=true) · [원시 Git-LFS 포인터](https://huggingface.co/DevQuasar/kakaocorp.kanana-1.5-2.1b-instruct-2505-GGUF/raw/4d3b6203857d893ebfcaca6c51901e3ea1d00d00/kakaocorp.kanana-1.5-2.1b-instruct-2505.Q4_K_M.gguf)
- 원본: [Kakao 모델 카드](https://huggingface.co/kakaocorp/kanana-1.5-2.1b-instruct-2505/blob/7df4bc35ccd610e451809d7106e1c3cf82bfd44c/README.md) · [공식 Apache-2.0 LICENSE](https://huggingface.co/kakaocorp/kanana-1.5-2.1b-instruct-2505/blob/7df4bc35ccd610e451809d7106e1c3cf82bfd44c/LICENSE)

### Kanana 1.5 8B

- GGUF 변환 공급자: DevQuasar. Kakao 공식 가중치의 커뮤니티 양자화다.
- 파일: `kakaocorp.kanana-1.5-8b-instruct-2505.Q4_K_M.gguf`
- SHA-256 / LFS OID: `f7ae0cc1de2396647dce4a82fb4943136bcc785339ee8944c6818184c983d287`
- [고정 다운로드](https://huggingface.co/DevQuasar/kakaocorp.kanana-1.5-8b-instruct-2505-GGUF/resolve/4ac8eab32701b37555f225ee2c34dfa4edcdc99d/kakaocorp.kanana-1.5-8b-instruct-2505.Q4_K_M.gguf)
- [고정 HF API 메타데이터](https://huggingface.co/api/models/DevQuasar/kakaocorp.kanana-1.5-8b-instruct-2505-GGUF/revision/4ac8eab32701b37555f225ee2c34dfa4edcdc99d?blobs=true) · [원시 Git-LFS 포인터](https://huggingface.co/DevQuasar/kakaocorp.kanana-1.5-8b-instruct-2505-GGUF/raw/4ac8eab32701b37555f225ee2c34dfa4edcdc99d/kakaocorp.kanana-1.5-8b-instruct-2505.Q4_K_M.gguf)
- 원본: [Kakao 모델 카드](https://huggingface.co/kakaocorp/kanana-1.5-8b-instruct-2505/blob/c963a5f4f6496c749f94064a20b33028b0db9f19/README.md) · [공식 Apache-2.0 LICENSE](https://huggingface.co/kakaocorp/kanana-1.5-8b-instruct-2505/blob/c963a5f4f6496c749f94064a20b33028b0db9f19/LICENSE)

## 한국어 근거와 제한

Kakao 공식 모델 카드는 원본 Instruct 모델의 **KoMT-Bench 6.54(2.1B), 7.63(8B)**를 보고한다. 한국어 대화 비교 후보로 선정한 근거이며, 이 Q4_K_M 파일이나 comet 캐릭터 대화의 평가가 아니다. 벤치마크 수치만으로 캐릭터 말투·세계관 유지·기억 충실도·환각 감소 또는 기존 Qwen 모델보다 나은 품질을 단정하지 않는다.

두 원본의 공식 LICENSE 파일을 확인했으며 Apache-2.0이다. 다른 Kanana 버전의 별도 라이선스와 혼동하지 않는다. 사용·재배포 시 해당 라이선스와 귀속 고지 조건을 따른다.

## 확인한 것과 남은 인수

2026-10-02 공개 메타데이터 확인:

- 고정 revision의 HF API와 원시 Git-LFS 포인터에서 파일명·크기·SHA-256이 일치한다. 실제 파일 전체를 내려받아 해시를 재계산한 검증은 아니다.
- HF GGUF 메타데이터는 두 후보의 architecture를 `llama`, context를 32,768, BOS/EOS를 Llama 계열 token으로 보고하며 14,287자 chat template을 포함한다.
- [llama.cpp b10970의 architecture 소스](https://raw.githubusercontent.com/ggml-org/llama.cpp/b10970/src/llama-arch.cpp)는 `llama`를 지원한다. comet은 기존 `--jinja` 실행 경로를 사용한다. 이는 architecture·template의 정적 호환 근거이며 실제 모델 로드 성공을 대신하지 않는다.
- 가중치·실행기 다운로드와 실제 추론은 이번 카탈로그 작업에 포함하지 않았다. Windows/macOS 모델 로드, 한국어 다중 턴 캐릭터 대화, 미지 정보 응답·기억 충실도, 속도·메모리·취소·전환은 실제 앱에서 별도로 인수해야 한다.
- 자동 테스트는 ID 저장·복원, 선택 목록, 고정 파일 명세, 기본값·추천 결과 유지와 위젯 제작 차단을 검증한다. 자동 검사만으로 모델 의미 품질이나 지원 OS의 네이티브 실행을 완료 처리하지 않는다.
