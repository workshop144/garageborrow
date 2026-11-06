import { beforeEach, describe, expect, it } from "vitest";
import { tenantMetaKey } from "@garageborrow/shared";

import { __test } from "../notifier.js";
import { installDdbMock, resetDdbStore, seedItem, setScanPageSize } from "./_setup.js";

beforeEach(() => {
  resetDdbStore();
  installDdbMock();
});

describe("notifier garage discovery", () => {
  it("finds every garage even when META rows sit beyond the first Scan page", async () => {
    for (const id of ["g1", "g2", "g3"]) {
      const k = tenantMetaKey(id);
      seedItem({ PK: k.pk, SK: k.sk, id });
      // Filler rows push later META rows onto later pages.
      for (let i = 0; i < 4; i++) seedItem({ PK: k.pk, SK: `AUDIT#${i}` });
    }
    setScanPageSize(3);
    const ids = await __test.listAllGarageIds();
    expect(ids.sort()).toEqual(["g1", "g2", "g3"]);
  });
});
