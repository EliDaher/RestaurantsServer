import { createHash } from "node:crypto";
import { env } from "../config/env.js";
import { HttpError } from "../utils/http.js";

type UploadInput = {
  dataUrl: string;
  fileName: string;
};

export async function uploadImageToCloudinary(input: UploadInput) {
  const { CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET, CLOUDINARY_CLOUD_NAME } = env;
  if (!CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET || !CLOUDINARY_CLOUD_NAME) {
    throw new HttpError(503, "Cloudinary is not configured");
  }

  const match = input.dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) {
    throw new HttpError(400, "Image must be sent as a valid data URL");
  }

  const [, mimeType, base64] = match;
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
    throw new HttpError(400, "Image must be smaller than 8MB");
  }

  const timestamp = Math.round(Date.now() / 1000).toString();
  const signature = createHash("sha1")
    .update(`timestamp=${timestamp}${CLOUDINARY_API_SECRET}`)
    .digest("hex");

  const form = new FormData();
  form.append("file", new Blob([buffer], { type: mimeType }), input.fileName);
  form.append("api_key", CLOUDINARY_API_KEY);
  form.append("timestamp", timestamp);
  form.append("signature", signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: "POST",
    body: form
  });

  const payload = (await response.json().catch(() => null)) as { secure_url?: string; public_id?: string; error?: { message?: string } } | null;
  if (!response.ok || !payload?.secure_url) {
    throw new HttpError(response.status || 502, payload?.error?.message ?? "Image upload failed");
  }

  return { url: payload.secure_url, publicId: payload.public_id ?? "" };
}
