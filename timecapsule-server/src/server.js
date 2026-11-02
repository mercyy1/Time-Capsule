// Starts the API: loads .env, checks the settings, then listens for requests.
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

createApp().listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});
