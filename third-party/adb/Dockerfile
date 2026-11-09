# Build-only environment. The exported runtime needs no Docker.
FROM debian:trixie-slim AS build
ARG TARGET_ARCH=x64
ENV TARGET_ARCH=$TARGET_ARCH
RUN sed -i 's|http://deb.debian.org/debian-security|http://mirrors.tuna.tsinghua.edu.cn/debian-security|g; s|http://deb.debian.org/debian|http://mirrors.tuna.tsinghua.edu.cn/debian|g' /etc/apt/sources.list.d/debian.sources && if [ "$TARGET_ARCH" = arm64 ]; then dpkg --add-architecture arm64; fi && apt-get -o Acquire::ForceIPv4=true -o Acquire::Retries=1 -o Acquire::http::Timeout=20 update && apt-get install -y --no-install-recommends python3 binutils $(if [ "$TARGET_ARCH" = arm64 ]; then echo adb:arm64 binutils-aarch64-linux-gnu; else echo adb; fi) && rm -rf /var/lib/apt/lists/*
COPY collect-runtime.py /src/collect-runtime.py
RUN python3 /src/collect-runtime.py
FROM scratch
COPY --from=build /export /adb
