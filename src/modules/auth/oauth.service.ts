import { randomBytes } from "node:crypto";
import type { User } from "../../../generated/prisma/client.ts";
import { authRepository as repo } from "./auth.repository.ts";
import { callbackUrl, findProvider, type Profile } from "./oauth.providers.ts";

type Provider = NonNullable<ReturnType<typeof findProvider>>;

// 제공사 로그인 화면으로 보낼 주소와 CSRF 방지용 state
export function buildAuthorizeUrl(name: string, { def, clientId }: Provider) {
  const state = randomBytes(16).toString("hex");
  const q = new URLSearchParams({ client_id: clientId, redirect_uri: callbackUrl(name), response_type: "code", state });
  if (def.scope) q.set("scope", def.scope);
  return { url: `${def.authUrl}?${q}`, state };
}

// 인증 코드를 액세스 토큰으로 바꾸고 제공사 프로필을 가져온다.
export async function fetchProfile(name: string, { def, clientId, clientSecret }: Provider, code: string, state: string) {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: callbackUrl(name),
    client_id: clientId,
    state,
  });
  if (clientSecret) params.set("client_secret", clientSecret);
  const res =
    def.tokenMethod === "GET"
      ? await fetch(`${def.tokenUrl}?${params}`, { headers: { Accept: "application/json" } })
      : await fetch(def.tokenUrl, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
          body: params,
        });
  if (!res.ok) throw new Error(`token HTTP ${res.status}`);
  const accessToken = (await res.json()).access_token;
  if (typeof accessToken !== "string") throw new Error("no access_token");
  return def.profile(accessToken);
}

// 제공사 프로필로 로그인할 사용자를 정한다.
// 1) 이미 연결된 계정이면 그 사용자  2) 제공사가 인증한 이메일이 인증된 기존 사용자와 같으면 연결
// 3) 그 외에는 새 사용자 (이메일을 못 받았거나 믿을 수 없으면 이메일 없이 가입)
export async function loginWithProfile(
  provider: string,
  p: Profile,
): Promise<{ user: User; error?: undefined } | { error: "email_unverified"; user?: undefined }> {
  const linked = await repo.findAccount(provider, p.id);
  if (linked) return { user: linked.user };

  const email = p.emailVerified && p.email ? p.email.toLowerCase() : null;
  if (email) {
    const existing = await repo.findUserByEmail(email);
    if (existing) {
      // 이메일 인증을 마치지 않은 로컬 계정은 소유자를 믿을 수 없어 연결하지 않는다
      // TODO: 이 경우 "기존 계정의 이메일 인증을 먼저 완료" 안내 화면, 또는 미인증 계정 정리 정책.
      if (!existing.emailVerified) return { error: "email_unverified" };
      await repo.linkAccount(existing.id, provider, p.id);
      return { user: existing };
    }
  }
  return { user: await repo.createSocialUser(email, provider, p.id) };
}
