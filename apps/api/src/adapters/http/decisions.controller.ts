import { BadRequestException, Body, Controller, Get, Post, Query, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";
import { DecisionsService } from "../../application/decisions.service";
import { InstanceTokenGuard } from "./instance-token.guard";

@Controller("decisions")
@UseGuards(InstanceTokenGuard)
export class DecisionsController {
  constructor(private readonly decisions: DecisionsService) {}

  @Post()
  async create(@Body() body: unknown) {
    try {
      return await this.decisions.create(body);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Get()
  list(@Query("status") _status?: string) {
    return this.decisions.listPending(); // only pending exposed in M1a
  }
}
