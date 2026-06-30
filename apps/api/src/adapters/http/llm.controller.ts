import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";
import { AssistRequestSchema, LlmChatRequestSchema, LlmEndpointInputSchema } from "@rcw/shared";
import { LlmService } from "../../application/llm.service";
import { InstanceTokenGuard } from "./instance-token.guard";

@Controller("llm")
@UseGuards(InstanceTokenGuard)
export class LlmController {
  constructor(private readonly llm: LlmService) {}

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
