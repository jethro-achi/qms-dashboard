import { describe, it, expect } from "vitest";
import {
  isAllowedMime,
  readAttachment,
  newAttachmentKey,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/message-attachments";

describe("attachment MIME allow-list", () => {
  it("permits documents and images", () => {
    for (const m of ["image/png", "image/jpeg", "application/pdf", "text/csv", "image/svg+xml"]) {
      expect(isAllowedMime(m)).toBe(true);
    }
  });

  it("rejects executable / active content types", () => {
    for (const m of ["text/html", "application/javascript", "application/x-msdownload", "application/x-sh", ""]) {
      expect(isAllowedMime(m)).toBe(false);
    }
  });
});

describe("readAttachment — path-traversal guard", () => {
  it("refuses keys containing traversal or separators", () => {
    expect(readAttachment("../../etc/passwd")).toBeNull();
    expect(readAttachment("..\\..\\secret")).toBeNull();
    expect(readAttachment("sub/dir")).toBeNull();
  });

  it("returns null for a well-formed but nonexistent key", () => {
    expect(readAttachment(newAttachmentKey())).toBeNull();
  });
});

describe("upload limits", () => {
  it("caps attachments at 10 MB", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(10 * 1024 * 1024);
  });

  it("generates opaque UUID keys", () => {
    expect(newAttachmentKey()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});
