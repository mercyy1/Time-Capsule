const http = require("node:http");
const { BackgroundTasks, shutdown } = require("./helpers/app");

const { createShutdown } = shutdown;

// A real HTTP server: GET /slow waits until the test calls answerSlow(), and
// anything else is answered at once.
async function startServer() {
  const waiting = [];
  const server = http.createServer((req, res) => {
    if (req.url === "/slow") waiting.push(() => res.end("slow done"));
    else res.end("fast");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    waiting,
    answerSlow: () => waiting.splice(0).forEach((answer) => answer()),
  };
}

// Resolves once `condition()` is true (checked every 10 ms).
async function until(condition) {
  while (!condition()) await new Promise((resolve) => setTimeout(resolve, 10));
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe("graceful shutdown", () => {
  // New for every test, so a stop a test abandoned can't count in the next one.
  let running, events, log, disconnect;

  beforeEach(async () => {
    running = await startServer();
    events = [];
    log = jest.fn();
    disconnect = jest.fn(async () => events.push("database disconnected"));
  });
  // Whatever a test left open (a request it never answered) is cut off.
  afterEach(async () => {
    running.server.closeAllConnections();
    await new Promise((resolve) => running.server.close(() => resolve()));
  });

  test("finishes the requests and the background work in progress, then closes the database", async () => {
    const tasks = new BackgroundTasks();
    const answer = fetch(`${running.url}/slow`).then((res) => res.text());
    await until(() => running.waiting.length === 1);
    let finishEmail;
    tasks.run("send an email", async () => {
      await new Promise((resolve) => (finishEmail = resolve));
      events.push("email sent");
    });

    const stopping = createShutdown({ server: running.server, tasks, disconnect, log })("SIGTERM");

    expect(log).toHaveBeenCalledWith(
      "SIGTERM received: finishing the requests and emails in progress, then stopping.",
    );
    // No new connections from now on...
    expect(running.server.listening).toBe(false);
    // ...but the request in progress gets its answer.
    running.answerSlow();
    expect(await answer).toBe("slow done");
    // The email isn't sent yet, so the database stays connected.
    await pause(200);
    expect(disconnect).not.toHaveBeenCalled();

    finishEmail();
    await expect(stopping).resolves.toBe(true);
    expect(events).toEqual(["email sent", "database disconnected"]);
    expect(log).toHaveBeenCalledTimes(1);
  });

  test("doesn't wait for a connection kept open for the next request (keep-alive)", async () => {
    // fetch keeps its connection open for seconds after an answer, like the
    // host's proxy does, hoping to reuse it.
    const answer = fetch(`${running.url}/slow`).then((res) => res.text());
    await until(() => running.waiting.length === 1);
    const stopping = createShutdown({
      server: running.server,
      tasks: new BackgroundTasks(),
      disconnect,
      log,
    })("SIGTERM");

    running.answerSlow();
    await answer;
    const answeredAt = Date.now();
    await expect(stopping).resolves.toBe(true);

    expect(Date.now() - answeredAt).toBeLessThan(1000);
  });

  test("stops anyway after the time limit, and says so", async () => {
    fetch(`${running.url}/slow`).catch(() => {}); // never answered; cut off afterwards
    await until(() => running.waiting.length === 1);

    const stopping = createShutdown({
      server: running.server,
      tasks: new BackgroundTasks(),
      disconnect,
      log,
      timeoutMs: 100,
    })("SIGTERM");

    await expect(stopping).resolves.toBe(false);
    expect(log).toHaveBeenLastCalledWith("Still busy after 0.1 seconds: stopping anyway.");
    expect(disconnect).not.toHaveBeenCalled();
  });

  test("a second signal while stopping changes nothing", async () => {
    const stop = createShutdown({
      server: running.server,
      tasks: new BackgroundTasks(),
      disconnect,
      log,
    });

    const first = stop("SIGTERM");
    const second = stop("SIGINT");

    expect(second).toBe(first);
    await expect(first).resolves.toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
