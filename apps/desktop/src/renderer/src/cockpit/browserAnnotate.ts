// Injected overlays for the browser "point & prompt" tools. The UI lives INSIDE the
// <webview> guest (an Electron guest paints above all host DOM, so a host overlay
// can't sit over the page). The guest signals events back over its console — the one
// channel a preload-less guest has that the host receives verbatim — and the host
// (BrowserPanel) does the screenshotting, uploading and sending. Two modes:
//   - "dom":    hover-highlight + click to pin elements, note each, send a review.
//   - "region": drag a rectangle to screenshot an area, then attach a command.
// Teardown removes every injected node so toggling off leaves the page pristine.

export type AnnotateMode = "dom" | "region";

export const ANNOTATE_MARK = "__RCW_ANNOT__::";

/** Events the guest overlay emits (parsed from the console marker by the host). */
export type AnnotateEvent =
  | { t: "pin"; id: number; selector: string; domPath: string; text: string; box: Box; vw: number; vh: number; url: string }
  | { t: "unpin"; id: number }
  | { t: "send"; url: string; notes: Array<{ id: number; note: string }> }
  | { t: "region"; box: Box; vw: number; vh: number; url: string }
  | { t: "region-send"; url: string; command: string }
  | { t: "exit" };

export type Box = { x: number; y: number; w: number; h: number };

