# yt-dlp's YouTube EJS solver requires Node >=22 (or Deno >=2.3).
# The distro 'nodejs' package may be older; ship an explicit supported runtime.
FROM node:22-bookworm-slim AS youtube-js-runtime
FROM python:3.12-slim
COPY --from=youtube-js-runtime /usr/local/bin/node /usr/local/bin/node

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PROCESSING_DB_PATH=/data/processing.db \
    HOME=/tmp/fluentforge-worker

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       tesseract-ocr \
       tesseract-ocr-aze \
       tesseract-ocr-eng \
       tesseract-ocr-rus \
       tesseract-ocr-tur \
       libreoffice-core \
       libreoffice-writer \
       ffmpeg \
       libgl1 \
       libglib2.0-0 \
       tini \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system fluentforge \
    && useradd --system --gid fluentforge --home-dir /nonexistent --shell /usr/sbin/nologin fluentforge

WORKDIR /app
COPY requirements.txt requirements-whisper.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-whisper.txt \
    && node -e 'if (Number(process.versions.node.split(".")[0]) < 22) process.exit(1)'

COPY --chown=fluentforge:fluentforge app ./app
RUN mkdir -p /data /models/whisper \
    && chown -R fluentforge:fluentforge /data /models/whisper /app

USER fluentforge

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=3).read()"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
