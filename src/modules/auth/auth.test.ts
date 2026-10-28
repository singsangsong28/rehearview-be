import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { app } from "../../app.ts";
import { prisma } from "../../lib/db.ts";
import { setMailer } from "../mail/mail.ts";

// 로컬 DB(.env의 DATABASE_URL)가 켜져 있어야 함. 반복 실행이 요청 제한에 걸리지 않도록 제한 해제
process.env.NODE_ENV = "test";
const server = app.listen(0);
const base = `http://localhost:${(server.address() as AddressInfo).port}`;
const email = `test-${Date.now()}@example.com`;
const password = "correct-horse-battery";
let verifyToken = "";
setMailer(async (m) => {
  verifyToken = m.text.match(/token=([0-9a-f]+)/)![1];
});

const post = (path: string, body: object, cookie = "") =>
  fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", cookie }, body: JSON.stringify(body) });

after(async () => {
  await prisma.user.deleteMany({ where: { email } });
  await prisma.$disconnect();
  server.close();
});

test("가입 → 미인증 로그인 차단 → 인증 → 로그인 → me → 비밀번호 틀림 거부", async () => {
  assert.equal((await post("/auth/signup", { email, password, agree: true })).status, 202);
  assert.ok(verifyToken);
  assert.equal((await post("/auth/login", { email, password })).status, 403);

  assert.equal((await post("/auth/verify", { token: verifyToken })).status, 200);
  assert.equal((await post("/auth/verify", { token: verifyToken })).status, 400); // 1회용

  const login = await post("/auth/login", { email, password });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.match(login.headers.get("set-cookie")!, /HttpOnly/i);

  const me = await fetch(base + "/auth/me", { headers: { cookie } });
  assert.equal((await me.json()).email, email);
  assert.equal((await fetch(base + "/auth/me")).status, 401);
  assert.equal((await post("/auth/login", { email, password: "wrong-password" })).status, 401);
});

test("tokenVersion이 바뀌면 기존 토큰 무효", async () => {
  const cookie = (await post("/auth/login", { email, password })).headers.get("set-cookie")!.split(";")[0];
  await prisma.user.update({ where: { email }, data: { tokenVersion: { increment: 1 } } });
  assert.equal((await fetch(base + "/auth/me", { headers: { cookie } })).status, 401);
});

test("비밀번호 찾기 → 재설정 → 기존 토큰 무효, 새 비밀번호로 로그인, 링크 재사용 불가", async () => {
  const oldCookie = (await post("/auth/login", { email, password })).headers.get("set-cookie")!.split(";")[0];
  let mails: string[] = [];
  setMailer(async (m) => void mails.push(m.text));

  // 가입 안 된 이메일도 같은 응답
  assert.equal((await post("/auth/forgot-password", { email: "nobody@example.com" })).status, 202);
  assert.equal(mails.length, 0);

  assert.equal((await post("/auth/forgot-password", { email })).status, 202);
  assert.equal(mails.length, 1);
  await post("/auth/forgot-password", { email }); // 1분 안 재요청은 메일 안 보냄
  assert.equal(mails.length, 1);

  const token = mails[0].match(/token=([0-9a-f]+)/)![1];
  assert.equal((await post("/auth/reset-password", { token, password: "short" })).status, 400);
  const newPassword = "new-correct-horse";
  assert.equal((await post("/auth/reset-password", { token, password: newPassword })).status, 200);
  assert.equal((await post("/auth/reset-password", { token, password: newPassword })).status, 400);

  assert.equal((await fetch(base + "/auth/me", { headers: { cookie: oldCookie } })).status, 401);
  assert.equal((await post("/auth/login", { email, password })).status, 401);
  assert.equal((await post("/auth/login", { email, password: newPassword })).status, 200);
});

test("아이디 찾기는 가입된 이메일에만 안내 메일", async () => {
  const mails: string[] = [];
  setMailer(async (m) => void mails.push(m.text));
  assert.equal((await post("/auth/find-account", { email: "nobody@example.com" })).status, 202);
  assert.equal(mails.length, 0);
  assert.equal((await post("/auth/find-account", { email })).status, 202);
  assert.match(mails[0], /이메일\+비밀번호/);
});

