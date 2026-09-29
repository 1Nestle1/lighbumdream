# whisper.cpp HTTP server, built for portability.
# The official image is compiled for newer CPUs and dies with "illegal instruction"
# on common hardware (e.g. 10th-gen Intel desktops). On x86 this targets AVX2,
# which every Intel/AMD CPU since about 2013 has.
FROM ubuntu:24.04 AS build
ARG WHISPER_REF=v1.9.4
RUN apt-get update \
 && apt-get install -y --no-install-recommends build-essential cmake git ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch "${WHISPER_REF}" https://github.com/ggml-org/whisper.cpp /src
WORKDIR /src
RUN if [ "$(uname -m)" = "x86_64" ]; then CPU_FLAGS="-DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON"; fi \
 && cmake -B build -DCMAKE_BUILD_TYPE=Release -DGGML_NATIVE=OFF -DBUILD_SHARED_LIBS=OFF \
      -DWHISPER_BUILD_TESTS=OFF ${CPU_FLAGS} \
 && cmake --build build -j"$(nproc)" --target whisper-server

FROM ubuntu:24.04
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg curl ca-certificates libgomp1 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/build/bin/whisper-server /usr/local/bin/whisper-server
COPY --from=build /src/models/download-ggml-model.sh /usr/local/bin/download-ggml-model.sh
# Unprivileged user: the server accepts file uploads, so don't run it as root.
RUN useradd --create-home whisper && mkdir /models && chown whisper /models
USER whisper
WORKDIR /home/whisper
EXPOSE 8080
