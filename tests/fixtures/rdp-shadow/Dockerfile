# Disposable Linux RDP peer for integration acceptance, never part of the application.
FROM debian:bookworm-slim
RUN sed -i 's|http://deb.debian.org/debian-security|http://mirrors.tuna.tsinghua.edu.cn/debian-security|g; s|http://deb.debian.org/debian|http://mirrors.tuna.tsinghua.edu.cn/debian|g' /etc/apt/sources.list.d/debian.sources && apt-get update && apt-get install -y --no-install-recommends freerdp2-shadow-x11 winpr-utils xvfb xterm xdotool xclip openssl ca-certificates x11-utils && rm -rf /var/lib/apt/lists/*
COPY start.sh /start.sh
RUN chmod 755 /start.sh
ENV DISPLAY=:99
ENTRYPOINT ["/start.sh"]
