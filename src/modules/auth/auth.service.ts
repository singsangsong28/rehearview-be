import { createHash, randomBytes } from "node:crypto";
import type { TokenPurpose } from "../../../generated/prisma/client.ts";
import { AppError } from "../../lib/errors.ts";
import { sendMail } from "../mail/mail.ts";
import { authRepository as repo } from "./auth.repository.ts";
import { readSession } from "./auth.session.ts";
import { hashPassword, verifyPassword } from "./password.ts";

const TTL_HOURS = { VERIFY_EMAIL: 24, RESET_PASSWORD: 1 } as const satisfies Record<TokenPurpose, number>;
const COOLDOWN_MS = 60_000;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// 존재하지 않는 이메일에도 해시 비교를 해서 로그인 응답 시간 차이를 줄임
const DUMMY_HASH = await hashPassword("dummy-password");

// TODO: 서버가 여러 대가 되면 인스턴스별로 따로 세므로 DB나 Redis 같은 공유 저장소로 옮길 것. 프로세스 재시작 시에도 초기화됨.
const mailedAt = new Map<string, number>();
function recentlyMailed(email: string) {
  const now = Date.now();
  if (now - (mailedAt.get(email) ?? 0) < COOLDOWN_MS) return true;
  mailedAt.set(email, now);
  return false;
}

// 1회용 토큰을 만들어 링크를 메일로 보낸다. 같은 용도 메일을 1분 안에 다시 요청하면 보내지 않는다(메일함 도배 방지).
// VerificationToken에 생성 시각이 없어서 만료 시각에서 거꾸로 계산한다.
async function sendTokenMail(user: { id: string; email: string }, purpose: TokenPurpose) {
  const ttlMs = TTL_HOURS[purpose] * 3_600_000;
  if (await repo.hasTokenExpiringAfter(user.id, purpose, new Date(Date.now() + ttlMs - COOLDOWN_MS))) return;

  const token = randomBytes(32).toString("hex");
  await repo.createToken(user.id, purpose, sha256(token), new Date(Date.now() + ttlMs));

  const base = process.env.FRONTEND_ORIGIN ?? "http://localhost:3000";
  const isVerify = purpose === "VERIFY_EMAIL";
  await sendMail({
    to: user.email,
    subject: isVerify ? "[Rehearview] 이메일 인증" : "[Rehearview] 비밀번호 재설정",
    text: isVerify
      ? `아래 링크에서 이메일 인증을 완료해 주세요. (${TTL_HOURS[purpose]}시간 유효)\n${base}/verify?token=${token}`
      : `아래 링크에서 비밀번호를 재설정해 주세요. (${TTL_HOURS[purpose]}시간 유효)\n본인이 요청하지 않았다면 이 메일을 무시해 주세요.\n${base}/reset-password?token=${token}`,
  });
}

const invalidLink = () => new AppError(400, "유효하지 않거나 만료된 링크입니다");

async function findUsableToken(rawToken: string, purpose: TokenPurpose) {
  const row = await repo.findTokenByHash(sha256(rawToken));
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) throw invalidLink();
  return row;
}

export const authService = {
  // 이미 가입된 이메일이어도 호출한 쪽에는 같은 결과를 줘서 가입 여부를 알아내지 못하게 한다.
  async signup(email: string, password: string) {
    if (await repo.findUserByEmail(email)) return;
    const user = await repo.createLocalUser(email, await hashPassword(password));
    await sendTokenMail({ id: user.id, email }, "VERIFY_EMAIL");
  },

  async verifyEmail(rawToken: string) {
    const row = await findUsableToken(rawToken, "VERIFY_EMAIL");
    await repo.completeEmailVerification(row.id, row.userId);
  },

  async login(email: string, password: string) {
    const user = await repo.findUserByEmail(email);
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !user.passwordHash || !ok) throw new AppError(401, "이메일 또는 비밀번호가 올바르지 않습니다");
    if (!user.emailVerified) throw new AppError(403, "이메일 인증이 필요합니다");
    return user;
  },

  // 가입 여부를 알 수 없도록 없는 이메일도 조용히 넘어간다.
  async forgotPassword(email: string) {
    const user = await repo.findUserByEmail(email);
    if (!user) return;
    // 인증 전 계정은 재설정 대신 인증 메일을 다시 보낸다 (인증 링크가 만료돼 막힌 경우 대비)
    await sendTokenMail({ id: user.id, email }, user.emailVerified ? "RESET_PASSWORD" : "VERIFY_EMAIL");
  },

  // 비밀번호를 바꾸면 기존 로그인(JWT)은 모두 무효화된다.
  async resetPassword(rawToken: string, password: string) {
    const row = await findUsableToken(rawToken, "RESET_PASSWORD");
    await repo.completePasswordReset(row.userId, await hashPassword(password));
  },

  // 아이디 찾기: 이 서비스의 아이디는 이메일이라, 입력한 이메일로 가입 여부와 가입 방식을 메일로 알려 준다.
  // TODO: 이메일 자체를 잊은 경우의 찾기(이름·휴대폰 번호 등 본인 확인 수단)는 해당 정보를 수집하지 않아 지금은 불가. 수집 방식 결정 후 구현.
  async findAccount(email: string) {
    const user = await repo.findUserWithAccounts(email);
    if (!user || recentlyMailed(email)) return;
    const methods = [user.passwordHash && "이메일+비밀번호", ...user.accounts.map((a) => a.provider)].filter(Boolean);
    await sendMail({
      to: email,
      subject: "[Rehearview] 가입 정보 안내",
      text: `이 이메일(${email})로 가입된 계정이 있습니다.\n로그인 방식: ${methods.join(", ")}`,
    });
  },

  async accountInfo(userId: string) {
    const user = await repo.findAccountSummary(userId);
    if (!user) throw new AppError(404, "계정을 찾을 수 없습니다");
    return {
      email: user.email,
      createdAt: user.createdAt,
      hasPassword: !!user.passwordHash,
      providers: user.accounts.map((a) => a.provider),
      consentAt: user.consentAt,
      interviewCount: user._count.interviews,
    };
  },

  // 현재 버전의 이용약관·개인정보 처리에 동의했음을 기록한다 (소셜 가입자의 첫 동의, 문서 버전이 바뀐 뒤의 재동의)
  async recordConsent(userId: string) {
    await repo.recordConsent(userId);
  },

  // 회원 탈퇴: 계정과 연결된 모든 데이터를 즉시 삭제한다 (되돌릴 수 없음)
  async deleteAccount(userId: string) {
    await repo.deleteUser(userId);
  },

  // 세션 쿠키의 토큰으로 사용자를 확인한다. tokenVersion이 다르면(비밀번호 변경 등) 거부.
  async authenticate(token: unknown) {
    const session = readSession(token);
    const user = session && (await repo.findUserById(session.userId));
    if (!user || user.tokenVersion !== session.tokenVersion) throw new AppError(401, "로그인이 필요합니다");
    return user;
  },
};
