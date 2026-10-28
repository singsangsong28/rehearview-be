#!/usr/bin/env bash
# 서버에서 실행하는 배포 스크립트. GitHub Actions 가 배포 전용 SSH 키로 접속하면 이 스크립트만 실행된다.
# 실행 중에 git 이 이 파일을 바꿔도 안전하도록 전체를 함수로 감싸고 마지막에 exit 한다.
set -euo pipefail

main() {
  local dir=/opt/rehearview-be
  cd "$dir"
  as_app() { sudo -u rehearview "$@"; }

  as_app git fetch --quiet origin main
  as_app git reset --hard origin/main
  as_app npm ci
  as_app npx prisma generate
  as_app npx prisma migrate deploy
  sudo systemctl restart rehearview-backend

  # 서비스가 다시 뜰 때까지 기다리며 헬스 체크
  for _ in $(seq 1 15); do
    if curl -fsS http://localhost:4000/health >/dev/null; then
      echo "배포 완료: $(as_app git rev-parse --short HEAD)"
      return 0
    fi
    sleep 2
  done
  # 공개 저장소의 Actions 로그에 서버 로그가 섞이지 않게 로그는 출력하지 않는다 (서버에서 journalctl 로 확인)
  echo "헬스 체크 실패" >&2
  return 1
}

main "$@"
exit $?
