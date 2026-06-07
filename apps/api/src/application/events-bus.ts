import { Injectable } from "@nestjs/common";
import { Subject } from "rxjs";

export type ServerEvent = { type: "decision.created" | "decision.resolved" | "session.updated"; payload: unknown };

@Injectable()
export class EventsBus {
  readonly stream$ = new Subject<ServerEvent>();
  emit(e: ServerEvent) { this.stream$.next(e); }
}
