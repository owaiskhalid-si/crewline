// The map draws tiles in a web worker, which has to be served as its own file: a bundler can't
// inline it. Copied from the installed package so its version always matches.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve("maplibre-gl/package.json"));
mkdirSync("public", { recursive: true });
copyFileSync(join(pkg, "dist/maplibre-gl-worker.mjs"), "public/maplibre-gl-worker.mjs");
