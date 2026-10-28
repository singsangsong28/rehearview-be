import type { Request, Response } from "express";
import { parse } from "../../lib/validate.ts";
import { analyzeSchema, answerSchema, createInterviewSchema, interviewIdSchema, postingUrlSchema, reportRequestSchema } from "./interview.schema.ts";
import { interviewService } from "./interview.service.ts";

// requireAuth를 거친 뒤라 res.locals.user가 있다
const userId = (res: Response): string => res.locals.user.id;
const idOf = (req: Request) => parse(interviewIdSchema, req.params).id;

export const interviewController = {
  async create(req: Request, res: Response) {
    res.status(201).json(await interviewService.create(userId(res), parse(createInterviewSchema, req.body)));
  },

  async posting(req: Request, res: Response) {
    res.json(await interviewService.fetchPosting(userId(res), parse(postingUrlSchema, req.body).url));
  },

  async analyze(req: Request, res: Response) {
    res.json(await interviewService.analyze(userId(res), parse(analyzeSchema, req.body)));
  },

  async answer(req: Request, res: Response) {
    const { answer, resume } = parse(answerSchema, req.body);
    res.json(await interviewService.answer(userId(res), idOf(req), answer, resume));
  },

  async report(req: Request, res: Response) {
    const { resume } = parse(reportRequestSchema, req.body ?? {});
    res.json(await interviewService.report(userId(res), idOf(req), resume));
  },

  async list(_req: Request, res: Response) {
    res.json(await interviewService.list(userId(res)));
  },

  async get(req: Request, res: Response) {
    res.json(await interviewService.get(userId(res), idOf(req)));
  },

  async remove(req: Request, res: Response) {
    await interviewService.remove(userId(res), idOf(req));
    res.status(204).end();
  },
};
