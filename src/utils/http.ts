import type { Response } from "express";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }
}

export function sendJson<T>(res: Response, data: T, status = 200) {
  return res.status(status).json({ data });
}
