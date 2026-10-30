import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../lib/errors.ts";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const botCheckFailed = () => new AppError(400, "봇 검증에 실패했어요. 다시 시도해 주세요");

// 로그인 요청에 실린 Cloudflare Turnstile 토큰을 확인한다. 비밀키가 없으면(로컬·CI) 건너뛴다.
// 토큰이 없거나 확인이 실패·지연(5초)되면 막는다. 요청 제한보다 앞에 둬서 봇이 남의 계정 시도 횟수를 소진시키지 못하게 한다.
// 주의: 운영에서 TURNSTILE_SECRET_KEY가 빠지면 검증이 조용히 꺼지므로 배포 환경변수 점검 대상이다.
export async function verifyTurnstile(req: Request, _res: Response, next: NextFunction) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return next();

  const token = req.body?.turnstileToken;
  if (typeof token !== "string" || !token) throw botCheckFailed();

  try {
    const res = await fetch(VERIFY_URL, {
      method: "POST",
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(5_000),
    });
    if (!((await res.json()) as { success?: boolean }).success) throw botCheckFailed();
  } catch (e) {
    throw e instanceof AppError ? e : botCheckFailed();
  }
  next();
}
