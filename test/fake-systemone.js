// A stand-in System One server for tests: answers every noul question
// with the probability `answer(questionId, state)` returns.
import http from "node:http";

export async function startFakeSystemOne(answer, { status = 200 } = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const request = JSON.parse(body);
      requests.push({ request, headers: req.headers });
      if (status !== 200) {
        res.writeHead(status);
        res.end("boom");
        return;
      }
      const answers = Object.fromEntries(
        Object.keys(request.questions).map((id) => [id, { type: "noul", noul: answer(id, request.state) }]),
      );
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ model: "fake-1", answers, usage: { input_tokens: 1, output_tokens: 0 } }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}/v1/systemone`,
    requests,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

/** Answer as a clean lazy pause: asks to continue, nothing else. */
export const lazyPause = (id) => (id === "asks_to_continue" ? 0.9 : 0.05);
/** Answer as a genuine final answer. */
export const finished = (id) => (id === "claims_done" ? 0.9 : 0.05);
