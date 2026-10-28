import { test } from "node:test";
import assert from "node:assert/strict";
import { chat, providersFromEnv, type Provider } from "./llm.ts";

process.env.LLM_RETRY_DELAY_MS = "0"; // 재시도 대기 없이 빠르게
process.env.LLM_MAX_WAIT_MS = "0"; // 기본은 기다렸다 다시 시도하지 않는다 (아래 대기 테스트에서만 늘린다)
process.env.LLM_WAIT_STEP_MS = "0";

const mk = (name: string): Provider => ({ name, baseUrl: `http://${name}`, apiKey: "k", model: "m" });
const ok = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }));
const msgs = [{ role: "user" as const, content: "hi" }];

test("첫 제공사가 429면 재시도 없이 바로 다음 제공사로 폴백", async () => {
  const hits: string[] = [];
  const f = async (url: string | URL | Request) => {
    hits.push(String(url));
    return String(url).startsWith("http://a") ? new Response("", { status: 429 }) : ok("from b");
  };
  assert.deepEqual(await chat(msgs, [mk("a"), mk("b")], f as typeof fetch), { provider: "b", text: "from b" });
  assert.equal(hits.filter((u) => u.startsWith("http://a")).length, 1);
});

test("마지막 제공사가 일시적으로 바쁘면(503) 한 번 더 시도해서 성공할 수 있다", async () => {
  let calls = 0;
  const f = async () => (++calls === 1 ? new Response("", { status: 503 }) : ok("두 번째에 성공"));
  assert.deepEqual(await chat(msgs, [mk("only")], f as typeof fetch), { provider: "only", text: "두 번째에 성공" });
  assert.equal(calls, 2);
});

test("인증 오류(401) 같은 영구 오류는 재시도하지 않는다", async () => {
  let calls = 0;
  const f = async () => (++calls, new Response("", { status: 401 }));
  await assert.rejects(chat(msgs, [mk("only")], f as typeof fetch), /모든 LLM 제공사 실패/);
  assert.equal(calls, 1);
});

test("모두 실패하면 에러", async () => {
  const f = async () => new Response("", { status: 503 });
  await assert.rejects(chat(msgs, [mk("a"), mk("b")], f as typeof fetch), /모든 LLM 제공사 실패/);
});

test("모든 제공사가 한도 초과(429)면 에러 대신 기다렸다 다시 시도해서 성공한다", async () => {
  process.env.LLM_MAX_WAIT_MS = "2000";
  try {
    // 첫 훑기: a(429), b(429), b 재시도(429) = 3번 실패. 기다린 뒤 두 번째 훑기의 a가 성공한다.
    let calls = 0;
    const f = async () => (++calls <= 3 ? new Response("", { status: 429 }) : ok("기다린 뒤 성공"));
    assert.deepEqual(await chat(msgs, [mk("a"), mk("b")], f as typeof fetch), { provider: "a", text: "기다린 뒤 성공" });
    assert.equal(calls, 4);
  } finally {
    process.env.LLM_MAX_WAIT_MS = "0";
  }
});

test("기다려도 소용없는 실패(인증 오류)는 기다리지 않고 바로 에러", async () => {
  process.env.LLM_MAX_WAIT_MS = "2000";
  try {
    let calls = 0;
    const f = async () => (++calls, new Response("", { status: 401 }));
    await assert.rejects(chat(msgs, [mk("a"), mk("b")], f as typeof fetch), /모든 LLM 제공사 실패/);
    assert.equal(calls, 2);
  } finally {
    process.env.LLM_MAX_WAIT_MS = "0";
  }
});

test("대기 한도까지 계속 바쁘면 결국 에러", async () => {
  process.env.LLM_MAX_WAIT_MS = "60";
  process.env.LLM_WAIT_STEP_MS = "10";
  try {
    const f = async () => new Response("", { status: 429 });
    await assert.rejects(chat(msgs, [mk("a")], f as typeof fetch), /모든 LLM 제공사 실패/);
  } finally {
    process.env.LLM_MAX_WAIT_MS = "0";
    process.env.LLM_WAIT_STEP_MS = "0";
  }
});

test("키가 있는 제공사만, 정해진 순서로", () => {
  const names = providersFromEnv({ GROQ_API_KEY: "x", GEMINI_API_KEY: "y" }).map((p) => p.name);
  assert.deepEqual(names, ["gemini", "groq"]);
});
