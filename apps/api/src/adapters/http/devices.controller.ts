import { BadRequestException, Body, Controller, Delete, Get, Param, Post, UseGuards } from "@nestjs/common";
import { NewDeviceSchema } from "@rcw/shared";
import { ZodError } from "zod";
import { DevicesService } from "../../application/devices.service";
import { InstanceTokenGuard } from "./instance-token.guard";
import { MasterTokenGuard } from "./master-token.guard";

@Controller("devices")
@UseGuards(InstanceTokenGuard, MasterTokenGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Post()
  async mint(@Body() body: unknown) {
    try {
      const { label } = NewDeviceSchema.parse(body);
      return await this.devices.mint(label);
    } catch (e) {
      if (e instanceof ZodError) throw new BadRequestException(e.issues);
      throw e;
    }
  }

  @Get()
  list() {
    return this.devices.list();
  }

  @Delete(":id")
  async revoke(@Param("id") id: string) {
    return { revoked: await this.devices.revoke(id) };
  }
}
