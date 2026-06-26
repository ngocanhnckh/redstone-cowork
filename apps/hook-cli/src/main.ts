#!/usr/bin/env node
import { argv, exit } from "node:process";
import { realpathSync } from "node:fs";
import { armAttach } from "./state";
import { installHooks } from "./installer";
import { loadCliConfig, saveCliConfig } from "./config";

const usage = `redstone <command>
  init --server <url> --token <token>   configure once
  hook                                  install hooks here + arm attach for the next session event
  handle                                (internal) Claude Code hook entrypoint
  poll --wrapper <id> --tmux <target>   (internal) delivery poller for redstone-claude sessions
  status                                show config + attach state
  claude [args]    run Claude under the wrapper so cockpit/phone replies type back`;

async function main() {
  const cmd = argv[2];
  if (cmd === "init") {
    const server = argv[argv.indexOf("--server") + 1];
    const token = argv[argv.indexOf("--token") + 1];
    if (!server || !token) { console.error(usage); exit(1); }
    saveCliConfig({ serverUrl: server.replace(/\/$/, ""), token });
    console.log("redstone configured");
  } else if (cmd === "hook") {
    if (!loadCliConfig()) { console.error("run `redstone init` first"); exit(1); }
    const bin = realpathSync(argv[1]);
    const settingsPath = installHooks(process.cwd(), `node ${bin}`);
    armAttach(process.cwd());
    console.log(`hooks installed -> ${settingsPath}`);
    console.log("attach armed: the next Claude Code activity in this directory will connect this session.");
  } else if (cmd === "claude") {
    if (!loadCliConfig()) { console.error("run `redstone init` first"); exit(1); }
    const { runWrapper } = await import("./claude-wrapper");
    const bin = realpathSync(argv[1]);
    runWrapper(argv.slice(3), bin);
  } else if (cmd === "handle") {
    const { handle } = await import("./handler");
    await handle();
  } else if (cmd === "poll") {
    const cfg = loadCliConfig();
    const wrapper = argv[argv.indexOf("--wrapper") + 1];
    const tmux = argv[argv.indexOf("--tmux") + 1];
    if (!cfg || !wrapper || !tmux) exit(0);
    const { runPoller } = await import("./poller");
    const { ApiClient } = await import("./api-client");
    await runPoller({ wrapperId: wrapper, tmuxTarget: tmux, api: new ApiClient(cfg) });
  } else if (cmd === "status") {
    console.log(JSON.stringify({ config: loadCliConfig() }, null, 2));
  } else {
    console.error(usage); exit(1);
  }
}
main().catch(() => exit(0)); // never propagate failures into a Claude session
