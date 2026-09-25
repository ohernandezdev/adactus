# /// script
# requires-python = ">=3.12"
# dependencies = ["laya-mlx>=0.2.0"]
# ///
"""Serve the Laya System One model on localhost with the TypeSafe wire format.

    uv run --script server/laya_server.py [--port 8765] [--model convaiinnovations/laya]

POST /v1/systemone  {"state": ..., "model": ..., "questions": {...}} -> Laya's predict() output
GET  /health        {"ok": true, "model": ...}

Binds to 127.0.0.1 only. The model loads once at startup; requests are
served one at a time because MLX inference is not thread-safe.
"""
import argparse
import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import laya_mlx


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--model", default="convaiinnovations/laya")
    args = parser.parse_args()

    print(f"adactus-laya: loading {args.model} ...", file=sys.stderr, flush=True)
    agent = laya_mlx.load(args.model)
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def _send(self, status: int, body: dict) -> None:
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            if self.path == "/health":
                self._send(200, {"ok": True, "model": args.model})
            else:
                self._send(404, {"error": "not found"})

        def do_POST(self) -> None:
            if self.path != "/v1/systemone":
                self._send(404, {"error": "not found"})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                request = json.loads(self.rfile.read(length))
                state, questions = request["state"], request["questions"]
            except (ValueError, KeyError, TypeError) as err:
                self._send(422, {"error": f"invalid request: {err}"})
                return
            try:
                with lock:
                    result = agent.predict(state, questions)
            except Exception as err:  # the model rejected the questions
                self._send(422, {"error": f"predict failed: {err}"})
                return
            self._send(200, result)

        def log_message(self, fmt: str, *values) -> None:
            print(f"adactus-laya: {fmt % values}", file=sys.stderr, flush=True)

    server = ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"adactus-laya: listening on http://127.0.0.1:{args.port}", file=sys.stderr, flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
