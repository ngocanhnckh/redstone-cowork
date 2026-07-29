"""
Redstone Cowork remote probe.

Runs on a host the cockpit connects to over SSH, for the OFFLINE (direct-connect)
edition. It is fed to the remote python on stdin and never written to disk; there
is no daemon, no install, and it never talks to any server — the desktop that
spawned it is its only client.

Protocol: newline-delimited JSON, both directions.

  ->  {"id": 7, "m": "tmux.list", "p": {...}}          request
  <-  {"id": 7, "ok": true, "r": {...}}                response
  <-  {"id": 7, "ok": false, "e": {"code":"…","msg":"…"}}
  <-  {"ev": "ready", "p": {...}}                      handshake (once, first)
  <-  {"ev": "hb", "p": {"t":…, "seq":…}}              heartbeat (~5s)
  <-  {"ev": "<name>", "p": {...}}                     unsolicited event
  <-  {"ev": "drop", "p": {"n": k}}                    k events were dropped
  <-  {"ev": "fatal", "p": {"code": "…"}}              about to exit

Large payloads are streamed rather than sent as one enormous line:

  <-  {"id": 7, "ok": true, "r": {"stream": "s3", "enc": "b64+zlib", "len": 812340}}
  <-  {"s": "s3", "d": "<base64 chunk>"}
  <-  {"s": "s3", "end": true}

Constraints, all load-bearing:
  * Python 3.6 compatible — no walrus, no dataclasses, no subprocess capture_output.
  * Standard library only.
  * ONE writer thread owns stdout; everything else enqueues. Interleaving writes
    from worker threads would corrupt framing.
  * Every handler is wrapped: a handler exception becomes an error frame, never a
    dead channel. The channel outliving a bad request is the whole point.
"""

from __future__ import print_function

import base64
import json
import os
import subprocess
import sys
import threading
import time
import zlib

try:
    import queue
except ImportError:  # Python 2 safety net; we require 3.6 but never crash on import
    import Queue as queue  # type: ignore

PROTO = 1
HB_INTERVAL = 5.0
MAX_QUEUE = 2000
CHUNK_BYTES = 64 * 1024
# Responses larger than this are streamed. Chosen so ordinary replies (a tmux list,
# a telemetry sample) stay single-frame, while a transcript tail or a pane capture
# never blocks the writer on one huge line.
STREAM_THRESHOLD = 48 * 1024
WORKERS = 3

_out_q = queue.Queue(maxsize=MAX_QUEUE)
_dropped = [0]
_dropped_lock = threading.Lock()
_stream_seq = [0]
_stream_lock = threading.Lock()
_stop = threading.Event()


# --------------------------------------------------------------------------
# Output
# --------------------------------------------------------------------------

def _writer_loop():
    """The ONLY writer to stdout."""
    out = sys.stdout
    while True:
        item = _out_q.get()
        if item is None:
            break
        try:
            out.write(item)
            out.write("\n")
            out.flush()
        except Exception:
            # stdout is gone (ssh died) — nothing left to do but stop.
            _stop.set()
            break


def _enqueue(line, droppable):
    """Queue one frame. Responses/heartbeats block briefly rather than vanish;
    events are dropped oldest-first under pressure so a slow consumer can never
    wedge the channel. A drop is reported so the desktop knows to refetch."""
    try:
        if droppable:
            try:
                _out_q.put_nowait(line)
            except queue.Full:
                try:
                    _out_q.get_nowait()  # discard the oldest
                except Exception:
                    pass
                with _dropped_lock:
                    _dropped[0] += 1
                try:
                    _out_q.put_nowait(line)
                except Exception:
                    pass
        else:
            _out_q.put(line, timeout=10)
    except Exception:
        pass


def emit(obj, droppable=False):
    try:
        _enqueue(json.dumps(obj, default=str), droppable)
    except Exception:
        # A frame that won't serialize must not kill the channel.
        pass


def emit_event(name, payload, droppable=True):
    emit({"ev": name, "p": payload}, droppable)


