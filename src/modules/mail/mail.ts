import nodemailer from "nodemailer";

export type Mail = { to: string; subject: string; text: string };
export type Mailer = (mail: Mail) => Promise<void>;

// SMTP_USER, SMTP_PASS 가 있으면 Gmail SMTP 로 실제 발송하고, 없으면 개발용으로 콘솔에 출력한다.
// TODO: 도메인 구매 후 발신 도메인 인증(SPF, DKIM)을 마치고 전용 메일 서비스로 교체. Gmail 은 하루 약 500통 한도.
const { SMTP_USER, SMTP_PASS } = process.env;

let mailer: Mailer = async (m) => {
  console.log(`[mail:dev] to=${m.to} subject=${m.subject}\n${m.text}`);
};

if (SMTP_USER && SMTP_PASS) {
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
  const from = process.env.MAIL_FROM || `Rehearview <${SMTP_USER}>`;
  mailer = async (m) => {
    await transport.sendMail({ from, ...m });
  };
}

export const setMailer = (m: Mailer) => {
  mailer = m;
};
export const sendMail: Mailer = (m) => mailer(m);
