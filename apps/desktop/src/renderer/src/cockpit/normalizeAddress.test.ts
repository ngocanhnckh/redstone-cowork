import { describe, it, expect } from "vitest";
import { normalizeAddress } from "./BrowserPanel";

describe("normalizeAddress", () => {
  it("keeps an existing http/https URL", () => {
    expect(normalizeAddress("https://example.com/x")).toBe("https://example.com/x");
    expect(normalizeAddress("http://foo.dev")).toBe("http://foo.dev");
  });

  it("prepends https:// to a bare domain", () => {
    expect(normalizeAddress("example.com")).toBe("https://example.com");
    expect(normalizeAddress("sub.example.co.uk/path?q=1")).toBe("https://sub.example.co.uk/path?q=1");
    expect(normalizeAddress("example.com:8443")).toBe("https://example.com:8443");
  });

  it("uses http:// for localhost and IPs", () => {
    expect(normalizeAddress("localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeAddress("127.0.0.1:8080/app")).toBe("http://127.0.0.1:8080/app");
  });

  it("treats free text (no dot, or spaces) as a Google search", () => {
    expect(normalizeAddress("how to center a div")).toBe("https://www.google.com/search?q=how%20to%20center%20a%20div");
    expect(normalizeAddress("redstone")).toBe("https://www.google.com/search?q=redstone");
  });

  it("leaves special schemes untouched and ignores empty input", () => {
    expect(normalizeAddress("about:blank")).toBe("about:blank");
    expect(normalizeAddress("   ")).toBe("");
  });
});
