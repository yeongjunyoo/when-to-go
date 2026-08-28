# 언제 가지

2026 관광데이터 활용 공모전 출품작. 공공데이터 기반 관광 혼잡도 안내 서비스.

## ⚠️ URL 불변 계약

> **이 배포 URL은 공모전 최종 제출 URL이며, 제출 이후 변경하지 않는다.**
>
> - 공개 서비스: `https://when-to-go-7s6.pages.dev`
> - 프록시(API): `https://when-to-go-proxy.apple021104.workers.dev`
>
> 이후 공모전 제출이 완료될 때까지 프로젝트 이름/서브도메인을 변경하지 않는다.

## 아키텍처

```
web/     Vite + React + TS + Tailwind + PWA — 정적 프론트엔드 (Cloudflare Pages)
worker/  Cloudflare Workers — 공공데이터 API 프록시 (Cloudflare Workers)
tests/   프록시 계약 테스트 (모킹된 upstream, 실호출 없음)
scripts/ CI 가드 (금지어 검사, 프로덕션 픽스처 검사)
```

프론트엔드는 upstream 공공데이터 API를 직접 호출하지 않는다. 항상 `worker/`
프록시를 거친다. 프록시가 인증키(`serviceKey`), `MobileApp`, `MobileOS`를
서버 측에서 강제 주입하므로 클라이언트는 인증키를 절대 볼 수 없다.

## 절대 규칙

- 인증키는 코드/커밋/로그 어디에도 등장하지 않는다. `wrangler secret put TOURAPI_KEY`로만 관리한다.
- 프로덕션 코드 경로에 픽스처/목 데이터를 두지 않는다(픽스처는 `tests/fixtures/`에만 존재).
- API 응답은 단말에 저장하지 않는다. 쿠시는 Workers 프로세스 메모리(TTL 최대 6시간, 공유)뿐이고,
  PWA(`vite-plugin-pwa`)는 정적 앱 셔을(HTML/JS/CSS 번들)만 Cache Storage에 precache한다
  — API 응답은 PWA 캐싱 대상이 아니다. B-index(아래 참조)는 승인 후에만 번들에 들어가는
  별도의 예외적 계층이다.
- 개발 계정 쿼타 1,000콜/일을 프로덕션 트래픽과 심사 증거 호출이 공유한다.
  전역 서킷브레이커가 490콜에서 경고, 700콜에서 upstream 호출을 차단한다.
  이 카운터는 **isolate별 베스트에포트 카운터**다(`worker/src/circuit.ts`) — Cloudflare가 동일 워커를
  복수 isolate에서 동시에 실행하면 각 isolate가 독립적으로 700까지 세므로, 실효 상한은 isolate 수 N에 비례해
  `N×700`까지 늘어날 수 있다. 정확한 전역 카운트가 필요하면 Durable Objects 등 중앙집중 카운터가
  필요하며, 현재는 이를 담당하지 않는 best-effort 예산 가드다.
- 서비스 내 어디에도 공공데이터 제공 기관의 명칭 약칭(국문/영문)이나 로고를 사용하지 않는다.
  금지어 목록은 `scripts/check-forbidden-terms.mjs`에 정의되어 있으며, `.github/workflows/ci.yml`이 모든 push/PR에서
`npm run check:terms`를 실행해 이를 강제한다.

## 재현 경로

### 설치

```bash
npm install
```

npm workspaces(`web/`, `worker/`)를 사용한다. 루트에서 한 번만 설치하면 된다.

### 로컬 개발

로컬 secret 파일을 만든다(커밋 금지, `.gitignore`에 등록됨):

```bash
# worker/.dev.vars
TOURAPI_KEY=<실제 64자리 hex 키>
```

```bash
npm run dev:worker   # http://127.0.0.1:8787 — Cloudflare Workers 로컬 프록시
npm run dev:web      # http://localhost:5173 — Vite dev server
```

프론트엔드가 배포된 프록시가 아닌 로커 프록시를 바라보게 하려면
`web/.env.local`에 `VITE_PROXY_BASE=http://127.0.0.1:8787`를 설정한다
(이 파일도 gitignore 대상).

#### B4 지도 뷰 빌드 플래그

지도는 `VITE_ENABLE_MAP=true`를 명시적으로 설정해야만 켜진다(기본값 off).
타일 약관 미확인이나 Kill Table R14(09-13까지 G4 미달성) 발동 시 이 환경변수를
빼면(또는 `false`로 설정하면) 지도 섹션이 전부 비활성화되며, 코드를 손으로 걸어낼 필요가
없다(route-level code splitting으로 Leaflet 자체가 별도 청크로 분리되어 있어서, 플래그가
꺼져 있으면 그 청크를 내려받지도 않는다).

