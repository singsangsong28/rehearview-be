import { test } from "node:test";
import assert from "node:assert/strict";
import { nextQuestionMessages, parseReport, tidyQuestion } from "./interview.prompt.ts";

const setup = { company: "테스트社", field: "영업", role: "법인영업", type: "COMPETENCY", intensity: "NORMAL", career: "EXPERIENCED" } as const;

test("지원 구분에 따라 질문 지침이 달라진다", () => {
  const sys = (career: "NEW_GRAD" | "EXPERIENCED" | "CAREER_CHANGE") => nextQuestionMessages({ ...setup, career }, "서류", [{ question: "q", answer: "a" }], "MAIN")[0].content;
  assert.match(sys("NEW_GRAD"), /신입 지원자/);
  assert.match(sys("EXPERIENCED"), /경력직 지원자/);
  assert.match(sys("CAREER_CHANGE"), /전환해 지원하는 이직 지원자/);
  assert.ok(!sys("NEW_GRAD").includes("경력직 지원자"));
});

test("nextQuestionMessages: 지난 답변은 앞부분만, 방금 한 답변은 전부 보낸다", () => {
  const long = "가".repeat(2_000);
  const msgs = nextQuestionMessages(setup, "서류", [{ question: "q1", answer: long }, { question: "q2", answer: long }], "MAIN");
  const answers = msgs.filter((m) => m.role === "user").map((m) => m.content);
  assert.ok(answers[0].length < 700 && answers[0].endsWith("…"));
  assert.ok(answers[1].startsWith(long)); // 마지막 답변은 그대로 (뒤에 지시문이 붙는다)
});

test("tidyQuestion: 접두어와 따옴표 제거", () => {
  assert.equal(tidyQuestion('면접관: "가장 큰 성과는 무엇인가요?"'), "가장 큰 성과는 무엇인가요?");
  assert.equal(tidyQuestion("  Q2. 왜 이직하나요?  "), "왜 이직하나요?");
});

test("parseReport: 코드블록이 섞여도 JSON을 찾고, 형식이 틀리면 null", () => {
  const ok = { scores: { "직무 이해도": 4, "근거와 구체성": 3, "논리 구조": 4, 전달력: 5, "태도와 진정성": 4, "질문 의도 파악": 3 }, feedback: "좋음" };
  const withAnswers = { ...ok, modelAnswers: [{ order: 1, answer: "예시 답변" }] };
  assert.deepEqual(parseReport("```json\n" + JSON.stringify(withAnswers) + "\n```"), withAnswers);
  // 모범 답변이 없거나 형식이 틀려도 리포트는 만들어진다
  assert.deepEqual(parseReport(JSON.stringify(ok)), { ...ok, modelAnswers: [] });
  assert.deepEqual(parseReport(JSON.stringify({ ...ok, modelAnswers: "엉터리" })), { ...ok, modelAnswers: [] });
  assert.equal(parseReport("JSON 없음"), null);
  assert.equal(parseReport(JSON.stringify({ ...ok, scores: { ...ok.scores, 전달력: 9 } })), null);
  assert.equal(parseReport(JSON.stringify({ scores: {}, feedback: "x" })), null);
});

test("nextQuestionMessages: 서류의 개인정보는 가려서 보내고, 마지막 메시지에 지시를 붙인다", () => {
  const msgs = nextQuestionMessages(setup, "연락처 010-1234-5678", [{ question: "자기소개?", answer: "메일 a@b.com 입니다" }], "FOLLOW_UP");
  const all = msgs.map((m) => m.content).join("\n");
  assert.ok(!all.includes("010-1234-5678") && !all.includes("a@b.com"));
  assert.match(msgs[0].content, /\[전화번호\]/);
  assert.equal(msgs.at(-1)!.role, "user");
  assert.match(msgs.at(-1)!.content, /꼬리질문/);
});
