# ComfyUI for developing/testing the poser custom node, with CUDA PyTorch.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

# Installed before the ComfyUI checkout so every ComfyUI version shares this (large) layer.
# cu130 supports Blackwell (RTX 50xx, sm_120) and needs an NVIDIA driver with CUDA >= 13.0.
# Build with TORCH_INDEX=https://download.pytorch.org/whl/cpu for a CPU-only image.
ARG TORCH_INDEX=https://download.pytorch.org/whl/cu130
RUN pip install --no-cache-dir torch torchvision torchaudio --index-url ${TORCH_INDEX}

# Triton (pulled in by CUDA torch) compiles kernels at runtime and needs a C compiler.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev \
 && rm -rf /var/lib/apt/lists/*

ARG COMFYUI_VERSION=v0.39.2
RUN git clone --depth 1 --branch ${COMFYUI_VERSION} https://github.com/comfy-org/comfyui /comfyui

WORKDIR /comfyui
RUN pip install --no-cache-dir -r requirements.txt \
 && pip install --no-cache-dir pytest

# Extra ComfyUI flags, e.g. COMFY_ARGS="--cpu" or "--lowvram".
ENV COMFY_ARGS=""
EXPOSE 8188
CMD ["sh", "-c", "exec python main.py --listen 0.0.0.0 --port 8188 $COMFY_ARGS"]
