FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    CHAOS_DATA_DIR=/data CHAOS_FIXTURES_DIR=/app/fixtures
WORKDIR /app/services/api
COPY services/api/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY fixtures /app/fixtures
COPY services/api/app ./app
RUN useradd --create-home --uid 10001 chaos && mkdir -p /data && chown chaos /data
USER chaos
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s CMD python -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8000/api/v1/health')"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