// ---------------------------------------------------------------------------
// The injected guest program. Written as a plain string (NOT a JS template
// literal and using string concatenation internally) so nothing inside collides
// with this file's own template handling. Guarded so re-injection is a no-op.
// ---------------------------------------------------------------------------
const GUEST = `(() => {
  var MARK = ${JSON.stringify(ANNOTATE_MARK)};
  var MODE = "__MODE__";
  if (window.__rcwAnnot && window.__rcwAnnot.mode === MODE) return;
  if (window.__rcwAnnot) { try { window.__rcwAnnot.teardown(); } catch (e) {} }

  var ACCENT = "#ff7a3c";
  var nodes = [];
  var pins = [];        // {id, el, note, badge, outline}
  var nextId = 1;

  function mk(tag, css) {
    var n = document.createElement(tag);
    n.setAttribute("data-rcw-annot", "1");
    if (css) n.style.cssText = css;
    nodes.push(n);
    (document.documentElement || document.body).appendChild(n);
    return n;
  }
  function isOurs(el) { return !!(el && el.closest && el.closest('[data-rcw-annot]')); }
  function signal(o) { try { console.log(MARK + JSON.stringify(o)); } catch (e) {} }
  function vp() { return { vw: window.innerWidth, vh: window.innerHeight }; }
  function urlNow() { return location.href; }

  // ---- element identity ---------------------------------------------------
  function cssEscape(s) { try { return window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/[^a-zA-Z0-9_-]/g, "\\\\$&"); } catch (e) { return s; } }
  function selectorFor(el) {
    if (el.id && document.querySelectorAll("#" + cssEscape(el.id)).length === 1) return "#" + cssEscape(el.id);
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && parts.length < 6) {
      var seg = cur.nodeName.toLowerCase();
      if (cur.id && document.querySelectorAll("#" + cssEscape(cur.id)).length === 1) { parts.unshift("#" + cssEscape(cur.id)); break; }
      var cls = (cur.getAttribute && cur.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean)[0];
      if (cls) seg += "." + cssEscape(cls);
      var p = cur.parentElement;
      if (p) {
        var same = Array.prototype.filter.call(p.children, function (c) { return c.nodeName === cur.nodeName; });
        if (same.length > 1) seg += ":nth-of-type(" + (Array.prototype.indexOf.call(p.children, cur) + 1) + ")";
      }
      parts.unshift(seg);
      cur = p;
    }
    return parts.join(" > ");
  }
  function domPathFor(el) {
    var parts = [];
    var cur = el;
    while (cur && cur.nodeType === 1 && cur !== document.documentElement && parts.length < 5) {
      var seg = cur.nodeName.toLowerCase();
      var cls = (cur.getAttribute && cur.getAttribute("class") || "").trim().split(/\\s+/).filter(Boolean)[0];
      if (cls) seg += "." + cls;
      parts.unshift(seg);
      cur = cur.parentElement;
    }
    return parts.join(" > ");
  }
  function textFor(el) {
    var t = (el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim();
    if (t) return t.slice(0, 300);
    var h = (el.outerHTML || "").replace(/\\s+/g, " ").trim();
    return h.slice(0, 200);
  }
  function boxFor(el) { var r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }

  // ---- shared teardown ----------------------------------------------------
  function teardown() {
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("keydown", onKey, true);
    document.removeEventListener("mousedown", onDown, true);
    document.removeEventListener("mouseup", onUp, true);
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition, true);
    for (var i = 0; i < nodes.length; i++) { try { nodes[i].remove(); } catch (e) {} }
    nodes = []; pins = [];
    try { delete window.__rcwAnnot; } catch (e) { window.__rcwAnnot = null; }
  }
  window.__rcwAnnot = { mode: MODE, teardown: teardown, ready: function () {} };

  // A hover highlighter shared by DOM mode.
  var hover = null, onMove = function () {}, onClick = function () {}, onKey = function () {},
      onDown = function () {}, onUp = function () {}, reposition = function () {};

  function onKeyGlobal(e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); signal({ t: "exit" }); teardown(); } }
  onKey = onKeyGlobal;
  document.addEventListener("keydown", onKey, true);

  // =========================================================================
  if (MODE === "dom") {
    hover = mk("div", "position:fixed;z-index:2147483640;pointer-events:none;border:2px solid " + ACCENT + ";background:" + ACCENT + "22;border-radius:3px;transition:all .04s ease;display:none;");
    var panel = mk("div", "position:fixed;right:14px;bottom:14px;z-index:2147483646;width:300px;max-height:60vh;overflow:auto;background:#1b1712f2;color:#f4ece2;font:12px/1.4 -apple-system,system-ui,sans-serif;border:1px solid #ffffff26;border-radius:12px;box-shadow:0 18px 50px #000a;padding:10px;backdrop-filter:blur(8px);");
    var head = mk("div", "position:absolute;left:-9999px;"); // placeholder to keep node order tidy
    panel.innerHTML = '<div data-drag style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px;cursor:move;user-select:none"><b style="font-size:12.5px">⠿ Comment mode</b><span style="opacity:.6;font-size:11px;text-align:right">drag to move · Esc to exit</span></div><div data-list></div><div data-empty style="opacity:.6;padding:6px 2px">Hover and click an element to pin it.</div><div style="display:flex;gap:8px;margin-top:10px"><button data-send style="flex:1;background:' + ACCENT + ';color:#1b1006;border:0;border-radius:8px;padding:7px 10px;font-weight:700;cursor:pointer">Send review (0)</button><button data-cancel style="background:#ffffff1a;color:#f4ece2;border:0;border-radius:8px;padding:7px 10px;cursor:pointer">Cancel</button></div>';
    var listEl = panel.querySelector("[data-list]");
    var emptyEl = panel.querySelector("[data-empty]");
    var sendBtn = panel.querySelector("[data-send]");
    panel.querySelector("[data-cancel]").addEventListener("click", function () { signal({ t: "exit" }); teardown(); });

    // Drag the panel by its header so it never blocks the element you want to click.
    var drag = null;
    function onDragMove(e) {
      if (!drag) return;
      var x = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, e.clientX - drag.dx));
      var y = Math.max(0, Math.min(window.innerHeight - panel.offsetHeight, e.clientY - drag.dy));
      panel.style.left = x + "px"; panel.style.top = y + "px";
    }
    function onDragUp() { drag = null; document.removeEventListener("mousemove", onDragMove, true); document.removeEventListener("mouseup", onDragUp, true); }
    panel.querySelector("[data-drag]").addEventListener("mousedown", function (e) {
      e.preventDefault(); e.stopPropagation();
      var r = panel.getBoundingClientRect();
      // Switch from right/bottom anchoring to explicit left/top on first grab.
      panel.style.right = "auto"; panel.style.bottom = "auto";
      panel.style.left = r.left + "px"; panel.style.top = r.top + "px";
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      document.addEventListener("mousemove", onDragMove, true);
      document.addEventListener("mouseup", onDragUp, true);
    });

    function renderList() {
      emptyEl.style.display = pins.length ? "none" : "block";
      sendBtn.textContent = "Send review (" + pins.length + ")";
      listEl.innerHTML = "";
      pins.forEach(function (p) {
        var row = document.createElement("div");
        row.setAttribute("data-rcw-annot", "1");
        row.style.cssText = "border-top:1px solid #ffffff14;padding:8px 0";
        var top = document.createElement("div");
        top.style.cssText = "display:flex;gap:6px;align-items:center;margin-bottom:4px";
        top.innerHTML = '<span style="background:' + ACCENT + ';color:#1b1006;border-radius:999px;min-width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800">' + p.id + '</span><code style="font-size:10.5px;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">' + p.selector.replace(/</g, "&lt;") + '</code><button style="background:none;border:0;color:#f4ece2;opacity:.6;cursor:pointer">✕</button>';
        top.querySelector("button").addEventListener("click", function () { removePin(p.id); });
        var inp = document.createElement("input");
        inp.setAttribute("data-rcw-annot", "1");
        inp.placeholder = "What should change here?";
        inp.value = p.note || "";
        inp.style.cssText = "width:100%;box-sizing:border-box;background:#0000003a;border:1px solid #ffffff1f;color:#f4ece2;border-radius:7px;padding:5px 7px;font:12px inherit";
        inp.addEventListener("input", function () { p.note = inp.value; });
        row.appendChild(top); row.appendChild(inp);
        listEl.appendChild(row);
      });
    }
    function reposition2() {
      pins.forEach(function (p) {
        if (!p.el || !p.el.isConnected) return;
        var r = p.el.getBoundingClientRect();
        p.outline.style.left = r.left + "px"; p.outline.style.top = r.top + "px";
        p.outline.style.width = r.width + "px"; p.outline.style.height = r.height + "px";
        p.badge.style.left = (r.left) + "px"; p.badge.style.top = (r.top) + "px";
      });
    }
    reposition = reposition2;
    function removePin(id) {
      var i = pins.findIndex(function (p) { return p.id === id; });
      if (i < 0) return;
      try { pins[i].outline.remove(); pins[i].badge.remove(); } catch (e) {}
      pins.splice(i, 1); renderList(); signal({ t: "unpin", id: id });
    }
    onMove = function (e) {
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || isOurs(el)) { hover.style.display = "none"; return; }
      var r = el.getBoundingClientRect();
      hover.style.display = "block";
      hover.style.left = r.left + "px"; hover.style.top = r.top + "px";
      hover.style.width = r.width + "px"; hover.style.height = r.height + "px";
      hover.__el = el;
    };
    onClick = function (e) {
      if (isOurs(e.target)) return;             // clicks in our panel behave normally
      var el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || isOurs(el)) return;
      e.preventDefault(); e.stopPropagation();
      var id = nextId++;
      var outline = mk("div", "position:fixed;z-index:2147483641;pointer-events:none;border:2px solid " + ACCENT + ";border-radius:3px;");
      var badge = mk("div", "position:fixed;z-index:2147483642;pointer-events:none;transform:translate(-4px,-10px);background:" + ACCENT + ";color:#1b1006;font:800 10px system-ui;border-radius:999px;min-width:16px;height:16px;display:flex;align-items:center;justify-content:center;padding:0 3px");
      badge.textContent = String(id);
      var p = { id: id, el: el, note: "", outline: outline, badge: badge, selector: selectorFor(el) };
      pins.push(p);
      var b = boxFor(el); var v = vp();
      signal({ t: "pin", id: id, selector: p.selector, domPath: domPathFor(el), text: textFor(el), box: b, vw: v.vw, vh: v.vh, url: urlNow() });
      renderList(); reposition2();
    };
    sendBtn.addEventListener("click", function () {
      if (!pins.length) { signal({ t: "exit" }); teardown(); return; }
      var notes = pins.map(function (p) { return { id: p.id, note: p.note || "" }; });
      signal({ t: "send", url: urlNow(), notes: notes });
      teardown();
    });
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition, true);
  }

  // =========================================================================
  if (MODE === "region") {
    var dim = mk("div", "position:fixed;inset:0;z-index:2147483640;cursor:crosshair;background:#0000;");
    var rect = mk("div", "position:fixed;z-index:2147483641;pointer-events:none;border:2px solid " + ACCENT + ";background:" + ACCENT + "1f;display:none;");
    var tip = mk("div", "position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:2147483646;background:#1b1712f2;color:#f4ece2;font:12px system-ui;border:1px solid #ffffff26;border-radius:999px;padding:6px 14px;box-shadow:0 10px 30px #0008");
    tip.textContent = "Drag to select an area · Esc to cancel";
    var start = null, cur = null, sent = false;

    function rectBox() {
      var x = Math.min(start.x, cur.x), y = Math.min(start.y, cur.y);
      return { x: x, y: y, w: Math.abs(cur.x - start.x), h: Math.abs(cur.y - start.y) };
    }
    onDown = function (e) { if (sent) return; start = { x: e.clientX, y: e.clientY }; cur = start; rect.style.display = "block"; drawRect(); };
    function drawRect() { var b = rectBox(); rect.style.left = b.x + "px"; rect.style.top = b.y + "px"; rect.style.width = b.w + "px"; rect.style.height = b.h + "px"; }
    dim.addEventListener("mousemove", function (e) { if (!start || sent) return; cur = { x: e.clientX, y: e.clientY }; drawRect(); });
    onUp = function (e) {
      if (!start || sent) return;
      cur = { x: e.clientX, y: e.clientY };
      var b = rectBox();
      if (b.w < 6 || b.h < 6) { start = null; rect.style.display = "none"; return; }
      sent = true; dim.style.cursor = "default"; dim.style.pointerEvents = "none";
      var v = vp();
      signal({ t: "region", box: b, vw: v.vw, vh: v.vh, url: urlNow() });
      // Command bar anchored under the rectangle.
      var bar = mk("div", "position:fixed;z-index:2147483646;background:#1b1712f5;border:1px solid #ffffff26;border-radius:10px;box-shadow:0 14px 40px #000a;padding:8px;display:flex;gap:8px;align-items:center;width:min(460px,80vw)");
      bar.style.left = Math.max(8, Math.min(b.x, window.innerWidth - 470)) + "px";
      bar.style.top = Math.min(b.y + b.h + 8, window.innerHeight - 60) + "px";
      var status = "capturing…";
      bar.innerHTML = '<input data-cmd placeholder="Command for this screenshot…" style="flex:1;background:#0000003a;border:1px solid #ffffff1f;color:#f4ece2;border-radius:7px;padding:7px 9px;font:13px system-ui"/><button data-go style="background:' + ACCENT + ';color:#1b1006;border:0;border-radius:8px;padding:7px 12px;font-weight:700;cursor:pointer">Send</button>';
      var input = bar.querySelector("[data-cmd]");
      var go = bar.querySelector("[data-go]");
      tip.textContent = status;
      window.__rcwAnnot.ready = function (rel) { tip.textContent = "📋 " + rel + " (copied) — add a command"; };
      function submit() { signal({ t: "region-send", url: urlNow(), command: input.value || "" }); teardown(); }
      go.addEventListener("click", submit);
      input.addEventListener("keydown", function (e2) { if (e2.key === "Enter") { e2.preventDefault(); submit(); } });
      setTimeout(function () { try { input.focus(); } catch (e3) {} }, 30);
    };
    dim.addEventListener("mousedown", onDown, true);
    dim.addEventListener("mouseup", onUp, true);
  }
})();`;