def _flush_drop_notice():
    with _dropped_lock:
        n = _dropped[0]
        _dropped[0] = 0
    if n:
        emit({"ev": "drop", "p": {"n": n}}, droppable=False)


def _send_stream(rid, text):
    """Send a large result as a compressed, chunked stream."""
    with _stream_lock:
        _stream_seq[0] += 1
        sid = "s%d" % _stream_seq[0]
    raw = text.encode("utf-8", "replace")
    blob = base64.b64encode(zlib.compress(raw, 6)).decode("ascii")
    emit({"id": rid, "ok": True, "r": {"stream": sid, "enc": "b64+zlib", "len": len(raw)}})
    for i in range(0, len(blob), CHUNK_BYTES):
        emit({"s": sid, "d": blob[i:i + CHUNK_BYTES]})
    emit({"s": sid, "end": True})


def respond(rid, result):
    if rid is None:
        return
    try:
        payload = json.dumps(result, default=str)
    except Exception as exc:
        respond_err(rid, "E_SERIALIZE", str(exc))
        return
    if len(payload) > STREAM_THRESHOLD:
        _send_stream(rid, payload)
    else:
        emit({"id": rid, "ok": True, "r": result})


def respond_err(rid, code, msg):
    if rid is None:
        return
    emit({"id": rid, "ok": False, "e": {"code": code, "msg": str(msg)[:500]}})


# --------------------------------------------------------------------------
# Shell helpers
# --------------------------------------------------------------------------

def run(args, timeout=15, stdin_bytes=None):
    """Run a command, returning (rc, stdout, stderr). Never raises."""
    try:
        p = subprocess.Popen(
            args,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            stdin=subprocess.PIPE if stdin_bytes is not None else None,
        )
    except Exception as exc:
        return (127, "", str(exc))
    try:
        try:
            out, err = p.communicate(input=stdin_bytes, timeout=timeout)
        except TypeError:
            # Python without communicate(timeout=) — best effort.
            out, err = p.communicate(input=stdin_bytes)
    except Exception:
        try:
            p.kill()
            out, err = p.communicate()
        except Exception:
            out, err = (b"", b"")
        return (124, _dec(out), "timeout")
    return (p.returncode, _dec(out), _dec(err))


def _dec(b):
    if b is None:
        return ""
    if isinstance(b, bytes):
        return b.decode("utf-8", "replace")
    return b


def _read_text(path, limit=None):
    try:
        with open(path, "rb") as fh:
            data = fh.read() if limit is None else fh.read(limit)
        return data.decode("utf-8", "replace")
    except Exception:
        return ""


# --------------------------------------------------------------------------
# Methods
# --------------------------------------------------------------------------

def m_ping(_p):
    return {"pong": True, "t": int(time.time() * 1000)}


def m_info(_p):
    return _host_info()


def _host_info():
    rc, tmux_v, _ = run(["tmux", "-V"], timeout=5)
    try:
        user = os.environ.get("USER") or os.environ.get("LOGNAME") or ""
        if not user:
            import pwd
            user = pwd.getpwuid(os.getuid()).pw_name
    except Exception:
        user = ""
    try:
        host = os.uname()[1]
    except Exception:
        host = ""
    return {
        "proto": PROTO,
        "py": "%d.%d.%d" % sys.version_info[:3],
        "os": sys.platform,
        "host": host,
        "user": user,
        "home": os.path.expanduser("~"),
        "tmux": tmux_v.strip() or None if rc == 0 else None,
        "caps": {
            # `tmux load-buffer -` (bytes on stdin) needs tmux >= 3.0. Without it we
            # fall back to chunked `send-keys -l`, which is what the hosted poller does.
            "loadBufferStdin": _tmux_at_least(tmux_v, 3, 0),
            "proc": os.path.isdir("/proc"),
        },
    }


