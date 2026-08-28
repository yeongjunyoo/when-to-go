# 언제 가지

2026 관광데이터 활용 공모전 출품작. 공공데이터 기반 관광 혼잡도 안내 서비스.

## ⚠️ URL 불변 계약

> **이 배포 URL은 공모전 최종 제출 URL이며, 제출 이후 변경하지 않는다.**
>
> - 프론트엔드: `https://<pages-project>.pages.dev`
> - 프록시(API): `https://<worker-name>.<subdomain>.workers.dev`
>
> 두 URL이 확정되는 즉시 이 섹션에 실제 값을 박제하고, 이후 공모전 제출이
> 완료될 때까지 프로젝트 이름/서브도메인을 변경하지 않는다.

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
- 로컬 영속 저장 없음 — 캐시는 Workers 프로세스 메모리(TTL 최대 6시간)뿐이다.
- 개발 계정 쿼터 1,000콜/일을 프로덕션 트래픽과 심사 증거 호출이 공유한다.
  전역 서킷 브레이커가 490콜에서 경고, 700콜에서 upstream 호출을 차단한다.
- 서비스 내 어디에도 공공데이터 제공 기관의 명칭 약칭(국문/영문)이나 로고를 사용하지 않는다.
  금지어 목록은 `scripts/check-forbidden-terms.mjs`에 정의되어 있으며, `npm run check:terms`가 이를 CI에서 강제한다.

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

프론트엔드가 배포된 프록시가 아닌 로컬 프록시를 바라보게 하려면
`web/.env.local`에 `VITE_PROXY_BASE=http://127.0.0.1:8787`를 설정한다
(이 파일도 gitignore 대상).

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
npm run check:terms      # UI/README/package.json에 금지어 없는지 검사
npm run check:fixtures   # 빌드 산출물에 테스트 픽스처가 섞이지 않았는지 검사(빌드 후 실행)
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
