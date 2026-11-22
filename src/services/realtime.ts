import { EventEmitter } from "node:events";

// Internal post-commit notifications. Never publish from a transaction callback.
export const committedChanges = new EventEmitter();
