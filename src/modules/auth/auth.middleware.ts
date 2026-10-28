import type { NextFunction, Request, Response } from "express";
import { authService } from "./auth.service.ts";
import { SESSION_COOKIE } from "./auth.session.ts";
import { hasConsented } from "./consent.ts";

// 로그인 필요 라우트용. 통과하면 res.locals.user에 사용자가 들어 있다.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  res.locals.user = await authService.authenticate(req.cookies?.[SESSION_COOKIE]);
  next();
}

// 서비스 기능(면접 등)은 현재 버전의 약관·개인정보 처리에 동의한 사용자만 쓸 수 있다. requireAuth 뒤에 둔다.
// 화면에서도 막지만, 서버에서 막아야 동의 화면을 건너뛰고 API를 직접 부르는 우회를 막을 수 있다.
export function requireConsent(_req: Request, res: Response, next: NextFunction) {
  if (!hasConsented(res.locals.user)) return void res.status(403).json({ error: "이용약관과 개인정보 처리에 동의해 주세요", code: "consent_required" });
  next();
}
