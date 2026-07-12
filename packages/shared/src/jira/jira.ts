import { z } from "zod";

/**
 * Per-session Jira integration types. A named Jira *profile* holds a base URL + a
 * PAT (encrypted at rest on the cowork server); a session *binding* points a
 * session at one profile + a project (and optionally a board). Issues/comments are
 * fetched live from self-hosted Jira Data Center (Bearer PAT auth). The PAT is
 * never returned to clients — only the validated account displayName.
 */

/** Profile name: a filesystem/URL-safe slug. */
export const JiraProfileNameSchema = z
  .string()
  .min(1)
  .regex(/^[a-zA-Z0-9._-]+$/, "name must be a safe slug ([a-zA-Z0-9._-]+)");

/** Upsert body for a profile: base URL + PAT (secret). */
export const JiraProfileUpsertSchema = z.object({
  baseUrl: z.string().url(),
  pat: z.string().min(1),
});
export type JiraProfileUpsert = z.infer<typeof JiraProfileUpsertSchema>;

/** List/summary view of a profile — NEVER includes the PAT. */
export const JiraProfileSummarySchema = z.object({
  name: JiraProfileNameSchema,
  baseUrl: z.string().url(),
  account: z.string().nullable(),
});
export type JiraProfileSummary = z.infer<typeof JiraProfileSummarySchema>;

/** A session's Jira binding: which profile + project (+ optional board) to read. */
export const JiraBindingSchema = z.object({
  profile: JiraProfileNameSchema,
  projectKey: z.string().min(1),
  boardId: z.number().int().positive().nullable().default(null),
});
export type JiraBinding = z.infer<typeof JiraBindingSchema>;

/** Coarse status bucket used to lane issues in the UI. */
export const JiraStatusCategorySchema = z.enum(["todo", "inprogress", "done"]);
export type JiraStatusCategory = z.infer<typeof JiraStatusCategorySchema>;

/** A single issue as surfaced to the cockpit. */
export const JiraIssueSchema = z.object({
  key: z.string(),
  summary: z.string(),
  status: z.string(),
  statusCategory: JiraStatusCategorySchema,
  assignee: z.string().nullable(),
  url: z.string(),
});
export type JiraIssue = z.infer<typeof JiraIssueSchema>;

/** A rendered comment on an issue (body is Jira-rendered HTML). */
export const JiraCommentSchema = z.object({
  author: z.string().nullable(),
  created: z.string(),
  bodyHtml: z.string(),
});
export type JiraComment = z.infer<typeof JiraCommentSchema>;

/** Full issue detail: the issue fields + rendered description + comments, plus the
 * raw description (for the editor), the issue type, whether it can own subtasks,
 * and its existing subtasks. */
export const JiraIssueDetailSchema = JiraIssueSchema.extend({
  descriptionHtml: z.string(),
  /** Raw description source (wiki/plain) — what the inline editor edits. */
  description: z.string().default(""),
  /** Issue type name, e.g. "Task", "Story", "Bug", "Sub-task", "Epic". */
  issueType: z.string().default(""),
  /** True when this issue may have subtasks (a standard type, not itself a
   * subtask and not an Epic) — drives the "add subtask" affordance. */
  subtaskAllowed: z.boolean().default(false),
  subtasks: z.array(JiraIssueSchema).default([]),
  comments: z.array(JiraCommentSchema),
});
export type JiraIssueDetail = z.infer<typeof JiraIssueDetailSchema>;
