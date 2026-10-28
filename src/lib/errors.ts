// 상태 코드와 사용자에게 보여 줄 메시지를 함께 던지는 에러. app.ts의 에러 핸들러가 응답으로 바꾼다.
export class AppError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
