import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authController as c } from "./auth.controller.ts";
import { requireAuth } from "./auth.middleware.ts";

// 비밀번호 무차별 대입이나 메일 도배가 가능한 POST 요청에만 건다.
// /auth/me, 로그아웃, 소셜 로그인 시작·콜백은 정상 사용 중에도 자주 불리므로 제외한다.
// TODO: 메모리 기반 카운터라 서버 인스턴스가 여러 개면 인스턴스별로 따로 센다. 배포 구성이 정해지면 Redis 등 공유 저장소로 교체.
// TODO: 소셜 로그인 콜백(제공사로 토큰 교환 요청을 보냄)에도 느슨한 별도 제한 검토.
const limiter = rateLimit({
  skip: () => process.env.NODE_ENV === "test",
  windowMs: 15 * 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

export const authRouter = Router();

authRouter.post("/signup", limiter, c.signup);
authRouter.post("/verify", limiter, c.verifyEmail);
authRouter.post("/login", limiter, c.login);
authRouter.post("/logout", c.logout);
authRouter.get("/me", requireAuth, c.me);
authRouter.post("/consent", requireAuth, c.consent);
authRouter.get("/account", requireAuth, c.account);
authRouter.delete("/me", requireAuth, c.deleteMe);
authRouter.post("/forgot-password", limiter, c.forgotPassword);
authRouter.post("/reset-password", limiter, c.resetPassword);
authRouter.post("/find-account", limiter, c.findAccount);
