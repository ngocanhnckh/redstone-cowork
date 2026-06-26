export const IPC = {
  configGet: "config:get",
  configSave: "config:save",
  configClear: "config:clear",
  sessions: "api:sessions",
  queue: "api:queue",
  decisions: "api:decisions",
  resolve: "api:resolve",
  snooze: "api:snooze",
  pin: "api:pin",
  streamEvent: "stream:event",
} as const;
