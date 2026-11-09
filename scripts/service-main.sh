#!/bin/sh
export PATH=/var/apps/nodejs_v22/target/bin:/usr/local/bin:/usr/bin:/bin
export DATA_DIR="$TRIM_PKGVAR"
export APP_SOCKET="$TRIM_APPDEST/app.sock"
export FNPACK="$TRIM_APPDEST/tools/fnpack"
PIDFILE="$TRIM_PKGVAR/service.pid"
case "$1" in
 start)
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then exit 0; fi
  cd "$TRIM_APPDEST" || exit 1
  umask 077
  nohup node server/index.js >> "$TRIM_PKGVAR/service.log" 2>&1 </dev/null &
  echo $! > "$PIDFILE"
  sleep 1
  kill -0 "$(cat "$PIDFILE")" 2>/dev/null
  ;;
 stop)
  if [ -f "$PIDFILE" ]; then
    service_pid=$(cat "$PIDFILE")
    case "$service_pid" in ''|*[!0-9]*) exit 1;; esac
    [ "$service_pid" -gt 1 ] || exit 1
    if kill -0 "$service_pid" 2>/dev/null; then
      kill "$service_pid" || exit 1
      remaining=30
      while kill -0 "$service_pid" 2>/dev/null; do
        if [ "$remaining" -le 0 ]; then
          echo "Service did not stop within 30 seconds" >&2
          exit 1
        fi
        sleep 1
        remaining=$((remaining - 1))
      done
    fi
    [ "$(cat "$PIDFILE" 2>/dev/null)" != "$service_pid" ] || rm -f "$PIDFILE"
  fi
  ;;
 status)
  [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null
  ;;
 *) exit 1;;
esac
