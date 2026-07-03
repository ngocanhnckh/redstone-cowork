#!/usr/bin/env node
import { argv, exit } from "node:process";
import { realpathSync } from "node:fs";
import { armAttach } from "./state";
import { installHooks } from "./installer";
import { loadCliConfig, saveCliConfig } from "./config";

const usage = `redstone [--config <name>] <command>
  init --server <url> --token <token>   configure once
  hook                                  install hooks here + arm attach for the next session event
  handle                                (internal) Claude Code hook entrypoint
  poll --wrapper <id> --tmux <target>   (internal) delivery poller for redstone-claude sessions
  status                                show config + attach state
  update                                re-download the latest agent bundle from the server
  agent                                 run the per-host daemon: report all Claude sessions + serve remote commands
  service install|uninstall             install/remove the agent as a boot-persistent service (systemd/launchd)
  config list                           list named Claude endpoint config profiles
  config get <name>                     show a profile's env keys + values
  config set <name> KEY=VAL [KEY=VAL…]  create/update a profile
  config rm <name>                      delete a profile
  claude [args]    run Claude under the wrapper so cockpit/phone replies type back
  --config <name>  inject a named endpoint profile's env into \`redstone claude\``;

/**
 * Pull a global \`--config <name>\` / \`--config=<name>\` flag out of the args
 * (it may appear anywhere, before or after the command). Returns the config
 * name (last one wins) and the remaining tokens with the flag removed.
 */
export function extractConfigFlag(tokens: string[]): { configName?: string; rest: string[] } {
  const rest: string[] = [];
  let configName: string | undefined;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === "--config") {
      configName = tokens[i + 1];
      i++; // skip the value
    } else if (t.startsWith("--config=")) {
      configName = t.slice("--config=".length);
    } else {
      rest.push(t);
    }
  }
  return { configName, rest };
}

/** Parse `KEY=VAL` pairs into an env map; throws on a malformed key/pair. */
export function parseEnvPairs(pairs: string[]): Record<string, string> {
  const env: Record<string, string> = {};
  for (const p of pairs) {
    const eq = p.indexOf("=");
    if (eq < 1) throw new Error(`invalid KEY=VAL pair: "${p}"`);
    const key = p.slice(0, eq);
    const val = p.slice(eq + 1);
    if (!/^[A-Z_][A-Z0-9_]*$/.test(key)) {
      throw new Error(`invalid env key "${key}" — must match ^[A-Z_][A-Z0-9_]*$`);
    }
    env[key] = val;
  }
  return env;
}

async function main() {
  const { configName, rest } = extractConfigFlag(argv.slice(2));
  const cmd = rest[0];
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
    await runWrapper(rest.slice(1), bin, configName);
  } else if (cmd === "config") {
    const cfg = loadCliConfig();
    if (!cfg) { console.error("run `redstone init` first"); exit(1); }
    const { ApiClient } = await import("./api-client");
    const api = new ApiClient(cfg);
    const sub = rest[1];
    const name = rest[2];
    if (sub === "list") {
      const names = await api.listConfigs();
      if (names.length === 0) console.log("(no config profiles)");
      else for (const n of names) console.log(n);
    } else if (sub === "get") {
      if (!name) { console.error("usage: redstone config get <name>"); exit(1); }
      const profile = await api.getConfig(name);
      if (!profile) { console.error(`config profile "${name}" not found`); exit(1); }
      for (const [k, v] of Object.entries(profile.env)) console.log(`${k}=${v}`);
    } else if (sub === "set") {
      if (!name || rest.length < 4) { console.error("usage: redstone config set <name> KEY=VAL [KEY=VAL …]"); exit(1); }
      let env: Record<string, string>;
      try { env = parseEnvPairs(rest.slice(3)); }
      catch (e) { console.error(`redstone: ${(e as Error).message}`); exit(1); return; }
      const ok = await api.setConfig(name, env);
      if (!ok) { console.error(`failed to save config "${name}"`); exit(1); }
      console.log(`saved config "${name}" (${Object.keys(env).length} vars)`);
    } else if (sub === "rm") {
      if (!name) { console.error("usage: redstone config rm <name>"); exit(1); }
      const ok = await api.deleteConfig(name);
      if (!ok) { console.error(`failed to delete config "${name}"`); exit(1); }
      console.log(`deleted config "${name}"`);
    } else {
      console.error("usage: redstone config list|get|set|rm"); exit(1);
    }
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
  } else if (cmd === "agent") {
    const cfg = loadCliConfig();
    if (!cfg) { console.error("run `redstone init` first"); exit(1); }
    const { runAgent } = await import("./agent");
    const { ApiClient } = await import("./api-client");
    console.log("redstone agent: reporting session inventory + serving remote commands…");
    await runAgent({ api: new ApiClient(cfg) });
  } else if (cmd === "service") {
    const sub = rest[1];
    const { installService, uninstallService } = await import("./service");
    if (sub === "uninstall") {
      console.log(uninstallService());
    } else if (sub === "install" || sub === undefined) {
      const scriptPath = realpathSync(argv[1]);
      console.log(installService({ nodePath: process.execPath, scriptPath }));
    } else {
      console.error("usage: redstone service install|uninstall"); exit(1);
    }
  } else if (cmd === "update") {
    const { runUpdate } = await import("./updater");
    const r = await runUpdate();
    console.log(r.message);
    if (!r.ok) exit(1);
  } else if (cmd === "status") {
    console.log(JSON.stringify({ config: loadCliConfig() }, null, 2));
  } else {
    console.error(usage); exit(1);
  }
}
// Only auto-run as the CLI entrypoint; importing (e.g. in tests) must not execute.
if (require.main === module) {
  main().catch(() => exit(0)); // never propagate failures into a Claude session
}
