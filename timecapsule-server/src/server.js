// Starts the API: loads .env, checks the settings, then listens for requests,
// until the host asks it to stop (SIGTERM, or Ctrl+C locally).
require("dotenv").config();

const { getEnv, EnvError } = require("./config/env");

let env;
try {
  env = getEnv();
} catch (err) {
  if (!(err instanceof EnvError)) throw err;
  console.error(err.message);
  process.exit(1);
}

const { createApp } = require("./app");
const { BackgroundTasks } = require("./background");
const { prisma } = require("./db");
const { createShutdown } = require("./shutdown");

const tasks = new BackgroundTasks();
const server = createApp({ tasks }).listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});

const shutdown = createShutdown({ server, tasks, disconnect: () => prisma.$disconnect() });
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    shutdown(signal).then(
      (clean) => process.exit(clean ? 0 : 1),
      (err) => {
        console.error("Couldn't stop cleanly:", err);
        process.exit(1);
      },
    );
  });
}
