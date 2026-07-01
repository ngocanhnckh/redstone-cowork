import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ZodError, z } from "zod";
import { AssistRequestSchema, LlmChatRequestSchema, LlmEndpointInputSchema } from "@rcw/shared";
import { LlmService } from "../../application/llm.service";
import { AgentService } from "../../application/agent.service";
import { InstanceTokenGuard } from "./instance-token.guard";

const AgentRequestSchema = z.object({
  sessionId: z.string().min(1),
  input: z.string().min(1),
  modelId: z.string().min(1).optional(),
});

@Controller("llm")
@UseGuards(InstanceTokenGuard)
export class LlmController {
  constructor(private readonly llm: LlmService, private readonly agent: AgentService) {}

  @Get("agent/enabled")
  agentEnabled() {
    return { enabled: this.agent.enabled() };
  }

  @Post("agent")
  async runAgent(@Body() body: unknown) {
    try {
      const req = AgentRequestSchema.parse(body);
      return await this.agent.run(req);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Get("models")
  async models() {
    return { models: await this.llm.models() };
  }

  @Post("endpoints")
  @HttpCode(201)
  async addEndpoint(@Body() body: unknown) {
    try {
      const input = LlmEndpointInputSchema.parse(body);
      return await this.llm.addEndpoint(input);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Delete("endpoints/:id")
  @HttpCode(200)
  async removeEndpoint(@Param("id") id: string) {
    await this.llm.deleteEndpoint(id);
    return { ok: true };
  }

  @Post("chat")
  async chat(@Body() body: unknown) {
    try {
      const req = LlmChatRequestSchema.parse(body);
      return { text: await this.llm.chat(req) };
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Post("assist")
  async assist(@Body() body: unknown) {
    try {
      const req = AssistRequestSchema.parse(body);
      return { text: await this.llm.assist(req) };
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }
}
