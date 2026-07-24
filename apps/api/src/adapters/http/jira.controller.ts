import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ZodError, z } from "zod";
import {
  JiraBindingSchema,
  JiraProfileNameSchema,
  JiraProfileUpsertSchema,
} from "@rcw/shared";
import { JiraService } from "../../application/jira.service";
import { InstanceTokenGuard } from "./instance-token.guard";

/** Body for creating an issue in a session's bound project. */
const CreateIssueSchema = z.object({
  summary: z.string().min(1),
  description: z.string().optional(),
});

/** Body for commenting on an issue. */
const CommentSchema = z.object({
  body: z.string().min(1),
});

/** Body for transitioning an issue's status. */
const TransitionSchema = z.object({
  transitionId: z.string().min(1),
});

/** Body for editing an issue: at least one of summary / description. */
const UpdateIssueSchema = z
  .object({ summary: z.string().min(1).optional(), description: z.string().optional() })
  .refine((v) => v.summary !== undefined || v.description !== undefined, {
    message: "provide summary and/or description",
  });

/** Body for creating a subtask under a parent issue. */
const CreateSubtaskSchema = z.object({
  summary: z.string().min(1),
  description: z.string().optional(),
});

/**
 * Per-session Jira integration (owner-only). Manages named Jira profiles and each
 * session's binding, and proxies live sprint issues / issue detail. Profile secrets
 * (the PAT) are never returned — only the validated account displayName.
 */
@Controller()
@UseGuards(InstanceTokenGuard)
export class JiraController {
  constructor(private readonly jira: JiraService) {}

  @Get("jira/profiles")
  list() {
    return this.jira.list();
  }

  @Put("jira/profiles/:name")
  @HttpCode(200)
  async upsert(@Param("name") name: string, @Body() body: unknown) {
    const parsedName = this.parseName(name);
    try {
      const upsert = JiraProfileUpsertSchema.parse(body);
      return await this.jira.upsert(parsedName, upsert);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Delete("jira/profiles/:name")
  async remove(@Param("name") name: string) {
    await this.jira.remove(this.parseName(name));
    return { ok: true };
  }

  @Get("jira/profiles/:name/validate")
  validate(@Param("name") name: string) {
    return this.jira.validate(this.parseName(name));
  }

  /** Projects under a profile — for the session's project-binding dropdown. */
  @Get("jira/profiles/:name/projects")
  listProjects(@Param("name") name: string) {
    return this.jira.listProjects(this.parseName(name));
  }

  /** Search Jira users under a profile — for the admin agent→Jira picker. */
  @Get("jira/profiles/:name/users")
  searchUsers(@Param("name") name: string, @Query("q") q: string) {
    return this.jira.searchUsers(this.parseName(name), q ?? "");
  }

  @Get("sessions/:id/jira")
  getBinding(@Param("id") id: string) {
    return this.jira.getBinding(id);
  }

  @Put("sessions/:id/jira")
  @HttpCode(200)
  async setBinding(@Param("id") id: string, @Body() body: unknown) {
    try {
      const binding = JiraBindingSchema.parse(body);
      return await this.jira.setBinding(id, binding);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Delete("sessions/:id/jira")
  async clearBinding(@Param("id") id: string) {
    await this.jira.clearBinding(id);
    return { ok: true };
  }

  @Get("sessions/:id/jira/issues")
  issues(@Param("id") id: string) {
    return this.jira.sessionIssues(id);
  }

  @Get("sessions/:id/jira/issues/:key")
  issueDetail(@Param("id") id: string, @Param("key") key: string) {
    return this.jira.issueDetail(id, key);
  }

  @Get("sessions/:id/jira/issues/:key/transitions")
  issueTransitions(@Param("id") id: string, @Param("key") key: string) {
    return this.jira.issueTransitions(id, key);
  }

  @Post("sessions/:id/jira/issues/:key/transitions")
  @HttpCode(200)
  async transitionIssue(@Param("id") id: string, @Param("key") key: string, @Body() body: unknown) {
    try {
      const { transitionId } = TransitionSchema.parse(body);
      await this.jira.transitionIssue(id, key, transitionId);
      return { ok: true };
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Put("sessions/:id/jira/issues/:key")
  @HttpCode(200)
  async updateIssue(@Param("id") id: string, @Param("key") key: string, @Body() body: unknown) {
    try {
      const fields = UpdateIssueSchema.parse(body);
      await this.jira.updateIssue(id, key, fields);
      return { ok: true };
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post("sessions/:id/jira/issues/:key/subtasks")
  @HttpCode(201)
  async createSubtask(@Param("id") id: string, @Param("key") key: string, @Body() body: unknown) {
    try {
      const { summary, description } = CreateSubtaskSchema.parse(body);
      return await this.jira.createSubtask(id, key, summary, description);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post("sessions/:id/jira/issues")
  @HttpCode(201)
  async createIssue(@Param("id") id: string, @Body() body: unknown) {
    try {
      const { summary, description } = CreateIssueSchema.parse(body);
      return await this.jira.createSessionIssue(id, summary, description);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post("sessions/:id/jira/issues/:key/comment")
  @HttpCode(200)
  async commentIssue(@Param("id") id: string, @Param("key") key: string, @Body() body: unknown) {
    try {
      const { body: text } = CommentSchema.parse(body);
      await this.jira.commentIssue(id, key, text);
      return { ok: true };
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  private parseName(name: string): string {
    try {
      return JiraProfileNameSchema.parse(name);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }
}
