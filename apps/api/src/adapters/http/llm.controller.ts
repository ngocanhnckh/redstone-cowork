import { BadRequestException, Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";
import { AssistRequestSchema, LlmChatRequestSchema } from "@rcw/shared";
import { LlmService } from "../../application/llm.service";
import { InstanceTokenGuard } from "./instance-token.guard";

@Controller("llm")
@UseGuards(InstanceTokenGuard)
export class LlmController {
  constructor(private readonly llm: LlmService) {}

  @Get("models")
  models() {
    return { models: this.llm.models() };
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
