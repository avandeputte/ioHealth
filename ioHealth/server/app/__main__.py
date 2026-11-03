"""`python -m app`: serve on LISTEN_ADDR (default :47800), plain HTTP for a reverse proxy, or HTTPS when
TLS_CERT_FILE and TLS_KEY_FILE are set."""
import uvicorn

from app import config

host, port = config.listen()
kw = {}
if config.TLS_CERT_FILE and config.TLS_KEY_FILE:
    kw = {"ssl_certfile": config.TLS_CERT_FILE, "ssl_keyfile": config.TLS_KEY_FILE}
uvicorn.run("app.main:app", host=host, port=port, proxy_headers=True, forwarded_allow_ips="*", timeout_keep_alive=120, **kw)
