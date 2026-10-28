# Rehearview (리허뷰) · 백엔드

AI 음성 모의면접 서비스 [Rehearview](https://github.com/singsangsong28/rehearview-fe)의 API 서버입니다. 서비스 주소는 https://www.rehearview.shop 이고, 이 서버는 https://api.rehearview.shop 에서 동작합니다.

## 기술 스택

Node.js 24 · Express 5 · TypeScript · Prisma 7 (PostgreSQL) · zod · JWT(httpOnly 쿠키) · nodemailer(Gmail SMTP) · undici

## 구조

```
src/
├─ app.ts, index.ts       앱 조립, 서버 시작
├─ lib/                   db, errors, validate(zod), mask(개인정보 가리기)
└─ modules/
   ├─ auth/               가입·로그인·이메일 인증·비밀번호 재설정·소셜 로그인·약관 동의·계정 삭제
   ├─ interview/          면접 생성·진행·리포트(모범 답변 포함), 서류·공고 분석
   ├─ posting/            채용 공고 주소에서 글 읽기 (SSRF 방어 포함)
   ├─ llm/                LLM 호출과 제공사 폴백 (Gemini → Groq → Cloudflare)
   └─ mail/               인증·재설정 메일 발송 (SMTP 설정이 없으면 콘솔 출력)
prisma/                   스키마와 마이그레이션
deploy/                   서버 설정 (systemd, Caddy), 배포·백업 스크립트
docs/                     배포 안내, 초기 기획서
.github/workflows/        CI와 서버 자동 배포
```

각 모듈은 `router → controller → service → repository` 계층과 `*.schema.ts`(zod 검증)로 나뉩니다.

## 실행

```bash
npm install
cp .env.example .env     # 값을 채웁니다 (아래 표 참고)
npx prisma migrate deploy
npm run dev              # http://localhost:4000
```

- DB는 PostgreSQL이 필요합니다. 로컬 개발용으로는 `npx prisma dev`가 띄우는 로컬 Postgres의 접속 주소를 `DATABASE_URL`에 넣어 쓸 수 있습니다.
- 테스트는 위 DB가 켜져 있어야 합니다: `npm test` (파일 하나씩 순서대로 실행, AI 호출은 가짜로 대체)
- 타입 검사: `npm run typecheck`
- 운영 실행: `npm start` (`.ts`를 그대로 실행하므로 Node 22.18 이상, 권장 24)

## 환경변수

`.env.example`에 전체 목록이 있습니다.

| 이름 | 설명 |
|---|---|
| `DATABASE_URL` | PostgreSQL 접속 주소 |
| `JWT_SECRET` | 로그인 토큰 서명 키 (32자 이상) |
| `FRONTEND_ORIGIN` | 프론트 주소 (CORS, 소셜 로그인 후 이동) |
| `OAUTH_REDIRECT_BASE` | 소셜 로그인 콜백의 기준 주소. 제공사 콘솔에 `{기준 주소}/auth/{provider}/callback`을 등록합니다 |
| `GITHUB_*`, `GOOGLE_*`, `KAKAO_*`, `NAVER_*` (`CLIENT_ID`, `CLIENT_SECRET`) | 소셜 로그인 앱 정보. 값이 없는 제공사는 꺼집니다 (카카오는 시크릿 없이도 가능) |
| `KAKAO_SCOPE` | 카카오 동의항목(예: `account_email`). 콘솔에서 동의항목을 설정한 뒤 사용 |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | AI(질문 생성·분석·리포트) 기본 제공사. 모델 기본값은 `gemini-3.6-flash` (무료 티어는 모델별 하루 한도가 작아 바꿔 쓸 수 있게 했습니다) |
| `GROQ_API_KEY`, `CF_ACCOUNT_ID`, `CF_API_TOKEN` | 폴백 AI 제공사 (선택). 키가 있는 제공사만 순서대로 시도합니다 |
| `LLM_TIMEOUT_MS` | AI 한 번의 응답을 기다리는 시간(기본 20000, 운영은 60000) |
| `LLM_MAX_WAIT_MS` | 모든 AI 제공사가 한도 초과·과부하일 때 에러 대신 기다렸다 다시 시도하는 최대 시간(기본 90000). 프론트 프록시 대기(3분)보다 짧게 둡니다 |
| `INTERVIEW_DAILY_LIMIT`, `ANALYSIS_DAILY_LIMIT`, `POSTING_FETCH_DAILY_LIMIT` | 사용자별 하루 면접 시작 · 서류 분석 · 공고 불러오기 횟수 제한 |
| `SMTP_USER`, `SMTP_PASS`, `SMTP_HOST`, `MAIL_FROM` | 메일 발송(Gmail SMTP, 앱 비밀번호). `SMTP_USER`·`SMTP_PASS`가 없으면 링크를 콘솔에 출력합니다 |
| `TRUST_PROXY` | 앞단 프록시 단계 수. 요청 제한이 접속자별로 걸리게 하려면 운영에서 `1`로 둡니다 |

## API 요약

| 경로 | 설명 |
|---|---|
| `GET /health` | 상태 확인 (`{"ok":true}`) |
| `POST /auth/signup` `/verify` `/login` `/logout` | 이메일 가입(동의 필요), 인증, 로그인 |
| `POST /auth/forgot-password` `/reset-password` `/find-account` | 비밀번호 찾기·재설정, 가입 정보 안내 |
| `GET /auth/{github,google,kakao,naver}` | 소셜 로그인 시작 (`/callback`으로 돌아옴) |
| `GET /auth/me` · `POST /auth/consent` | 내 정보(동의 여부 포함) · 약관 동의 기록 |
| `GET /auth/account` · `DELETE /auth/me` | 계정 정보 · 계정 삭제 |
| `POST /interviews/posting` | 채용 공고 주소에서 글 불러오기 |
| `POST /interviews/analyze` | 서류(여러 파일)와 공고를 분석해 면접 준비 브리프 만들기 |
| `POST /interviews` · `GET /interviews` · `GET/DELETE /interviews/:id` | 면접 생성 · 목록 · 조회 · 삭제 |
| `POST /interviews/:id/answer` · `POST /interviews/:id/report` | 답변 제출(다음 질문) · 리포트 생성 (6가지 기준 점수, 총평, 질문별 모범 답변 예시) |

면접 API는 로그인과 **현재 버전의 약관 동의**가 필요합니다 (동의 전에는 `403 consent_required`).

## 배포

- 백엔드는 OCI(도쿄) VM에서 Caddy(HTTPS) 뒤의 systemd 서비스로 돌고, 프론트는 Vercel입니다. 설정 순서와 환경변수는 [`docs/배포.md`](docs/배포.md)에 있습니다.
- **CI/CD**: PR(dev, main 대상)에서 GitHub Actions가 Postgres를 띄워 마이그레이션, 타입 검사, 테스트를 돌립니다. `main`에 병합되면 테스트 통과 후 서버에 SSH로 접속해 `deploy/deploy.sh`를 실행합니다(코드 갱신 → `npm ci` → `prisma migrate deploy` → 재시작 → 헬스 체크).
- **브랜치 흐름**: `feature/*`·`fix/*`·`docs/*` → `dev` PR → `dev`에서 `main` 릴리스 PR.
- DB 백업 스크립트는 `deploy/backup.sh`(매일, 14일 보관)이고, 서버 설치 방법은 [`docs/배포.md`](docs/배포.md)에 있습니다.

## 보안·개인정보 설계

- 서류와 공고 **원문은 저장하지 않습니다.** 요청마다 받아 AI 호출에만 쓰고, 전화번호·이메일·주민등록번호 형태는 AI로 보내기 전에 가립니다. 리포트에는 점수, 총평, 모범 답변 예시만 저장합니다.
- 비밀번호는 scrypt(솔트)로 저장하고, 로그인 토큰은 httpOnly 쿠키입니다. 비밀번호를 바꾸면 기존 토큰이 모두 무효화됩니다(`tokenVersion`).
- 공고 주소 읽기는 SSRF를 막기 위해 http/https와 표준 포트만 허용하고, 내부·예약 IP는 연결 시점에 차단하며, 리다이렉트마다 다시 검사합니다.
- 로그인·가입·비밀번호 찾기 등에는 접속 IP별 요청 횟수 제한이 있습니다. (현재 메모리 기반이라 서버를 재시작하면 초기화되고, 여러 대로 늘리면 Redis 등으로 옮겨야 합니다. 하루 사용 횟수 제한도 마찬가지입니다.)
- 운영에서는 Vercel이 알려 주는 접속자 IP를 Caddy가 `X-Forwarded-For`로 넘깁니다. 백엔드 주소로 직접 요청하는 사람이 이 헤더를 위조하면 요청 제한을 피할 수 있다는 한계가 있습니다.

## 알려진 제한

- AI 제공사의 무료 한도(Gemini 모델별 하루 요청 수, Groq 분당 토큰)가 작아 사용자가 늘면 질문 생성이나 리포트가 실패할 수 있습니다. 일반 공개 전에 유료 전환이 필요합니다.
- 백업은 같은 서버 디스크에만 보관합니다.

## 라이선스

소스 코드의 라이선스는 아직 정하지 않았습니다.
