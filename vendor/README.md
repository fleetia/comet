# Comet vNext Lagrange build

`fleetia-lagrange-0.1.1.tgz`는 승인된 Comet 디자인을 포함하는 로컬 Lagrange 소스 빌드다. package.json의 file dependency와 pnpm lockfile integrity가 이 artifact를 고정한다. registry에 새 버전을 발행하거나 다른 앱의 설치 패키지를 덮어쓰지 않는다.

Lagrange checkout의 version은 Changesets 릴리스 전 기존 값을 유지하므로 이 파일의 0.1.1은 최신 registry 버전을 뜻하지 않는다. 기존 Comet registry dependency 0.2.2를 이 검토 가능한 artifact로 교체했으며, 배포 버전 전환은 정식 릴리스 후 별도로 수행한다.

재생성은 `/Users/tracycho/Dev/fleetia/lagrange`에서 `corepack pnpm build && corepack pnpm pack --pack-destination ../comet/vendor`, Comet에서 `corepack pnpm install --no-frozen-lockfile`을 실행한다. UI 변경에는 타입·회귀·네이티브 검증을 다시 수행한다.
