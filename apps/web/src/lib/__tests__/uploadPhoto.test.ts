import { afterEach, describe, expect, it, vi } from "vitest";

import { setAuthTokenProvider } from "../api";
import { uploadPhoto } from "../uploadPhoto";

const S3_URL = "https://bucket.s3.example.test/uploads/tool/abc.jpg?X-Amz-Signature=sig";

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthTokenProvider(() => null);
});

function stubFetch(putStatus = 200, signHeaders?: Record<string, string>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchMock = vi.fn((url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (url.endsWith("/uploads/sign")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            url: S3_URL,
            key: "uploads/tool/abc.jpg",
            expires_in: 300,
            ...(signHeaders ? { headers: signHeaders } : {}),
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );
    }
    return Promise.resolve(new Response(null, { status: putStatus }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

const file = () => new File([new Uint8Array(1234)], "drill.jpg", { type: "image/jpeg" });

describe("uploadPhoto", () => {
  it("signs the declared type and size, then PUTs the file to the signed URL", async () => {
    setAuthTokenProvider(() => "id-token");
    const calls = stubFetch();
    const out = await uploadPhoto(file(), "donation_photo");
    expect(out).toEqual({ key: "uploads/tool/abc.jpg" });

    expect(JSON.parse(String(calls[0]?.init.body))).toEqual({
      kind: "donation_photo",
      content_type: "image/jpeg",
      content_length: 1234,
    });
    const put = calls[1];
    expect(put?.url).toBe(S3_URL);
    expect(put?.init.method).toBe("PUT");
    expect(put?.init.headers).toEqual({ "Content-Type": "image/jpeg", "If-None-Match": "*" });
    // The app's ID token never goes to S3.
    expect(JSON.stringify(put?.init.headers)).not.toContain("id-token");
  });

  it("sends exactly the headers the API signed when it returns them", async () => {
    const calls = stubFetch(200, { "Content-Type": "image/jpeg", "x-amz-meta-k": "v" });
    await uploadPhoto(file());
    expect(calls[1]?.init.headers).toEqual({ "Content-Type": "image/jpeg", "x-amz-meta-k": "v" });
    expect(JSON.parse(String(calls[0]?.init.body)).kind).toBe("tool_photo");
  });

  it("throws when S3 refuses the upload", async () => {
    stubFetch(403);
    await expect(uploadPhoto(file())).rejects.toThrow("Photo upload failed: 403");
  });
});
