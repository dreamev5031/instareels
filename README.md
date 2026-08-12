# instareels

TTS 나레이션 → Edge TTS 생성 → 앞표지 설정 → 영상 업로드 → OCR 위험구간 제외 → TTS 길이에 맞춘 SCENE 배정까지의 파이프라인. 앞표지는 이미지/문구/폰트/세로 위치를 JOB에 저장하고 실시간 미리보기를 제공한다. 자막/BGM/최종 렌더는 아직 범위에 포함하지 않음.

## 로컬 실행

```bash
npm install
npm run dev
# http://localhost:3000
```

`.env.example`을 참고해 필요하면 `.env.local`을 만든다. 로컬 개발에서는 프론트/백엔드가 같은 서버(`same-origin`)이므로 기본값 그대로 아무 설정 없이 동작한다.

시스템 요구사항: `ffmpeg`/`ffprobe`가 PATH에 있어야 한다(OCR 프레임 추출, TTS/영상 길이 측정, 썸네일 생성에 사용).

## 아키텍처: 한 코드베이스, 두 개의 Railway 서비스

프론트(UI)와 백엔드(`app/api/*`)는 물리적으로 분리된 코드가 아니라 **동일한 Next.js 앱을 두 가지 설정으로 각각 배포**한다.

- **`instareels-api`**: 이 앱을 정상적으로 실행 — `app/api/*`가 실제로 호출되는 쪽. ffmpeg/OCR(tesseract.js)/Edge TTS(msedge-tts)가 여기서 동작해야 한다.
- **`instareels-web`**: 같은 앱을 같은 방식으로 실행하지만, 브라우저는 이제 상대경로 `/api/...` 대신 `NEXT_PUBLIC_API_URL`(백엔드 공개 주소)로 직접 요청한다. `app/api/*` 코드는 그대로 남아있지만 아무도 호출하지 않는다.

CORS는 `proxy.ts` 하나가 모든 `/api/*` 요청에 일괄 적용한다 (`FRONTEND_URL`에 등록된 origin + 로컬 개발 중 `localhost`는 항상 허용).

## Railway 배포

Railway 프로젝트 안에 서비스 두 개를 만들고, 각각 이 저장소를 연결한다. 두 서비스 모두 **Root Directory는 저장소 루트(`/`)** 로 동일하고, **Dockerfile Path**만 다르게 지정한다 (Service Settings → Build → Dockerfile Path).

### [Backend Railway Service] `instareels-api`

- Root Directory: `/`
- Dockerfile Path: `Dockerfile.api`
- Build/Start: Dockerfile이 전담 (`npm ci` → `npm run build` → `next start -H 0.0.0.0`). Railway의 별도 Build/Start Command 필드는 비워둔다.
- 필요 환경변수:
  | 변수 | 값 | 비고 |
  |---|---|---|
  | `WORK_DIR` | `/tmp/instareels` (기본값, 미설정시 자동) | Volume을 붙이면 그 마운트 경로로 변경 |
  | `FRONTEND_URL` | `instareels-web`의 공개 도메인 | CORS 허용 origin, 콤마로 여러 개 가능 |

  `PORT`는 Railway가 자동 주입하므로 별도 설정 불필요.

### [Frontend Railway Service] `instareels-web`

- Root Directory: `/`
- Dockerfile Path: `Dockerfile.web`
- Build/Start: Dockerfile이 전담 (`npm ci` → `npm run build` → `next start -H 0.0.0.0`).
- 필요 환경변수 (**빌드 타임**에 필요 — Next.js가 클라이언트 번들에 값을 직접 박아 넣는다):
  | 변수 | 값 | 비고 |
  |---|---|---|
  | `NEXT_PUBLIC_API_URL` | `instareels-api`의 공개 도메인 | Railway service variable reference(`${{instareels-api.RAILWAY_PUBLIC_DOMAIN}}` 형태)로 걸어두면 도메인 재생성 시에도 자동 반영됨 |

  Railway는 이 값을 "Build-time variable"로 서비스에 등록해야 `docker build` 시 `ARG NEXT_PUBLIC_API_URL`로 전달된다. **배포 순서: `instareels-api`를 먼저 배포해 도메인을 발급받은 뒤, `instareels-web`의 `NEXT_PUBLIC_API_URL`을 그 도메인으로 설정하고 배포한다.**

### 헬스체크

- `GET /health` → `{ "status": "ok" }` — Railway healthcheck path로 이 엔드포인트를 지정.
- `GET /api/diagnostics` → ffmpeg/ffprobe 실행 가능 여부, tesseract.js/msedge-tts 모듈 로드 가능 여부, `WORK_DIR` 쓰기 가능 여부를 점검해 JSON으로 반환 (문제 있으면 503). 배포 직후 백엔드가 실제로 정상 세팅됐는지 수동 확인용.

## 파일 저장 (임시 vs 영구)

업로드 영상, TTS 오디오, OCR용 프레임, 썸네일은 전부 `WORK_DIR` 하위에 저장된다 (`src/jobs/paths.ts`). Railway에 Volume을 붙이지 않으면 재배포/재시작 시 사라지는 임시 파일로 취급하는 게 맞다 — 지금 단계(테스트)에서는 그대로 두면 되고, 나중에 영속성이 필요해지면 Railway Volume을 만들어 임의 경로(예: `/data`)에 마운트하고 `WORK_DIR=/data`로 바꾸기만 하면 코드 변경 없이 적용된다.

## 로컬에서 분리 배포 흉내내기 (선택)

프론트/백엔드를 진짜로 나눠서 테스트하고 싶다면:

```bash
# 1) 백엔드 역할 (기본 포트 3000)
npm run dev

# 2) 프론트 역할 (다른 포트, 백엔드를 절대경로로 바라보게 빌드)
NEXT_PUBLIC_API_URL=http://localhost:3000 npm run build
PORT=3100 npm run start
```
