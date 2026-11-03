# ioHealth in a container: the iPhone's upload API and the web app on port 47800. Everything it keeps is in MariaDB
# (DB_* and IOTHING_AUTH_DB_*); nothing is written to disk. See docker-compose.yml.
FROM python:3.12-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends git && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml ./
COPY app ./app
COPY static ./static
RUN pip install --no-cache-dir -e . && apt-get purge -y git && apt-get autoremove -y
# runs as its own user (uid 1000), not as root, like iopix and ionotes
RUN useradd --uid 1000 --user-group --create-home --shell /usr/sbin/nologin iohealth && chown -R iohealth:iohealth /app
ENV PYTHONUNBUFFERED=1
EXPOSE 47800
USER iohealth
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:47800/v1/health', timeout=4)" || exit 1
CMD ["python", "-m", "app"]
