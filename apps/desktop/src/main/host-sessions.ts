import { runRemote } from "./claude-login";

// List RESUMABLE Claude conversations in a folder on a host — including ones with no live
// tmux (claude exited / was killed) but whose transcript still lives in
// ~/.claude/projects/<encoded-cwd>/*.jsonl. `claude --resume <id>` can bring these back.
// The encoding claude uses for the project dir replaces "/" and "." with "-".

export type FolderSession = { id: string; mtime: number; title: string; messages: number };

// Python (base64'd so the folder path can't break the shell) that walks the project dir
// and emits a JSON array, newest first.
const LISTER = Buffer.from(`
import json, os, sys, glob
folder = sys.argv[1] if len(sys.argv) > 1 else ""
enc = "".join("-" if c in "/." else c for c in folder)
d = os.path.expanduser("~/.claude/projects/" + enc)
out = []
try:
    files = sorted(glob.glob(os.path.join(d, "*.jsonl")), key=os.path.getmtime, reverse=True)[:20]
except Exception:
    files = []
for f in files:
    sid = os.path.basename(f)[:-6]
    try: mt = int(os.path.getmtime(f))
    except Exception: mt = 0
    title = ""; n = 0
    try:
        for line in open(f, "r", errors="ignore"):
            n += 1
            if title: continue
            try: o = json.loads(line)
            except Exception: continue
            if o.get("type") == "user":
                m = o.get("message"); c = m.get("content") if isinstance(m, dict) else o.get("content")
                if isinstance(c, list): c = " ".join(x.get("text", "") for x in c if isinstance(x, dict))
                if isinstance(c, str):
                    s = c.strip()
                    if s and not s.startswith("<"): title = s[:90]
    except Exception: pass
    out.append({"id": sid, "mtime": mt, "title": title, "messages": n})
print(json.dumps(out))
`, "utf8").toString("base64");

const shq = (v: string) => `'${v.replace(/'/g, `'\\''`)}'`;

export async function listFolderSessions(machine: string, folder: string): Promise<FolderSession[]> {
  if (!folder || !folder.startsWith("/")) return [];
  const cmd = `echo ${LISTER} | base64 -d | python3 - ${shq(folder)}`;
  try {
    const out = await runRemote(machine, cmd, 20000);
    const start = out.indexOf("["), end = out.lastIndexOf("]");
    if (start < 0 || end < start) return [];
    const parsed = JSON.parse(out.slice(start, end + 1));
    return Array.isArray(parsed) ? (parsed as FolderSession[]) : [];
  } catch { return []; }
}
