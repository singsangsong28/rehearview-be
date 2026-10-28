import type { CareerLevel, Intensity, InterviewType, TurnKind } from "../../../generated/prisma/client.ts";
import { prisma } from "../../lib/db.ts";

type NewInterview = { company: string; field: string; role: string; type: InterviewType; intensity: Intensity; career: CareerLevel };

// 서류 원문은 어디에도 저장하지 않는다. 질문·답변·리포트만 저장.
export const interviewRepository = {
  createWithFirstTurn: (userId: string, data: NewInterview, firstQuestion: string) =>
    prisma.interview.create({
      data: { ...data, userId, turns: { create: { order: 1, question: firstQuestion, kind: "MAIN" } } },
      include: { turns: true },
    }),

  countCreatedSince: (userId: string, since: Date) =>
    prisma.interview.count({ where: { userId, createdAt: { gte: since } } }),

  // 소유자 확인을 위해 항상 userId와 함께 조회 (남의 면접은 없는 것으로 취급)
  findOwned: (id: string, userId: string) =>
    prisma.interview.findFirst({
      where: { id, userId },
      include: { turns: { orderBy: { order: "asc" } }, report: true },
    }),

  list: (userId: string) =>
    prisma.interview.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { id: true, company: true, field: true, role: true, type: true, intensity: true, career: true, status: true, createdAt: true },
    }),

  answerTurn: (turnId: string, answer: string) => prisma.turn.update({ where: { id: turnId }, data: { answer } }),

  // 답변 저장과 다음 질문 추가를 한 번에 (둘 중 하나만 반영되는 상태를 막는다)
  answerAndAddTurn: (turnId: string, answer: string, interviewId: string, order: number, question: string, kind: TurnKind) =>
    prisma.$transaction([
      prisma.turn.update({ where: { id: turnId }, data: { answer } }),
      prisma.turn.create({ data: { interviewId, order, question, kind } }),
    ]),

  saveReport: (interviewId: string, scores: Record<string, number>, feedback: string, modelAnswers: { order: number; answer: string }[]) =>
    prisma.$transaction([
      prisma.report.create({ data: { interviewId, scores, feedback, modelAnswers } }),
      prisma.interview.update({ where: { id: interviewId }, data: { status: "COMPLETED" } }),
    ]),

  remove: (id: string, userId: string) => prisma.interview.deleteMany({ where: { id, userId } }),
};
