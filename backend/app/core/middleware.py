import hashlib
import re
import threading
import time
from collections import defaultdict
from uuid import uuid4

from fastapi import Request, status
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp, Receive, Scope, Send

from app.core.audit import audit_log
from app.core.settings import settings


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        supplied_request_id = request.headers.get("X-Request-ID", "")
        request_id = (
            supplied_request_id
            if re.fullmatch(r"[A-Za-z0-9._-]{1,128}", supplied_request_id)
            else str(uuid4())
        )
        request.state.request_id = request_id
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response


class RequestSizeLimitMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        content_lengths = [
            value.decode("latin-1")
            for name, value in scope.get("headers", [])
            if name.lower() == b"content-length"
        ]
        if len(content_lengths) > 1:
            response = JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"detail": "Invalid Content-Length header"},
            )
            await response(scope, receive, send)
            return
        if content_lengths:
            try:
                content_length = int(content_lengths[0])
                if content_length < 0:
                    raise ValueError
            except ValueError:
                response = JSONResponse(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    content={"detail": "Invalid Content-Length header"},
                )
                await response(scope, receive, send)
                return
            if content_length > settings.MAX_REQUEST_BODY_BYTES:
                response = JSONResponse(
                    status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                    content={"detail": "Request body too large"},
                )
                await response(scope, receive, send)
                return

        messages: list[dict] = []
        body_size = 0
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            messages.append(message)
            body_size += len(message.get("body", b""))
            if body_size > settings.MAX_REQUEST_BODY_BYTES:
                response = JSONResponse(
                    status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                    content={"detail": "Request body too large"},
                )
                await response(scope, receive, send)
                return
            if not message.get("more_body", False):
                break

        message_index = 0

        async def replay_receive():
            nonlocal message_index
            if message_index < len(messages):
                message = messages[message_index]
                message_index += 1
                return message
            return {"type": "http.disconnect"}

        await self.app(scope, replay_receive, send)


class RateLimitMiddleware(BaseHTTPMiddleware):
    _lock = threading.Lock()
    _requests: dict[str, dict[int, int]] = defaultdict(dict)
    _max_clients = 10000
    _last_cleanup_window = 0

    async def dispatch(self, request: Request, call_next):
        if request.url.path in {"/", "/health/live", "/health/ready"}:
            return await call_next(request)

        window = int(time.time() // 60)
        key = self._request_key(request)
        allowed = False
        current_count = 0

        with self._lock:
            if window != self._last_cleanup_window:
                expired_keys = []
                for client_key, bucket in self._requests.items():
                    for stale_window in [
                        bucket_window for bucket_window in bucket if bucket_window < window
                    ]:
                        bucket.pop(stale_window, None)
                    if not bucket:
                        expired_keys.append(client_key)
                for client_key in expired_keys:
                    self._requests.pop(client_key, None)
                self._last_cleanup_window = window

            if key not in self._requests and len(self._requests) >= self._max_clients:
                allowed = False
            else:
                bucket = self._requests[key]
                current_count = bucket.get(window, 0)
                if current_count < settings.RATE_LIMIT_REQUESTS_PER_MINUTE:
                    bucket[window] = current_count + 1
                    allowed = True
                    current_count = bucket[window]

        if not allowed:
            audit_log(
                "rate_limit.exceeded",
                key=key,
                path=request.url.path,
                method=request.method,
                request_id=getattr(request.state, "request_id", None),
            )
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                headers={"Retry-After": "60"},
                content={"detail": "Rate limit exceeded"},
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(settings.RATE_LIMIT_REQUESTS_PER_MINUTE)
        response.headers["X-RateLimit-Remaining"] = str(
            max(settings.RATE_LIMIT_REQUESTS_PER_MINUTE - current_count, 0)
        )
        return response

    def _request_key(self, request: Request) -> str:
        client_host = request.client.host if request.client else "unknown"
        client_hash = hashlib.sha256(client_host.encode()).hexdigest()
        return f"ip:{client_hash}"
