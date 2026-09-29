import { api } from "./api";

type SignResponse = {
  url: string;
  key: string;
  expires_in: number;
  headers?: Record<string, string>;
};

// Two-step S3 upload: ask the API for a presigned PUT URL, then PUT the file
// directly to S3. The returned `key` is what the API persists on the entity.
export async function uploadPhoto(
  file: File,
  kind: "tool_photo" | "donation_photo" | "wishlist_photo" = "tool_photo",
): Promise<{ key: string }> {
  const sign = await api.post<SignResponse>("/uploads/sign", {
    kind,
    content_type: file.type,
    // signed into the URL: S3 refuses a body of any other size
    content_length: file.size,
  });
  const res = await fetch(sign.url, {
    method: "PUT",
    // Signed into the URL: If-None-Match makes it single-use.
    headers: sign.headers ?? { "Content-Type": file.type, "If-None-Match": "*" },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Photo upload failed: ${res.status}`);
  }
  return { key: sign.key };
}