/** The injected program for a given mode, with the mode literal substituted in. */
export function annotateJs(mode: AnnotateMode): string {
  return GUEST.replace("__MODE__", mode);
}

/** Tear down any active overlay (used when toggling a mode off from the host). */
export const ANNOTATE_TEARDOWN_JS = `(() => { try { if (window.__rcwAnnot) window.__rcwAnnot.teardown(); } catch (e) {} })();`;

/** Push the saved screenshot path into the region command bar (host → guest). */
export function annotateReadyJs(rel: string): string {
  return `(() => { try { if (window.__rcwAnnot && window.__rcwAnnot.ready) window.__rcwAnnot.ready(${JSON.stringify(rel)}); } catch (e) {} })();`;
}

type WV = HTMLElement & { executeJavaScript(code: string): Promise<unknown> };

/**
 * Inject the overlay for `mode` and translate its console signals into onEvent.
 * Returns a cleanup fn that removes the listener AND tears down the guest overlay.
 */
export function wireAnnotate(wv: WV, mode: AnnotateMode, onEvent: (e: AnnotateEvent) => void): () => void {
  const inject = () => { try { void wv.executeJavaScript(annotateJs(mode)); } catch { /* not ready */ } };
  const onConsole = (e: Event) => {
    const msg = (e as unknown as { message?: string }).message;
    if (typeof msg !== "string" || !msg.startsWith(ANNOTATE_MARK)) return;
    try { onEvent(JSON.parse(msg.slice(ANNOTATE_MARK.length)) as AnnotateEvent); } catch { /* ignore malformed */ }
  };
  inject();
  wv.addEventListener("console-message", onConsole as EventListener);
  // Re-inject if the guest navigates while the mode is on (pins reset — expected).
  wv.addEventListener("dom-ready", inject as EventListener);
  return () => {
    wv.removeEventListener("console-message", onConsole as EventListener);
    wv.removeEventListener("dom-ready", inject as EventListener);
    try { void wv.executeJavaScript(ANNOTATE_TEARDOWN_JS); } catch { /* gone */ }
  };
}
