// The tests use some of the server's own packages (Prisma's client and CLI), so
// they need the server's dependencies installed (`npm ci` in timecapsule-server).
import { createRequire } from "node:module";
import path from "node:path";

export const serverDir = path.resolve(import.meta.dirname, "..", "..", "timecapsule-server");
export const requireFromServer = createRequire(path.join(serverDir, "package.json"));
