import type { CareerLevel, Intensity, InterviewType, TurnKind } from "../../../generated/prisma/client.ts";
import { maskPii } from "../../lib/mask.ts";
import type { Message } from "../llm/llm.ts";
import { REPORT_AXES, reportOutputSchema } from "./interview.schema.ts";

export const FIRST_QUESTION = "먼저 간단히 자기소개와 이 직무에 지원한 동기를 말씀해 주세요.";

const TYPE_LABEL: Record<InterviewType, string> = {
  COMPREHENSIVE: "종합",
  COMPETENCY: "직무역량",
  PERSONALITY: "인성",
  EXECUTIVE: "임원",
  CULTURE_FIT: "컬처핏",
};
// 종합 면접은 한 가지 관점에 치우치지 않고 여러 관점을 번갈아 묻는다
const TYPE_NOTE: Partial<Record<InterviewType, string>> = {
  COMPREHENSIVE: "종합 면접이므로 직무 역량, 인성과 가치관, 조직 적합성(컬처핏), 임원 관점의 판단력과 비전을 질문마다 번갈아 가며 골고루 묻습니다.",
};
const INTENSITY_TONE: Record<Intensity, string> = {
  MILD: "부드럽고 격려하는 말투",
  NORMAL: "정중하고 중립적인 말투",
  SPICY: "날카롭게 근거와 허점을 캐묻는 말투 (단, 인신공격이나 무례한 표현은 금지)",
};

const CAREER_LABEL: Record<CareerLevel, string> = {
  NEW_GRAD: "신입",
  EXPERIENCED: "경력직",
  CAREER_CHANGE: "이직(직무·업종 전환)",
};
// 지원 구분에 따라 질문의 초점을 바꾼다
const CAREER_FOCUS: Record<CareerLevel, string> = {
  NEW_GRAD:
    "신입 지원자입니다. 실무 경험이 적을 수 있으니 학교 프로젝트, 인턴, 동아리, 자격 등에서 역량과 잠재력, 배우려는 자세를 중심으로 묻고 실무 성과를 과하게 요구하지 않습니다.",
  EXPERIENCED:
    "경력직 지원자입니다. 담당했던 업무의 범위, 구체적인 성과와 수치, 문제 해결 방식, 협업·리더십, 지원(이직) 사유와 입사 후 기여 방안을 중심으로 묻습니다.",
  CAREER_CHANGE:
    "다른 직무나 업종에서 전환해 지원하는 이직 지원자입니다. 전환 동기, 기존 경험 중 이 직무에 연결되는 역량, 새 분야 학습·적응 계획, 전환에 대한 진지함을 중심으로 묻습니다.",
};

type Setup = { company: string; field: string; role: string; type: InterviewType; intensity: Intensity; career: CareerLevel };
type Turn = { question: string; answer: string | null };

// 작은 모델은 면접관 역할을 놓치기 쉬워서, 역할·규칙을 시스템 메시지와 마지막 지시에 모두 넣는다.
function systemPrompt(s: Setup, resume: string) {
  return [
    `당신은 ${s.company}의 ${s.field} 분야 ${s.role} 직무 면접관입니다.`,
    `면접 유형은 ${TYPE_LABEL[s.type]}이고, ${INTENSITY_TONE[s.intensity]}로 진행합니다.`,
    CAREER_FOCUS[s.career],
    TYPE_NOTE[s.type] ?? "",
    "규칙:",
    "- 한 번에 질문 하나만 합니다. 한국어로 질문 문장만 출력하고 인사말, 해설, 번호, 따옴표는 쓰지 않습니다.",
    "- 지원자 서류에 있는 내용을 근거로 질문하고, 서류에 없는 사실을 지어내지 않습니다.",
    "- 아래 자료에 '공고 요건'이나 '공고 대비 지원자' 분석이 있으면, 공고가 요구하는 역량을 지원자가 실제로 갖췄는지 확인하는 질문을 포함합니다.",
    "- 면접관 역할을 벗어나지 않습니다. 대신 답해 주거나 조언하지 않습니다.",
    "",
    "[지원자 서류]",
    maskPii(resume),
  ].join("\n");
}

