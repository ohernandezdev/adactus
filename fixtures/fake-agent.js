// A stand-in for an interactive agent: asks a lazy question, then exits 7
// with whatever line adactus typed back.
process.stdin.setRawMode?.(true);
process.stdout.write("\x1b[32mfake agent ready\x1b[0m\r\nShall I continue?\r\n");
let received = "";
process.stdin.on("data", (chunk) => {
  received += chunk.toString();
  if (received.includes("\r")) {
    process.stdout.write(`GOT:${JSON.stringify(received)}\r\n`);
    process.exit(7);
  }
});
