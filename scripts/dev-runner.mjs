import { spawn } from "node:child_process";
import { existsSync, watch } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const srcDir = resolve(root, "src");
const distServer = resolve(root, "dist", "server.js");
const tscBin = resolve(root, "node_modules", "typescript", "bin", "tsc");

let server;
let building = false;
let pending = false;
let debounce;

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: "inherit"
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
      }
    });
  });
}

async function buildAndRestart() {
  if (building) {
    pending = true;
    return;
  }

  building = true;
  try {
    await run(process.execPath, [tscBin]);
    restartServer();
  } catch (error) {
    console.error(error.message);
  } finally {
    building = false;
    if (pending) {
      pending = false;
      void buildAndRestart();
    }
  }
}

function restartServer() {
  if (!existsSync(distServer)) {
    return;
  }

  if (server) {
    server.kill();
  }

  server = spawn(process.execPath, [distServer], {
    cwd: root,
    stdio: "inherit"
  });
}

function scheduleBuild() {
  clearTimeout(debounce);
  debounce = setTimeout(() => void buildAndRestart(), 150);
}

watch(srcDir, { recursive: true }, scheduleBuild);

process.on("SIGINT", () => {
  server?.kill();
  process.exit(0);
});

void buildAndRestart();

