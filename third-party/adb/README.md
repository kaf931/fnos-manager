# ADB runtime

Google Android Debug Bridge packaged from Debian trixie `adb` 1:34.0.5-12 for x86_64 and ARM64. `Dockerfile` builds a self-contained runtime including the ELF loader and the dependency closure; Docker is build-only. Exported runtimes go into `tools/adb/{x64,arm64}`. The package verifier checks every file's SHA-256 and ELF architecture. Each export contains dependency copyright notices and common license texts.

Build on a Linux x86_64 Docker host:

```sh
docker build --network=host --build-arg TARGET_ARCH=x64 --output type=local,dest=build/adb-x64 third-party/adb
docker build --network=host --build-arg TARGET_ARCH=arm64 --output type=local,dest=build/adb-arm64 third-party/adb
```

Copy each exported `adb` directory into `tools/adb/{arch}`. Version updates require reviewing the pinned verifier and dependency licenses. NAS runtime uses one loopback server and a restricted credential directory per application user; no global ADB service is used.
