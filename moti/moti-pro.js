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
      + ".mtw-input .mtw-att{background:#2C2F39;color:#F4F4F0;font-size:17px;font-weight:400}"
      + ".mtw-input .mtw-att:hover{background:#3A3E4B}"
      + ".mtw-imp{align-self:flex-start;max-width:88%;background:#212430;border:1px solid #D4F500;border-radius:12px;padding:11px 12px;font-size:13px;color:#F4F4F0}"
      + ".mtw-imp .mtw-cl{font-weight:700;margin-bottom:4px;color:#D4F500}"
      + ".mtw-imp button{margin:8px 6px 0 0;border-radius:9px;padding:7px 11px;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer;border:1px solid #D4F500;background:#D4F500;color:#15170a}"
      + ".mtw-imp button.mtw-sec{background:transparent;color:#D4F500}"
      + ".mtw-photo{align-self:flex-end;max-width:70%;border-radius:12px;border:1px solid #2C2F39;overflow:hidden}"
      + ".mtw-photo img{display:block;max-width:100%;max-height:220px}"
      + ".mtw-check{align-self:flex-start;max-width:92%;background:#212430;border:1px solid #D4F500;border-radius:12px;padding:11px 12px;font-size:13px;color:#F4F4F0}"
      + ".mtw-check .mtw-cl{font-weight:700;margin-bottom:6px;color:#D4F500}"
      + ".mtw-check label{display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-top:1px solid #2C2F39;cursor:pointer;line-height:1.35}"
      + ".mtw-check label:first-of-type{border-top:none}"
      + ".mtw-check input{margin-top:2px;accent-color:#D4F500}"
      + ".mtw-check .mtw-res{font-size:12px;margin-left:24px;padding-bottom:4px}"
      + ".mtw-check button{margin:8px 6px 0 0;border-radius:9px;padding:7px 11px;font-family:inherit;font-size:12.5px;font-weight:700;cursor:pointer;border:1px solid #D4F500;background:#D4F500;color:#15170a}"
      + ".mtw-check button.mtw-sec{background:transparent;color:#D4F500}"
      + ".mtw-check button:disabled{opacity:.5;cursor:default}"
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

  var fab, panel, bodyEl, chipsEl, inputEl, fileEl, attEl, camEl, imgEl, started = false, busy = false;
  var lastPhoto = null; /* the photo sent most recently: { blob } — uploaded only if "keep this photo" is approved */
  var IMPORT_INTENT = /\b(import(s|ing|ed)?\b|migrat\w*|switch(ing)? (over|from)|mov(e|ing) (over|across|from)|bring (over|across|in) my|upload (my )?(file|csv|spreadsheet|export|data|records|customers))/i;

  /* 📎 Import: files go straight into HomeLinq's import wizard, where Moti reads them with the engineer */
  function chooseImportFiles() {
    if (userRole === "customer") { addMsg("Importing files is for HomeLinq Pro engineers.", "bot"); return; }
    if (typeof window.motiOpenImport !== "function") {
      addMsg("You can import your data inside HomeLinq Pro - open the app and tap the paperclip in my chat there.", "bot");
      return;
    }
    fileEl.click();
  }
  function addImportCard() {
    if (userRole === "customer" || typeof window.motiOpenImport !== "function") { return; }
    var card = document.createElement("div");
    card.className = "mtw-imp";
    card.innerHTML = '<div class="mtw-cl">Bring your data into HomeLinq</div>' +
      '<div>Attach the files you exported (CSV or Excel, several at once). I\'ll work out what each one is and talk it through with you - you review every row before anything is saved, and you can undo it afterwards.</div>' +
      '<button type="button" class="mtw-pick">&#128206; Choose files</button><button type="button" class="mtw-sec mtw-open">Open import wizard</button>';
    card.querySelector(".mtw-pick").addEventListener("click", function () { chooseImportFiles(); });
    card.querySelector(".mtw-open").addEventListener("click", function () { close(); window.motiOpenImport(); });
    bodyEl.appendChild(card);
    bodyEl.scrollTop = bodyEl.scrollHeight;
  }

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
      '<form class="mtw-input"><button type="button" class="mtw-att" aria-label="Import your data from files" title="Import your data (CSV or Excel files)">&#128206;</button>' +
      '<input type="file" class="mtw-file" multiple accept=".csv,.txt,.tsv,.xlsx,.xlsm,.xls" style="display:none"/>' +
      '<button type="button" class="mtw-att mtw-cam" aria-label="Send Moti a photo" title="Send Moti a photo (receipt, data plate, fault code, certificate)">&#128247;</button>' +
      '<input type="file" class="mtw-img" accept="image/*" style="display:none"/>' +
      '<input type="text" class="mtw-text" placeholder="Ask Moti about your jobs, invoices..." autocomplete="off" aria-label="Message"/>' +
      '<button type="submit" aria-label="Send">&#8593;</button></form>';
    document.body.appendChild(panel);

    bodyEl = panel.querySelector(".mtw-body");
    chipsEl = panel.querySelector(".mtw-chips");
    inputEl = panel.querySelector(".mtw-input .mtw-text");
    fileEl = panel.querySelector(".mtw-file");
    attEl = panel.querySelector(".mtw-att");
    attEl.addEventListener("click", function () { chooseImportFiles(); });
    camEl = panel.querySelector(".mtw-cam");
    imgEl = panel.querySelector(".mtw-img");
    camEl.addEventListener("click", function () {
      if (busy) { return; }
      if (userRole === "customer") { addMsg("Photos are for HomeLinq Pro engineers.", "bot"); return; }
      imgEl.click();
    });
    imgEl.addEventListener("change", function () {
      var f = imgEl.files && imgEl.files[0];
      imgEl.value = "";
      if (f) { sendPhoto(f, inputEl.value.trim()); inputEl.value = ""; }
    });
    fileEl.addEventListener("change", function () {
      var arr = [];
      for (var i = 0; i < fileEl.files.length; i++) { arr.push(fileEl.files[i]); }
      fileEl.value = "";
      if (!arr.length) { return; }
      if (typeof window.motiOpenImport === "function") {
        close();
        window.motiOpenImport(arr);
      }
    });

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
              if (attEl) { attEl.style.display = "none"; }
              if (camEl) { camEl.style.display = "none"; }
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

  /* ---------- Photos: shrink on the phone, send to Moti ---------- */
  function shrinkImage(file, cb) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () {
      var tries = [[1600, 0.82], [1280, 0.75], [1024, 0.7]];
      var out = null;
      for (var i = 0; i < tries.length; i++) {
        var max = tries[i][0], sc = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement("canvas");
        c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        out = c.toDataURL("image/jpeg", tries[i][1]);
        if (out.length < 2000000) { break; }
      }
      URL.revokeObjectURL(url);
      cb(null, out);
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb("That file doesn't look like a photo I can read."); };
    img.src = url;
  }
  function dataUrlToBlob(du) {
    var parts = du.split(","), bin = atob(parts[1]), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) { arr[i] = bin.charCodeAt(i); }
    return new Blob([arr], { type: "image/jpeg" });
  }
  function sendPhoto(file, text) {
    var token = getToken();
    if (!token) { addMsg("Please sign in to HomeLinq Pro first, then send me the photo again.", "bot"); return; }
    busy = true; chipsEl.innerHTML = "";
    shrinkImage(file, function (err, du) {
      if (err || !du) { busy = false; addMsg(err || "I couldn't read that photo.", "bot"); renderChips(); return; }
      var bubble = document.createElement("div"); bubble.className = "mtw-photo";
      var im = document.createElement("img"); im.src = du; im.alt = "Photo sent to Moti"; bubble.appendChild(im);
      bodyEl.appendChild(bubble);
      if (text) { addMsg(text, "user"); }
      bodyEl.scrollTop = bodyEl.scrollHeight;
      lastPhoto = { blob: dataUrlToBlob(du) };
      var typing = showTyping();
      api({ message: text || "", image: { media_type: "image/jpeg", data: du.split(",")[1] }, history: convo.slice(-12) }, token)
        .then(function (d) { typing.remove(); busy = false; handleReply(d, "[Photo] " + (text || "(photo sent)"), token, true); })
        .catch(function () { typing.remove(); busy = false; addMsg("I couldn't reach the server just then. Please try the photo again.", "bot"); renderChips(); });
    });
  }
  function uploadPhoto(token, bucket, path, blob) {
    return fetch(CFG.SUPABASE_URL + "/storage/v1/object/" + bucket + "/" + path, {
      method: "POST", headers: { "apikey": CFG.SUPABASE_ANON_KEY, "Authorization": "Bearer " + token, "Content-Type": "image/jpeg", "x-upsert": "false" }, body: blob
    }).then(function (r) { return r.ok ? path : r.text().then(function (t) { throw new Error(t || "upload failed"); }); });
  }
  function handleReply(d, userText, token, isPhoto) {
    if (d.error) { addMsg(d.error, "bot"); renderChips(); return; }
    var reply = d.reply || "";
    convo.push({ role: "user", content: userText });
    if (reply) { addMsg(reply, "bot"); convo.push({ role: "assistant", content: reply }); }
    if (d.open_import || (userRole === "engineer" && !isPhoto && IMPORT_INTENT.test(userText))) { addImportCard(); }
    if (d.proposals && d.proposals.length) { addChecklist(d.proposals, token, isPhoto); }
    else if (d.proposal) { addChecklist([d.proposal], token, isPhoto); }
    else { renderChips(); }
  }
  /* ---------- Approve one or several of Moti's suggestions ---------- */
  function addChecklist(proposals, token, isPhoto) {
    var card = document.createElement("div"); card.className = "mtw-check";
    var head = document.createElement("div"); head.className = "mtw-cl";
    head.textContent = proposals.length > 1 ? "Tick what you'd like me to do" : "Confirm with Moti";
    card.appendChild(head);
    var boxes = [];
    proposals.forEach(function (p, i) {
      var lab = document.createElement("label");
      var cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true;
      var sp = document.createElement("span"); sp.textContent = p.summary || p.tool;
      lab.appendChild(cb); lab.appendChild(sp); card.appendChild(lab);
      var res = document.createElement("div"); res.className = "mtw-res"; card.appendChild(res);
      boxes.push({ p: p, cb: cb, res: res });
    });
    var go = document.createElement("button"); go.type = "button";
    var no = document.createElement("button"); no.type = "button"; no.className = "mtw-sec"; no.textContent = "Cancel";
    function label() { var n = boxes.filter(function (b) { return b.cb.checked; }).length; go.textContent = n ? (proposals.length > 1 ? "Approve " + n + " selected" : "Confirm") : "Nothing selected"; go.disabled = !n; }
    boxes.forEach(function (b) { b.cb.addEventListener("change", label); });
    label();
    card.appendChild(go); card.appendChild(no);
    bodyEl.appendChild(card); bodyEl.scrollTop = bodyEl.scrollHeight;
    function lock() { go.disabled = true; no.disabled = true; boxes.forEach(function (b) { b.cb.disabled = true; }); }
    no.addEventListener("click", function () {
      lock(); go.style.display = "none"; no.style.display = "none";
      api({ declined: proposals.map(function (p) { return { tool: p.tool, input: p.input }; }), source: isPhoto ? "photo" : "chat" }, token).catch(function () {});
      addMsg("No problem - I've left that. Anything else?", "bot");
      convo.push({ role: "assistant", content: "[Engineer cancelled: " + proposals.map(function (p) { return p.summary; }).join("; ") + "]" });
      renderChips();
    });
    go.addEventListener("click", function () {
      var chosen = boxes.filter(function (b) { return b.cb.checked; }), skipped = boxes.filter(function (b) { return !b.cb.checked; });
      if (!chosen.length) { return; }
      lock(); go.textContent = "Working…"; busy = true;
      var typing = showTyping();
      var uid = jwtSub(token);
      // Photos are uploaded (privately) only now, and only if "keep this photo" was ticked
      var prep = chosen.map(function (b) {
        if (b.p.tool !== "attach_photo_to_job") { return Promise.resolve(); }
        if (!lastPhoto || !uid) { b.failLocal = "The photo is no longer available — send it again."; return Promise.resolve(); }
        var bucket = b.p.input.kind === "receipt" ? "receipts" : "job-photos";
        var path = uid + "/" + (b.p.input.job_id || "general") + "/" + Date.now() + "-" + Math.floor(Math.random() * 1e6) + ".jpg";
        return uploadPhoto(token, bucket, path, lastPhoto.blob).then(function () { b.p.input.storage_path = path; b.p.input.storage_bucket = bucket; })
          .catch(function () { b.failLocal = "The photo didn't upload — check your signal and try again."; });
      });
      Promise.all(prep).then(function () {
        var send = chosen.filter(function (b) { return !b.failLocal; });
        chosen.forEach(function (b) { if (b.failLocal) { b.res.textContent = "✗ " + b.failLocal; b.res.style.color = "#F87171"; } });
        var payload = { confirmActions: send.map(function (b) { return { tool: b.p.tool, input: b.p.input }; }), source: isPhoto ? "photo" : "chat" };
        if (skipped.length) { payload.declined = skipped.map(function (b) { return { tool: b.p.tool, input: b.p.input }; }); }
        if (!send.length) { typing.remove(); busy = false; go.style.display = "none"; no.style.display = "none"; renderChips(); return; }
        return api(payload, token).then(function (d) {
          typing.remove(); busy = false; go.style.display = "none"; no.style.display = "none";
          var results = d.results || [];
          var done = [];
          send.forEach(function (b, i) {
            var r = results[i] || { ok: false, message: d.error || "Something went wrong." };
            b.res.textContent = (r.ok ? "✓ " : "✗ ") + (r.message || (r.ok ? "Done" : "Didn't go through"));
            b.res.style.color = r.ok ? "#A3E635" : "#F87171";
            if (r.ok) { done.push(b.p.summary); }
          });
          skipped.forEach(function (b) { b.res.textContent = "– Skipped"; b.res.style.color = "#9AA0AC"; });
          convo.push({ role: "assistant", content: "[Engineer approved and done: " + done.join("; ") + "]" });
          if (window.booksRefresh) { try { window.booksRefresh(); } catch (e) {} }
          renderChips();
        });
      }).catch(function () { typing.remove(); busy = false; go.textContent = "Try again"; go.disabled = false; renderChips(); });
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
        handleReply(d, text, token, false);
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