def _tmux_at_least(version_text, major, minor):
    try:
        # "tmux 3.3a" / "tmux next-3.4"
        digits = ""
        for ch in version_text:
            if ch.isdigit() or ch == ".":
                digits += ch
            elif digits:
                break
        parts = [int(x) for x in digits.split(".") if x != ""]
        if not parts:
            return False
        got_major = parts[0]
        got_minor = parts[1] if len(parts) > 1 else 0
        return (got_major, got_minor) >= (major, minor)
    except Exception:
        return False


# tmux -----------------------------------------------------------------------

# One call gets every pane of EVERY tmux session — which is what lets the offline
# edition adopt sessions the user started by hand, not just cockpit-launched
# `rcw-<id>` ones.
_PANE_FMT = "\t".join([
    "#{session_name}", "#{window_index}", "#{pane_index}", "#{pane_pid}",
    "#{pane_current_path}", "#{pane_current_command}",
    "#{session_created}", "#{session_attached}",
])


def _process_tree():
    """pid -> args, and pid -> child pids, from one `ps`."""
    rc, out, _ = run(["ps", "-eo", "pid=,ppid=,args="], timeout=10)
    if rc != 0:
        return ({}, {})
    args_by_pid = {}
    kids = {}
    for line in out.split("\n"):
        line = line.strip()
        if not line:
            continue
        parts = line.split(None, 2)
        if len(parts) < 2:
            continue
        try:
            pid = int(parts[0])
            ppid = int(parts[1])
        except Exception:
            continue
        args_by_pid[pid] = parts[2] if len(parts) > 2 else ""
        kids.setdefault(ppid, []).append(pid)
    return (args_by_pid, kids)


def _is_claude_cmd(args):
    if not args:
        return False
    exe = args.split()[0]
    return exe.rsplit("/", 1)[-1] == "claude"


def _resume_id(args):
    """`claude --resume <uuid>` names the exact transcript — the strongest correlation
    signal there is, and far better than guessing by working directory."""
    toks = args.split()
    for i, t in enumerate(toks):
        if t == "--resume" and i + 1 < len(toks):
            return toks[i + 1]
    return None


def _find_claude(pane_pid, args_by_pid, kids):
    """Search a pane's process subtree for the Claude CLI.

    Necessary because `pane_current_command` reports only the pane's FOREGROUND
    process. The cockpit's own wrapper launches Claude inside a shell command string
    (`RCW_WRAPPER_ID=… claude …; rcw_ec=$?; …`), so the pane reads as `bash` with
    claude as its child — matching on the pane command alone misses every
    wrapper-launched session on the box.
    """
    stack = [pane_pid]
    seen = set()
    while stack:
        pid = stack.pop(0)
        if pid in seen:
            continue
        seen.add(pid)
        args = args_by_pid.get(pid, "")
        if _is_claude_cmd(args):
            return (pid, args)
        for k in kids.get(pid, []):
            stack.append(k)
    return (None, None)


def m_tmux_list(_p):
    rc, out, err = run(["tmux", "list-panes", "-a", "-F", _PANE_FMT], timeout=10)
    if rc != 0:
        # No server running is the normal "no sessions" case, not an error.
        if "no server running" in (err or "").lower() or "no server running" in (out or "").lower():
            return {"panes": [], "running": False}
        raise RuntimeError(err.strip() or "tmux list-panes failed (rc=%d)" % rc)
    args_by_pid, kids = _process_tree()
    panes = []
    for line in out.split("\n"):
        if not line.strip():
            continue
        f = line.split("\t")
        if len(f) < 8:
            continue
        pane_pid = _int(f[3])
        claude_pid, claude_args = _find_claude(pane_pid, args_by_pid, kids)
        panes.append({
            "session": f[0],
            "window": _int(f[1]),
            "pane": _int(f[2]),
            "pid": pane_pid,
            "cwd": f[4],
            "command": f[5],
            "createdAt": _int(f[6]),
            "attached": f[7] not in ("", "0"),
            # Resolved from the process subtree, not the pane's foreground command.
            "claudePid": claude_pid,
            "claudeArgs": claude_args,
            "resumeId": _resume_id(claude_args) if claude_args else None,
        })
    return {"panes": panes, "running": True}


