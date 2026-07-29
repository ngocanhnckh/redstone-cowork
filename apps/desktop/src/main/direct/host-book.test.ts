import { describe, it, expect, beforeEach, vi } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

// Electron isn't available in vitest, and ~/.ssh/config belongs to whoever runs the
// suite — so both are stubbed. Everything else is the real module.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rcw-hostbook-"));
vi.mock("electron", () => ({ app: { getPath: () => tmp } }));

const sshConfigHosts = vi.hoisted(() => ({ value: [] as Array<{ alias: string; hostName: string | null; user: string | null; port: number | null }> }));
vi.mock("../ssh-config", () => ({ listSshConfigHosts: () => sshConfigHosts.value }));

import { addHost, enabledHosts, listHosts, removeHost, setEnabled, sshTargetOf, LOCAL_HOST_ID } from "./host-book";

const store = () => path.join(tmp, "direct-hosts.json");

describe("host book", () => {
  beforeEach(() => {
    fs.rmSync(store(), { force: true });
    sshConfigHosts.value = [];
  });

  it("always includes this machine, enabled, with no SSH", () => {
    const local = listHosts().find((h) => h.id === LOCAL_HOST_ID)!;
    expect(local).toBeTruthy();
    expect(local.enabled).toBe(true);
    expect(local.label).toBe(os.hostname());
    // The offline edition must work with no account AND no SSH configured at all.
    expect(sshTargetOf(local)).toBeNull();
  });

  it("offers ~/.ssh/config aliases but never auto-enables them", () => {
    // A typical config has dozens of aliases including bastions; connecting to all of
    // them on launch would be hostile, and a burst of handshakes is what fail2ban bans.
    sshConfigHosts.value = [
      { alias: "contabo2", hostName: "1.2.3.4", user: "anh", port: null },
      { alias: "bastion", hostName: "5.6.7.8", user: null, port: 2222 },
    ];
    const hosts = listHosts();
    const offered = hosts.filter((h) => h.source === "ssh-config");
    expect(offered.map((h) => h.label).sort()).toEqual(["bastion", "contabo2"]);
    expect(offered.every((h) => !h.enabled)).toBe(true);
    expect(enabledHosts().map((h) => h.id)).toEqual([LOCAL_HOST_ID]);
  });

  it("promotes an enabled suggestion so it survives ~/.ssh/config changes", () => {
    sshConfigHosts.value = [{ alias: "contabo2", hostName: "1.2.3.4", user: "anh", port: null }];
    const promoted = setEnabled("sshconfig:contabo2", true)!;
    expect(promoted.enabled).toBe(true);

    sshConfigHosts.value = []; // alias removed from the config afterwards
    const still = listHosts().find((h) => h.label === "contabo2");
    expect(still, "an enabled host must not vanish when ~/.ssh/config changes").toBeTruthy();
    expect(still!.enabled).toBe(true);
  });

  it("stops offering a dismissed alias without touching ~/.ssh/config", () => {
    sshConfigHosts.value = [{ alias: "bastion", hostName: "5.6.7.8", user: null, port: null }];
    expect(listHosts().some((h) => h.label === "bastion")).toBe(true);
    removeHost("sshconfig:bastion");
    expect(listHosts().some((h) => h.label === "bastion")).toBe(false);
    // The alias is still in the user's config — we only stopped suggesting it.
    expect(sshConfigHosts.value).toHaveLength(1);
  });

  it("adds manual hosts enabled, and they win over a same-target suggestion", () => {
    const added = addHost({ label: "prod", sshHost: "contabo2", user: "anh" });
    expect(added.enabled).toBe(true);
    sshConfigHosts.value = [{ alias: "contabo2", hostName: "1.2.3.4", user: "anh", port: null }];
    const matching = listHosts().filter((h) => h.sshHost === "contabo2");
    expect(matching, "manual entry should dedupe the ssh-config suggestion").toHaveLength(1);
    expect(matching[0].source).toBe("manual");
  });

  it("never disables the local machine", () => {
    setEnabled(LOCAL_HOST_ID, false);
    expect(listHosts().find((h) => h.id === LOCAL_HOST_ID)!.enabled).toBe(true);
  });

  it("builds ssh targets, leaving the user to ~/.ssh/config when unset", () => {
    const withUser = addHost({ sshHost: "box", user: "deploy", port: 2222 });
    expect(sshTargetOf(withUser)).toEqual({ host: "deploy@box", opts: ["-p", "2222"] });

    // A blank user is the whole point of adding a host by its alias — ssh resolves
    // User/HostName/Port itself.
    const alias = addHost({ sshHost: "contabo2" });
    expect(sshTargetOf(alias)).toEqual({ host: "contabo2", opts: [] });
  });

  it("survives a corrupt store rather than losing the host list", () => {
    fs.writeFileSync(store(), "{not json", "utf8");
    expect(() => listHosts()).not.toThrow();
    expect(listHosts().some((h) => h.id === LOCAL_HOST_ID)).toBe(true);
  });
});
