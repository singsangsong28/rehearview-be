import { test, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../lib/db.ts";
import { loginWithProfile } from "./oauth.service.ts";

const stamp = Date.now();
const e = (n: string) => `oauth-${n}-${stamp}@example.com`;
const ids = [`g-${stamp}`, `h-${stamp}`, `k-${stamp}`, `n-${stamp}`, `x-${stamp}`];

after(async () => {
  await prisma.user.deleteMany({
    where: {
      OR: [
        { email: { in: [e("new"), e("local"), e("unver")] } },
        { accounts: { some: { providerAccountId: { in: ids } } } },
      ],
    },
  });
  await prisma.$disconnect();
});

test("새 사용자 가입 후 같은 프로필로 다시 로그인하면 같은 사용자", async () => {
  const p = { id: ids[0], email: e("new"), emailVerified: true };
  const first = await loginWithProfile("google", p);
  assert.ok(first.user?.emailVerified);
  const again = await loginWithProfile("google", p);
  assert.equal(again.user?.id, first.user?.id);
});

test("이메일 인증된 로컬 계정은 인증된 소셜 이메일과 자동 연결", async () => {
  const local = await prisma.user.create({ data: { email: e("local"), emailVerified: new Date(), passwordHash: "x" } });
  const r = await loginWithProfile("github", { id: ids[1], email: e("local").toUpperCase(), emailVerified: true });
  assert.equal(r.user?.id, local.id);
});

test("미인증 로컬 계정이나 미인증 소셜 이메일은 연결하지 않음", async () => {
  await prisma.user.create({ data: { email: e("unver"), passwordHash: "x" } });
  const blocked = await loginWithProfile("kakao", { id: ids[2], email: e("unver"), emailVerified: true });
  assert.deepEqual(blocked, { error: "email_unverified" });

  // 제공사가 이메일 인증을 보증하지 않으면 이메일 없이 가입
  const naver = await loginWithProfile("naver", { id: ids[3], email: e("local"), emailVerified: false });
  assert.ok(naver.user && naver.user.email === null && naver.user.emailVerified === null);
});

test("이메일을 못 받아도 가입", async () => {
  const r = await loginWithProfile("kakao", { id: ids[4], email: null, emailVerified: false });
  assert.ok(r.user && r.user.email === null);
});
