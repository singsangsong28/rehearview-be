// 이용약관·개인정보처리방침(AI 전송 고지 포함)을 바꾸면 이 버전을 올린다. 올리면 모든 이용자가 다시 동의해야 서비스를 쓸 수 있다.
// 프론트의 /privacy, /terms 문서를 고칠 때 함께 올리는 것을 잊지 않는다.
export const CONSENT_VERSION = "2026-10-28";

export const hasConsented = (user: { consentVersion: string | null }) => user.consentVersion === CONSENT_VERSION;
