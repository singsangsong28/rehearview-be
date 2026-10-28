export type Message = { role: "system" | "user" | "assistant"; content: string };
export type Provider = { name: string; baseUrl: string; apiKey: string; model: string };

type Env = Record<string, string | undefined>;

// 기본 → 폴백 순서. 키가 없는 제공사는 건너뜀.
export function providersFromEnv(env: Env = process.env): Provider[] {
  const all: Array<Provider | null> = [
    env.GEMINI_API_KEY
      ? {
          name: "gemini",
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
          apiKey: env.GEMINI_API_KEY,
          // 2026-10-28 실측: 3.6-flash 2.7초, 3.5-flash-lite 1.2초, 3.8-flash는 응답 없음(과부하)이라 3.6을 기본으로
          model: env.GEMINI_MODEL ?? "gemini-3.6-flash",
        }
      : null,
    env.GROQ_API_KEY
      ? {
          name: "groq",
          baseUrl: "https://api.groq.com/openai/v1",
          apiKey: env.GROQ_API_KEY,
          model: env.GROQ_MODEL ?? "openai/gpt-oss-120b",
        }
      : null,
    // 엔드포인트 경로는 아직 실제 호출로 확인하지 않음
    env.CF_API_TOKEN && env.CF_ACCOUNT_ID
      ? {
          name: "cloudflare",
          baseUrl: `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/v1`,
          apiKey: env.CF_API_TOKEN,
          model: env.CF_MODEL ?? "@cf/openai/gpt-oss-120b",
        }
      : null,
  ];
  return all.filter((p): p is Provider => p !== null);
}

// Node 가 타입을 지우기만 하고 실행하므로 생성자 매개변수 속성(readonly status)은 쓸 수 없다
class HttpError extends Error {
  status: number;
  retryAfterMs?: number;
  constructor(status: number, retryAfterMs?: number) {
    super(`HTTP ${status}`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// 잠시 뒤 다시 하면 될 수 있는 실패: 한도 초과(429), 서버 오류(5xx), 시간 초과
const isBusy = (e: unknown) => (e instanceof HttpError && (e.status === 429 || e.status >= 500)) || (e instanceof Error && e.name === "TimeoutError");

// 제공사를 순서대로 한 번 훑는다. 실패(네트워크, 한도 초과, 서버 오류 등)하면 다음 제공사로 넘어간다.
// 로그에는 서류·답변이 들어갈 수 있는 응답 본문을 남기지 않고 상태 코드만 남긴다.
async function tryProviders(messages: Message[], providers: Provider[], fetchFn: typeof fetch, deadline: number) {
  const failures: string[] = [];
  let busy = false;
  let retryAfterMs = 0;
  for (const [i, p] of providers.entries()) {
    // 넘어갈 다음 제공사가 없는 마지막 제공사는, 일시적인 과부하(429, 5xx)에 한해 짧게 기다렸다가 한 번 더 시도한다
    const attempts = i === providers.length - 1 ? 2 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await fetchFn(`${p.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` },
          body: JSON.stringify({ model: p.model, messages }),
          // 한 번의 응답을 너무 오래 기다리지 않고, 전체 대기 한도(deadline)도 넘지 않게 끊는다
          signal: AbortSignal.timeout(Math.max(1, Math.min(Number(process.env.LLM_TIMEOUT_MS ?? 20_000), deadline - Date.now()))),
        });
        if (!res.ok) {
          const seconds = Number(res.headers.get("retry-after"));
          throw new HttpError(res.status, Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 30) * 1000 : undefined);
        }
        const text = (await res.json())?.choices?.[0]?.message?.content;
        if (typeof text !== "string" || !text.trim()) throw new Error("빈 응답");
        return { ok: true as const, provider: p.name, text };
      } catch (e) {
        const message = e instanceof Error ? e.message : "오류";
        failures.push(`${p.name}: ${message}`);
        console.warn(`[llm] ${failures.at(-1)}`);
        if (isBusy(e)) {
          busy = true;
          if (e instanceof HttpError && e.retryAfterMs) retryAfterMs = Math.max(retryAfterMs, e.retryAfterMs);
        }
        const transient = /^HTTP (429|5\d\d)$/.test(message); // 시간 초과는 같은 제공사에 바로 다시 보내지 않는다
        if (attempt < attempts && transient) await sleep(Number(process.env.LLM_RETRY_DELAY_MS ?? 1_200));
        else break;
      }
    }
  }
  return { ok: false as const, failures, busy, retryAfterMs };
}

// 모든 제공사가 바쁠 때(무료 한도의 분당 제한 등)는 에러를 내지 않고 LLM_MAX_WAIT_MS 안에서 기다렸다 다시 시도한다.
// 인증 오류처럼 기다려도 나아지지 않는 실패는 바로 에러로 돌려준다.
export async function chat(
  messages: Message[],
  providers: Provider[] = providersFromEnv(),
  fetchFn: typeof fetch = fetch,
): Promise<{ provider: string; text: string }> {
  if (providers.length === 0) throw new Error("사용 가능한 LLM 제공사가 없습니다 (API 키 확인)");
  const deadline = Date.now() + Number(process.env.LLM_MAX_WAIT_MS ?? 90_000);
  for (let round = 1; ; round++) {
    const pass = await tryProviders(messages, providers, fetchFn, deadline);
    if (pass.ok) return { provider: pass.provider, text: pass.text };
    const wait = Math.max(pass.retryAfterMs, Number(process.env.LLM_WAIT_STEP_MS ?? 5_000));
    if (!pass.busy || Date.now() + wait >= deadline) throw new Error(`모든 LLM 제공사 실패 (${pass.failures.join(", ")})`);
    console.warn(`[llm] 제공사가 모두 바빠서 ${Math.round(wait / 1000)}초 뒤 다시 시도 (${round}번째)`);
    await sleep(wait);
  }
}
