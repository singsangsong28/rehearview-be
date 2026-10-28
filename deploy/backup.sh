#!/usr/bin/env bash
# 매일 DB를 덤프해서 14일치만 남긴다. 서버의 /etc/cron.daily/rehearview-backup 으로 설치해 root 로 실행한다.
# 백업에는 이메일·면접 기록이 들어 있으므로 root 만 읽을 수 있게 한다. 탈퇴한 사용자의 정보도 최대 14일 백업에 남는다 (처리방침 7항).
# ponytail: 같은 서버 디스크에만 보관한다. 서버를 잃으면 백업도 잃으므로 서버 밖(오브젝트 스토리지 등) 사본이 필요하면 여기서 올린다.
set -euo pipefail

dir=/var/backups/rehearview
install -d -m 700 "$dir"
file="$dir/rehearview-$(date +%F).sql.gz"

runuser -u postgres -- pg_dump rehearview | gzip > "$file.tmp"
mv "$file.tmp" "$file"
chmod 600 "$file"

find "$dir" -name 'rehearview-*.sql.gz' -mtime +14 -delete
