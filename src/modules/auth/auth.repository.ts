import type { TokenPurpose } from "../../../generated/prisma/client.ts";
import { prisma } from "../../lib/db.ts";
import { CONSENT_VERSION } from "./consent.ts";

// 인증 모듈의 DB 접근만 담당한다. 판단·검증은 service에서.
export const authRepository = {
  findUserById: (id: string) => prisma.user.findUnique({ where: { id } }),
  findUserByEmail: (email: string) => prisma.user.findUnique({ where: { email } }),
  // 계정 화면용: 연결된 소셜 로그인과 면접 기록 수
  findAccountSummary: (id: string) =>
    prisma.user.findUnique({ where: { id }, include: { accounts: { select: { provider: true } }, _count: { select: { interviews: true } } } }),
  // 연결된 소셜 계정, 인증 토큰, 면접(질문·답변·리포트)까지 DB의 연쇄 삭제(onDelete: Cascade)로 함께 지워진다
  deleteUser: (id: string) => prisma.user.delete({ where: { id } }),
  findUserWithAccounts: (email: string) => prisma.user.findUnique({ where: { email }, include: { accounts: true } }),

  // 이메일 가입은 가입 화면에서 동의를 받고 오므로 동의 기록과 함께 만든다
  createLocalUser: (email: string, passwordHash: string) =>
    prisma.user.create({ data: { email, passwordHash, consentVersion: CONSENT_VERSION, consentAt: new Date() } }),
  recordConsent: (id: string) => prisma.user.update({ where: { id }, data: { consentVersion: CONSENT_VERSION, consentAt: new Date() } }),

  // 소셜 가입. 이메일은 제공사가 인증을 보증한 경우에만 넘기고, 그때만 emailVerified를 채운다.
  createSocialUser: (email: string | null, provider: string, providerAccountId: string) =>
    prisma.user.create({
      data: {
        email,
        emailVerified: email ? new Date() : null,
        accounts: { create: { provider, providerAccountId } },
      },
    }),

  findAccount: (provider: string, providerAccountId: string) =>
    prisma.account.findUnique({
      where: { provider_providerAccountId: { provider, providerAccountId } },
      include: { user: true },
    }),
  linkAccount: (userId: string, provider: string, providerAccountId: string) =>
    prisma.account.create({ data: { userId, provider, providerAccountId } }),

  findTokenByHash: (tokenHash: string) => prisma.verificationToken.findUnique({ where: { tokenHash } }),
  createToken: (userId: string, purpose: TokenPurpose, tokenHash: string, expiresAt: Date) =>
    prisma.verificationToken.create({ data: { userId, purpose, tokenHash, expiresAt } }),
  // 만료가 minExpiresAt보다 늦은 토큰(= 최근에 만든 토큰)이 있는지
  hasTokenExpiringAfter: async (userId: string, purpose: TokenPurpose, minExpiresAt: Date) =>
    !!(await prisma.verificationToken.findFirst({ where: { userId, purpose, expiresAt: { gt: minExpiresAt } } })),

  completeEmailVerification: (tokenId: string, userId: string) =>
    prisma.$transaction([
      prisma.verificationToken.update({ where: { id: tokenId }, data: { usedAt: new Date() } }),
      prisma.user.update({ where: { id: userId }, data: { emailVerified: new Date() } }),
    ]),

  // 이 사용자의 미사용 재설정 토큰을 모두 소진하고, 비밀번호 변경과 함께 tokenVersion을 올려 기존 로그인을 무효화
  completePasswordReset: (userId: string, passwordHash: string) =>
    prisma.$transaction([
      prisma.verificationToken.updateMany({
        where: { userId, purpose: "RESET_PASSWORD", usedAt: null },
        data: { usedAt: new Date() },
      }),
      prisma.user.update({ where: { id: userId }, data: { passwordHash, tokenVersion: { increment: 1 } } }),
    ]),
};
