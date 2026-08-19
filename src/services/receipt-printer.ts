import net from "node:net";
import { HttpError } from "../utils/http.js";

const defaultCutPort = 9100;
const connectTimeoutMs = 5_000;
const cutCommand = Buffer.from([
  0x1b, 0x64, 0x04,
  0x1d, 0x56, 0x00
]);

export async function sendReceiptCutCommand(input: { host?: string; port?: number }) {
  const host = input.host?.trim();
  if (!host) {
    throw new HttpError(400, "Receipt printer IP is not configured");
  }

  const port = Number.isInteger(input.port) && input.port ? input.port : defaultCutPort;

  await new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const timeout = windowlessTimeout(() => {
      socket.destroy();
      reject(new HttpError(504, "Timed out while connecting to receipt printer"));
    }, connectTimeoutMs);

    socket.once("connect", () => {
      socket.write(cutCommand, (error) => {
        windowlessClearTimeout(timeout);
        if (error) {
          socket.destroy();
          reject(new HttpError(502, "Failed to send cut command to receipt printer"));
          return;
        }
        socket.end();
      });
    });

    socket.once("error", (error) => {
      windowlessClearTimeout(timeout);
      reject(new HttpError(502, "Could not connect to receipt printer", { message: error.message }));
    });

    socket.once("close", () => {
      windowlessClearTimeout(timeout);
      resolve();
    });
  });
}

function windowlessTimeout(callback: () => void, timeoutMs: number) {
  return setTimeout(callback, timeoutMs);
}

function windowlessClearTimeout(timeout: NodeJS.Timeout) {
  clearTimeout(timeout);
}
