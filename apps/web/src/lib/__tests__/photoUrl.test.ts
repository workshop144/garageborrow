import { describe, expect, it } from "vitest";

import { photoUrl } from "../photoUrl";

describe("photoUrl", () => {
  it("serves the medium variant of an uploaded key through /img/ by default", () => {
    expect(photoUrl("uploads/item/01HX.jpg")).toMatch(/\/img\/medium\/uploads\/item\/01HX\.jpg$/);
  });

  it("serves the thumb variant when asked", () => {
    expect(photoUrl("uploads/item/01HX.jpg", "thumb")).toMatch(
      /\/img\/thumb\/uploads\/item\/01HX\.jpg$/,
    );
  });

  // GB-R1-2: the original upload keeps its EXIF (GPS); never point at it.
  it("never renders the original upload", () => {
    for (const size of ["thumb", "medium", undefined] as const) {
      expect(photoUrl("uploads/item/01HX.jpg", size)).not.toMatch(/\/img\/uploads\//);
    }
    // An unexpected size value from untyped callers still maps to a variant.
    expect(photoUrl("uploads/item/01HX.jpg", "original" as never)).toMatch(/\/img\/medium\//);
  });

  it.each(["https://x.cloudfront.net/t.gif", "http://a/b.jpg", "//a/b.jpg", "drill.jpg", ""])(
    "renders nothing for %s",
    (key) => {
      expect(photoUrl(key)).toBe("");
    },
  );
});
