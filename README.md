# Rehearview (리허뷰) · 백엔드

AI 음성 모의면접 서비스 [Rehearview](https://github.com/singsangsong28/rehearview-fe)의 API 서버입니다.

## 기술 스택

Node.js 24 · Express 5 · TypeScript · Prisma 7 (PostgreSQL) · zod · JWT(httpOnly 쿠키) · undici

## 구조

```
src/
├─ app.ts, index.ts       앱 조립, 서버 시작
├─ lib/                   db, errors, validate(zod), mask(개인정보 가리기)
└─ modules/
   ├─ auth/               가입·로그인·이메일 인증·비밀번호 재설정·소셜 로그인·약관 동의·계정 삭제
   ├─ interview/          면접 생성·진행·리포트, 서류·공고 분석
   ├─ posting/            채용 공고 주소에서 글 읽기 (SSRF 방어 포함)
   ├─ llm/                LLM 호출과 제공사 폴백
   └─ mail/               메일 발송 연결점
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
- 테스트는 위 DB가 켜져 있어야 합니다: `npm test` (파일 하나씩 순서대로 실행)
- 타입 검사: `npm run typecheck`

## 환경변수

| 이름 | 설명 |
|---|---|
| `DATABASE_URL` | PostgreSQL 접속 주소 |
| `JWT_SECRET` | 로그인 토큰 서명 키 (32자 이상) |
| `FRONTEND_ORIGIN` | 프론트 주소 (CORS, 소셜 로그인 후 이동) |
| `OAUTH_REDIRECT_BASE` | 소셜 로그인 콜백의 기준 주소. 제공사 콘솔에 `{기준 주소}/auth/{provider}/callback`을 등록합니다 |
| `GITHUB_*`, `GOOGLE_*`, `KAKAO_*`, `NAVER_*` (`CLIENT_ID`, `CLIENT_SECRET`) | 소셜 로그인 앱 정보. 값이 없는 제공사는 꺼집니다 (카카오는 시크릿 없이도 가능) |
| `KAKAO_SCOPE` | 카카오 동의항목(예: `account_email`). 콘솔에서 동의항목을 설정한 뒤 사용 |
| `GEMINI_API_KEY` | AI(질문 생성·분석·리포트) 기본 제공사 |
| `GROQ_API_KEY`, `CF_ACCOUNT_ID`, `CF_API_TOKEN` | 폴백 AI 제공사 (선택) |
| `LLM_TIMEOUT_MS` | AI 응답 대기 시간(기본 20000) |
| `INTERVIEW_DAILY_LIMIT`, `ANALYSIS_DAILY_LIMIT`, `POSTING_FETCH_DAILY_LIMIT` | 사용자별 하루 면접 시작 · 서류 분석 · 공고 불러오기 횟수 제한 |

## API 요약

| 경로 | 설명 |
|---|---|
| `POST /auth/signup` `/verify` `/login` `/logout` | 이메일 가입(동의 필요), 인증, 로그인 |
| `POST /auth/forgot-password` `/reset-password` `/find-account` | 비밀번호 찾기·재설정, 가입 정보 안내 |
| `GET /auth/{github,google,kakao,naver}` | 소셜 로그인 시작 (`/callback`으로 돌아옴) |
| `GET /auth/me` · `POST /auth/consent` | 내 정보(동의 여부 포함) · 약관 동의 기록 |
| `GET /auth/account` · `DELETE /auth/me` | 계정 정보 · 계정 삭제 |
| `POST /interviews/posting` | 채용 공고 주소에서 글 불러오기 |
| `POST /interviews/analyze` | 서류(여러 파일)와 공고를 분석해 면접 준비 브리프 만들기 |
| `POST /interviews` · `GET /interviews` · `GET/DELETE /interviews/:id` | 면접 생성 · 목록 · 조회 · 삭제 |
| `POST /interviews/:id/answer` · `POST /interviews/:id/report` | 답변 제출(다음 질문) · 리포트 생성 |

면접 API는 로그인과 **현재 버전의 약관 동의**가 필요합니다 (동의 전에는 `403 consent_required`).

## 보안·개인정보 설계

- 서류와 공고 **원문은 저장하지 않습니다.** 요청마다 받아 AI 호출에만 쓰고, 전화번호·이메일·주민등록번호 형태는 AI로 보내기 전에 가립니다.
- 비밀번호는 scrypt(솔트)로 저장하고, 로그인 토큰은 httpOnly 쿠키입니다. 비밀번호를 바꾸면 기존 토큰이 모두 무효화됩니다(`tokenVersion`).
- 공고 주소 읽기는 SSRF를 막기 위해 http/https와 표준 포트만 허용하고, 내부·예약 IP는 연결 시점에 차단하며, 리다이렉트마다 다시 검사합니다.
- 로그인·가입·비밀번호 찾기 등에는 요청 횟수 제한이 있습니다. (현재 메모리 기반이라 서버를 여러 대로 늘리면 Redis 등으로 옮겨야 합니다.)
- 이메일 인증·재설정 메일은 개발 중에는 서버 콘솔에 링크를 출력합니다. 실제 발송은 `modules/mail/mail.ts`를 교체해 연결합니다.

## 라이선스

소스 코드의 라이선스는 아직 정하지 않았습니다.