def m_tmux_capture(p):
    target = p.get("target")
    lines = int(p.get("lines") or 60)
    if not target:
        raise ValueError("target required")
    rc, out, err = run(["tmux", "capture-pane", "-p", "-J", "-t", target, "-S", "-%d" % lines], timeout=20)
    if rc != 0:
        raise RuntimeError(err.strip() or "capture-pane failed")
    return {"text": out}


def _int(s):
    try:
        return int(s)
    except Exception:
        return 0


# telemetry ------------------------------------------------------------------

_prev_cpu = [None]
_prev_net = [None]


def _cpu_linux():
    line = _read_text("/proc/stat", 4096).split("\n")[0]
    if not line.startswith("cpu "):
        return None
    parts = [float(x) for x in line.split()[1:] if x.strip() != ""]
    if len(parts) < 4:
        return None
    idle = parts[3] + (parts[4] if len(parts) > 4 else 0.0)
    total = sum(parts)
    return (idle, total)


def _mem_linux():
    info = {}
    for line in _read_text("/proc/meminfo", 8192).split("\n"):
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        digits = "".join(ch for ch in v if ch.isdigit())
        if digits:
            info[k.strip()] = int(digits) * 1024
    total = info.get("MemTotal", 0)
    # MemAvailable is the truthful "how much can a new process actually get" figure.
    # Node's os.freemem() reports MemFree, which reads alarmingly low on any box with
    # a warm page cache — so these numbers differ slightly from the hosted edition.
    avail = info.get("MemAvailable", info.get("MemFree", 0))
    return (total - avail, total)


def _net_linux():
    rx = tx = 0
    for line in _read_text("/proc/net/dev", 65536).split("\n")[2:]:
        if ":" not in line:
            continue
        name, rest = line.split(":", 1)
        if name.strip() == "lo":
            continue
        f = rest.split()
        if len(f) >= 9:
            rx += _int(f[0])
            tx += _int(f[8])
    return (rx, tx)


def _mem_darwin():
    rc, out, _ = run(["sysctl", "-n", "hw.memsize"], timeout=5)
    total = _int(out.strip()) if rc == 0 else 0
    rc, vm, _ = run(["vm_stat"], timeout=5)
    if rc != 0 or total == 0:
        return (0, total)
    page = 4096
    free_pages = 0
    for line in vm.split("\n"):
        if "page size of" in line:
            digits = "".join(ch for ch in line.split("page size of")[1] if ch.isdigit())
            if digits:
                page = int(digits)
        for key in ("Pages free:", "Pages inactive:", "Pages speculative:"):
            if line.startswith(key):
                digits = "".join(ch for ch in line.split(":", 1)[1] if ch.isdigit())
                if digits:
                    free_pages += int(digits)
    return (max(0, total - free_pages * page), total)


def _net_darwin():
    rc, out, _ = run(["netstat", "-ib"], timeout=8)
    if rc != 0:
        return (0, 0)
    rx = tx = 0
    seen = set()
    for line in out.split("\n")[1:]:
        f = line.split()
        # Only the "Link#" rows carry real per-interface byte counters; every other
        # row repeats them per address family and would double-count.
        if len(f) < 10 or not f[2].startswith("Link"):
            continue
        if f[0] in seen or f[0] == "lo0":
            continue
        seen.add(f[0])
        rx += _int(f[6])
        tx += _int(f[9])
    return (rx, tx)


def _cpu_darwin():
    # No cheap /proc equivalent; loadavg / ncpu is a decent stand-in and costs nothing.
    try:
        load1 = os.getloadavg()[0]
    except Exception:
        return None
    rc, out, _ = run(["sysctl", "-n", "hw.ncpu"], timeout=5)
    ncpu = _int(out.strip()) or 1
    return max(0.0, min(100.0, 100.0 * load1 / ncpu))