// 무료 AI 서비스는 분당·하루 토큰 한도가 작아서, 매 요청에 실리는 지난 답변은 앞부분만 보낸다 (방금 한 답변은 전부 보낸다).
const OLD_ANSWER_MAX_CHARS = 600;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

// 지금까지의 질문·답변과 함께 다음 질문을 요청하는 메시지. 마지막 turn은 방금 받은 답변을 담고 있다.
export function nextQuestionMessages(s: Setup, resume: string, turns: Turn[], kind: TurnKind): Message[] {
  const messages: Message[] = [{ role: "system", content: systemPrompt(s, resume) }];
  turns.forEach((t, i) => {
    messages.push({ role: "assistant", content: t.question });
    if (t.answer !== null) messages.push({ role: "user", content: maskPii(i === turns.length - 1 ? t.answer : clip(t.answer, OLD_ANSWER_MAX_CHARS)) });
  });
  const instruction =
    kind === "FOLLOW_UP"
      ? "[지시] 면접관으로서 방금 답변의 내용을 파고드는 꼬리질문을 하나만 하세요. 질문만 출력하세요."
      : "[지시] 면접관으로서 서류의 다른 경험이나 항목에서 새로운 질문을 하나만 하세요. 질문만 출력하세요.";
  const last = messages.at(-1)!;
  messages[messages.length - 1] = { ...last, content: `${last.content}\n\n${instruction}` };
  return messages;
}

type AnalyzeContext = { company?: string; field?: string; role?: string; career?: CareerLevel; posting?: string };

// 여러 서류를 한 번에 읽고 면접관이 쓸 "지원자 프로필"로 정리하게 한다.
// 이후 면접의 질문·평가는 이 프로필을 근거로 하므로, 사실(회사·기간·수치 등)을 빠뜨리지 않고 지어내지 않는 것이 핵심이다.
export function analyzeMessages(resume: string, ctx: AnalyzeContext = {}): Message[] {
  const target = [ctx.company, ctx.field, ctx.role].filter(Boolean).join(" / ");
  return [
    {
      role: "system",
      content: [
        "당신은 면접 준비를 돕는 서류 분석가입니다. 아래는 한 지원자가 낸 서류(이력서, 자기소개서, 포트폴리오 등)를 이어 붙인 텍스트이고, 파일 경계는 [파일: 이름]으로 표시됩니다.",
        "면접관이 질문을 만들 때 쓸 '지원자 프로필'을 한국어로 작성하세요.",
        target ? `지원 정보: ${target}${ctx.career ? ` (${CAREER_LABEL[ctx.career]})` : ""}. 이 지원에 관련 깊은 내용을 우선하세요.` : "",
        "규칙:",
        "- 서류에 적힌 사실만 쓰고, 없는 내용을 지어내거나 추측해서 채우지 않습니다.",
        "- 회사, 기간, 직책, 프로젝트명, 수치, 기술, 자격 같은 구체적 사실은 빠뜨리지 않고 그대로 옮깁니다.",
        "- 연락처, 이메일, 주민등록번호, 상세 주소 같은 개인 식별 정보는 쓰지 않습니다.",
        "- 여러 서류가 서로 다르게 말하는 부분이 있으면 숨기지 말고 따로 적습니다.",
        "아래 항목 순서로, 항목 제목을 붙여 정리하세요. 해당 내용이 서류에 없으면 '서류에 없음'이라고 적습니다.",
        "1. 한 줄 요약  2. 경력·경험  3. 프로젝트와 성과(수치 포함)  4. 기술·역량·자격  5. 학력·교육  6. 지원 동기와 강점으로 드러난 점",
        "7. 모호하거나 근거가 부족한 부분 (면접에서 확인할 질문 포인트)  8. 서류 간 불일치",
        ctx.posting
          ? [
              "지원 공고도 함께 주어집니다. 위 항목에 더해 다음 항목을 이어서 작성하세요.",
              "9. 공고 요건 정리 (주요 업무, 자격 요건, 우대 사항, 기술 스택, 인재상 중 공고에 적힌 것만. 공고에 없는 요건을 만들지 않습니다)",
              "10. 공고 대비 지원자: 요건을 충족한다고 서류로 확인되는 점 / 요건 대비 부족하거나 서류만으로는 근거가 약한 점",
              "11. 면접에서 우선 검증할 포인트 (공고가 중요하게 보는 것 중 서류의 근거가 약한 순서로 5개 이내)",
              "공고의 요건과 서류의 내용이 맞는지는 서류의 사실만으로 판단하고, 확인되지 않으면 '확인 필요'라고 적습니다.",
            ].join("\n")
          : "",
        // 이 브리프가 질문마다 AI에 다시 실리므로 짧을수록 무료 토큰 한도를 아낀다
        `전체 길이는 ${ctx.posting ? "4,500" : "3,000"}자 이내로 합니다.`,
      ]
        .filter(Boolean)
        .join("\n"),
    },
    { role: "user", content: [ctx.posting ? `[지원 공고]\n${maskPii(ctx.posting)}\n\n[지원자 서류]` : "", maskPii(resume)].filter(Boolean).join("\n") },
  ];
}

