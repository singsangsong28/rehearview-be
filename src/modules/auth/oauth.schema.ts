import { z } from "zod";

// 제공사가 콜백으로 돌려보내는 쿼리. 하나라도 비어 있으면 실패 처리한다.
export const oauthCallbackQuerySchema = z.object({
  code: z.string().min(1).max(2048),
  state: z.string().min(1).max(256),
});
