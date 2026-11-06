import { describe, expect, it } from "vitest";

import { photoUrl } from "../photoUrl";

describe("photoUrl", () => {
  it("serves uploaded keys through /img/", () => {
    expect(photoUrl("uploads/item/01HX.jpg")).toMatch(/\/img\/uploads\/item\/01HX\.jpg$/);
  });

  it.each(["https://x.cloudfront.net/t.gif", "http://a/b.jpg", "//a/b.jpg", "drill.jpg", ""])(
    "renders nothing for %s",
    (key) => {
      expect(photoUrl(key)).toBe("");
    },
  );
});
