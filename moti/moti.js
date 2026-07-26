/* ============================================================
   Moti — embeddable AI assistant widget for HomeLinq
   Self-contained: injects its own CSS, builds the widget, and
   talks to the Supabase Edge Function (with offline fallback).
   Load order on a page:
     <script src="moti/config.js"></script>
     <script src="moti/moti-knowledge.js"></script>
     <script src="moti/moti.js"></script>
   ============================================================ */
(function () {
  "use strict";

  var KB = window.MOTI_KB || { greeting: "Hi, I'm Moti.", starters: [], entries: [], fallback: "Please contact HomeLinq support." };
  var CFG = window.MOTI_CONFIG || {};

  function aiReady() {
    return !!(CFG.MOTI_FUNCTION_URL && CFG.MOTI_FUNCTION_URL.indexOf("supabase.co") !== -1 && CFG.SUPABASE_ANON_KEY);
  }

  var sessionId;
  try {
    sessionId = localStorage.getItem("moti_session");
    if (!sessionId) {
      sessionId = "s-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
      localStorage.setItem("moti_session", sessionId);
    }
  } catch (e) { sessionId = "s-" + Date.now(); }

  var convo = [];

  /* ---------- inject styles ---------- */
  function injectCSS() {
    var css = ""
      + ".mtw-fab{position:fixed;right:22px;bottom:22px;z-index:2147483000;display:flex;align-items:center;gap:9px;background:#D4F500;color:#15170a;border:none;border-radius:999px;padding:8px 17px 8px 8px;cursor:pointer;font-family:inherit;font-weight:600;font-size:14.5px;box-shadow:0 8px 30px rgba(0,0,0,.32);transition:transform .18s}"
      + ".mtw-fab:hover{transform:translateY(-2px)}"
      + ".mtw-fab .mtw-fh{width:40px;height:40px;background:#15170a;border-radius:50%;display:flex;align-items:center;justify-content:center}"
      + ".mtw-fab .mtw-fh svg{width:29px}"
      + ".mtw-fab.mtw-hide{display:none}"
      + ".mtw-panel{position:fixed;right:22px;bottom:22px;z-index:2147483001;width:374px;max-width:calc(100vw - 28px);height:548px;max-height:calc(100vh - 44px);background:#1A1C22;border:1px solid #2C2F39;border-radius:20px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.55);font-family:inherit}"
      + ".mtw-panel.mtw-open{display:flex;animation:mtwpop .22s ease}"
      + "@keyframes mtwpop{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}"
      + ".mtw-top{display:flex;align-items:center;gap:11px;padding:15px 16px;background:#212430;border-bottom:1px solid #2C2F39}"
      + ".mtw-top .mtw-h{width:44px;height:44px;background:#30343E;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:0 0 44px}"
      + ".mtw-top .mtw-h svg{width:33px}"
      + ".mtw-nm{font-weight:700;font-size:16px;color:#F4F4F0}"
      + ".mtw-sub{font-size:12px;color:#9AA0AC;display:flex;align-items:center;gap:6px}"
      + ".mtw-dot{width:7px;height:7px;border-radius:50%;background:#D4F500;display:inline-block}"
      + ".mtw-x{margin-left:auto;background:none;border:none;color:#9AA0AC;font-size:22px;cursor:pointer;line-height:1;padding:4px}"
      + ".mtw-x:hover{color:#F4F4F0}"
      + ".mtw-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:11px}"
      + ".mtw-msg{max-width:85%;font-size:14.5px;line-height:1.55;padding:10px 13px;border-radius:14px;white-space:pre-wrap}"
      + ".mtw-msg.mtw-bot{background:#30343E;color:#F4F4F0;border-bottom-left-radius:4px;align-self:flex-start}"
      + ".mtw-msg.mtw-user{background:#D4F500;color:#15170a;font-weight:500;border-bottom-right-radius:4px;align-self:flex-end}"
      + ".mtw-typing{align-self:flex-start;background:#30343E;border-radius:14px;border-bottom-left-radius:4px;padding:12px 15px;display:flex;gap:5px}"
      + ".mtw-typing span{width:7px;height:7px;border-radius:50%;background:#9AA0AC;animation:mtwdot 1s infinite}"
      + ".mtw-typing span:nth-child(2){animation-delay:.15s}.mtw-typing span:nth-child(3){animation-delay:.3s}"
      + "@keyframes mtwdot{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-4px)}}"
      + ".mtw-chips{display:flex;flex-wrap:wrap;gap:7px;padding:0 16px 11px}"
      + ".mtw-chips button{background:transparent;border:1px solid #2C2F39;color:#9AA0AC;font-family:inherit;font-size:12.5px;padding:7px 11px;border-radius:999px;cursor:pointer}"
      + ".mtw-chips button:hover{border-color:#D4F500;color:#D4F500}"
      + ".mtw-input{display:flex;gap:8px;padding:13px 14px;border-top:1px solid #2C2F39;background:#212430}"
      + ".mtw-input input{flex:1;background:#0E0F13;border:1px solid #2C2F39;border-radius:10px;color:#F4F4F0;font-family:inherit;font-size:14px;padding:10px 12px}"
      + ".mtw-input input:focus{outline:none;border-color:#D4F500}"
      + ".mtw-input button{background:#D4F500;border:none;border-radius:10px;width:42px;cursor:pointer;color:#15170a;font-size:17px;font-weight:700}"
      + ".mtw-svg .mtw-eye{transform-box:fill-box;transform-origin:center;animation:mtwblink 5.4s infinite}"
      + ".mtw-svg .mtw-eye2{animation-delay:.06s}"
      + "@keyframes mtwblink{0%,94%,100%{transform:scaleY(1)}97%{transform:scaleY(.12)}}";
    var s = document.createElement("style");
    s.textContent = css;
    document.head.appendChild(s);
  }

  /* ---------- Moti head SVG ---------- */
  function motiHead() {
    return '<svg class="mtw-svg" viewBox="0 0 140 122" xmlns="http://www.w3.org/2000/svg">' +
      '<line x1="70" y1="26" x2="70" y2="16" stroke="#474D5B" stroke-width="5" stroke-linecap="round"/>' +
      '<circle cx="70" cy="10" r="5.5" fill="#D4F500"/>' +
      '<rect x="18" y="56" width="12" height="40" rx="6" fill="#2A2D36"/>' +
      '<rect x="110" y="56" width="12" height="40" rx="6" fill="#2A2D36"/>' +
      '<rect x="26" y="26" width="88" height="84" rx="24" fill="#474D5B"/>' +
      '<rect x="38" y="44" width="64" height="50" rx="16" fill="#121319"/>' +
      '<circle class="mtw-eye" cx="57" cy="68" r="9.5" fill="#D4F500"/>' +
      '<circle class="mtw-eye mtw-eye2" cx="83" cy="68" r="9.5" fill="#D4F500"/>' +
      '<circle cx="54" cy="64" r="2.8" fill="#fff" opacity="0.9"/>' +
      '<circle cx="80" cy="64" r="2.8" fill="#fff" opacity="0.9"/>' +
      '<path d="M60 83 Q70 91 80 83" fill="none" stroke="#D4F500" stroke-width="4" stroke-linecap="round"/>' +
      '<circle cx="24" cy="76" r="2.5" fill="#D4F500"/>' +
      '<circle cx="116" cy="76" r="2.5" fill="#D4F500"/>' +
      '</svg>';
  }

  /* ---------- offline fallback matcher ---------- */
  var STOP = {};
  "what how do does the is are can a an and or to of for with you your i my me it this that on in".split(" ")
    .forEach(function (w) { STOP[w] = 1; });
  var PHRASES = [
    [/smell.*gas|gas leak|emergency|urgent/, "emergency"],
    [/how much|price|pricing|cost|\bpay\b/, "pricing"],
    [/book|find.*engineer|need.*engineer/, "book"],
    [/become|\bjoin\b|i.?m an engineer|sign up/, "engineer"]
  ];
  function entryById(id) {
    for (var i = 0; i < KB.entries.length; i++) { if (KB.entries[i].id === id) return KB.entries[i]; }
    return null;
  }
  function findAnswer(raw) {
    var t = " " + String(raw).toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ") + " ";
    var trimmed = t.trim();
    if (/\b(hi|hey|hello|yo|hiya|morning|afternoon)\b/.test(t) && trimmed.split(" ").length <= 3) return KB.greeting;
    if (/\b(thanks|thank|cheers|ta)\b/.test(t) && trimmed.split(" ").length <= 4)
      return "Anytime. Anything else I can help with?";
    for (var p = 0; p < PHRASES.length; p++) {
      if (PHRASES[p][0].test(t)) { var e = entryById(PHRASES[p][1]); if (e) return e.a; }
    }
    var best = null, score = 0;
    for (var i = 0; i < KB.entries.length; i++) {
      var ent = KB.entries[i], s = 0;
      for (var j = 0; j < ent.tags.length; j++) {
        var tag = ent.tags[j];
        if (STOP[tag]) continue;
        if (t.indexOf(" " + tag) !== -1) s += tag.length > 5 ? 3 : (tag.length > 3 ? 2 : 1);
      }
      if (s > score) { score = s; best = ent; }
    }
    return (best && score >= 2) ? best.a : KB.fallback;
  }

  /* ---------- widget ---------- */
  var fab, panel, bodyEl, chipsEl, inputEl, started = false;

  function build() {
    fab = document.createElement("button");
    fab.className = "mtw-fab";
    fab.setAttribute("aria-label", "Ask Moti");
    fab.innerHTML = '<span class="mtw-fh">' + motiHead() + '</span><span>Ask Moti</span>';
    document.body.appendChild(fab);

    panel = document.createElement("div");
    panel.className = "mtw-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Chat with Moti");
    panel.innerHTML =
      '<div class="mtw-top">' +
        '<span class="mtw-h">' + motiHead() + '</span>' +
        '<div><div class="mtw-nm">Moti</div>' +
        '<div class="mtw-sub"><span class="mtw-dot"></span> Your HomeLinq assistant</div></div>' +
        '<button class="mtw-x" aria-label="Close">&times;</button>' +
      '</div>' +
      '<div class="mtw-body"></div>' +
      '<div class="mtw-chips"></div>' +
      '<form class="mtw-input"><input type="text" placeholder="Ask Moti a question..." ' +
        'autocomplete="off" aria-label="Message"/><button type="submit" aria-label="Send">&#8593;</button></form>';
    document.body.appendChild(panel);

    bodyEl = panel.querySelector(".mtw-body");
    chipsEl = panel.querySelector(".mtw-chips");
    inputEl = panel.querySelector(".mtw-input input");

    fab.addEventListener("click", open);
    panel.querySelector(".mtw-x").addEventListener("click", close);
    panel.querySelector(".mtw-input").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = inputEl.value.trim();
      if (v) { send(v); inputEl.value = ""; }
    });
  }

  function open() {
    fab.classList.add("mtw-hide");
    panel.classList.add("mtw-open");
    if (!started) { started = true; addMsg(KB.greeting, "bot"); renderChips(); }
    setTimeout(function () { inputEl.focus(); }, 250);
  }
  function close() { panel.classList.remove("mtw-open"); fab.classList.remove("mtw-hide"); }

  function renderChips() {
    chipsEl.innerHTML = "";
    (KB.starters || []).forEach(function (q) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = q;
      b.addEventListener("click", function () { send(q); });
      chipsEl.appendChild(b);
    });
  }

  function addMsg(text, who) {
    var m = document.createElement("div");
    m.className = "mtw-msg mtw-" + who;
    m.textContent = text;
    bodyEl.appendChild(m);
    bodyEl.scrollTop = bodyEl.scrollHeight;
    return m;
  }

  function addFeedback(messageId) {
    var wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;align-items:center;gap:8px;margin:-3px 0 3px;padding-left:2px";
    var label = document.createElement("span");
    label.textContent = "Was this helpful?";
    label.style.cssText = "font-size:12px;color:#646A76";
    wrap.appendChild(label);
    ["Yes", "No"].forEach(function (txt, idx) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = txt;
      b.style.cssText = "background:transparent;border:1px solid #2C2F39;color:#9AA0AC;font-family:inherit;font-size:12px;padding:3px 10px;border-radius:999px;cursor:pointer";
      b.addEventListener("click", function () {
        sendFeedback(messageId, idx === 0);
        wrap.innerHTML = "";
        var t = document.createElement("span");
        t.textContent = "Thanks - that helps Moti improve.";
        t.style.cssText = "font-size:12px;color:#646A76";
        wrap.appendChild(t);
      });
      wrap.appendChild(b);
    });
    bodyEl.appendChild(wrap);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

  function sendFeedback(messageId, helpful) {
    if (!aiReady()) return;
    try {
      fetch(CFG.SUPABASE_URL + "/rest/v1/moti_feedback", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": CFG.SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + CFG.SUPABASE_ANON_KEY,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify({ session_id: sessionId, message_id: messageId, helpful: helpful })
      });
    } catch (e) { /* best-effort */ }
  }

  function showTyping() {
    var t = document.createElement("div");
    t.className = "mtw-typing";
    t.innerHTML = "<span></span><span></span><span></span>";
    bodyEl.appendChild(t);
    bodyEl.scrollTop = bodyEl.scrollHeight;
    return t;
  }

  function offlineReply(text, typing) {
    var reply = findAnswer(text);
    setTimeout(function () {
      typing.remove();
      convo.push({ role: "user", content: text });
      convo.push({ role: "assistant", content: reply });
      addMsg(reply, "bot");
      renderChips();
    }, 360 + Math.min(reply.length * 5, 600));
  }

  function send(text) {
    addMsg(text, "user");
    chipsEl.innerHTML = "";
    var typing = showTyping();

    if (!aiReady()) { offlineReply(text, typing); return; }

    fetch(CFG.MOTI_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": CFG.SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + CFG.SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ message: text, history: convo.slice(-10), sessionId: sessionId })
    })
      .then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (d) {
        if (d && d.reply) {
          typing.remove();
          convo.push({ role: "user", content: text });
          convo.push({ role: "assistant", content: d.reply });
          addMsg(d.reply, "bot");
          if (d.messageId) addFeedback(d.messageId);
          renderChips();
        } else {
          offlineReply(text, typing);
        }
      })
      .catch(function () { offlineReply(text, typing); });
  }

  function init() { injectCSS(); build(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
