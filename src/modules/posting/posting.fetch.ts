import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { BlockList, isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { AppError } from "../../lib/errors.ts";
import { extractPostingText } from "./posting.html.ts";

// 사용자가 준 주소를 서버가 대신 읽어 온다. 서버 내부망·클라우드 메타데이터를 읽게 만드는 공격(SSRF)을 막는 것이 핵심이다.
// 1) http/https만, 표준 포트만  2) 연결 시점에 실제 접속할 IP를 검사(DNS를 바꿔치는 공격 방지)  3) 리다이렉트마다 다시 검사
// 4) 시간·크기 제한  5) 글(HTML/텍스트)만 허용

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16], ["172.16.0.0", 12],
  ["192.0.0.0", 24], ["192.0.2.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blocked.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8], ["2001:db8::", 32]] as const) blocked.addSubnet(net, prefix, "ipv6");

export function isBlockedAddress(address: string): boolean {
  const mapped = address.toLowerCase().match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); // IPv4를 IPv6로 감싼 주소
  const ip = mapped ? mapped[1] : address;
  const family = isIP(ip);
  if (family === 0) return true; // IP가 아니면 막는다
  return blocked.check(ip, family === 4 ? "ipv4" : "ipv6");
}

// 접속 직전에 주소를 풀어 보고 막힌 주소는 제외한다
const agent = new Agent({
  connect: {
    lookup(
      hostname: string,
      options: LookupOptions,
      callback: (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void,
    ) {
      dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err, "");
        const allowed = addresses.filter((a) => !isBlockedAddress(a.address));
        if (allowed.length === 0) return callback(new Error("blocked address") as NodeJS.ErrnoException, "");
        if (options.all) return callback(null, allowed);
        callback(null, allowed[0].address, allowed[0].family);
      });
    },
  },
});

export function validatePostingUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError(400, "공고 주소가 올바르지 않습니다");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AppError(400, "http 또는 https 주소만 사용할 수 있습니다");
  if (url.username || url.password) throw new AppError(400, "주소에 계정 정보를 넣을 수 없습니다");
  if (url.port && url.port !== "80" && url.port !== "443") throw new AppError(400, "이 주소의 포트는 사용할 수 없습니다");
  if (isIP(url.hostname.replace(/^\[|\]$/g, "")) && isBlockedAddress(url.hostname.replace(/^\[|\]$/g, ""))) throw new AppError(400, "이 주소는 사용할 수 없습니다");
  return url;
}

const FAIL_MESSAGE = "공고를 불러오지 못했어요. 사이트가 접근을 막았을 수 있으니 공고 내용을 직접 붙여 넣어 주세요";

async function readLimited(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_BYTES) {
      await reader.cancel();
      break; // 너무 큰 페이지는 앞부분만 쓴다
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// 공고 주소의 글을 가져온다. 실패하면 이유를 숨기고 일반 안내만 준다(내부 정보 노출 방지).
export async function fetchPostingText(rawUrl: string): Promise<string> {
  let url = validatePostingUrl(rawUrl);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const res = await undiciFetch(url, {
        dispatcher: agent,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "Mozilla/5.0 (compatible; RehearviewBot/1.0)", Accept: "text/html,text/plain;q=0.9,*/*;q=0.1", "Accept-Language": "ko,en;q=0.8" },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        await res.body?.cancel();
        url = validatePostingUrl(new URL(res.headers.get("location")!, url).toString()); // 리다이렉트 대상도 다시 검사
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = res.headers.get("content-type") ?? "";
      if (!/text\/html|text\/plain|application\/xhtml/i.test(type)) throw new Error("not text");
      const raw = await readLimited(res.body as ReadableStream<Uint8Array> | null);
      const text = /html/i.test(type) ? extractPostingText(raw) : raw.slice(0, 20_000);
      if (text.trim().length < 50) throw new Error("empty");
      return text;
    }
    throw new Error("too many redirects");
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError(422, FAIL_MESSAGE);
  }
}
