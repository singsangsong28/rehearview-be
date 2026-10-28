import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { AppError } from "./lib/errors.ts";
import { authRouter } from "./modules/auth/auth.router.ts";
import { oauthRouter } from "./modules/auth/oauth.router.ts";
import { interviewRouter } from "./modules/interview/interview.router.ts";

export const app = express();
// Vercel·Caddy 뒤에서 실제 접속자 IP(요청 제한 기준)를 읽으려면 거쳐 오는 프록시 단계 수를 TRUST_PROXY 로 알려 준다
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY));
app.use(cors({ origin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3000", credentials: true }));
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});
app.use("/auth", authRouter);
app.use("/auth", oauthRouter);
app.use("/interviews", interviewRouter);

// 비동기 핸들러에서 던진 에러도 여기로 온다 (Express 5)
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof AppError) return void res.status(err.status).json({ error: err.message });
  // 서류·답변이 섞일 수 있어 에러 객체 전체는 로그에 남기지 않는다
  console.error(`[error] ${err instanceof Error ? err.name : "unknown"}`);
  res.status(500).json({ error: "서버 오류가 발생했습니다" });
});
