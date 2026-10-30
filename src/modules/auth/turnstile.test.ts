import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { verifyTurnstile } from "./turnstile.ts";

// Cloudflare 호출은 가짜로 대체한다.
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.TURNSTILE_SECRET_KEY;
});

const stubFetch = (body: object | "error") => {
  let calls = 0;
  globalThis.fetch = (async () => {
    calls++;
    if (body === "error") throw new Error("network");
    return new Response(JSON.stringify(body));
  }) as typeof fetch;
  return () => calls;
};

// 통과하면 true, 막히면 던져진 에러의 상태 코드를 돌려준다.
const run = async (token?: unknown) => {
  let passed = false;
  try {
    await verifyTurnstile({ body: { turnstileToken: token } } as Request, {} as Response, (() => void (passed = true)) as NextFunction);
  } catch (e) {
    return (e as { status: number }).status;
  }
  return passed;
};

test("비밀키가 없으면 검증 없이 통과", async () => {
  const calls = stubFetch({ success: false });
  assert.equal(await run(), true);
  assert.equal(calls(), 0);
});

test("토큰이 없거나 비어 있으면 Cloudflare를 부르지 않고 400", async () => {
  process.env.TURNSTILE_SECRET_KEY = "secret";
  const calls = stubFetch({ success: true });
  assert.equal(await run(), 400);
  assert.equal(await run(""), 400);
  assert.equal(calls(), 0);
});

test("확인 성공이면 통과, 실패 응답이나 호출 오류면 400", async () => {
  process.env.TURNSTILE_SECRET_KEY = "secret";
  stubFetch({ success: true });
  assert.equal(await run("t"), true);
  stubFetch({ success: false });
  assert.equal(await run("t"), 400);
  stubFetch("error");
  assert.equal(await run("t"), 400);
});
