import {
  CopyObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { mockClient } from "aws-sdk-client-mock";
import { beforeEach, describe, expect, it } from "vitest";

import {
  hasPhoneSegment,
  migratePhotoKeys,
  migratedKey,
  rewritePhotoKeys,
} from "../lib/photo-key-migration.js";
import { installDdbMock, listAll, resetDdbStore, seedItem } from "./_setup.js";

const DIGITS = "15555550100";
const OLD = `uploads/tool_photo/${DIGITS}/01J9ZK3Q7V8M2N4P6R8T0W2Y4A.jpg`;
const NEW = "uploads/tool_photo/01J9ZK3Q7V8M2N4P6R8T0W2Y4A.jpg";
const TABLE = "GarageBorrow-test";
const BUCKET = "garageborrow-images-test";

describe("photo key helpers", () => {
  it("finds the phone segment in originals and resized copies only", () => {
    expect(hasPhoneSegment(OLD)).toBe(true);
    expect(hasPhoneSegment(`thumb/${OLD}`)).toBe(true);
    expect(hasPhoneSegment(`https://cdn.example/medium/${OLD}`)).toBe(true);
    expect(hasPhoneSegment(NEW)).toBe(false);
    expect(hasPhoneSegment("uploads/tool_photo/12345/x.jpg")).toBe(false); // too short for a phone
  });

  it("maps an old key to its opaque form and is idempotent", () => {
    expect(migratedKey(OLD)).toBe(NEW);
    expect(migratedKey(`thumb/${OLD}`)).toBe(`thumb/${NEW}`);
    expect(migratedKey(NEW)).toBe(NEW);
  });

  it("rewrites every copy inside a row, leaving other strings alone", () => {
    const row = {
      PK: "TENANT#g",
      SK: "ITEM#1",
      primary_photo_key: OLD,
      photo_keys: [OLD, NEW],
      photo_url: `https://cdn.example/${OLD}`,
      before_snapshot: { item: { primary_photo_key: OLD } },
      note: `call ${DIGITS}`,
    };
    const out = rewritePhotoKeys(row) as typeof row;
    expect(JSON.stringify(out)).not.toContain(`/${DIGITS}/`);
    expect(out.photo_keys).toEqual([NEW, NEW]);
    expect(out.before_snapshot.item.primary_photo_key).toBe(NEW);
    expect(out.note).toBe(`call ${DIGITS}`);
  });
});

describe("migratePhotoKeys", () => {
  const s3Mock = mockClient(S3Client);
  let objects: Set<string>;

  beforeEach(() => {
    resetDdbStore();
    installDdbMock();
    objects = new Set([OLD, `thumb/${OLD}`, `medium/${OLD}`, "uploads/tool_photo/other.jpg"]);
    s3Mock.reset();
    s3Mock
      .on(ListObjectsV2Command)
      .callsFake(() =>
        Promise.resolve({ Contents: [...objects].map((Key) => ({ Key })), IsTruncated: false }),
      );
    s3Mock.on(CopyObjectCommand).callsFake((input: { Key: string; CopySource: string }) => {
      const source = decodeURIComponent(input.CopySource.slice(BUCKET.length + 1));
      if (!objects.has(source)) throw new Error("NoSuchKey");
      objects.add(input.Key);
      return Promise.resolve({});
    });
    s3Mock
      .on(DeleteObjectsCommand)
      .callsFake((input: { Delete: { Objects: Array<{ Key: string }> } }) => {
        for (const o of input.Delete.Objects) objects.delete(o.Key);
        return Promise.resolve({});
      });
  });

  function seedRows(): void {
    seedItem({ PK: "TENANT#g", SK: "ITEM#1", name: "Drill", primary_photo_key: OLD });
    seedItem({ PK: "TENANT#g", SK: "DONATION#1", photo_keys: [OLD] });
    seedItem({ PK: "TENANT#g", SK: "ITEM#2", name: "Saw", primary_photo_key: NEW });
  }

  it("dry run counts and changes nothing", async () => {
    seedRows();
    const before = JSON.stringify(listAll());
    const report = await migratePhotoKeys({
      s3: new S3Client({}),
      bucket: BUCKET,
      table: TABLE,
      apply: false,
    });
    expect(report).toMatchObject({ old_objects: 3, objects_copied: 3, rows_referencing: 2 });
    expect(report.objects_deleted).toBe(0);
    expect(JSON.stringify(listAll())).toBe(before);
    expect(objects.has(OLD)).toBe(true);
    expect(s3Mock.commandCalls(CopyObjectCommand)).toHaveLength(0);
  });

  it("copies, repoints rows, then deletes the old objects; a second run is a no-op", async () => {
    seedRows();
    const report = await migratePhotoKeys({
      s3: new S3Client({}),
      bucket: BUCKET,
      table: TABLE,
      apply: true,
    });
    expect(report).toMatchObject({
      old_objects: 3,
      objects_copied: 3,
      rows_rewritten: 2,
      rows_still_referencing: 0,
      objects_deleted: 3,
    });
    expect([...objects].some(hasPhoneSegment)).toBe(false);
    expect(objects.has(NEW) && objects.has(`thumb/${NEW}`)).toBe(true);
    expect(JSON.stringify(listAll())).not.toContain(`/${DIGITS}/`);
    expect(listAll().find((r) => r.SK === "ITEM#1")?.["name"]).toBe("Drill");

    const again = await migratePhotoKeys({
      s3: new S3Client({}),
      bucket: BUCKET,
      table: TABLE,
      apply: true,
    });
    expect(again).toMatchObject({ old_objects: 0, rows_referencing: 0, objects_deleted: 0 });
  });

  it("keeps the old objects while any row still names them", async () => {
    seedRows();
    // A row that cannot be rewritten: its photo key changes again before every write.
    seedItem({ PK: "TENANT#g", SK: "ITEM#3", primary_photo_key: OLD });
    let bump = 0;
    s3Mock.on(CopyObjectCommand).callsFake((input: { Key: string }) => {
      objects.add(input.Key);
      return Promise.resolve({});
    });
    const { ddb } = await import("../lib/ddb.js");
    const original = ddb().send.bind(ddb());
    ddb().send = ((cmd: { input?: { Key?: { SK?: string } } }) => {
      if (cmd.input?.Key?.SK === "ITEM#3") {
        seedItem({ PK: "TENANT#g", SK: "ITEM#3", primary_photo_key: `${OLD}?v=${++bump}` });
      }
      return original(cmd as never);
    }) as never;
    const report = await migratePhotoKeys({
      s3: new S3Client({}),
      bucket: BUCKET,
      table: TABLE,
      apply: true,
    });
    ddb().send = original as never;
    expect(report.rows_gave_up).toBe(1);
    expect(report.rows_still_referencing).toBe(1);
    expect(report.objects_deleted).toBe(0);
    expect(objects.has(OLD)).toBe(true);
  });
});