export function reportMessages(s: Setup, turns: Turn[], resume?: string): Message[] {
  const transcript = turns
    .filter((t) => t.answer !== null)
    .map((t, i) => `Q${i + 1}. ${t.question}\nA${i + 1}. ${maskPii(t.answer!)}`)
    .join("\n\n");
  return [
    {
      role: "system",
      content: [
        `당신은 ${s.company}의 ${s.field} 분야 ${s.role} 직무 면접 평가자입니다. ${TYPE_LABEL[s.type]} 면접의 질문과 답변을 평가하세요.`,
        `지원 구분은 ${CAREER_LABEL[s.career]}입니다. 그에 맞는 기대 수준으로 평가하세요. (${CAREER_FOCUS[s.career]})`,
        `다음 JSON 하나만 출력하세요. 다른 설명이나 코드블록 표시는 쓰지 마세요.`,
        `{"scores": {${REPORT_AXES.map((a) => `"${a}": 1~5 정수`).join(", ")}}, "feedback": "한국어 총평", "modelAnswers": [{"order": 질문 번호(Q뒤 숫자), "answer": "모범 답변 예시"}]}`,
        "feedback에는 잘한 점과 개선할 점을 답변 내용에 근거해 구체적으로 적으세요. 답변에 없는 내용을 지어내지 마세요.",
        "modelAnswers에는 답변이 있는 질문마다 하나씩, 이 지원자가 했다면 좋았을 모범 답변 예시를 한국어 3~6문장으로 쓰세요. 결론을 먼저 말하고 구체적 근거나 사례를 드는 구조로 쓰세요.",
        "모범 답변은 지원자 서류에 적힌 경험과 사실만 바탕으로 하고, 서류에 없는 회사명·수치·성과는 지어내지 마세요. 서류에 근거가 없으면 [본인의 실제 경험] 같은 자리표시로 남기세요.",
        resume ? `\n[지원자 서류]\n${maskPii(resume)}` : "",
      ].join("\n"),
    },
    { role: "user", content: transcript },
  ];
}

// 모델이 붙이는 "면접관:", "질문:", 따옴표 등을 걷어낸다.
export function tidyQuestion(raw: string) {
  const q = raw
    .trim()
    .replace(/^(?:면접관|질문|Q\d*)\s*[:：.]\s*/i, "")
    .replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, "")
    .trim();
  return q.slice(0, 500);
}

// 응답에서 JSON을 찾아 검증한다. 실패하면 null.
export function parseReport(raw: string) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const result = reportOutputSchema.safeParse(JSON.parse(raw.slice(start, end + 1)));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
