import { join } from "node:path";
import { PromptLoader } from "../src/infrastructure/prompts/prompt-loader";

describe("PromptLoader", () => {
  const loader = new PromptLoader(join(__dirname, "../../../prompts"));

  it("renders a template with variables", () => {
    const out = loader.render("system/hello.md", { persona_name: "Linh", today: "2026-06-07" });
    expect(out).toContain("You are Linh");
    expect(out).toContain("2026-06-07");
  });

  it("throws on missing template", () => {
    expect(() => loader.render("nope/missing.md", {})).toThrow();
  });
});
