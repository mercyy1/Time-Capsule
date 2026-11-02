const { BackgroundTasks } = require("./helpers/app");

afterEach(() => jest.restoreAllMocks());

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("runs work without making the caller wait, and idle() waits for it", async () => {
  const tasks = new BackgroundTasks();
  const done = [];

  tasks.run("slow work", async () => {
    await tick();
    done.push("slow");
  });
  expect(done).toEqual([]);

  await tasks.idle();
  expect(done).toEqual(["slow"]);
});

test("idle() also waits for work started by other work", async () => {
  const tasks = new BackgroundTasks();
  const done = [];

  tasks.run("first", async () => {
    await tick();
    tasks.run("second", async () => {
      await tick();
      done.push("second");
    });
    done.push("first");
  });

  await tasks.idle();
  expect(done).toEqual(["first", "second"]);
});

test("a failure goes to onError with its description; other work carries on", async () => {
  const failures = [];
  const tasks = new BackgroundTasks({
    onError: (err, description) => failures.push([description, err.message]),
  });
  const done = [];

  tasks.run("broken work", () => {
    throw new Error("boom");
  });
  tasks.run("fine work", async () => done.push("fine"));
  await tasks.idle();

  expect(failures).toEqual([["broken work", "boom"]]);
  expect(done).toEqual(["fine"]);
});

test("failures are logged by default", async () => {
  const log = jest.spyOn(console, "error").mockImplementation(() => {});
  const tasks = new BackgroundTasks();
  const failure = new Error("boom");

  tasks.run("send an email", async () => {
    throw failure;
  });
  await tasks.idle();

  expect(log).toHaveBeenCalledWith("Background work failed (send an email):", failure);
});