타일 공급자: OpenStreetMap Standard raster 타일(`tile.openstreetmap.org`),
OSMF Tile Usage Policy(https://operations.osmfoundation.org/policies/tiles/) 준수
확인됨(2026-08-28) — 정확한 URL, 상시 출처표기, 브라우저 기본 캐싱(no-cache 우회 없음),
프리페치/오프라인 기능 없음.

### 빌드

```bash
npm run build   # worker 타입체크 + web 프로덕션 빌드
```

### 테스트

```bash
npx vitest run   # 프록시 계약 테스트 — upstream은 전부 모킹, 실호출 0회
```

### 금지어 / 프로덕션 픽스처 가드

```bash
npm run check:terms           # UI/README/package.json에 금지어 없는지 검사
npm run check:fixtures        # worker/src 정적 검사(상시) + web 빌드 산출물 픽스처 검사(빌드 후)
npm run check:index-approval  # B-index 실데이터가 승인 없이 번들/git에 존재하지 않는지 검사
```

### 배포 (리더 실행, 이 저장소 작업자는 실행하지 않음)

```bash
# 1) Worker 프록시에 secret 등록 (최초 1회, 이후 값 변경 시에만 재실행)
cd worker
npx wrangler secret put TOURAPI_KEY

# 2) Worker 배포
npx wrangler deploy

# 3) 프론트엔드 빌드 후 Cloudflare Pages 배포
cd ../web
npm run build
npx wrangler pages deploy dist --project-name=<pages-project-name>
```

배포된 Worker URL이 확정되면 `web`의 프로덕션 빌드 환경변수
`VITE_PROXY_BASE`를 그 URL로 설정하고 재배포한다. 이후 위 URL 불변 계약에
따라 변경하지 않는다.

## B-index (승인 대기 계층)

B-live(요청-스코프 실시간 호출, 영속 저장 0)가 언제나 기본 경로다. B-index는 로컬 저장 승인이 난 뒤에만
켜지는 상위 캐싱 계층이다(POI 후보집합을 빌드타임에 생성해 번들에 넣어둘 수 있도록).
소비 측 코드(App.tsx/MapView.tsx)는 `getPoiIndexFor()` 하나만 부르며 B-index가 그 시군구를 덞고 있으면 그것을,
없으면 B-live를 투명하게 쓴다.

- **활성화 조건**: `VITE_LOCAL_STORAGE_APPROVED=true` 하나뿐이다(기본값 off). 거절되면 이 플래그가 영구히 off로
  남고, 코드 삭제나 사용자 가시적 변화 없이 그대로 끝난다(B-live가 이미 모든 화면을 서비스하고 있으므로).
- **생성기**: `scripts/generate-poi-index.mjs`는 `GENERATE_INDEX_APPROVED=true`를 명시적으로 설정하지 않으면 실행을
  거부한다(실제 승인과 별개의 수동 확인 스위치).
- **2중 가드**: `npm run check:index-approval`가 (1) 빌드 번들(`web/dist`)과 (2) git에 커밋된 파일 양쪽을 둘 다
  검사해, 실데이터 마커(`"__WTG_INDEX_REAL_DATA_MARKER__":true`)가 발견되면 실패한다. git 검사가 별도로
  있는 이유: repo가 공개 전제라 번들에 안 들어가도 커밋으로 동일한 유출이 일어난다.
- 생성기가 안 돎았을 때 기본값은 `web/src/generated/poi-index.generated.json`의 빈 플레이스홀더(`{ "entries": [] }`)이며,
  이 상태에서는 어느 시군구도 멤치지 않아 모든 요청이 그대로 B-live로 폴백한다.

## 오퍼레이션 allowlist

| operation | upstream 경로 | 필수 파라미터 |
|---|---|---|
| `ldongCode2` | `KorService2/ldongCode2` | - |
| `tatsCnctrRatedList` | `TatsCnctrRateService/tatsCnctrRatedList` | `areaCd`, `signguCd` |
| `detailCommon2` | `KorService2/detailCommon2` | `contentId` |
| `detailImage2` | `KorService2/detailImage2` | `contentId`, `imageYN` |
| `areaBasedList1` | `TarRlteTarService1/areaBasedList1` | `areaCd`, `signguCd`, `baseYm` |
| `areaBasedList2` | `KorService2/areaBasedList2` | `lDongRegnCd`, `lDongSignguCd` |

클라이언트는 `operation` 이름과 위 필수/선택 파라미터만 지정한다.
`serviceKey`/`MobileApp`/`MobileOS`/`_type`는 서버가 강제 주입하며,
클라이언트가 이 값들을 보내면 400으로 거부된다.
