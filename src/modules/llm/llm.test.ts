import { test } from "node:test";
import assert from "node:assert/strict";
import { chat, providersFromEnv, type Provider } from "./llm.ts";

process.env.LLM_RETRY_DELAY_MS = "0"; // 재시도 대기 없이 빠르게

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

test("키가 있는 제공사만, 정해진 순서로", () => {
  const names = providersFromEnv({ GROQ_API_KEY: "x", GEMINI_API_KEY: "y" }).map((p) => p.name);
  assert.deepEqual(names, ["gemini", "groq"]);
});
