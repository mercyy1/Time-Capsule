// Work a request starts but doesn't wait for, such as sending an email after the
// response has gone out (so the response, and how long it takes, doesn't depend
// on it). Nobody is waiting to see a failure, so failures are logged.
class BackgroundTasks {
  #pending = new Set();
  #onError;

  constructor({
    onError = (err, description) => console.error(`Background work failed (${description}):`, err),
  } = {}) {
    this.#onError = onError;
  }

  // Starts `work` (an async function) on its own; `description` names it in logs.
  run(description, work) {
    const task = Promise.resolve()
      .then(work)
      .catch((err) => this.#onError(err, description))
      .finally(() => this.#pending.delete(task));
    this.#pending.add(task);
  }

  // Resolves once all the work started so far, and any it started, is done.
  async idle() {
    while (this.#pending.size > 0) await Promise.all(this.#pending);
  }
}

module.exports = { BackgroundTasks };
