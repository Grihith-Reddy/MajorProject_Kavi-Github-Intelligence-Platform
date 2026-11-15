import asyncio
import unittest

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import StreamingResponse

from app.core.middleware import RequestSizeLimitMiddleware


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(RequestSizeLimitMiddleware)

    @app.post("/stream")
    async def stream(request: Request):
        await request.json()

        async def events():
            for index in range(3):
                await asyncio.sleep(0.05)
                yield f"data: {index}\n\n"

        return StreamingResponse(events(), media_type="text/event-stream")

    return app


class StreamingThroughMiddlewareTests(unittest.TestCase):
    def test_streaming_response_is_not_cancelled_after_body_replay(self):
        async def run():
            transport = httpx.ASGITransport(app=_app())
            async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
                response = await client.post("/stream", json={"q": "hello"})
                return response.text

        body = asyncio.run(run())
        self.assertEqual(body, "data: 0\n\ndata: 1\n\ndata: 2\n\n")


if __name__ == "__main__":
    unittest.main()
