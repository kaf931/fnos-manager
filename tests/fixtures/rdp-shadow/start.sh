#!/bin/sh
set -eu
mkdir -p /qa
winpr-hash -u rdpqa -p "${RDP_QA_PASSWORD:?Provide a disposable test password}" -f sam > /qa/SAM
Xvfb :99 -screen 0 1280x720x24 -ac >/qa/xvfb.log 2>&1 &
for n in $(seq 1 50); do xdpyinfo >/dev/null 2>&1 && break; sleep .1; done
xterm -geometry 100x28+20+20 -fa Monospace -fs 14 -bg '#102030' -fg white -e sh -c 'printf "NAS MANAGER RDP SIMULATION\nNLA authenticated test desktop\n"; PS1="rdp-qa$ "; export PS1; exec /bin/sh' >/qa/xterm.log 2>&1 &
exec freerdp-shadow-cli /port:3389 /sec:nla /sam-file:/qa/SAM +auth