test("회원 탈퇴: 계정과 연결된 모든 데이터가 삭제되고 다시 로그인할 수 없다", async () => {
  const { hashPassword } = await import("./password.ts");
  const del = `del-${Date.now()}@example.com`;
  const user = await prisma.user.create({
    data: {
      email: del,
      emailVerified: new Date(),
      passwordHash: await hashPassword(password),
      accounts: { create: { provider: "github", providerAccountId: `gh-${Date.now()}` } },
      interviews: {
        create: {
          company: "삭제테스트",
          field: "영업",
          role: "법인영업",
          type: "COMPETENCY",
          intensity: "NORMAL",
          career: "EXPERIENCED",
          turns: { create: { order: 1, question: "질문", answer: "답변" } },
          report: { create: { scores: { a: 1 }, feedback: "총평" } },
        },
      },
      tokens: { create: { tokenHash: `h-${Date.now()}`, purpose: "VERIFY_EMAIL", expiresAt: new Date(Date.now() + 60_000) } },
    },
  });

  const login = await post("/auth/login", { email: del, password });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];

  // 계정 정보: 로그인 방식과 면접 기록 수
  const info = await (await fetch(base + "/auth/account", { headers: { cookie } })).json();
  assert.deepEqual({ ...info, createdAt: undefined, consentAt: undefined }, { email: del, createdAt: undefined, consentAt: undefined, hasPassword: true, providers: ["github"], interviewCount: 1 });
  assert.equal((await fetch(base + "/auth/account")).status, 401); // 로그인 필요

  // 삭제
  assert.equal((await fetch(base + "/auth/me", { method: "DELETE" })).status, 401); // 로그인 없이는 삭제 불가
  const res = await fetch(base + "/auth/me", { method: "DELETE", headers: { cookie } });
  assert.equal(res.status, 204);
  assert.match(res.headers.get("set-cookie") ?? "", /token=;/); // 쿠키도 지운다

  // 연결된 데이터가 모두 사라졌다
  assert.equal(await prisma.user.count({ where: { id: user.id } }), 0);
  assert.equal(await prisma.account.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.verificationToken.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.interview.count({ where: { userId: user.id } }), 0);
  assert.equal(await prisma.turn.count({ where: { interview: { userId: user.id } } }), 0);
  assert.equal(await prisma.report.count({ where: { interview: { userId: user.id } } }), 0);

  // 이전 로그인 쿠키와 비밀번호 모두 더는 통하지 않는다
  assert.equal((await fetch(base + "/auth/me", { headers: { cookie } })).status, 401);
  assert.equal((await post("/auth/login", { email: del, password })).status, 401);
});

test("가입에는 동의가 필요하고, 동의 시각과 문서 버전이 기록된다", async () => {
  const { CONSENT_VERSION, hasConsented } = await import("./consent.ts");
  const mail = `consent-${Date.now()}@example.com`;
  assert.equal((await post("/auth/signup", { email: mail, password })).status, 400); // 동의 값 없음
  assert.equal((await post("/auth/signup", { email: mail, password, agree: false })).status, 400);
  assert.equal(await prisma.user.count({ where: { email: mail } }), 0); // 동의 없이는 계정이 만들어지지 않는다

  assert.equal((await post("/auth/signup", { email: mail, password, agree: true })).status, 202);
  const user = await prisma.user.findUniqueOrThrow({ where: { email: mail } });
  assert.equal(user.consentVersion, CONSENT_VERSION);
  assert.ok(user.consentAt && Date.now() - user.consentAt.getTime() < 60_000);
  assert.equal(hasConsented(user), true);
  await prisma.user.delete({ where: { id: user.id } });
});

test("소셜 가입자처럼 동의 전인 사용자: me는 consented=false, 동의하면 true, 문서 버전이 바뀌면 다시 false", async () => {
  const { CONSENT_VERSION } = await import("./consent.ts");
  const { hashPassword } = await import("./password.ts");
  const mail = `noconsent-${Date.now()}@example.com`;
  const user = await prisma.user.create({ data: { email: mail, emailVerified: new Date(), passwordHash: await hashPassword(password) } });
  try {
    const cookie = (await post("/auth/login", { email: mail, password })).headers.get("set-cookie")!.split(";")[0];
    const me = async () => (await (await fetch(base + "/auth/me", { headers: { cookie } })).json()).consented;
    const api = (path: string) => fetch(base + path, { headers: { cookie } });

    assert.equal(await me(), false);
    const blocked = await api("/interviews");
    assert.equal(blocked.status, 403); // 동의 전에는 서비스 기능(API)을 쓸 수 없다
    assert.equal((await blocked.json()).code, "consent_required");

    assert.equal((await post("/auth/consent", { agree: false }, cookie)).status, 400);
    assert.equal((await post("/auth/consent", {}, cookie)).status, 400);
    assert.equal((await post("/auth/consent", { agree: true })).status, 401); // 로그인 필요
    assert.equal((await post("/auth/consent", { agree: true }, cookie)).status, 200);
    assert.equal(await me(), true);
    assert.equal((await api("/interviews")).status, 200);

    // 문서 버전이 바뀐 것처럼 과거 버전 동의로 되돌리면 다시 막힌다
    await prisma.user.update({ where: { id: user.id }, data: { consentVersion: `${CONSENT_VERSION}-old` } });
    assert.equal(await me(), false);
    assert.equal((await api("/interviews")).status, 403);
    // 동의 없이도 계정 삭제는 할 수 있다
    assert.equal((await fetch(base + "/auth/me", { method: "DELETE", headers: { cookie } })).status, 204);
  } finally {
    await prisma.user.deleteMany({ where: { id: user.id } });
  }
});
