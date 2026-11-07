import assert from "node:assert/strict";
import { test } from "node:test";
import { filesOfUser, folderPaths, safeFileName, toFileEntry, type FileEntry } from "../src/lib/files";

test("folderPaths joins parents and treats unknown parents as root", () => {
  const paths = folderPaths([
    { folderId: "c", folderName: "Plans", parentFolderId: "b" },
    { folderId: "b", folderName: "Architect", parentFolderId: "a" },
    { folderId: "a", folderName: "Drawings", parentFolderId: "unknown-root" },
  ]);
  assert.equal(paths.get("c"), "Drawings/Architect/Plans");
  assert.equal(paths.get("a"), "Drawings");
});

test("folderPaths survives cycles", () => {
  const paths = folderPaths([
    { folderId: "a", folderName: "A", parentFolderId: "b" },
    { folderId: "b", folderName: "B", parentFolderId: "a" },
  ]);
  assert.ok(paths.get("a"));
  assert.ok(paths.get("b"));
});

test("toFileEntry maps nulls to undefined and resolves the folder path", () => {
  const entry = toFileEntry(
    { fileId: "f1", fileName: "A-101.pdf", fileAreaId: "fa", folderId: "x", version: null, downloadLink: "https://x" },
    "Documents",
    new Map([["x", "Drawings/Plans"]]),
  );
  assert.equal(entry.folderPath, "Drawings/Plans");
  assert.equal(entry.fileAreaName, "Documents");
  assert.equal(entry.version, undefined);
  assert.equal(entry.downloadLink, "https://x");
});

test("safeFileName strips path separators and leading dots", () => {
  assert.equal(safeFileName("a/b:c.pdf"), "a_b_c.pdf");
  assert.equal(safeFileName("..secret"), "_secret");
  assert.equal(safeFileName(""), "file");
});

test("filesOfUser keeps files the user uploaded or last modified", () => {
  const file = (fileId: string, uploadedByUserId?: string, lastModifiedByUserId?: string): FileEntry => ({
    fileId,
    fileName: fileId,
    fileAreaId: "fa",
    fileAreaName: "Documents",
    folderPath: "",
    uploadedByUserId,
    lastModifiedByUserId,
  });
  const files = [file("a", "u1", "u2"), file("b", "u2", "u1"), file("c", "u2", "u2")];
  assert.deepEqual(
    filesOfUser(files, "u1").map((f) => f.fileId),
    ["a", "b"],
  );
});
