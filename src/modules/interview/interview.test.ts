import { test, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { app } from "../../app.ts";
import { prisma } from "../../lib/db.ts";
import { CONSENT_VERSION } from "../auth/consent.ts";
import { hashPassword } from "../auth/password.ts";
import { llm, web } from "./interview.service.ts";

// 로컬 DB(.env의 DATABASE_URL)가 켜져 있어야 함. LLM은 가짜로 대체한다.
process.env.NODE_ENV = "test";
process.env.INTERVIEW_DAILY_LIMIT = "2";
const server = app.listen(0);
const base = `http://localhost:${(server.address() as AddressInfo).port}`;
const stamp = Date.now();
const password = "correct-horse-battery";
const emails = [0, 1, 2].map((i) => `iv-${i}-${stamp}@example.com`);

const REPORT = {
  scores: { "직무 이해도": 4, "근거와 구체성": 3, "논리 구조": 4, 전달력: 5, "태도와 진정성": 4, "질문 의도 파악": 3 },
  feedback: "구체적인 사례가 더 필요합니다.",
};
let failLlm = false;
const sent: string[] = [];
llm.chat = async (messages) => {
  sent.push(messages.map((m) => m.content).join("\n"));
  if (failLlm) throw new Error("fail");
  const isReport = messages[0].content.includes("평가자");
  const isAnalyze = messages[0].content.includes("서류 분석가");
  return { provider: "fake", text: isReport ? JSON.stringify(REPORT) : isAnalyze ? "1. 한 줄 요약: 법인영업 3년 경력\n2. 경력·경험: 신규 거래처 발굴" : `면접관: "질문 ${sent.length}"` };
};

const call = (path: string, cookie: string, method = "GET", body?: object) =>
  fetch(base + path, { method, headers: { "Content-Type": "application/json", cookie }, body: body && JSON.stringify(body) });

async function loginAs(email: string) {
  await prisma.user.create({ data: { email, emailVerified: new Date(), passwordHash: await hashPassword(password), consentVersion: CONSENT_VERSION, consentAt: new Date() } });
  const res = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.headers.get("set-cookie")!.split(";")[0];
}

after(async () => {
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await prisma.$disconnect();
  server.close();
});

const setup = { company: "테스트社", field: "영업", role: "법인영업", type: "COMPETENCY", intensity: "MILD", career: "EXPERIENCED" };
const resume = "홍길동 010-1234-5678 hong@example.com 법인영업 3년";
const cookies = Promise.all(emails.map(loginAs));

test("면접 전체 흐름: 생성 → 6번 답변(본 질문·꼬리질문 번갈아) → 종료 → 리포트", async () => {
  const [a] = await cookies;
  const created = await call("/interviews", a, "POST", setup);
  assert.equal(created.status, 201);
  const { id, turn } = await created.json();
  assert.equal(turn.order, 1);

  const kinds: string[] = [];
  let done = false;
  for (let i = 1; i <= 6 && !done; i++) {
    const r = await (await call(`/interviews/${id}/answer`, a, "POST", { answer: `답변 ${i}`, resume })).json();
    done = r.done;
    if (!done) kinds.push(r.turn.kind);
  }
  assert.ok(done);
  assert.deepEqual(kinds, ["FOLLOW_UP", "MAIN", "FOLLOW_UP", "MAIN", "FOLLOW_UP"]);
  // 모델에 보낸 내용에는 서류의 전화번호·이메일이 없다
  assert.ok(sent.length > 0 && sent.every((s) => !s.includes("010-1234-5678") && !s.includes("hong@example.com")));
  // 더 이상 답할 질문이 없다
  assert.equal((await call(`/interviews/${id}/answer`, a, "POST", { answer: "추가", resume })).status, 409);

  const report = await call(`/interviews/${id}/report`, a, "POST", { resume });
  assert.equal(report.status, 200);
  assert.equal((await report.json()).feedback, REPORT.feedback);

  const detail = await (await call(`/interviews/${id}`, a)).json();
  assert.equal(detail.status, "COMPLETED");
  assert.equal(detail.turns.length, 6);
  assert.ok(!JSON.stringify(detail).includes("010-1234-5678")); // 서류 원문은 저장되지 않는다
});

test("LLM 실패 시 아무것도 저장하지 않고 503, 이후 같은 요청을 다시 보내면 성공", async () => {
  const [a] = await cookies;
  const { id } = await (await call("/interviews", a, "POST", setup)).json();

  failLlm = true;
  assert.equal((await call(`/interviews/${id}/answer`, a, "POST", { answer: "첫 답변", resume })).status, 503);
  failLlm = false;
  const afterFail = await (await call(`/interviews/${id}`, a)).json();
  assert.equal(afterFail.turns.length, 1);
  assert.equal(afterFail.turns[0].answer, null);

  assert.equal((await call(`/interviews/${id}/answer`, a, "POST", { answer: "첫 답변", resume })).status, 200);
});

test("로그인 필요, 남의 면접은 404, 일일 한도를 넘으면 429, 입력 검증은 400", async () => {
  const [, b, c] = await cookies;
  assert.equal((await call("/interviews", "")).status, 401);

  const { id } = await (await call("/interviews", b, "POST", setup)).json();
  assert.equal((await call(`/interviews/${id}`, c)).status, 404);
  assert.equal((await call(`/interviews/${id}`, c, "DELETE")).status, 404);

  assert.equal((await call("/interviews", b, "POST", setup)).status, 201);
  assert.equal((await call("/interviews", b, "POST", setup)).status, 429);

  assert.equal((await call("/interviews", c, "POST", { ...setup, type: "NOPE" })).status, 400);
  assert.equal((await call(`/interviews/${id}/answer`, b, "POST", { answer: "", resume })).status, 400);
});

test("서류·공고 분석: 브리프를 돌려주고, 개인정보는 가려서 보내며, 공고가 있으면 함께 보낸다", async () => {
  const [a] = await cookies;
  const before = sent.length;
  const res = await call("/interviews/analyze", a, "POST", {
    resume: "[파일: 이력서.pdf]\n홍길동 010-1234-5678 법인영업 3년\n[파일: 자소서.docx]\nhong@example.com 신규 거래처 발굴",
    posting: "법인영업 채용. 자격 요건: 경력 3년 이상. 문의 recruit@sample.com",
    company: "샘플물산",
    role: "법인영업",
    career: "EXPERIENCED",
  });
  assert.equal(res.status, 200);
  assert.match((await res.json()).profile, /한 줄 요약/);
  const prompt = sent[sent.length - 1];
  assert.equal(sent.length, before + 1);
  assert.ok(prompt.includes("[지원 공고]") && prompt.includes("자격 요건: 경력 3년 이상") && prompt.includes("[파일: 자소서.docx]"));
  assert.ok(!prompt.includes("010-1234-5678") && !prompt.includes("hong@example.com") && !prompt.includes("recruit@sample.com")); // 개인정보는 가린다
  assert.match(prompt, /공고 요건 정리/); // 공고가 있을 때만 붙는 항목

  // 공고 없이 분석하면 공고 항목이 빠진다
  await call("/interviews/analyze", a, "POST", { resume: "서류 내용" });
  assert.ok(!sent[sent.length - 1].includes("[지원 공고]") && !sent[sent.length - 1].includes("공고 요건 정리"));
});

test("서류 분석 입력 검증, 로그인 필요, 하루 횟수 제한", async () => {
  const [, , c] = await cookies;
  assert.equal((await call("/interviews/analyze", "", "POST", { resume: "x" })).status, 401);
  assert.equal((await call("/interviews/analyze", c, "POST", { resume: "" })).status, 400);
  assert.equal((await call("/interviews/analyze", c, "POST", { resume: "가".repeat(100_001) })).status, 400);
  assert.equal((await call("/interviews/analyze", c, "POST", { resume: "x", career: "NOPE" })).status, 400);

  process.env.ANALYSIS_DAILY_LIMIT = "2";
  assert.equal((await call("/interviews/analyze", c, "POST", { resume: "하나" })).status, 200);
  assert.equal((await call("/interviews/analyze", c, "POST", { resume: "둘" })).status, 200);
  assert.equal((await call("/interviews/analyze", c, "POST", { resume: "셋" })).status, 429);
  delete process.env.ANALYSIS_DAILY_LIMIT;
});

test("공고 주소 불러오기: 본문 반환, 잘못된 주소 400, 실패 422, 하루 횟수 제한 429", async () => {
  const [a, b] = await cookies;
  const original = web.fetchPostingText;
  web.fetchPostingText = async (url) => `공고 본문 ${url}`;
  try {
    const ok = await call("/interviews/posting", a, "POST", { url: "https://example.com/jobs/1" });
    assert.equal(ok.status, 200);
    assert.match((await ok.json()).text, /공고 본문 https:\/\/example\.com\/jobs\/1/);
    assert.equal((await call("/interviews/posting", a, "POST", { url: "not a url" })).status, 400);
    assert.equal((await call("/interviews/posting", "", "POST", { url: "https://example.com" })).status, 401);

    // 실제 접속 함수는 내부 주소를 거부한다 (posting.fetch.ts 의 안전 검사)
    web.fetchPostingText = original;
    assert.equal((await call("/interviews/posting", a, "POST", { url: "http://169.254.169.254/latest/meta-data/" })).status, 400);
    assert.equal((await call("/interviews/posting", a, "POST", { url: "file:///etc/passwd" })).status, 400);

    web.fetchPostingText = async () => "본문";
    process.env.POSTING_FETCH_DAILY_LIMIT = "1";
    assert.equal((await call("/interviews/posting", b, "POST", { url: "https://example.com/a" })).status, 200);
    assert.equal((await call("/interviews/posting", b, "POST", { url: "https://example.com/b" })).status, 429);
  } finally {
    web.fetchPostingText = original;
    delete process.env.POSTING_FETCH_DAILY_LIMIT;
  }
});
