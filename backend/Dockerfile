FROM python:3.13-slim

# Copy uv into the image
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app

# Optional but recommended for faster, cleaner installs
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN apt-get update && apt-get install -y --no-install-recommends postgresql-client 
#    && ln -sf /nix/orb/sys/bin/sh /bin/sh \
#    && rm -rf /var/lib/apt/lists/*

# Copy dependency metadata first for better layer caching
COPY pyproject.toml uv.lock ./

# Install dependencies into /app/.venv
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --no-dev --frozen

RUN uv pip install --system -e ".[dev]"

COPY . .

RUN chmod +x start.sh

CMD ["./start.sh"]
