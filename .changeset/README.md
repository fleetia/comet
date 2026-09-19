# Changesets

사용자에게 전달할 변경은 저장소 루트에서 `pnpm changeset`으로 기록합니다.
`comet`와 patch·minor·major 중 변경 수준을 선택하고 한국어 업데이트 노트를 작성하세요.

main에 병합하면 버전과 CHANGELOG를 갱신하는 PR이 자동으로 열립니다.
그 PR을 병합하면 두 OS 설치 파일과 signed updater를 빌드해 GitHub Release로 배포합니다.
앱은 npm에 게시하지 않습니다. 자세한 절차와 재시도는 [릴리스 안내](../docs/development/releases.md)를 따릅니다.
