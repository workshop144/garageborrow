import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  handler,
  isPermanentResizeError,
  isResizedKey,
  MAX_INPUT_PIXELS,
  resizeOne,
  setSharpForTest,
} from "../image-resizer.js";

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
  it("returns true for img/ variant prefixes and the legacy thumb/ and medium/ ones", () => {
    expect(isResizedKey("img/thumb/uploads/a/foo.jpg")).toBe(true);
    expect(isResizedKey("img/medium/uploads/a/bar.png")).toBe(true);
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
        clone: () => inst,
        rotate: () => inst,
        resize: () => inst,
        toBuffer: async () => Buffer.from([9, 9, 9]),
      };
      return inst;
    });
    setSharpForTest(sharpStub as never);

    const out = await resizeOne("bucket", "uploads/test/photo.jpg");
    expect(out).not.toBeNull();
    expect(out?.thumb_key).toBe("img/thumb/uploads/test/photo.jpg");
    expect(out?.medium_key).toBe("img/medium/uploads/test/photo.jpg");
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(2);
    // F11: the input is decoded once, with a pixel limit; both variants clone it.
    expect(sharpStub).toHaveBeenCalledTimes(1);
    expect(sharpStub).toHaveBeenCalledWith(fakeBuffer, {
      limitInputPixels: MAX_INPUT_PIXELS,
      failOn: "error",
    });
  });
});

describe("handler retries", () => {
  const event = (key: string) => ({
    Records: [{ s3: { bucket: { name: "bucket" }, object: { key } } }],
  });

  it("rethrows a transient S3 failure so Lambda retries the event", async () => {
    const throttled = Object.assign(new Error("Slow Down"), { name: "SlowDown" });
    s3Mock.on(GetObjectCommand).rejects(throttled);
    await expect(handler(event("uploads/item/a.jpg") as never)).rejects.toThrow("Slow Down");
  });

  it("swallows a permanent failure (object gone, not an image)", async () => {
    s3Mock.on(GetObjectCommand).rejects(Object.assign(new Error("gone"), { name: "NoSuchKey" }));
    await expect(handler(event("uploads/item/a.jpg") as never)).resolves.toEqual({ processed: 0 });

    s3Mock.on(GetObjectCommand).resolves({
      Body: streamFromBuffer(Buffer.from([1])) as unknown as never,
    });
    setSharpForTest((() => {
      throw new Error("Input buffer contains unsupported image format");
    }) as never);
    await expect(handler(event("uploads/item/b.jpg") as never)).resolves.toEqual({ processed: 0 });
  });
});

// GB-R1-2: the variants are the only images members ever load, so they must
// carry no EXIF (GPS position of a member's home, camera serial, capture time).
// Runs the real sharp, not a stub.
describe("variants drop photo metadata", () => {
  async function jpegWithGps(orientation = 1): Promise<Buffer> {
    const sharp = (await import("sharp")).default;
    return sharp({
      create: { width: 1600, height: 800, channels: 3, background: { r: 200, g: 40, b: 40 } },
    })
      .jpeg()
      .withExif({
        IFD0: { Make: "TestCam", Model: "Serial-12345" },
        IFD3: {
          GPSLatitudeRef: "N",
          GPSLatitude: "40/1 26/1 46/1",
          GPSLongitudeRef: "W",
          GPSLongitude: "79/1 58/1 56/1",
        },
      })
      .withMetadata({ orientation })
      .toBuffer();
  }

  async function resizeWithRealSharp(input: Buffer, key: string): Promise<Buffer[]> {
    s3Mock.on(GetObjectCommand).resolves({
      Body: streamFromBuffer(input) as unknown as never,
      ContentType: "image/jpeg",
    });
    s3Mock.on(PutObjectCommand).resolves({});
    setSharpForTest(undefined);
    const out = await resizeOne("bucket", key);
    expect(out).not.toBeNull();
    return s3Mock.commandCalls(PutObjectCommand).map((c) => c.args[0].input.Body as Buffer);
  }

  it("the fixture really has GPS EXIF (guards the test itself)", async () => {
    const sharp = (await import("sharp")).default;
    const meta = await sharp(await jpegWithGps()).metadata();
    expect(meta.exif?.length ?? 0).toBeGreaterThan(0);
    expect(meta.exif?.toString("latin1")).toContain("Serial-12345");
    expect((await sharp(await jpegWithGps(6)).metadata()).orientation).toBe(6);
  });

  it("writes thumb and medium with no EXIF, XMP, IPTC or ICC block", async () => {
    const sharp = (await import("sharp")).default;
    const outputs = await resizeWithRealSharp(await jpegWithGps(), "uploads/wishlist_photo/a.jpg");
    expect(outputs).toHaveLength(2);
    for (const buf of outputs) {
      const meta = await sharp(buf).metadata();
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.iptc).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      expect(meta.orientation).toBeUndefined();
      expect(buf.toString("latin1")).not.toContain("Serial-12345");
      expect(buf.toString("latin1")).not.toContain("Exif\0\0");
    }
    const widths = await Promise.all(outputs.map(async (b) => (await sharp(b).metadata()).width));
    expect(widths.sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([256, 1024]);
  });

  it("bakes the EXIF orientation into the pixels before dropping the tag", async () => {
    const sharp = (await import("sharp")).default;
    // Orientation 6 = rotate 90° clockwise to display: the 1600x800 landscape
    // pixels are a portrait photo, so the variants must come out portrait.
    const outputs = await resizeWithRealSharp(await jpegWithGps(6), "uploads/tool_photo/r.jpg");
    for (const buf of outputs) {
      const meta = await sharp(buf).metadata();
      expect(meta.orientation).toBeUndefined();
      expect(meta.height ?? 0).toBeGreaterThan(meta.width ?? 0);
    }
  });

  it("refuses a decompression bomb (over MAX_INPUT_PIXELS) as a permanent error", async () => {
    const sharp = (await import("sharp")).default;
    // 7000 x 7000 = 49 MP of one colour: a few KB as PNG, ~150 MB decoded.
    const bomb = await sharp({
      create: { width: 7000, height: 7000, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    expect(bomb.length).toBeLessThan(2_000_000);
    // A fresh stream per GetObject: the handler below fetches it again.
    s3Mock.on(GetObjectCommand).callsFake(() => ({
      Body: streamFromBuffer(bomb) as unknown as never,
      ContentType: "image/png",
    }));
    s3Mock.on(PutObjectCommand).resolves({});
    setSharpForTest(undefined);
    const err = await resizeOne("bucket", "uploads/tool_photo/bomb.png").catch((e: unknown) => e);
    expect((err as Error).message).toMatch(/pixel limit/);
    expect(isPermanentResizeError(err)).toBe(true);
    expect(s3Mock.commandCalls(PutObjectCommand)).toHaveLength(0);
    // The handler swallows it: no retry, nothing lands in the DLQ.
    await expect(
      handler({
        Records: [
          { s3: { bucket: { name: "bucket" }, object: { key: "uploads/tool_photo/bomb.png" } } },
        ],
      }),
    ).resolves.toEqual({ processed: 0 });
  });

  it("never resizes a key outside uploads/", async () => {
    setSharpForTest(() => {
      throw new Error("should not be called");
    });
    expect(await resizeOne("bucket", "other/x.jpg")).toBeNull();
    expect(s3Mock.commandCalls(GetObjectCommand)).toHaveLength(0);
  });
});
