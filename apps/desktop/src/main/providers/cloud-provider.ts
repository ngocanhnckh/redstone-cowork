import * as api from "../api";
import type { ProviderEvent, Resolution, SessionProvider } from "./provider";
import type { ServerHost } from "../workspace";

// The hosted edition, unchanged. Every method delegates straight to main/api.ts —
// this is a pure indirection so the cockpit can be pointed at a different backend
// without touching the renderer or any IPC channel.
//
// Deliberately no error handling, caching or retry here: adding any would change
// hosted behaviour, and the whole point of this file is that it cannot.

export const cloudProvider: SessionProvider = {
  mode: "cloud",

  start(onEvent: (e: ProviderEvent) => void, shouldPoll?: () => boolean): () => void {
    return api.startStream(onEvent, shouldPoll);
  },

  getSessions: () => api.getSessions(),
  getQueue: () => api.getQueue(),
  getPendingDecisions: () => api.getPendingDecisions(),
  getInventory: () => api.getInventory(),
  getTelemetry: () => api.getTelemetry(),
  getDocker: () => api.getDocker(),
  getCaps: () => api.getCaps(),
  getHosts: (): Promise<ServerHost[]> => api.getHosts(),

  instruct: (sessionId: string, text: string) => api.instruct(sessionId, text),
  interrupt: (sessionId: string, text?: string) => api.interrupt(sessionId, text),
  resolveDecision: (id: string, resolution: Resolution) => api.resolveDecision(id, resolution),
  switchMode: (sessionId: string, mode: string) => api.switchMode(sessionId, mode),
  snooze: (id: string, minutes: number) => api.snooze(id, minutes),
  pin: (id: string, pinned: boolean) => api.pin(id, pinned),
  dismissSession: (id: string) => api.dismissSession(id),
  addTag: (sessionId: string, tag: string) => api.addTag(sessionId, tag),
  removeTag: (sessionId: string, tag: string) => api.removeTag(sessionId, tag),
  addUserTodo: (sessionId: string, text: string) => api.addUserTodo(sessionId, text),
  toggleUserTodo: (sessionId: string, todoId: string) => api.toggleUserTodo(sessionId, todoId),
  deleteUserTodo: (sessionId: string, todoId: string) => api.deleteUserTodo(sessionId, todoId),
};
