import { BadRequestException, Body, Controller, Get, HttpCode, NotFoundException, Param, Post, UseGuards } from "@nestjs/common";
import { ZodError } from "zod";
import { AccessKeysService } from "../../application/access-keys.service";
import { InstanceTokenGuard } from "./instance-token.guard";

/**
 * Manage access keys for the external API. Guarded by the human guard (instance
 * token or the linked Redstone owner) — access keys can't mint more access keys.
 */
@Controller("access-keys")
@UseGuards(InstanceTokenGuard)
export class AccessKeysController {
  constructor(private readonly keys: AccessKeysService) {}

  @Post()
  @HttpCode(201)
  async create(@Body() body: unknown) {
    try {
      return await this.keys.create(body); // includes the plaintext key ONCE
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Get()
  list() {
    return this.keys.list(); // metadata only — never the secret
  }

  @Post(":id/revoke")
  @HttpCode(200)
  async revoke(@Param("id") id: string) {
    if (!(await this.keys.revoke(id))) throw new NotFoundException();
    return { ok: true };
  }
}
