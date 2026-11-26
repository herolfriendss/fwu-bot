import { describe, expect, it } from "vitest";
import { readBoundedText } from "@/lib/http-body";

function streamed(parts: string[]): Request {
  const encoder = new TextEncoder();
  let pulled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= parts.length) return controller.close();
      controller.enqueue(encoder.encode(parts[pulled++]));
    },
  });
  return new Request("https://example.test/api", { method: "POST", body, duplex: "half" } as RequestInit);
}

describe("readBoundedText", () => {
  it("returns the body when it fits", async () => {
    const request = new Request("https://example.test/api", { method: "POST", body: "{\"ok\":true}" });
    expect(await readBoundedText(request, 100)).toBe("{\"ok\":true}");
  });

  it("refuses a declared Content-Length above the limit without reading", async () => {
    const request = new Request("https://example.test/api", { method: "POST", body: "x".repeat(50), headers: { "content-length": "5000" } });
    expect(await readBoundedText(request, 100)).toBeNull();
  });

  it("stops a chunked body as soon as it crosses the limit", async () => {
    expect(await readBoundedText(streamed(["a".repeat(60), "b".repeat(60), "c".repeat(60)]), 100)).toBeNull();
    expect(await readBoundedText(streamed(["é".repeat(10), "z"]), 100)).toBe(`${"é".repeat(10)}z`);
  });

  it("counts bytes, not characters", async () => {
    // 60 × "é" = 120 bytes in UTF-8.
    expect(await readBoundedText(streamed(["é".repeat(60)]), 100)).toBeNull();
  });
});
