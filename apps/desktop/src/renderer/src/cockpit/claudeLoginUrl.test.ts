import { describe, it, expect } from "vitest";
import { extractLoginUrl } from "./ClaudeLoginModal";

/** tmux capture-pane pads every line to the pane width with trailing spaces. */
const pad = (s: string, w = 100) => s + " ".repeat(Math.max(0, w - s.length));

const HEAD =
  "https://claude.com/cai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e" +
  "&response_type=code&scope=org%3Acreate_api_key+user%3Aprofile&code_challenge=-kieUGM3gsmiboe99eVyC&code_challeng";
const TAIL = "e_method=S256&state=6dsi7Xr1qJq5";

describe("extractLoginUrl", () => {
  it("stitches a wrapped URL when tmux pads lines to the pane width", () => {
    // Regression: the padding used to end the join, cutting the URL at
    // '…&code_challeng' and producing an invalid OAuth link.
    const pane = [pad("Browser didn't open? Use the url below:"), pad(""), pad(HEAD), pad(TAIL), pad("Paste code here if prompted > ")].join("\n");
    const url = extractLoginUrl(pane);
    expect(url).toBe(HEAD + TAIL);
    expect(url).toContain("code_challenge_method=S256");
    expect(url).toContain("state=");
  });

  it("stitches across three wrapped segments", () => {
    const a = "https://claude.ai/oauth/authorize?code=true&client_id=abc&code_ch";
    const b = "allenge=xyz&code_challenge_met";
    const c = "hod=S256&state=zzz";
    const pane = [pad(a), pad(b), pad(c), pad("Paste code here > ")].join("\n");
    expect(extractLoginUrl(pane)).toBe(a + b + c);
  });

  it("stops at prose so following text is never appended", () => {
    const pane = [pad(HEAD + TAIL), pad("Paste code here if prompted > ")].join("\n");
    expect(extractLoginUrl(pane)).toBe(HEAD + TAIL);
  });

  it("returns null when the pane has no Claude URL", () => {
    expect(extractLoginUrl([pad("$ ls -la"), pad("total 0")].join("\n"))).toBeNull();
  });

  it("ignores unrelated domains", () => {
    expect(extractLoginUrl(pad("https://example.com/oauth/authorize?x=1"))).toBeNull();
  });
});
