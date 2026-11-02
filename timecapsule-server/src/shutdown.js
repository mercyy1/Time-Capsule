// Stopping without cutting anyone off. A host stops the server with SIGTERM on
// every deploy and restart; Render then waits 30 seconds before killing it. In
// that time the server stops taking new connections, lets the requests already
// in progress finish, waits for the work it does after responding (account
// emails), and closes its database connections.
//
// Returns shutdown(signal), which resolves to true once all that is done, or to
// false if it took longer than `timeoutMs` (the process should exit anyway).
// Calling it again returns the same promise.
const SHUTDOWN_TIMEOUT_MS = 25_000;
// How often idle connections are closed while stopping (see below).
const SWEEP_INTERVAL_MS = 100;

function createShutdown({
  server,
  tasks,
  disconnect,
  timeoutMs = SHUTDOWN_TIMEOUT_MS,
  log = console.log,
}) {
  let stopping = null;

  return function shutdown(signal) {
    if (stopping) return stopping;
    log(`${signal} received: finishing the requests and emails in progress, then stopping.`);

    let sweep;
    const finished = (async () => {
      // server.close() stops accepting connections, closes the idle ones, and
      // calls back once every connection is gone. A connection that is busy
      // answering stays open after its answer, though: browsers and the host's
      // proxy keep connections open for their next request (keep-alive), so
      // close() would wait seconds for them to give up. Closing idle connections
      // every 100 ms ends each one right after its last answer.
      const closed = new Promise((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      );
      sweep = setInterval(() => server.closeIdleConnections(), SWEEP_INTERVAL_MS);
      await closed;
      clearInterval(sweep);

      await tasks.idle();
      await disconnect();
      return true;
    })();

    let timer;
    const timedOut = new Promise((resolve) => {
      timer = setTimeout(() => {
        log(`Still busy after ${timeoutMs / 1000} seconds: stopping anyway.`);
        resolve(false);
      }, timeoutMs);
    });

    stopping = Promise.race([finished, timedOut]).finally(() => {
      clearTimeout(timer);
      clearInterval(sweep);
    });
    return stopping;
  };
}

module.exports = { createShutdown, SHUTDOWN_TIMEOUT_MS };
