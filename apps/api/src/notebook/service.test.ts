import { describe, expect, it } from "vitest";
import { classifyUpload, cleanFileName } from "./service.js";

describe("classifyUpload", () => {
  it("accepts photos as images", () => {
    expect(classifyUpload("image/jpeg", "a.jpg")).toEqual({ kind: "image", mime: "image/jpeg" });
    expect(classifyUpload("image/png; charset=binary", "a.png")).toEqual({ kind: "image", mime: "image/png" });
  });

  it("accepts documents as files", () => {
    expect(classifyUpload("application/pdf", "plan.pdf")).toEqual({ kind: "file", mime: "application/pdf" });
  });

  it("falls back to the extension when the browser sends no type", () => {
    expect(classifyUpload("", "notes.md")).toEqual({ kind: "file", mime: "text/markdown" });
    expect(classifyUpload("application/octet-stream", "data.csv")).toEqual({ kind: "file", mime: "text/csv" });
  });

  it("refuses types that could run as a page", () => {
    expect(classifyUpload("image/svg+xml", "logo.svg")).toBeNull();
    expect(classifyUpload("text/html", "page.html")).toBeNull();
    expect(classifyUpload("application/octet-stream", "run.exe")).toBeNull();
  });
});

describe("cleanFileName", () => {
  it("strips paths and control characters", () => {
    expect(cleanFileName("../../etc/passwd")).toBe("passwd");
    expect(cleanFileName("C:\\Users\\me\\план.pdf")).toBe("план.pdf");
    expect(cleanFileName("a\u0000b.txt")).toBe("ab.txt");
  });

  it("never returns an empty name", () => {
    expect(cleanFileName("")).toBe("file");
  });
});
