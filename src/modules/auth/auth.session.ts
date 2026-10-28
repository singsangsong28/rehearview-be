import type { Response } from "express";
import jwt from "jsonwebtoken";

export const SESSION_COOKIE = "token";
const SESSION_DAYS = 7;

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 32) throw new Error("JWT_SECRET은 32자 이상이어야 합니다");
  return s;
};

type SessionUser = { id: string; tokenVersion: number };

// 토큰에는 사용자 id(sub)와 tokenVersion(tv)만 넣는다. tv가 DB와 다르면(비밀번호 변경 등) 무효.
export function setSessionCookie(res: Response, user: SessionUser) {
  const token = jwt.sign({ sub: user.id, tv: user.tokenVersion }, secret(), { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_DAYS * 86_400_000,
  });
}

export const clearSessionCookie = (res: Response) => void res.clearCookie(SESSION_COOKIE);

// 유효한 토큰이면 { userId, tokenVersion }, 아니면 null
export function readSession(token: unknown): { userId: string; tokenVersion: number } | null {
  if (typeof token !== "string") return null;
  try {
    const p = jwt.verify(token, secret()) as jwt.JwtPayload;
    return { userId: String(p.sub), tokenVersion: Number(p.tv) };
  } catch {
    return null;
  }
}
