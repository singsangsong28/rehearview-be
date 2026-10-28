import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fetchPostingText, isBlockedAddress, validatePostingUrl } from "./posting.fetch.ts";
import { extractPostingText } from "./posting.html.ts";

test("내부망·예약 주소는 막고 공인 주소는 허용", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.5", "172.31.255.255", "192.168.0.10", "169.254.169.254", "0.0.0.0", "100.64.1.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"])
    assert.equal(isBlockedAddress(ip), true, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "2606:4700:4700::1111"]) assert.equal(isBlockedAddress(ip), false, ip);
  assert.equal(isBlockedAddress("not-an-ip"), true);
});

test("주소 검증: http/https, 표준 포트, 계정 정보 없음, 내부 IP 직접 입력 거부", () => {
  assert.doesNotThrow(() => validatePostingUrl("https://example.com/jobs/1?x=1"));
  assert.doesNotThrow(() => validatePostingUrl("http://example.com:80/jobs"));
  for (const bad of ["ftp://example.com/a", "file:///etc/passwd", "javascript:alert(1)", "https://user:pw@example.com/", "https://example.com:8080/", "http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://[::1]/", "not a url"])
    assert.throws(() => validatePostingUrl(bad), bad);
});

test("내 컴퓨터(localhost)의 서버를 읽게 하려는 시도는 막힌다", async () => {
  const server = createServer((_req, res) => res.end("비밀 내부 데이터 ".repeat(20)));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); // 열릴 때까지 기다려야 포트를 읽을 수 있다
  const { port } = server.address() as AddressInfo;
  try {
    // IP를 직접 적은 경우는 주소 검증에서, 이름(localhost)으로 우회하는 경우는 연결 시점 검사에서 막힌다
    await assert.rejects(fetchPostingText(`http://127.0.0.1:${port}/`), /사용할 수 없습니다/);
    await assert.rejects(fetchPostingText("http://localhost/"), /공고를 불러오지 못했어요/);
  } finally {
    server.close();
  }
});

test("JSON-LD JobPosting이 있으면 구조화된 공고 내용을 뽑는다", () => {
  const html = `<html><head><title>마케터 채용</title>
    <script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "퍼포먼스 마케터",
      hiringOrganization: { "@type": "Organization", name: "샘플물산" },
      description: "<p>담당 업무</p><ul><li>광고 운영</li><li>데이터 분석</li></ul>",
      experienceRequirements: "경력 3년 이상",
      skills: ["GA4", "SQL"],
    })}</script></head><body><div id="root"></div></body></html>`;
  const text = extractPostingText(html);
  assert.match(text, /공고 제목: 퍼포먼스 마케터/);
  assert.match(text, /회사: 샘플물산/);
  assert.match(text, /- 광고 운영/);
  assert.match(text, /경력 조건: 경력 3년 이상/);
  assert.match(text, /기술: GA4, SQL/);
});

test("구조화 데이터가 없으면 화면의 글을 읽고, 스크립트·스타일은 버린다", () => {
  const html = `<html><head><title>개발자 채용</title><style>.a{color:red}</style></head><body>
    <script>alert("x")</script><h1>백엔드 개발자</h1><p>자격 요건 &amp; 우대 사항</p><ul><li>Node.js 경험</li><li>SQL 활용</li></ul>
    <div>${"상세 내용입니다. ".repeat(30)}</div></body></html>`;
  const text = extractPostingText(html);
  assert.match(text, /백엔드 개발자/);
  assert.match(text, /자격 요건 & 우대 사항/);
  assert.match(text, /- Node\.js 경험/);
  assert.ok(!text.includes("alert") && !text.includes("color:red"));
});
