import type { CareerLevel } from "../../../generated/prisma/client.ts";
import { AppError } from "../../lib/errors.ts";
import { chat } from "../llm/llm.ts";
import { fetchPostingText } from "../posting/posting.fetch.ts";
import { FIRST_QUESTION, analyzeMessages, nextQuestionMessages, parseReport, reportMessages, tidyQuestion } from "./interview.prompt.ts";
import { interviewRepository as repo } from "./interview.repository.ts";

// 질문 N개(본 질문과 꼬리질문 번갈아)를 받으면 면접 종료
const MAX_TURNS = 6;
const dailyLimit = () => Number(process.env.INTERVIEW_DAILY_LIMIT ?? 5);
// 서류 분석은 면접 한 번에 몇 번 다시 돌릴 수 있어서 면접 수보다 넉넉하게
const analysisDailyLimit = () => Number(process.env.ANALYSIS_DAILY_LIMIT ?? 20);
// 공고 주소 불러오기는 서버가 대신 외부 사이트에 접속하는 기능이라 남용을 막으려고 하루 횟수를 제한한다
const postingDailyLimit = () => Number(process.env.POSTING_FETCH_DAILY_LIMIT ?? 30);
const PROFILE_MAX_CHARS = 5_000; // 질문마다 AI에 실리는 브리프 길이 상한 (무료 토큰 한도 절약)

// TODO: 메모리 기반이라 서버가 여러 대면 대수별로 따로 센다. 서버를 재시작하면 초기화된다. 배포 구성이 정해지면 DB나 Redis로.
const usage = new Map<string, number>();
function countUsage(kind: "analysis" | "posting", userId: string) {
  const key = `${kind}:${userId}:${new Date().toISOString().slice(0, 10)}`; // 날짜(UTC)별로 센다
  const n = (usage.get(key) ?? 0) + 1;
  usage.set(key, n);
  return n;
}

// 테스트에서 가짜로 바꿔 끼우기 위한 연결점 (LLM, 외부 사이트 접속)
export const llm = { chat };
export const web = { fetchPostingText };

async function ask(messages: Parameters<typeof chat>[0], failMessage = "면접관을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요") {
  try {
    return (await llm.chat(messages)).text;
  } catch {
    // 제공사 오류 내용(서류가 섞일 수 있음)은 응답·로그에 남기지 않는다
    throw new AppError(503, failMessage);
  }
}

async function owned(userId: string, id: string) {
  const interview = await repo.findOwned(id, userId);
  if (!interview) throw new AppError(404, "면접을 찾을 수 없습니다");
  return interview;
}

export const interviewService = {
  // 채용 공고 주소에서 글을 불러온다. 결과를 사용자에게 보여 주고 고칠 수 있게 하므로 저장하지 않는다.
  async fetchPosting(userId: string, url: string) {
    if (countUsage("posting", userId) > postingDailyLimit()) throw new AppError(429, `공고 불러오기는 하루에 ${postingDailyLimit()}번까지 할 수 있습니다`);
    return { text: await web.fetchPostingText(url) };
  },

  // 여러 서류(와 채용 공고)를 읽어 면접 준비 브리프로 정리한다. 원문은 저장하지 않고, 결과 텍스트만 돌려준다.
  async analyze(userId: string, input: { resume: string; company?: string; field?: string; role?: string; career?: CareerLevel; posting?: string }) {
    if (countUsage("analysis", userId) > analysisDailyLimit()) throw new AppError(429, `서류 분석은 하루에 ${analysisDailyLimit()}번까지 할 수 있습니다`);
    const { resume, ...ctx } = input;
    const failMessage = "서류를 분석하지 못했습니다. AI 서비스가 잠시 바쁠 수 있으니 잠시 후 다시 시도해 주세요";
    const profile = (await ask(analyzeMessages(resume, ctx), failMessage)).trim().slice(0, PROFILE_MAX_CHARS);
    if (!profile) throw new AppError(503, failMessage);
    return { profile };
  },

  // 첫 질문은 모델 없이 고정 문장으로 낸다 (작은 모델이 첫 턴에 역할을 놓치는 문제 회피).
  async create(userId: string, input: Parameters<typeof repo.createWithFirstTurn>[1]) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    if ((await repo.countCreatedSince(userId, startOfDay)) >= dailyLimit())
      throw new AppError(429, `하루에 ${dailyLimit()}번까지 면접을 진행할 수 있습니다`);
    const interview = await repo.createWithFirstTurn(userId, input, FIRST_QUESTION);
    return { id: interview.id, turn: { order: 1, question: FIRST_QUESTION, kind: "MAIN" as const } };
  },

  // 답변을 저장하고 다음 질문을 만든다. 질문 생성이 실패하면 아무것도 저장하지 않아 같은 요청을 다시 보내면 된다.
  async answer(userId: string, id: string, answer: string, resume: string) {
    const interview = await owned(userId, id);
    if (interview.status === "COMPLETED") throw new AppError(409, "이미 종료된 면접입니다");
    const open = interview.turns.find((t) => t.answer === null);
    if (!open) throw new AppError(409, "모든 질문에 답했습니다. 리포트를 생성해 주세요");

    if (interview.turns.length >= MAX_TURNS) {
      await repo.answerTurn(open.id, answer);
      return { done: true as const };
    }

    const order = interview.turns.length + 1;
    const kind = order % 2 === 0 ? ("FOLLOW_UP" as const) : ("MAIN" as const);
    const turns = interview.turns.map((t) => (t.id === open.id ? { ...t, answer } : t));
    const question = tidyQuestion(await ask(nextQuestionMessages(interview, resume, turns, kind)));
    if (!question) throw new AppError(503, "면접관을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요");

    await repo.answerAndAddTurn(open.id, answer, interview.id, order, question, kind);
    return { done: false as const, turn: { order, question, kind } };
  },

  // 리포트 생성. 이미 있으면 그대로 돌려주고, 실패하면 면접 상태는 그대로라 다시 요청할 수 있다.
  async report(userId: string, id: string, resume?: string) {
    const interview = await owned(userId, id);
    if (interview.report) return interview.report;
    if (!interview.turns.some((t) => t.answer !== null)) throw new AppError(409, "답변이 있어야 리포트를 만들 수 있습니다");

    const parsed = parseReport(await ask(reportMessages(interview, interview.turns, resume)));
    if (!parsed) throw new AppError(502, "리포트를 만들지 못했습니다. 다시 시도해 주세요");
    await repo.saveReport(interview.id, parsed.scores, parsed.feedback, parsed.modelAnswers);
    return (await owned(userId, id)).report;
  },

  list: (userId: string) => repo.list(userId),
  get: (userId: string, id: string) => owned(userId, id),

  async remove(userId: string, id: string) {
    if ((await repo.remove(id, userId)).count === 0) throw new AppError(404, "면접을 찾을 수 없습니다");
  },
};
