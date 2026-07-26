/* ============================================================
   Moti Pro — operational AI assistant widget for HomeLinq Pro
   Used on app.html. Acts as the logged-in engineer: looks up
   their real data, builds reports, and proposes write-actions
   (invoices, sending invoices, chasing payment, etc.) for them
   to confirm. Load order:  config.js  then  moti-pro.js
   ============================================================ */
(function () {
  "use strict";

  var CFG = window.MOTI_CONFIG || {};
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) { return; }
  var REF = CFG.SUPABASE_URL.split("//")[1].split(".")[0];
  var FN_URL = CFG.SUPABASE_URL + "/functions/v1/moti-engineer";
  var STORE_KEY = "sb-" + REF + "-auth-token";

  var GREETING_BODY = "I'm Moti, your HomeLinq Pro assistant. I can pull up your jobs, invoices, quotes and finances and build you quick reports - and I can create invoices, email them to your customers and chase up payment for you. Just moved over from another platform like Commusoft or ServiceM8? I can help you import your data into HomeLinq too. Anything that changes your data, you confirm first - what do you need?";
  var GREETING_CUSTOMER = "I'm Moti, your HomeLinq assistant. I can help you check on your bookings, find available gas engineers in your area, and answer questions about our services. How can I help?";
  var GREETING_GENERIC = "Hi, I'm Moti - your HomeLinq assistant. Sign in and I can help you with your bookings and services.";
  var STARTERS_ENG = [
    "What's on this week?",
    "Which invoices are unpaid?",
    "How much have I invoiced this month?",
    "Help me chase an overdue invoice",
    "I'm moving from another platform",
    "Any CP12s expiring soon?"
  ];
  var STARTERS_CUST = [
    "Check my booking status",
    "What services do you offer?",
    "How do I book an engineer?",
    "I have a question about my booking"
  ];
  var STARTERS = STARTERS_ENG;
  var userRole = "unknown";

  var convo = [];

  function getToken() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return null;
      var p = JSON.parse(raw);
      return p.access_token || (p.currentSession && p.currentSession.access_token) || null;
    } catch (e) { return null; }
  }

  function injectCSS() {
    var css = ""
      + ".mtw-fab{position:fixed;right:22px;bottom:80px;z-index:2147483000;display:flex;align-items:center;gap:9px;background:#D4F500;color:#15170a;border:none;border-radius:999px;padding:8px 17px 8px 8px;cursor:grab;font-family:inherit;font-weight:600;font-size:14.5px;box-shadow:0 8px 30px rgba(0,0,0,.32);transition:transform .18s;touch-action:none;-webkit-user-select:none;user-select:none}"
      + ".mtw-fab:hover{transform:translateY(-2px)}"
      + ".mtw-fab.mtw-dragging{cursor:grabbing;transform:scale(1.08);transition:none}"
      + ".mtw-fab .mtw-fh{width:40px;height:40px;background:#15170a;border-radius:50%;display:flex;align-items:center;justify-content:center}"
      + ".mtw-fab .mtw-fh svg{width:29px}.mtw-fab.mtw-hide{display:none}"
      + ".mtw-panel{position:fixed;right:22px;bottom:22px;z-index:2147483001;width:392px;max-width:calc(100vw - 28px);height:580px;max-height:calc(100vh - 44px);background:#1A1C22;border:1px solid #2C2F39;border-radius:20px;display:none;flex-direction:column;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.55);font-family:inherit}"
      + ".mtw-panel.mtw-open{display:flex}"
      + ".mtw-top{display:flex;align-items:center;gap:11px;padding:15px 16px;background:#212430;border-bottom:1px solid #2C2F39}"
      + ".mtw-top .mtw-h{width:44px;height:44px;background:#30343E;border-radius:50%;display:flex;align-items:center;justify-content:center;flex:0 0 44px}"
      + ".mtw-top .mtw-h svg{width:33px}"
      + ".mtw-nm{font-weight:700;font-size:16px;color:#F4F4F0}"
      + ".mtw-sub{font-size:12px;color:#9AA0AC;display:flex;align-items:center;gap:6px}"
      + ".mtw-dot{width:7px;height:7px;border-radius:50%;background:#D4F500;display:inline-block}"
      + ".mtw-x{margin-left:auto;background:none;border:none;color:#9AA0AC;font-size:22px;cursor:pointer;line-height:1;padding:4px}.mtw-x:hover{color:#F4F4F0}"
      + ".mtw-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:11px}"
      + ".mtw-msg{max-width:86%;font-size:14.5px;line-height:1.55;padding:10px 13px;border-radius:14px;white-space:pre-wrap}"
      + ".mtw-msg.mtw-bot{background:#30343E;color:#F4F4F0;border-bottom-left-radius:4px;align-self:flex-start}"
      + ".mtw-msg.mtw-user{background:#D4F500;color:#15170a;font-weight:500;border-bottom-right-radius:4px;align-self:flex-end}"
      + ".mtw-confirm{background:#212430;border:1px solid #3A3F4A;border-radius:12px;padding:12px 14px;align-self:flex-start;max-width:90%}"
      + ".mtw-confirm .mtw-cl{font-size:10.5px;color:#D4F500;text-transform:uppercase;letter-spacing:.1em;margin-bottom:6px;font-weight:600}"
      + ".mtw-confirm .mtw-cs{font-size:14px;color:#F4F4F0;line-height:1.5;margin-bottom:11px}"
      + ".mtw-crow{display:flex;gap:8px}"
      + ".mtw-crow button{font-family:inherit;font-size:13px;font-weight:600;padding:8px 16px;border-radius:8px;cursor:pointer;border:1px solid #3A3F4A}"
      + ".mtw-yes{background:#D4F500;color:#15170a;border-color:#D4F500}"
      + ".mtw-no{background:transparent;color:#9AA0AC}"
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
      '<circle cx="24" cy="76" r="2.5" fill="#D4F500"/><circle cx="116" cy="76" r="2.5" fill="#D4F500"/></svg>';
  }

  var fab, panel, bodyEl, chipsEl, inputEl, started = false, busy = false;

  function build() {
    fab = document.createElement("button");
    fab.className = "mtw-fab";
    fab.setAttribute("aria-label", "Ask Moti");
    fab.innerHTML = '<span class="mtw-fh">' + motiHead() + '</span><span>Ask Moti</span>';
    document.body.appendChild(fab);

    panel = document.createElement("div");
    panel.className = "mtw-panel";
    panel.setAttribute("role", "dialog");
    panel.innerHTML =
      '<div class="mtw-top"><span class="mtw-h">' + motiHead() + '</span>' +
      '<div><div class="mtw-nm">Moti</div><div class="mtw-sub"><span class="mtw-dot"></span> Your HomeLinq Pro assistant</div></div>' +
      '<button class="mtw-x" aria-label="Close">&times;</button></div>' +
      '<div class="mtw-body"></div><div class="mtw-chips"></div>' +
      '<form class="mtw-input"><input type="text" placeholder="Ask Moti about your jobs, invoices..." autocomplete="off" aria-label="Message"/>' +
      '<button type="submit" aria-label="Send">&#8593;</button></form>';
    document.body.appendChild(panel);

    bodyEl = panel.querySelector(".mtw-body");
    chipsEl = panel.querySelector(".mtw-chips");
    inputEl = panel.querySelector(".mtw-input input");

    makeDraggable(fab);
    panel.querySelector(".mtw-x").addEventListener("click", close);
    panel.querySelector(".mtw-input").addEventListener("submit", function (ev) {
      ev.preventDefault();
      var v = inputEl.value.trim();
      if (v && !busy) { send(v); inputEl.value = ""; }
    });

    /* Restore saved position */
    try {
      var saved = localStorage.getItem("mtw-fab-pos");
      if (saved) {
        var pos = JSON.parse(saved);
        fab.style.right = "auto";
        fab.style.bottom = "auto";
        fab.style.left = Math.min(pos.x, window.innerWidth - 60) + "px";
        fab.style.top = Math.min(pos.y, window.innerHeight - 60) + "px";
      }
    } catch (e) {}
  }

  /* === Drag handling for Moti FAB === */
  function makeDraggable(el) {
    var startX = 0, startY = 0, startLeft = 0, startTop = 0, dragging = false, moved = false;

    function onStart(ex, ey) {
      dragging = true; moved = false;
      startX = ex; startY = ey;
      var rect = el.getBoundingClientRect();
      startLeft = rect.left; startTop = rect.top;
      el.classList.add("mtw-dragging");
    }
    function onMove(ex, ey) {
      if (!dragging) return;
      var dx = ex - startX, dy = ey - startY;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      if (!moved) return;
      var nx = startLeft + dx, ny = startTop + dy;
      nx = Math.max(0, Math.min(nx, window.innerWidth - 60));
      ny = Math.max(0, Math.min(ny, window.innerHeight - 60));
      el.style.right = "auto"; el.style.bottom = "auto";
      el.style.left = nx + "px"; el.style.top = ny + "px";
    }
    function onEnd() {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("mtw-dragging");
      if (!moved) { open(); return; }
      /* Save position */
      try {
        localStorage.setItem("mtw-fab-pos", JSON.stringify({ x: parseInt(el.style.left), y: parseInt(el.style.top) }));
      } catch (e) {}
    }

    /* Touch events */
    el.addEventListener("touchstart", function (ev) {
      ev.preventDefault();
      var t = ev.touches[0];
      onStart(t.clientX, t.clientY);
    }, { passive: false });
    el.addEventListener("touchmove", function (ev) {
      ev.preventDefault();
      var t = ev.touches[0];
      onMove(t.clientX, t.clientY);
    }, { passive: false });
    el.addEventListener("touchend", function () { onEnd(); });

    /* Mouse events */
    el.addEventListener("mousedown", function (ev) {
      ev.preventDefault();
      onStart(ev.clientX, ev.clientY);
    });
    document.addEventListener("mousemove", function (ev) { onMove(ev.clientX, ev.clientY); });
    document.addEventListener("mouseup", function () { onEnd(); });
  }

  function open() {
    fab.classList.add("mtw-hide");
    panel.classList.add("mtw-open");
    if (!started) { started = true; greet(); }
    setTimeout(function () { inputEl.focus(); }, 250);
  }
  function close() { panel.classList.remove("mtw-open"); fab.classList.remove("mtw-hide"); }

  /* personalised opening greeting — identifies user role and name */
  function greet() {
    var token = getToken();
    if (!token) { addMsg(GREETING_GENERIC, "bot"); renderChips(); return; }
    var userId = jwtSub(token);
    if (!userId) { addMsg(GREETING_GENERIC, "bot"); renderChips(); return; }

    /* Check engineers table first, filtered by THIS user's ID */
    fetch(CFG.SUPABASE_URL + "/rest/v1/engineers?select=full_name&id=eq." + userId, {
      headers: { "apikey": CFG.SUPABASE_ANON_KEY, "Authorization": "Bearer " + token }
    })
      .then(function (r) { return r.json(); })
      .then(function (rows) {
        if (rows && rows.length > 0 && rows[0].full_name) {
          /* User IS an engineer */
          userRole = "engineer";
          STARTERS = STARTERS_ENG;
          var name = String(rows[0].full_name).split(" ")[0];
          updateSubtitle("Your HomeLinq Pro assistant");
          addMsg("Hi " + name + " - " + GREETING_BODY, "bot");
          renderChips();
        } else {
          /* Not an engineer — check customers table */
          return fetch(CFG.SUPABASE_URL + "/rest/v1/customers?select=full_name&id=eq." + userId, {
            headers: { "apikey": CFG.SUPABASE_ANON_KEY, "Authorization": "Bearer " + token }
          })
            .then(function (r2) { return r2.json(); })
            .then(function (cRows) {
              userRole = "customer";
              STARTERS = STARTERS_CUST;
              var custName = (cRows && cRows[0] && cRows[0].full_name) ? String(cRows[0].full_name).split(" ")[0] : "";
              updateSubtitle("Your HomeLinq assistant");
              addMsg(custName ? ("Hi " + custName + " - " + GREETING_CUSTOMER) : ("Hi - " + GREETING_CUSTOMER), "bot");
              renderChips();
            });
        }
      })
      .catch(function () { addMsg("Hi - " + GREETING_GENERIC, "bot"); renderChips(); });
  }

  function updateSubtitle(text) {
    var sub = panel.querySelector(".mtw-sub");
    if (sub) { sub.innerHTML = '<span class="mtw-dot"></span> ' + text; }
  }

  function renderChips() {
    chipsEl.innerHTML = "";
    STARTERS.forEach(function (q) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = q;
      b.addEventListener("click", function () { if (!busy) send(q); });
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

  function showTyping() {
    var t = document.createElement("div");
    t.className = "mtw-typing";
    t.innerHTML = "<span></span><span></span><span></span>";
    bodyEl.appendChild(t);
    bodyEl.scrollTop = bodyEl.scrollHeight;
    return t;
  }

  function api(payload, token) {
    return fetch(FN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": CFG.SUPABASE_ANON_KEY,
        "Authorization": "Bearer " + token
      },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json().catch(function () { return { error: "Bad response." }; }); });
  }

  function addConfirmCard(proposal, token) {
    var card = document.createElement("div");
    card.className = "mtw-confirm";
    card.innerHTML = '<div class="mtw-cl">Confirm with Moti</div>' +
      '<div class="mtw-cs"></div>' +
      '<div class="mtw-crow"><button class="mtw-yes" type="button">Confirm</button>' +
      '<button class="mtw-no" type="button">Cancel</button></div>';
    card.querySelector(".mtw-cs").textContent = proposal.summary;
    bodyEl.appendChild(card);
    bodyEl.scrollTop = bodyEl.scrollHeight;

    card.querySelector(".mtw-yes").addEventListener("click", function () {
      card.remove();
      busy = true;
      var typing = showTyping();
      api({ confirmAction: { tool: proposal.tool, input: proposal.input } }, token)
        .then(function (d) {
          typing.remove();
          busy = false;
          addMsg(d.message || (d.error ? d.error : "Done."), "bot");
          convo.push({ role: "assistant", content: "[Action completed: " + proposal.summary + "]" });
          renderChips();
        })
        .catch(function () { typing.remove(); busy = false; addMsg("Something went wrong saving that. Please try again.", "bot"); });
    });
    card.querySelector(".mtw-no").addEventListener("click", function () {
      card.remove();
      addMsg("No problem - I've cancelled that. Anything else?", "bot");
      convo.push({ role: "assistant", content: "[Engineer cancelled: " + proposal.summary + "]" });
      renderChips();
    });
  }

  function send(text) {
    addMsg(text, "user");
    chipsEl.innerHTML = "";
    var token = getToken();
    if (!token) {
      addMsg("You'll need to be signed in to HomeLinq Pro for me to look at your jobs and invoices. Please sign in, then ask me again.", "bot");
      return;
    }
    busy = true;
    var typing = showTyping();
    api({ message: text, history: convo.slice(-12) }, token)
      .then(function (d) {
        typing.remove();
        busy = false;
        if (d.error) { addMsg(d.error, "bot"); renderChips(); return; }
        var reply = d.reply || "";
        convo.push({ role: "user", content: text });
        if (reply) { addMsg(reply, "bot"); convo.push({ role: "assistant", content: reply }); }
        if (d.proposal) { addConfirmCard(d.proposal, token); }
        else { renderChips(); }
      })
      .catch(function () {
        typing.remove();
        busy = false;
        addMsg("I couldn't reach the server just then. Please check your connection and try again.", "bot");
      });
  }

  /* ---------- PWA + push notifications ----------
     Registers the shared service worker (makes HomeLinq Pro
     installable) and, if the engineer has already allowed
     notifications (e.g. via the Moti home-screen app), keeps
     their push subscription registered so Moti can ping them
     when a task finishes. */
  function urlB64ToUint8(str) {
    var pad = "=".repeat((4 - (str.length % 4)) % 4);
    var b = (str + pad).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(b), arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  function jwtSub(token) {
    try {
      var p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return p.sub || null;
    } catch (e) { return null; }
  }
  function registerPush() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("moti-sw.js").catch(function () {});
    if (!("PushManager" in window) || !("Notification" in window)) return;
    if (!CFG.VAPID_PUBLIC_KEY || Notification.permission !== "granted") return;
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (ex) {
        if (ex) return ex;
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8(CFG.VAPID_PUBLIC_KEY)
        });
      });
    }).then(function (sub) {
      var token = getToken();
      if (!token || !sub) return;
      var uid = jwtSub(token);
      if (!uid) return;
      var s = sub.toJSON();
      return fetch(CFG.SUPABASE_URL + "/rest/v1/push_subscriptions?on_conflict=endpoint", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": CFG.SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + token,
          "Prefer": "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify({ engineer_id: uid, endpoint: s.endpoint, subscription: s, user_agent: navigator.userAgent })
      });
    }).catch(function () { /* push is best-effort */ });
  }

  function init() { injectCSS(); build(); registerPush(); }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
