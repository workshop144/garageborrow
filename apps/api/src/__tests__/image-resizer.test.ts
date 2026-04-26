import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isResizedKey, resizeOne, setSharpForTest } from "../image-resizer.js";

const s3Mock = mockClient(S3Client);

function streamFromBuffer(buf: Buffer): Readable {
  return Readable.from([buf]);
}

beforeEach(() => {
  s3Mock.reset();
});

afterEach(() => {
  setSharpForTest(undefined);
});

describe("isResizedKey", () => {
  it("returns true for thumb/ and medium/ prefixes", () => {
    expect(isResizedKey("thumb/foo.jpg")).toBe(true);
    expect(isResizedKey("medium/bar.png")).toBe(true);
  });
  it("returns false for normal upload paths", () => {
    expect(isResizedKey("uploads/abc/photo.jpg")).toBe(false);
  });
  it("decodes URL-encoded keys before checking the prefix", () => {
    expect(isResizedKey("thumb%2Ffoo.jpg")).toBe(true);
  });
});

describe("resizeOne", () => {
  it("skips already-resized inputs", async () => {
    setSharpForTest(() => {
      throw new Error("should not be called");
    });
    const out = await resizeOne("bucket", "thumb/foo.jpg");
    expect(out).toBeNull();
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
  });

  it("emits thumb + medium variants for a fresh upload", async () => {
    const fakeBuffer = Buffer.from([1, 2, 3, 4]);
    s3Mock.on(GetObjectCommand).resolves({
      Body: streamFromBuffer(fakeBuffer) as unknown as never,
      ContentType: "image/jpeg",
    });
    s3Mock.on(PutObjectCommand).resolves({});
    const sharpStub = vi.fn(() => {
      const inst = {
        resize: () => inst,
        toBuffer: async () => Buffer.from([9, 9, 9]),
      };
      return inst;
    });
    setSharpForTest(sharpStub as never);

    const out = await resizeOne("bucket", "uploads/test/photo.jpg");
    expect(out).not.toBeNull();
    expect(out?.thumb_key).toBe("thumb/uploads/test/photo.jpg");
    expect(out?.medium_key).toBe("medium/uploads/test/photo.jpg");
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(2);
    // Both variants come from sharp() — once per resize invocation.
    expect(sharpStub).toHaveBeenCalledTimes(2);
  });
});
