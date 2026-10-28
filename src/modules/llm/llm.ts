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

// 제공사를 순서대로 시도하고, 실패(네트워크, 한도 초과, 서버 오류 등)하면 다음으로 넘어간다.
// 로그에는 서류·답변이 들어갈 수 있는 응답 본문을 남기지 않고 상태 코드만 남긴다.
export async function chat(
  messages: Message[],
  providers: Provider[] = providersFromEnv(),
  fetchFn: typeof fetch = fetch,
): Promise<{ provider: string; text: string }> {
  if (providers.length === 0) throw new Error("사용 가능한 LLM 제공사가 없습니다 (API 키 확인)");
  const failures: string[] = [];
  for (const [i, p] of providers.entries()) {
    // 넘어갈 다음 제공사가 없는 마지막 제공사는, 일시적인 과부하(429, 5xx)에 한해 짧게 기다렸다가 한 번 더 시도한다
    const attempts = i === providers.length - 1 ? 2 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const res = await fetchFn(`${p.baseUrl}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${p.apiKey}` },
          body: JSON.stringify({ model: p.model, messages }),
          // 음성 면접은 오래 기다리게 할 수 없어서 짧게 끊고 다음 제공사로 넘어간다
          signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? 20_000)),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = (await res.json())?.choices?.[0]?.message?.content;
        if (typeof text !== "string" || !text.trim()) throw new Error("빈 응답");
        return { provider: p.name, text };
      } catch (e) {
        const message = e instanceof Error ? e.message : "오류";
        failures.push(`${p.name}: ${message}`);
        console.warn(`[llm] ${failures.at(-1)}`);
        const transient = /^HTTP (429|5\d\d)$/.test(message); // 시간 초과(20초)는 다시 기다리게 하지 않는다
        if (attempt < attempts && transient) await new Promise((r) => setTimeout(r, Number(process.env.LLM_RETRY_DELAY_MS ?? 1_200)));
        else break;
      }
    }
  }
  throw new Error(`모든 LLM 제공사 실패 (${failures.join(", ")})`);
}
