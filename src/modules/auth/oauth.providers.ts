// 제공사 정보만 모아 둔다. 로그인/가입 판단은 oauth.service.ts에서.

// 제공사가 알려 준 이메일은 emailVerified가 true일 때만 신뢰한다.
export type Profile = { id: string; email: string | null; emailVerified: boolean };

export type ProviderDef = {
  authUrl: string;
  tokenUrl: string;
  tokenMethod?: "GET";
  scope: string;
  // 클라이언트 시크릿 없이도 쓸 수 있는 제공사 (카카오는 콘솔에서 시크릿 사용을 켠 경우에만 필요)
  secretOptional?: true;
  profile(accessToken: string): Promise<Profile>;
};

const getJson = async (url: string, accessToken: string) => {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", "User-Agent": "rehearview" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// 주의: 아래 엔드포인트와 응답 필드는 각 제공사 문서 기준으로 작성했으나 실제 앱 등록 후 호출해 본 적은 없다.
const PROVIDERS: Record<string, ProviderDef> = {
  github: {
    authUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scope: "read:user user:email",
    async profile(t) {
      const user = await getJson("https://api.github.com/user", t);
      const emails: Array<{ email: string; primary: boolean; verified: boolean }> = await getJson(
        "https://api.github.com/user/emails",
        t,
      );
      const primary = emails.find((e) => e.primary && e.verified);
      return { id: String(user.id), email: primary?.email ?? null, emailVerified: !!primary };
    },
  },
  google: {
    authUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scope: "openid email",
    async profile(t) {
      const u = await getJson("https://openidconnect.googleapis.com/v1/userinfo", t);
      return { id: String(u.sub), email: u.email ?? null, emailVerified: u.email_verified === true };
    },
  },
  kakao: {
    authUrl: "https://kauth.kakao.com/oauth/authorize",
    tokenUrl: "https://kauth.kakao.com/oauth/token",
    // 동의항목을 콘솔에서 설정하지 않은 권한을 요청하면 카카오가 로그인 화면에서 오류를 내므로 기본은 요청 없음(이메일 없이 가입).
    // TODO: 이메일이 필요하면 콘솔에서 account_email 동의항목 설정(비즈앱 전환·검수가 필요할 수 있음) 후 .env에 KAKAO_SCOPE=account_email
    scope: process.env.KAKAO_SCOPE ?? "",
    secretOptional: true,
    async profile(t) {
      const u = await getJson("https://kapi.kakao.com/v2/user/me", t);
      const a = u.kakao_account;
      return {
        id: String(u.id),
        email: a?.email ?? null,
        emailVerified: a?.is_email_valid === true && a?.is_email_verified === true,
      };
    },
  },
  naver: {
    authUrl: "https://nid.naver.com/oauth2.0/authorize",
    tokenUrl: "https://nid.naver.com/oauth2.0/token",
    tokenMethod: "GET",
    scope: "",
    async profile(t) {
      const u = (await getJson("https://openapi.naver.com/v1/nid/me", t)).response;
      // TODO: 네이버는 이메일 인증 여부를 알려 주지 않아 안전하게 미인증으로 취급한다(자동 연결·이메일 저장 안 함). 인증 여부를 확인할 방법이 생기면 true로.
      return { id: String(u.id), email: u.email ?? null, emailVerified: false };
    },
  },
};

// 제공사 콘솔에 등록할 콜백: {OAUTH_REDIRECT_BASE}/auth/{provider}/callback
export const callbackUrl = (provider: string) =>
  `${process.env.OAUTH_REDIRECT_BASE ?? "http://localhost:4000"}/auth/${provider}/callback`;

// 알려진 제공사이면서 .env에 키가 있는 경우에만 반환 (키가 없으면 해당 제공사는 꺼진 것으로 취급)
export function findProvider(name: string) {
  const def = PROVIDERS[name];
  const key = name.toUpperCase();
  const id = process.env[`${key}_CLIENT_ID`];
  const secret = process.env[`${key}_CLIENT_SECRET`];
  return def && id && (secret || def.secretOptional) ? { def, clientId: id, clientSecret: secret ?? "" } : null;
}
