import { api } from "./api";

type SignResponse = { url: string; key: string; expires_in: number };

// Two-step S3 upload: ask the API for a presigned PUT URL, then PUT the file
// directly to S3. The returned `key` is what the API persists on the entity.
export async function uploadPhoto(
  file: File,
  kind: "tool_photo" | "donation_photo" | "wishlist_photo" = "tool_photo",
): Promise<{ key: string }> {
  const sign = await api.post<SignResponse>("/uploads/sign", {
    kind,
    content_type: file.type,
  });
  const res = await fetch(sign.url, {
    method: "PUT",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) {
    throw new Error(`Photo upload failed: ${res.status}`);
  }
  return { key: sign.key };
}
