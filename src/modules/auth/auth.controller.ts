import type { Request, Response } from "express";
import { parse } from "../../lib/validate.ts";
import { hasConsented } from "./consent.ts";
import {
  consentSchema,
  findAccountSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
  signupSchema,
  verifyEmailSchema,
} from "./auth.schema.ts";
import { authService } from "./auth.service.ts";
import { clearSessionCookie, setSessionCookie } from "./auth.session.ts";

// 메일을 보내는 API는 가입 여부가 드러나지 않게 항상 같은 응답을 준다.
const MAIL_SENT = { message: "입력하신 이메일로 안내 메일을 보냈습니다. 메일함을 확인해 주세요" };

export const authController = {
  async signup(req: Request, res: Response) {
    const { email, password } = parse(signupSchema, req.body);
    await authService.signup(email, password);
    res.status(202).json({ message: "인증 메일을 보냈습니다. 메일함을 확인해 주세요" });
  },

  async verifyEmail(req: Request, res: Response) {
    await authService.verifyEmail(parse(verifyEmailSchema, req.body).token);
    res.json({ message: "이메일 인증이 완료되었습니다" });
  },

  async login(req: Request, res: Response) {
    const { email, password } = parse(loginSchema, req.body);
    const user = await authService.login(email, password);
    setSessionCookie(res, user);
    res.json({ id: user.id, email: user.email });
  },

  // TODO: 쿠키만 지우므로 탈취된 토큰은 만료나 tokenVersion 변경 전까지 유효. 필요하면 로그아웃 시 tokenVersion을 올려 무효화.
  logout(_req: Request, res: Response) {
    clearSessionCookie(res);
    res.json({ ok: true });
  },

  me(_req: Request, res: Response) {
    const user = res.locals.user;
    // consented: 현재 버전의 약관·개인정보 처리에 동의했는지 (아니면 동의 화면으로 보낸다)
    res.json({ id: user.id, email: user.email, consented: hasConsented(user) });
  },

  async consent(req: Request, res: Response) {
    parse(consentSchema, req.body);
    await authService.recordConsent(res.locals.user.id);
    res.json({ consented: true });
  },

  async account(_req: Request, res: Response) {
    res.json(await authService.accountInfo(res.locals.user.id));
  },

  async deleteMe(_req: Request, res: Response) {
    await authService.deleteAccount(res.locals.user.id);
    clearSessionCookie(res);
    res.status(204).end();
  },

  async forgotPassword(req: Request, res: Response) {
    await authService.forgotPassword(parse(forgotPasswordSchema, req.body).email);
    res.status(202).json(MAIL_SENT);
  },

  async resetPassword(req: Request, res: Response) {
    const { token, password } = parse(resetPasswordSchema, req.body);
    await authService.resetPassword(token, password);
    res.json({ message: "비밀번호가 변경되었습니다. 새 비밀번호로 로그인해 주세요" });
  },

  async findAccount(req: Request, res: Response) {
    await authService.findAccount(parse(findAccountSchema, req.body).email);
    res.status(202).json(MAIL_SENT);
  },
};
