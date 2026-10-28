import { z } from "zod";

const EMAIL_MSG = "이메일 형식이 올바르지 않습니다";
const PASSWORD_MSG = "비밀번호는 8~128자여야 합니다"; // 상한은 scrypt 비용 폭주 방지

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, EMAIL_MSG)
  .pipe(z.email(EMAIL_MSG));
const newPassword = z.string().min(8, PASSWORD_MSG).max(128, PASSWORD_MSG);
const token = z
  .string()
  .min(1, "토큰이 필요합니다")
  .max(256, "유효하지 않은 토큰입니다");

// 이용약관, 개인정보 수집·이용(AI 서비스 전송 포함), 만 14세 이상 확인에 한꺼번에 동의했다는 뜻
const AGREE_MSG = "이용약관과 개인정보 처리에 동의해 주세요";
const agree = z.literal(true, AGREE_MSG);

export const signupSchema = z.object({ email, password: newPassword, agree });
export const consentSchema = z.object({ agree });
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, EMAIL_MSG).max(254, EMAIL_MSG),
  password: z
    .string()
    .min(1, "비밀번호를 입력해 주세요")
    .max(128, PASSWORD_MSG),
});
export const verifyEmailSchema = z.object({ token });
export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ token, password: newPassword });
export const findAccountSchema = z.object({ email });

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
