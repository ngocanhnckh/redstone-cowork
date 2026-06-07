import nunjucks from "nunjucks";

/** All system prompts live as .md Jinja templates under prompts/ — never in code (PLAN.md working agreement). */
export class PromptLoader {
  private readonly env: nunjucks.Environment;

  constructor(promptsDir: string) {
    this.env = new nunjucks.Environment(
      new nunjucks.FileSystemLoader(promptsDir, { noCache: false }),
      { autoescape: false, throwOnUndefined: true }
    );
  }

  render(relativePath: string, vars: Record<string, unknown>): string {
    return this.env.render(relativePath, vars);
  }
}
