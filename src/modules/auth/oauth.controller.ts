import type { NextFunction, Request, Response } from "express";
import { setSessionCookie } from "./auth.session.ts";
import { findProvider } from "./oauth.providers.ts";
import { oauthCallbackQuerySchema } from "./oauth.schema.ts";
import { buildAuthorizeUrl, fetchProfile, loginWithProfile } from "./oauth.service.ts";

const STATE_COOKIE = "oauth_state";
const frontend = () => process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
// 로그인 성공 후 이동할 프론트 경로 (frontend/lib/routes.ts 의 MEMBER_HOME 과 같아야 함)
const MEMBER_HOME = "/interviews";
const failRedirect = (res: Response, code: string) => res.redirect(`${frontend()}/login?error=${code}`);

export const oauthController = {
  // 알려진 제공사가 아니거나 키가 없으면 다음 라우트로 넘긴다 (/auth/me 같은 다른 경로와 겹치기 때문)
  start(req: Request, res: Response, next: NextFunction) {
    const name = String(req.params.provider);
    const provider = findProvider(name);
    if (!provider) return void next();
    const { url, state } = buildAuthorizeUrl(name, provider);
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 600_000,
    });
    res.redirect(url);
  },

  async callback(req: Request, res: Response, next: NextFunction) {
    const name = String(req.params.provider);
    const provider = findProvider(name);
    if (!provider) return void next();

    const expectedState = req.cookies?.[STATE_COOKIE];
    res.clearCookie(STATE_COOKIE);
    const query = oauthCallbackQuerySchema.safeParse(req.query);
    if (!query.success || query.data.state !== expectedState) return void failRedirect(res, "oauth_failed");

    try {
      const profile = await fetchProfile(name, provider, query.data.code, query.data.state);
      const result = await loginWithProfile(name, profile);
      if (result.error) return void failRedirect(res, result.error);
      setSessionCookie(res, result.user);
      res.redirect(`${frontend()}${MEMBER_HOME}`);
    } catch (e) {
      // 토큰·프로필 내용은 로그에 남기지 않음
      console.warn(`[oauth] ${name}: ${e instanceof Error ? e.message : "오류"}`);
      failRedirect(res, "oauth_failed");
    }
  },
};
