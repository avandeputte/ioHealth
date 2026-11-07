"""`python -m app`: the server, as run.sh, the service and the container start it. HOST and PORT (config.env) say where
it listens; TLS_CERT_FILE and TLS_KEY_FILE serve HTTPS directly instead of behind a reverse proxy, and
FORWARDED_ALLOW_IPS says which addresses may tell it the visitor's address and scheme (X-Forwarded-*)."""
import uvicorn

from app import config


def main():
    # timeout_keep_alive: the phone sends an upload's batches over one connection, with pauses between them
    # the app reads X-Forwarded-* itself (iosuite-shared, with FORWARDED_ALLOW_IPS), so uvicorn must not rewrite the peer
    uvicorn.run("app.main:app", host=config.HOST, port=config.PORT, proxy_headers=False, ssl_certfile=config.TLS_CERT_FILE or None,
                ssl_keyfile=config.TLS_KEY_FILE or None, timeout_keep_alive=120)


if __name__ == "__main__":
    main()
