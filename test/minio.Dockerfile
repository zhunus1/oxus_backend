# Disposable storage tests only; server/local-development deployment remains unchanged.
# Official prebuilt images are unavailable. Build the fixed upstream source with checksum verification.
FROM golang:1.24.8-alpine AS builder
WORKDIR /source
ADD --checksum=sha256:be6d0bd3696c3a13a35f02d3a0280b64319c67918b4501c5c3d87f96d000085c https://codeload.github.com/minio/minio/tar.gz/refs/tags/RELEASE.2025-10-15T17-29-55Z /tmp/minio.tar.gz
RUN tar -xzf /tmp/minio.tar.gz --strip-components=1 -C /source
RUN CGO_ENABLED=0 go build -trimpath -o /minio .

FROM node:22-alpine
COPY --from=builder /minio /usr/local/bin/minio
USER node
ENTRYPOINT ["minio"]
CMD ["server", "/data", "--address", ":9000"]
