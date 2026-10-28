import { test } from "node:test";
import assert from "node:assert/strict";
import { maskPii } from "./mask.ts";

test("전화번호, 이메일, 주민번호를 가린다", () => {
  assert.equal(maskPii("연락처 010-1234-5678 / 01098765432"), "연락처 [전화번호] / [전화번호]");
  assert.equal(maskPii("02-123-4567"), "[전화번호]");
  assert.equal(maskPii("mail: hong.gildong+x@example.co.kr"), "mail: [이메일]");
  assert.equal(maskPii("901231-1234567"), "[주민번호]");
});

test("일반 문장과 연도·기간은 그대로", () => {
  const s = "2019.03 ~ 2023.02 컨테이너선 기관사로 근무, 연료 1200톤 관리";
  assert.equal(maskPii(s), s);
});
