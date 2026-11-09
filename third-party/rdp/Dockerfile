# Build-only container; exported runtime requires no Docker on the user's NAS.
FROM debian:bookworm-slim AS build
ARG TARGET_ARCH=x64
ENV TARGET_ARCH=$TARGET_ARCH
RUN sed -i 's|http://deb.debian.org/debian-security|http://mirrors.tuna.tsinghua.edu.cn/debian-security|g; s|http://deb.debian.org/debian|http://mirrors.tuna.tsinghua.edu.cn/debian|g' /etc/apt/sources.list.d/debian.sources && if [ "$TARGET_ARCH" = arm64 ]; then dpkg --add-architecture arm64; fi && apt-get update && apt-get install -y --no-install-recommends build-essential pkg-config ca-certificates python3 libtool-bin $(if [ "$TARGET_ARCH" = arm64 ]; then echo gcc-aarch64-linux-gnu libcairo2-dev:arm64 libjpeg62-turbo-dev:arm64 libpng-dev:arm64 libossp-uuid-dev:arm64 freerdp2-dev:arm64 libssl-dev:arm64; else echo libcairo2-dev libjpeg62-turbo-dev libpng-dev libossp-uuid-dev freerdp2-dev libssl-dev; fi) && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY guacamole-server-1.6.0.tar.gz collect-runtime.py ./
RUN echo '8bc45675da96d7b6f39728160181e3d4ff3c08f460f6d26de5805b642bf13f2b  guacamole-server-1.6.0.tar.gz' | sha256sum -c - && tar xzf guacamole-server-1.6.0.tar.gz && cd guacamole-server-1.6.0 && if [ "$TARGET_ARCH" = arm64 ]; then export CC=aarch64-linux-gnu-gcc PKG_CONFIG_LIBDIR=/usr/lib/aarch64-linux-gnu/pkgconfig:/usr/share/pkgconfig; target=--host=aarch64-linux-gnu; fi && ./configure ${target:-} --prefix=/opt/rdp --without-vnc --without-ssh --without-telnet --disable-guacenc --disable-guaclog && make -j2 && make install
RUN python3 /src/collect-runtime.py
FROM scratch
COPY --from=build /export /rdp
