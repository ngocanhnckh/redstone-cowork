import { app } from "electron";
import fs from "node:fs";
import path from "node:path";

// VSCode-style "recent projects": the folders/hosts the user has actually opened a session in
// from THIS app, most-recent first, for one-click reopen. Stored locally in userData (like
// VSCode's recents). Deduped by machine+folder; capped so the list stays tidy. Never throws.

export type Recent = {
  name: string;        // server display name (or host)
  host: string;        // ssh host / alias / ip
  sshUser: string;     // "" = use ~/.ssh/config
  sshPort: number;
  machine: string;     // reporting machine name (for the local-session case) or host
  folder: string;      // absolute project folder on the host
  at: number;          // last opened (epoch ms)
};

const MAX = 12;
const storePath = (): string => path.join(app.getPath("userData"), "recents.json");

export function listRecents(): Recent[] {
  try {
    const raw = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    if (!Array.isArray(raw)) return [];
    return (raw as Recent[])
      .filter((r) => r && typeof r.folder === "string" && typeof r.host === "string")
      .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
      .slice(0, MAX);
  } catch {
    return [];
  }
}

/** Record (or bump) a recently-opened project. Deduped by machine+folder. */
export function addRecent(entry: Omit<Recent, "at">): Recent[] {
  try {
    const key = (r: { machine: string; folder: string }) => `${r.machine}\0${r.folder}`;
    const now = Date.now();
    const next: Recent = { ...entry, at: now };
    const list = listRecents().filter((r) => key(r) !== key(next));
    list.unshift(next);
    const trimmed = list.slice(0, MAX);
    fs.writeFileSync(storePath(), JSON.stringify(trimmed, null, 2), "utf8");
    return trimmed;
  } catch {
    return listRecents();
  }
}

export function removeRecent(machine: string, folder: string): Recent[] {
  try {
    const list = listRecents().filter((r) => !(r.machine === machine && r.folder === folder));
    fs.writeFileSync(storePath(), JSON.stringify(list, null, 2), "utf8");
    return list;
  } catch {
    return listRecents();
  }
}
