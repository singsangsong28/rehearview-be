import { Router } from "express";
import { oauthController as c } from "./oauth.controller.ts";

export const oauthRouter = Router();

oauthRouter.get("/:provider", c.start);
oauthRouter.get("/:provider/callback", c.callback);
