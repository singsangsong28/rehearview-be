import { Router } from "express";
import { requireAuth, requireConsent } from "../auth/auth.middleware.ts";
import { interviewController as c } from "./interview.controller.ts";

export const interviewRouter = Router();
interviewRouter.use(requireAuth, requireConsent);

interviewRouter.post("/", c.create);
interviewRouter.post("/analyze", c.analyze);
interviewRouter.post("/posting", c.posting);
interviewRouter.get("/", c.list);
interviewRouter.get("/:id", c.get);
interviewRouter.delete("/:id", c.remove);
interviewRouter.post("/:id/answer", c.answer);
interviewRouter.post("/:id/report", c.report);