def m_telemetry(_p):
    now = time.time()
    is_linux = os.path.isdir("/proc")

    cpu_pct = None
    if is_linux:
        cur = _cpu_linux()
        prev = _prev_cpu[0]
        _prev_cpu[0] = cur
        if cur and prev:
            d_idle = cur[0] - prev[0]
            d_total = cur[1] - prev[1]
            if d_total > 0:
                cpu_pct = max(0.0, min(100.0, 100.0 * (1.0 - d_idle / d_total)))
    else:
        cpu_pct = _cpu_darwin()

    ram_used, ram_total = _mem_linux() if is_linux else _mem_darwin()

    rx_bps = tx_bps = None
    cur_net = _net_linux() if is_linux else _net_darwin()
    prev_net = _prev_net[0]
    _prev_net[0] = (cur_net[0], cur_net[1], now)
    if prev_net:
        dt = now - prev_net[2]
        if dt > 0.5:
            rx_bps = max(0, int((cur_net[0] - prev_net[0]) / dt))
            tx_bps = max(0, int((cur_net[1] - prev_net[1]) / dt))

    uptime = 0
    if is_linux:
        uptime = int(float((_read_text("/proc/uptime", 128).split() or ["0"])[0] or 0))
    else:
        rc, out, _ = run(["sysctl", "-n", "kern.boottime"], timeout=5)
        if rc == 0 and "sec =" in out:
            try:
                boot = int(out.split("sec =")[1].split(",")[0].strip())
                uptime = int(now - boot)
            except Exception:
                uptime = 0

    return {
        "cpuPct": None if cpu_pct is None else int(round(cpu_pct)),
        "ramUsed": ram_used,
        "ramTotal": ram_total,
        "netRxBps": rx_bps,
        "netTxBps": tx_bps,
        "uptimeSec": uptime,
        # The desktop must compute ages from THIS clock, never by comparing a remote
        # mtime against its own Date.now() — laptops sleep and drift, and the result
        # is bizarre "idle for -4 hours" readings.
        "t": int(now * 1000),
    }


# transcripts ----------------------------------------------------------------
#
# Division of labour, deliberately: Python does what only it can do cheaply — walking
# the tree, stat'ing, reading byte ranges, and filtering a multi-MB file down to the
# few lines that matter. All parsing that affects what the user SEES is done in
# TypeScript by @rcw/claude-core, the same code the on-host agent uses. Reimplementing
# that here would make the cockpit render differently depending on the backend.

# @rcw/claude-core caps its full-file scan at 80 MB because readTotalUsage() reads the
# whole transcript into memory. This scan streams line by line and only two integers
# cross the wire, so the memory argument doesn't apply — and long-running sessions do
# exceed 80 MB in practice (a real one on the dev box is 202 MB, for which the hosted
# edition silently reports 0 tokens). The cap here is only a runaway guard.
MAX_SCAN_BYTES = 4 * 1024 * 1024 * 1024
TODO_MARKERS = ("TaskCreate", "TaskUpdate", "TodoWrite")


def _projects_root():
    return os.path.join(os.path.expanduser("~"), ".claude", "projects")


def m_sessions_scan(p):
    """Stat every transcript. Cheap enough to call on every tick — no file contents."""
    root = _projects_root()
    now = time.time()
    limit = int((p or {}).get("limit") or 300)
    files = []
    try:
        dirs = os.listdir(root)
    except Exception:
        return {"root": root, "files": [], "now": int(now * 1000)}
    for d in dirs:
        dpath = os.path.join(root, d)
        try:
            names = os.listdir(dpath)
        except Exception:
            continue
        for n in names:
            if not n.endswith(".jsonl"):
                continue
            fpath = os.path.join(dpath, n)
            try:
                st = os.stat(fpath)
            except Exception:
                continue
            files.append({
                "path": fpath,
                "id": n[:-6],
                "dir": d,
                "size": st.st_size,
                "mtimeMs": int(st.st_mtime * 1000),
                # Age is computed HERE, against the remote clock. The desktop must never
                # compare a remote mtime with its own Date.now() — laptops sleep and
                # drift, and the result is nonsense like "idle for -4 hours".
                "ageMs": max(0, int((now - st.st_mtime) * 1000)),
            })
    files.sort(key=lambda f: f["mtimeMs"], reverse=True)
    return {"root": root, "files": files[:limit], "now": int(now * 1000)}


