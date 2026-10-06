FROM python:3.12-slim

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
RUN pip install --no-cache-dir -r requirements.txt -r requirements-whisper.txt

COPY --chown=fluentforge:fluentforge app ./app
RUN mkdir -p /data /models/whisper \
    && chown -R fluentforge:fluentforge /data /models/whisper /app

USER fluentforge

EXPOSE 8001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8001/health', timeout=3).read()"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
