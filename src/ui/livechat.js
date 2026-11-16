// The pop-out chat window (Live tab > Pop out chat): just the chat, small, on top of your game if you want.
const $ = (id) => document.getElementById(id);
const pop = { seq: 0, chat: [], filter: "both", stick: true, cfg: null, newBelow: 0 };
const query = new URLSearchParams(location.search);
pop.onTop = query.get("top") !== "0";
pop.see = Math.max(30, Math.min(100, +query.get("see") || 100));

async function popApi(path, body) {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
  return res.json();
}

function popWords() {
  const c = pop.cfg || {};
  const saved = (typeof loadPref === "function" && loadPref("lvAlerts")) || {};
  return [...(saved.words || []), c.twitch, c.twitchLogin].filter(Boolean);
}

function popShown(i) { return pop.filter === "both" || i.p === pop.filter; }

function popDraw(fresh, all) {
  const m = $("popMsgs");
  const words = popWords();
  if (all) {
    m.innerHTML = "";
    fresh = pop.chat;
  }
  const show = fresh.filter(popShown);
  if (show.length) m.querySelector(".lv-chat-empty")?.remove();
  for (const item of show) m.append(lvChatLine(item, { words }));
  while (m.children.length > 250) m.firstElementChild.remove();
  if (!m.children.length) m.innerHTML = `<p class="lv-chat-empty">${pop.cfg && (pop.cfg.twitch || pop.cfg.youtube) ? "Chat shows up here." : "Set up the Live tab first."}</p>`;
  if (pop.stick) m.scrollTop = m.scrollHeight;
  else if (show.length) {
    pop.newBelow += show.length;
    $("popMore").hidden = false;
    $("popMore").textContent = `${pop.newBelow} new`;
  }
}

async function popPoll() {
  try {
    const res = await popApi("/api/live-state", { since: pop.seq });
    if (res && res.ok) {
      pop.cfg = res.config;
      if (res.seq < pop.seq) { pop.chat = []; pop.seq = 0; }
      pop.seq = res.seq;
      const before = new Set(pop.chat.map((i) => i.id));
      pop.chat = lvRemoved(pop.chat.concat(res.chat || []), res.removed).slice(-300);
      const gone = [...before].some((id) => !pop.chat.some((i) => i.id === id));
      popDraw(res.chat || [], gone);
      const tw = res.twitch || {}, yt = res.youtube || {};
      const live = !!res.session;
      $("popLive").hidden = !live;
      if (live) $("popLive").textContent = lvClock(Date.now() / 1000 - res.session.start);
      const n = (tw.viewers || 0) + (yt.viewers || 0);
      $("popViewers").textContent = tw.live || yt.live ? `${n.toLocaleString("en-US")} watching` : "Chat";
      $("popViewers").title = tw.live && yt.live ? `${tw.viewers || 0} on Twitch, ${yt.viewers || 0} on YouTube` : "";
    }
  } catch (e) { /* the app is busy or closing */ }
  setTimeout(popPoll, 1500);
}

$("popFilter").querySelector('[data-f="both"]').textContent = "All";
$("popFilter").querySelector('[data-f="tw"]').innerHTML = LV_ICONS.tw;
$("popFilter").querySelector('[data-f="yt"]').innerHTML = LV_ICONS.yt;
$("popFilter").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  pop.filter = b.dataset.f;
  $("popFilter").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
  popDraw([], true);
});
$("popMsgs").addEventListener("scroll", () => {
  const m = $("popMsgs");
  pop.stick = m.scrollHeight - m.scrollTop - m.clientHeight < 40;
  if (pop.stick) { pop.newBelow = 0; $("popMore").hidden = true; }
});
$("popMore").addEventListener("click", () => { const m = $("popMsgs"); m.scrollTop = m.scrollHeight; });

function popStyle() {
  $("popPin").classList.toggle("on", pop.onTop);
  $("popPin").title = pop.onTop ? "Stays on top of other windows (click to stop)" : "Keep on top of other windows";
  $("popSee").value = pop.see;
  popApi("/api/live-popout", { onTop: pop.onTop, see: pop.see }).catch(() => {});
  if (typeof savePref === "function") savePref("lvPop", { onTop: pop.onTop, see: pop.see });
}
$("popPin").addEventListener("click", () => { pop.onTop = !pop.onTop; popStyle(); });
$("popSee").addEventListener("change", () => { pop.see = +$("popSee").value; popStyle(); });
$("popPin").classList.toggle("on", pop.onTop);
$("popSee").value = pop.see;

$("popSend").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = $("popText").value.trim();
  if (!text) return;
  $("popText").value = "";
  const res = await popApi("/api/live-send", { text, to: "both" }).catch(() => null);
  if (!res || (!res.tw && !res.yt)) {
    $("popText").value = text;
    $("popText").placeholder = (res && (res.twError || res.ytError)) || "Couldn't send it.";
  }
});

popPoll();
