/* ============================================================
   Moti App — standalone home-screen PWA for HomeLinq engineers.
   Full-screen Moti: sign in once, then give commands (voice or
   typed). Moti acts as the engineer (their session, RLS-scoped),
   proposes any data change for one-tap confirmation, and can
   push a notification when the task is done.
   Load order:  supabase-js  ->  config.js  ->  moti-app.js
   ============================================================ */
(function () {
  "use strict";

  var CFG = window.MOTI_CONFIG || {};
  var FN_URL = CFG.SUPABASE_URL + "/functions/v1/moti-engineer";
  var sbc = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

  var GREETING = "I'm Moti, your HomeLinq teammate. Tell me what you need and I'll handle it — I can pull up your jobs, invoices, quotes and finances, create and send invoices, and chase late payments for you. Tap the mic and just say it, or type below. Anything that changes your data, I'll show you to confirm first.";
  var STARTERS = [
    "What's on this week?",
    "Which invoices are unpaid?",
    "How much have I invoiced this month?",
    "Help me chase an overdue invoice",
    "I'm moving from another platform",
    "Any CP12s expiring soon?"
  ];

  /* ---------- elements ---------- */
  var elLogin   = document.getElementById("screen-login");
  var elApp     = document.getElementById("screen-app");
  var elForm    = document.getElementById("login-form");
  var elEmail   = document.getElementById("login-email");
  var elPass    = document.getElementById("login-pass");
  var elLoginBtn= document.getElementById("login-btn");
  var elLoginErr= document.getElementById("login-error");
  var elStatus  = document.getElementById("head-status");
  var elSignout = document.getElementById("btn-signout");
  var elVoiceBtn= document.getElementById("btn-voice");
  var elBody    = document.getElementById("chat-body");
  var elChips   = document.getElementById("chat-chips");
  var elChatForm= document.getElementById("chat-form");
  var elText    = document.getElementById("chat-text");
  var elMic     = document.getElementById("btn-mic");
  var elVoiceHint = document.getElementById("voice-hint");
  var elBanner  = document.getElementById("push-banner");
  var elPushEnable = document.getElementById("push-enable");
  var elPushDismiss= document.getElementById("push-dismiss");

  var convo = [], busy = false, greeted = false, lastInputWasVoice = false;

  /* ---------- service worker ---------- */
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("moti-sw.js").catch(function () {});
  }

  /* ============================================================
     AUTH
     ============================================================ */
  function showLogin() {
    elApp.hidden = true;
    elLogin.hidden = false;
  }

  function showApp() {
    elLogin.hidden = true;
    elApp.hidden = false;
    if (!greeted) { greeted = true; greet(); }
    ensurePush();
  }

  elForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var email = elEmail.value.trim();
    var pass = elPass.value;
    if (!email || !pass) return;
    elLoginErr.textContent = "";
    elLoginBtn.disabled = true;
    elLoginBtn.textContent = "Signing in…";
    sbc.auth.signInWithPassword({ email: email, password: pass })
      .then(function (res) {
        elLoginBtn.disabled = false;
        elLoginBtn.textContent = "Sign in";
        if (res.error) {
          elLoginErr.textContent = res.error.message || "Couldn't sign you in. Check your details and try again.";
          return;
        }
        elPass.value = "";
        showApp();
      })
      .catch(function () {
        elLoginBtn.disabled = false;
        elLoginBtn.textContent = "Sign in";
        elLoginErr.textContent = "Couldn't reach the server. Check your connection and try again.";
      });
  });

  elSignout.addEventListener("click", function () {
    sbc.auth.signOut().then(function () {
      convo = []; greeted = false;
      elBody.innerHTML = ""; elChips.innerHTML = "";
      showLogin();
    });
  });

  sbc.auth.onAuthStateChange(function (event, session) {
    if (event === "SIGNED_OUT" || !session) showLogin();
  });

  /* ============================================================
     GREETING (personalised)
     ============================================================ */
  function greet() {
    sbc.from("engineers").select("full_name,business_name").maybeSingle()
      .then(function (res) {
        var row = res.data || {};
        var name = row.full_name ? String(row.full_name).split(" ")[0] : "";
        if (row.business_name) elStatus.textContent = row.business_name;
        addMsg((name ? "Hi " + name + " — " : "Hi — ") + GREETING, "bot");
        renderChips();
      })
      .catch(function () {
        addMsg("Hi — " + GREETING, "bot");
        renderChips();
      });
  }

  /* ============================================================
     CHAT UI
     ============================================================ */
  function addMsg(text, who) {
    var m = document.createElement("div");
    m.className = "msg " + who;
    m.textContent = text;
    elBody.appendChild(m);
    elBody.scrollTop = elBody.scrollHeight;
    return m;
  }

  function showTyping() {
    var t = document.createElement("div");
    t.className = "typing";
    t.innerHTML = "<span></span><span></span><span></span>";
    elBody.appendChild(t);
    elBody.scrollTop = elBody.scrollHeight;
    return t;
  }

  function renderChips() {
    elChips.innerHTML = "";
    STARTERS.forEach(function (q) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = q;
      b.addEventListener("click", function () { if (!busy) send(q); });
      elChips.appendChild(b);
    });
  }

  function getToken() {
    return sbc.auth.getSession().then(function (r) {
      return (r.data && r.data.session) ? r.data.session.access_token : null;
    });
  }

  function api(payload) {
    return getToken().then(function (token) {
      if (!token) { showLogin(); return { error: "Please sign in again." }; }
      return fetch(FN_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": CFG.SUPABASE_ANON_KEY,
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify(payload)
      }).then(function (r) {
        return r.json().catch(function () { return { error: "Bad response from the server." }; });
      });
    });
  }

  function addConfirmCard(proposal) {
    var card = document.createElement("div");
    card.className = "confirm";
    card.innerHTML =
      '<div class="cl">Confirm with Moti</div>' +
      '<div class="cs"></div>' +
      '<div class="crow">' +
        '<button class="c-yes" type="button">Confirm</button>' +
        '<button class="c-no" type="button">Cancel</button>' +
      '</div>';
    card.querySelector(".cs").textContent = proposal.summary;
    elBody.appendChild(card);
    elBody.scrollTop = elBody.scrollHeight;

    card.querySelector(".c-yes").addEventListener("click", function () {
      card.remove();
      busy = true;
      var typing = showTyping();
      api({ confirmAction: { tool: proposal.tool, input: proposal.input } })
        .then(function (d) {
          typing.remove(); busy = false;
          botSay(d.message || (d.error ? d.error : "Done."));
          convo.push({ role: "assistant", content: "[Action completed: " + proposal.summary + "]" });
          renderChips();
        })
        .catch(function () {
          typing.remove(); busy = false;
          addMsg("Something went wrong saving that. Please try again.", "bot");
        });
    });
    card.querySelector(".c-no").addEventListener("click", function () {
      card.remove();
      addMsg("No problem — I've cancelled that. Anything else?", "bot");
      convo.push({ role: "assistant", content: "[Engineer cancelled: " + proposal.summary + "]" });
      renderChips();
    });
  }

  function send(text, viaVoice) {
    if (busy) return;
    lastInputWasVoice = !!viaVoice;
    addMsg(text, "user");
    elChips.innerHTML = "";
    busy = true;
    var typing = showTyping();
    api({ message: text, history: convo.slice(-12) })
      .then(function (d) {
        typing.remove(); busy = false;
        if (d.error) { botSay(d.error); renderChips(); return; }
        var reply = d.reply || "";
        convo.push({ role: "user", content: text });
        if (reply) { botSay(reply); convo.push({ role: "assistant", content: reply }); }
        if (d.open_import) {
          /* The import runs inside HomeLinq Pro (it needs the full app), so link there */
          var imp = document.createElement("div");
          imp.className = "msg bot";
          imp.appendChild(document.createTextNode("Importing happens in HomeLinq Pro: "));
          var a = document.createElement("a");
          a.href = "app.html#import"; a.textContent = "open HomeLinq Pro and start the import";
          a.style.color = "inherit"; a.style.fontWeight = "700";
          imp.appendChild(a);
          elBody.appendChild(imp); elBody.scrollTop = elBody.scrollHeight;
        }
        if (d.proposal) { addConfirmCard(d.proposal); }
        else { renderChips(); }
      })
      .catch(function () {
        typing.remove(); busy = false;
        addMsg("I couldn't reach the server just then. Please check your connection and try again.", "bot");
      });
  }

  elChatForm.addEventListener("submit", function (ev) {
    ev.preventDefault();
    var v = elText.value.trim();
    if (v && !busy) { send(v); elText.value = ""; }
  });

  /* ============================================================
     SPEECH  — Moti talks back when it was spoken to
     ============================================================ */
  var speechOn = true;
  try { speechOn = localStorage.getItem("moti_voice_off") !== "1"; } catch (e) {}
  var ttsVoice = null, ttsPrimed = false;

  function pickVoice() {
    if (!("speechSynthesis" in window)) return;
    var vs = window.speechSynthesis.getVoices() || [];
    ttsVoice = vs.filter(function (v) { return /en-GB/i.test(v.lang); })[0]
            || vs.filter(function (v) { return /^en/i.test(v.lang); })[0]
            || vs[0] || null;
  }
  if ("speechSynthesis" in window) {
    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
  }

  /* Browsers (esp. on phones) only allow speech after the user has
     triggered it from a tap at least once — call this from tap
     handlers to unlock it for the rest of the session. */
  function primeTTS() {
    if (!("speechSynthesis" in window) || ttsPrimed) return;
    try {
      var u = new SpeechSynthesisUtterance(" ");
      u.volume = 0;
      window.speechSynthesis.speak(u);
      ttsPrimed = true;
    } catch (e) {}
  }

  function speak(text) {
    if (!speechOn || !("speechSynthesis" in window) || !text) return;
    try {
      window.speechSynthesis.cancel();
      var clean = String(text)
        .replace(/\u00a3\s?(\d[\d,]*(?:\.\d+)?)/g, "$1 pounds")
        .replace(/\s+/g, " ").trim();
      if (!clean) return;
      // speak on the next tick so cancel() doesn't swallow it (Chrome bug)
      setTimeout(function () {
        try {
          var u = new SpeechSynthesisUtterance(clean);
          if (ttsVoice) u.voice = ttsVoice;
          u.lang = (ttsVoice && ttsVoice.lang) || "en-GB";
          u.rate = 1; u.pitch = 1; u.volume = 1;
          window.speechSynthesis.resume();
          window.speechSynthesis.speak(u);
        } catch (e) {}
      }, 70);
    } catch (e) {}
  }

  /* Add a bot message — and read it aloud if the engineer spoke. */
  function botSay(text) {
    addMsg(text, "bot");
    if (lastInputWasVoice) speak(text);
  }

  function paintVoiceBtn() {
    elVoiceBtn.innerHTML = speechOn ? "\uD83D\uDD0A" : "\uD83D\uDD07";
    elVoiceBtn.classList.toggle("muted", !speechOn);
    elVoiceBtn.title = speechOn ? "Moti's voice is on" : "Moti's voice is off";
  }
  if ("speechSynthesis" in window) {
    paintVoiceBtn();
    elVoiceBtn.addEventListener("click", function () {
      speechOn = !speechOn;
      try { localStorage.setItem("moti_voice_off", speechOn ? "0" : "1"); } catch (e) {}
      try {
        window.speechSynthesis.cancel();
        if (speechOn) {
          ttsPrimed = true;
          var u = new SpeechSynthesisUtterance("Voice on.");
          if (ttsVoice) u.voice = ttsVoice;
          u.lang = (ttsVoice && ttsVoice.lang) || "en-GB";
          window.speechSynthesis.speak(u);
        }
      } catch (e) {}
      paintVoiceBtn();
    });
  } else {
    elVoiceBtn.hidden = true;
  }

  /* ============================================================
     VOICE INPUT  (Web Speech API)
     ============================================================ */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var rec = null, listening = false;

  if (SR) {
    elMic.hidden = false;
    elMic.addEventListener("click", function () {
      primeTTS();
      if (listening) { stopVoice(); return; }
      startVoice();
    });
  }

  function startVoice() {
    if (busy) return;
    if ("speechSynthesis" in window) { try { window.speechSynthesis.cancel(); } catch (e) {} }
    try {
      rec = new SR();
      rec.lang = "en-GB";
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      rec.onresult = function (e) {
        var t = (e.results[0] && e.results[0][0] && e.results[0][0].transcript) || "";
        t = t.trim();
        if (t) { elText.value = ""; send(t, true); }
      };
      rec.onerror = function () { stopVoice(); };
      rec.onend = function () { stopVoice(); };
      rec.start();
      listening = true;
      elMic.classList.add("listening");
      elVoiceHint.hidden = false;
    } catch (e) { stopVoice(); }
  }

  function stopVoice() {
    listening = false;
    elMic.classList.remove("listening");
    elVoiceHint.hidden = true;
    if (rec) { try { rec.stop(); } catch (e) {} rec = null; }
  }

  /* ============================================================
     PUSH NOTIFICATIONS
     ============================================================ */
  function urlB64ToUint8(s) {
    var pad = "=".repeat((4 - (s.length % 4)) % 4);
    var b = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(b);
    var arr = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }

  function pushSupported() {
    return ("serviceWorker" in navigator) && ("PushManager" in window) && ("Notification" in window);
  }

  function ensurePush() {
    if (!pushSupported() || !CFG.VAPID_PUBLIC_KEY) return;
    if (Notification.permission === "granted") {
      subscribePush();
    } else if (Notification.permission === "default") {
      try {
        if (localStorage.getItem("moti_push_dismissed") !== "1") elBanner.hidden = false;
      } catch (e) { elBanner.hidden = false; }
    }
  }

  function subscribePush() {
    if (!pushSupported() || !CFG.VAPID_PUBLIC_KEY) return;
    navigator.serviceWorker.ready.then(function (reg) {
      return reg.pushManager.getSubscription().then(function (existing) {
        if (existing) return existing;
        return reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlB64ToUint8(CFG.VAPID_PUBLIC_KEY)
        });
      });
    }).then(function (sub) {
      var s = sub.toJSON();
      return sbc.auth.getSession().then(function (r) {
        var sess = r.data && r.data.session;
        if (!sess) return;
        return sbc.from("push_subscriptions").upsert({
          engineer_id: sess.user.id,
          endpoint: s.endpoint,
          subscription: s,
          user_agent: navigator.userAgent
        }, { onConflict: "endpoint" });
      });
    }).catch(function () { /* push is best-effort */ });
  }

  elPushEnable.addEventListener("click", function () {
    Notification.requestPermission().then(function (perm) {
      elBanner.hidden = true;
      if (perm === "granted") subscribePush();
    });
  });

  elPushDismiss.addEventListener("click", function () {
    elBanner.hidden = true;
    try { localStorage.setItem("moti_push_dismissed", "1"); } catch (e) {}
  });

  /* ============================================================
     BOOT
     ============================================================ */
  sbc.auth.getSession().then(function (r) {
    if (r.data && r.data.session) showApp();
    else showLogin();
  }).catch(showLogin);

})();
