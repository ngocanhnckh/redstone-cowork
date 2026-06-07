import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
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

  @Post(":id/resolve")
  @HttpCode(200)
  async resolve(@Param("id") id: string, @Body() body: unknown) {
    try {
      return await this.decisions.resolve(id, body);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Get(":id/await")
  async awaitResolution(
    @Param("id") id: string,
    @Query("timeoutMs") timeoutMs = "25000",
    @Res() res: Response,
  ) {
    const d = await this.decisions.await(id, Number(timeoutMs) || 25_000);
    if (!d) return res.status(204).send();
    return res.status(200).json(d);
  }

  @Post(":id/delivered")
  @HttpCode(200)
  async markDelivered(@Param("id") id: string) {
    await this.decisions.markDelivered(id);
    return { ok: true };
  }
}
