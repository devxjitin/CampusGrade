"""Gunicorn settings for the API container.

The API only serves HTTP: background work lives in the worker service (Sprint 2).
`FORWARDED_ALLOW_IPS` must stay restricted to the reverse proxy's network in
production; compose sets it because the API is only reachable from the proxy.
"""

import os

bind = f"0.0.0.0:{os.getenv('PORT', '5001')}"
worker_class = "uvicorn.workers.UvicornWorker"
workers = int(os.getenv("WEB_CONCURRENCY", "2"))
# Repository uploads and archive downloads can be slow; AI/repo work is not done here.
timeout = int(os.getenv("GUNICORN_TIMEOUT", "120"))
graceful_timeout = 30
keepalive = 5
# Heartbeat files on tmpfs so the container can run with a read-only root filesystem.
worker_tmp_dir = "/dev/shm"
# Recycle workers occasionally to bound memory growth; jitter avoids simultaneous restarts.
max_requests = 2000
max_requests_jitter = 200
accesslog = None
errorlog = "-"
