import type { z } from "zod";
import { AppError } from "./errors.ts";

// 스키마로 검사하고 통과한 값을 돌려준다. 실패하면 첫 번째 오류 메시지로 400.
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw new AppError(400, result.error.issues[0]?.message ?? "잘못된 요청입니다");
  return result.data;
}
