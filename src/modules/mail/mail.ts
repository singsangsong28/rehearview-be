export type Mail = { to: string; subject: string; text: string };
export type Mailer = (mail: Mail) => Promise<void>;

// 개발용: 실제 발송 없이 콘솔에 출력.
// TODO: 도메인 구매 후 발신 도메인 인증(SPF, DKIM)을 마치고 실제 메일 서비스로 교체 (setMailer 또는 이 기본값을 대체). 공개 전 필수.
let mailer: Mailer = async (m) => {
  console.log(`[mail:dev] to=${m.to} subject=${m.subject}\n${m.text}`);
};

export const setMailer = (m: Mailer) => {
  mailer = m;
};
export const sendMail: Mailer = (m) => mailer(m);