def m_transcript_head(p):
    """First bytes of each named transcript. The head never changes, so the desktop
    asks only for files it hasn't seen before."""
    paths = (p or {}).get("paths") or []
    nbytes = int((p or {}).get("bytes") or 16 * 1024)
    out = {}
    for path in paths[:200]:
        out[path] = _read_text(path, nbytes)
    return {"heads": out}


def m_transcript_tail(p):
    """Tail of a transcript, or the delta since a known offset.

    Passing `fromOffset` (the size at the last read) returns only what was appended,
    which is what makes watching a live session nearly free."""
    path = (p or {}).get("path")
    if not path:
        raise ValueError("path required")
    nbytes = int((p or {}).get("bytes") or 768 * 1024)
    from_offset = (p or {}).get("fromOffset")
    try:
        size = os.path.getsize(path)
    except Exception as exc:
        raise RuntimeError("stat failed: %s" % exc)

    truncated = False
    if from_offset is not None:
        start = int(from_offset)
        if start > size:
            # File shrank — rotated or rewritten. Fall back to a bounded tail and tell
            # the desktop to discard what it had rather than splice mismatched halves.
            truncated = True
            start = max(0, size - nbytes)
    else:
        start = max(0, size - nbytes)

    chunk = b""
    if size > start:
        try:
            with open(path, "rb") as fh:
                fh.seek(start)
                chunk = fh.read(size - start)
        except Exception as exc:
            raise RuntimeError("read failed: %s" % exc)

    # Drop a leading partial line whenever we started at a position we did NOT get from
    # a previous read — i.e. a bounded tail, including the post-rotation fallback.
    if start > 0 and (from_offset is None or truncated):
        nl = chunk.find(b"\n")
        chunk = chunk[nl + 1:] if nl >= 0 else b""
        start += (nl + 1) if nl >= 0 else len(chunk)

    # Trim to the last COMPLETE line and report the offset that lands on. Claude may be
    # mid-write, and returning a half-written JSON line would make every delta parse
    # produce a spurious failure. Offsets are byte offsets — decoding first and
    # measuring the string would desync on any multi-byte character.
    nl = chunk.rfind(b"\n")
    if nl < 0:
        chunk = b""
    else:
        chunk = chunk[:nl + 1]
    offset = start + len(chunk)

    return {
        "text": chunk.decode("utf-8", "replace"),
        "size": size,
        "offset": offset,
        "reset": truncated,
    }


