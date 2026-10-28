import { z } from "zod";

const text = (label: string, max: number) =>
  z.string().trim().min(1, `${label}을(를) 입력해 주세요`).max(max, `${label}은(는) ${max}자 이하여야 합니다`);

// 서류는 서버에 저장하지 않고 요청마다 받는다. 길이 상한은 LLM 입력 폭주 방지.
const resume = z.string().trim().min(1, "서류 내용이 필요합니다").max(30_000, "서류는 30,000자 이하여야 합니다");

export const createInterviewSchema = z.object({
  company: text("회사", 100),
  field: text("직군", 100),
  role: text("직무", 100),
  type: z.enum(["COMPREHENSIVE", "COMPETENCY", "PERSONALITY", "EXECUTIVE", "CULTURE_FIT"], "면접 유형이 올바르지 않습니다"),
  intensity: z.enum(["MILD", "NORMAL", "SPICY"], "면접 강도가 올바르지 않습니다"),
  career: z.enum(["NEW_GRAD", "EXPERIENCED", "CAREER_CHANGE"], "지원 구분이 올바르지 않습니다"),
});

// 서류 분석 요청: 여러 파일을 이어 붙인 원문(더 길 수 있음)과, 분석 방향을 잡아 줄 지원 정보(선택)
const optionalText = (max: number) => z.string().trim().max(max).optional();
export const analyzeSchema = z.object({
  resume: z.string().trim().min(1, "서류 내용이 필요합니다").max(100_000, "서류는 100,000자 이하여야 합니다"),
  company: optionalText(100),
  field: optionalText(100),
  role: optionalText(100),
  career: z.enum(["NEW_GRAD", "EXPERIENCED", "CAREER_CHANGE"]).optional(),
  posting: optionalText(30_000), // 채용 공고 내용 (주소에서 불러왔거나 붙여 넣은 글)
});

// 공고 주소에서 글을 불러온다. 실제 접속 안전 검사는 posting.fetch.ts 에서 한다.
export const postingUrlSchema = z.object({ url: z.string().trim().url("공고 주소가 올바르지 않습니다").max(2_000, "주소가 너무 깁니다") });

export const answerSchema = z.object({ answer: text("답변", 5_000), resume });
export const reportRequestSchema = z.object({ resume: resume.optional() });
export const interviewIdSchema = z.object({ id: z.string().min(1).max(64) });

// LLM이 만든 리포트 JSON 검증. 축 이름은 prompt와 같아야 한다.
export const REPORT_AXES = ["직무 이해도", "근거와 구체성", "논리 구조", "전달력", "태도와 진정성", "질문 의도 파악"] as const;
const score = z.number().int().min(1).max(5);
export const reportOutputSchema = z.object({
  scores: z.object(Object.fromEntries(REPORT_AXES.map((a) => [a, score])) as Record<(typeof REPORT_AXES)[number], typeof score>),
  feedback: z.string().trim().min(1).max(5_000),
  // 모범 답변은 덤이라 형식이 틀려도 리포트 전체를 실패시키지 않고 비운다
  modelAnswers: z.array(z.object({ order: z.number().int().min(1), answer: z.string().trim().min(1).max(2_000) })).max(20).catch([]),
});
