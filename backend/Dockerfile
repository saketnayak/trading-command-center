FROM python:3.12-slim

WORKDIR /app

RUN pip install uv
COPY pyproject.toml .
RUN uv pip install --system -e ".[dev]"

# Patch TradingAgents to add technical analyst support
COPY patches/ /tmp/tradingagents_patches/
RUN python /tmp/tradingagents_patches/apply_patches.py

COPY . .

RUN chmod +x start.sh
CMD ["./start.sh"]