def m_transcript_reduce(p):
    """Full-file aggregation, done here because the alternative is shipping a 160 MB
    transcript to compute two integers.

    Token totals mirror @rcw/claude-core's sumUsage exactly (cumulative-absolute, cache
    READS excluded as ~free) — that property is what makes the server-side usage ingest
    idempotent. Todo lines are only FILTERED here; the event-sourced fold stays in
    TypeScript so both editions build the same list."""
    path = (p or {}).get("path")
    if not path:
        raise ValueError("path required")
    try:
        size = os.path.getsize(path)
    except Exception as exc:
        raise RuntimeError("stat failed: %s" % exc)
    if size > MAX_SCAN_BYTES:
        return {"tokensInput": 0, "tokensOutput": 0, "todoLines": [], "scanned": False, "size": size}

    tokens_in = 0
    tokens_out = 0
    todo_lines = []
    try:
        with open(path, "rb") as fh:
            for raw in fh:
                try:
                    line = raw.decode("utf-8", "replace")
                except Exception:
                    continue
                if any(m in line for m in TODO_MARKERS):
                    if len(todo_lines) < 4000:
                        todo_lines.append(line.rstrip("\n"))
                if "usage" not in line:
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                msg = obj.get("message")
                if not isinstance(msg, dict) or msg.get("role") != "assistant":
                    continue
                u = msg.get("usage")
                if not isinstance(u, dict):
                    continue
                tokens_in += (u.get("input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0)
                tokens_out += u.get("output_tokens") or 0
    except Exception as exc:
        raise RuntimeError("scan failed: %s" % exc)

    return {
        "tokensInput": tokens_in,
        "tokensOutput": tokens_out,
        "todoLines": todo_lines,
        "scanned": True,
        "size": size,
    }


METHODS = {
    "probe.ping": (m_ping, "fast"),
    "probe.info": (m_info, "fast"),
    "tmux.list": (m_tmux_list, "fast"),
    "tmux.capturePane": (m_tmux_capture, "slow"),
    "telemetry.sample": (m_telemetry, "slow"),
    "sessions.scan": (m_sessions_scan, "slow"),
    "transcript.head": (m_transcript_head, "slow"),
    "transcript.tail": (m_transcript_tail, "slow"),
    "transcript.reduce": (m_transcript_reduce, "slow"),
}


# --------------------------------------------------------------------------
# Dispatch
# --------------------------------------------------------------------------

_work_q = queue.Queue()


def _invoke(rid, name, params):
    entry = METHODS.get(name)
    if entry is None:
        respond_err(rid, "E_NO_METHOD", "unknown method: %s" % name)
        return
    try:
        respond(rid, entry[0](params or {}))
    except Exception as exc:
        respond_err(rid, "E_HANDLER", "%s: %s" % (type(exc).__name__, exc))


def _worker_loop():
    while True:
        item = _work_q.get()
        if item is None:
            _work_q.task_done()
            break
        try:
            _invoke(item[0], item[1], item[2])
        finally:
            _work_q.task_done()


def _drain(timeout):
    """Best-effort wait for queued slow methods to finish, so a request issued just
    before shutdown (or before stdin closes) still gets its answer."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _work_q.unfinished_tasks == 0:
            return True
        time.sleep(0.02)
    return False


def _heartbeat_loop():
    seq = 0
    while not _stop.wait(HB_INTERVAL):
        seq += 1
        _flush_drop_notice()
        emit({"ev": "hb", "p": {"t": int(time.time() * 1000), "seq": seq, "q": _out_q.qsize()}})


def main():
    threading.Thread(target=_writer_loop, name="rcw-writer").start()
    for i in range(WORKERS):
        t = threading.Thread(target=_worker_loop, name="rcw-worker-%d" % i)
        t.daemon = True
        t.start()
    hb = threading.Thread(target=_heartbeat_loop, name="rcw-hb")
    hb.daemon = True
    hb.start()

    emit({"ev": "ready", "p": _host_info()})

    try:
        for raw in sys.stdin:
            line = raw.strip()
            if not line:
                continue
            try:
                msg = json.loads(line)
            except Exception:
                # Never die on garbage; the desktop reports unparseable input itself.
                continue
            rid = msg.get("id")
            name = msg.get("m")
            params = msg.get("p")
            if name == "probe.shutdown":
                # Let in-flight slow methods finish and answer first — otherwise a
                # request sent just before shutdown is silently dropped and its
                # caller hangs until its timeout.
                _drain(5.0)
                respond(rid, {"ok": True})
                break
            entry = METHODS.get(name)
            if entry is not None and entry[1] == "fast":
                # Run inline: a keystroke must never queue behind a slow `docker stats`.
                _invoke(rid, name, params)
            else:
                _work_q.put((rid, name, params))
    except Exception:
        pass
    finally:
        # stdin closed (ssh went away) or we were asked to stop. Give queued work a
        # moment to answer, then let the writer flush what's already queued before
        # the sentinel stops it.
        _drain(2.0)
        _stop.set()
        try:
            _out_q.put(None, timeout=5)
        except Exception:
            pass


if __name__ == "__main__":
    main()
