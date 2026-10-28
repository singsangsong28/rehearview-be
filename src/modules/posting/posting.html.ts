// 채용 공고 HTML에서 읽을 수 있는 글자를 뽑는다.
// 자바스크립트로 그려지는 공고 사이트가 많아서, 페이지에 심어 둔 구조화 데이터(JSON-LD JobPosting)를 먼저 찾는다.
const MAX_TEXT_CHARS = 20_000;

const ENTITIES: Record<string, string> = { "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'" };
const decode = (s: string) =>
  s
    .replace(/&(nbsp|amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));

export function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article)\b[^>]*>/gi, "\n")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<[^>]+>/g, " "),
  )
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

type Json = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.map(str).filter(Boolean).join(", ") : v && typeof v === "object" ? str((v as Json).name ?? (v as Json).value) : "");

// schema.org JobPosting 항목을 사람이 읽을 글로 바꾼다
function jobPostingText(job: Json): string {
  const lines = [
    str(job.title) && `공고 제목: ${str(job.title)}`,
    str((job.hiringOrganization as Json | undefined)?.name) && `회사: ${str((job.hiringOrganization as Json).name)}`,
    str(job.employmentType) && `고용 형태: ${str(job.employmentType)}`,
    str(job.experienceRequirements) && `경력 조건: ${str(job.experienceRequirements)}`,
    str(job.educationRequirements) && `학력 조건: ${str(job.educationRequirements)}`,
    str(job.skills) && `기술: ${str(job.skills)}`,
    str(job.responsibilities) && `담당 업무:\n${htmlToText(str(job.responsibilities))}`,
    str(job.qualifications) && `자격 요건:\n${htmlToText(str(job.qualifications))}`,
    str(job.description) && `상세:\n${htmlToText(str(job.description))}`,
  ];
  return lines.filter(Boolean).join("\n");
}

function findJobPostings(node: unknown, out: Json[] = []): Json[] {
  if (Array.isArray(node)) node.forEach((n) => findJobPostings(n, out));
  else if (node && typeof node === "object") {
    const obj = node as Json;
    const type = obj["@type"];
    if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) out.push(obj);
    findJobPostings(obj["@graph"], out);
  }
  return out;
}

export function extractPostingText(html: string): string {
  const parts: string[] = [];

  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      for (const job of findJobPostings(JSON.parse(m[1]))) parts.push(jobPostingText(job));
    } catch {
      // 깨진 JSON-LD는 건너뛴다
    }
  }

  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const ogDescription = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i)?.[1];
  const body = htmlToText(html);
  if (parts.length === 0 || body.length > 200) {
    // 구조화 데이터가 없거나 본문도 충분하면 화면에 보이는 글을 함께 쓴다
    if (title) parts.push(`페이지 제목: ${decode(title).trim()}`);
    if (ogDescription) parts.push(`요약: ${decode(ogDescription).trim()}`);
    parts.push(body);
  }
  return parts.filter(Boolean).join("\n\n").slice(0, MAX_TEXT_CHARS);
}
