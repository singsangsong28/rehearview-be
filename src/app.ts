import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { AppError } from "./lib/errors.ts";
import { authRouter } from "./modules/auth/auth.router.ts";
import { oauthRouter } from "./modules/auth/oauth.router.ts";
import { interviewRouter } from "./modules/interview/interview.router.ts";

export const app = express();
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
