const $ = (s) => document.querySelector(s);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (n) => new Intl.NumberFormat("en").format(n);
const odds = (s) => (s.oddsCenti / 100).toFixed(2) + "×";
const symbols = { s: "♠", h: "♥", d: "♦", c: "♣" };
const suitNames = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
const paths = {
  lobby: "M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z",
  clubs:
    "M3 21V7l9-4 9 4v14M8 8h1m6 0h1M8 12h1m6 0h1M8 16h1m6 0h1M10 21v-4h4v4",
  activity: "M5 3h14v18H5zM8 8h8M8 12h8M8 16h5",
  profile: "M20 21v-2a7 7 0 0 0-14 0v2M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  search: "M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
  star: "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z",
  back: "m14 6-6 6 6 6",
  close: "m6 6 12 12M6 18 18 6",
  check: "m5 12 4 4L19 6",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  arrow: "m9 5 7 7-7 7",
  info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  full: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
};
const icon = (name, fill = false) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="${paths[name] || paths.grid}"/></svg>`;
const names = {
  "rank-pattern:pair": "Exactly one pair",
  "colour:all-red": "All red",
  "colour:all-black": "All black",
  "suit-pattern:monotone": "Any flush",
  "straight:yes": "Any straight",
  "any-ace:yes": "Contains an ace",
};
let S,
  selections,
  route = "lobby",
  routeId = "",
  selected = "rank-pattern:pair",
  amount = 100,
  result = null,
  busy = false;
let lobbySearch = "",
  lobbyClub = "all",
  lobbyFilter = "all",
  modal = null,
  betQuery = "",
  family = "all",
  incoming = null,
  replaceSlot = null,
  historyFilter = "all";
let requestPending = null,
  toastTimer,
  roundsThisVisit = 0,
  focusReturn;
try {
  requestPending = JSON.parse(
    sessionStorage.getItem("preflop.pending") || "null",
  );
} catch {}
const title = (s) => names[s.id] || s.label;
function toast(text) {
  clearTimeout(toastTimer);
  $("#toast").textContent = text;
  $("#toast").classList.add("show");
  toastTimer = setTimeout(() => $("#toast").classList.remove("show"), 4500);
}
async function api(path, body) {
  const response = await fetch("/api/" + path, {
    credentials: "same-origin",
    method: body ? "POST" : "GET",
    headers: body
      ? { "Content-Type": "application/json", "X-Preflop-Request": "1" }
      : {},
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok) {
    const e = new Error(
      data.error || "Something went wrong. Please try again.",
    );
    e.status = response.status;
    throw e;
  }
  return data;
}
function card(code, back = false) {
  const suit = code.slice(-1),
    rank = code.slice(0, -1).replace("T", "10");
  return `<div class="playing-card ${["h", "d"].includes(suit) ? "red" : ""} ${back ? "face-down" : ""}" role="img" aria-label="${back ? "Face-down card" : esc(rank + " of " + suitNames[suit])}">${back ? '<span class="back-mark">P</span>' : `<span class="card-corner">${esc(rank)}<small>${symbols[suit]}</small></span><span class="card-suit">${symbols[suit]}</span><span class="card-corner lower">${esc(rank)}<small>${symbols[suit]}</small></span>`}</div>`;
}
function board(t, cards = t.cards, large = false, reveal = false) {
  return `<div class="board ${t.theme} ${large ? "board-large" : ""} ${reveal ? "reveal" : ""}" aria-label="Simulated table preview"><div class="board-head"><span class="demo-tag"><i></i> SIMULATED TABLE</span>${large ? `<button class="icon-button" data-action="board-full" aria-label="Enlarge cards">${icon("full")}</button>` : ""}</div><div class="felt-ring"></div><div class="cards">${cards.map((c) => card(c, busy && large)).join("")}</div><span class="felt-wordmark">PreFlop</span><span class="table-emboss">TABLE ${t.number}</span></div>`;
}
function nav() {
  return [
    ["lobby", "Lobby"],
    ["clubs", "Clubs"],
    ["activity", "Activity"],
    ["profile", "Profile"],
  ]
    .map(
      ([key, label]) =>
        `<a href="#${key}" class="nav-item ${route === key || (key === "clubs" && route === "club") ? "active" : ""}" ${route === key ? 'aria-current="page"' : ""}>${icon(key)}<span>${label}</span></a>`,
    )
    .join("");
}
function shell(content) {
  $("#app").innerHTML =
    `<aside class="sidebar"><a class="wordmark" href="#lobby" aria-label="PreFlop lobby">PreFlop<span>♠</span></a><span class="side-caption">THE FLOP IS JUST THE BEGINNING</span><nav aria-label="Main">${nav()}</nav><div class="sidebar-bottom"><div class="practice-mark">${icon("info")}<span>All instinct.<br>Zero real money.</span></div><button class="text-button" data-action="help">How to play</button><small>Free chips · No cash value</small></div></aside><div class="workspace"><header class="topbar"><a href="#lobby" class="wordmark mobile-wordmark">PreFlop<span>♠</span></a><div class="breadcrumb">${route === "table" ? "THE TABLE" : route === "club" ? "THE CLUB" : route.toUpperCase()}<span class="pill practice">PRACTICE</span></div><div class="account"><span class="chip-icon">♠</span><div><strong>${fmt(S.profile.balance)}</strong><small>free chips</small></div><a class="avatar" href="#profile" aria-label="Your profile">${esc(S.profile.name[0].toUpperCase())}</a></div></header><main id="main" tabindex="-1">${content}</main><footer class="page-footer"><span>Example clubs. Simulated rounds.</span><span>Free chips. No purchases, prizes or cash-out.</span></footer></div><nav class="bottom-nav" aria-label="Mobile navigation">${nav()}</nav>`;
}
function heading(eyebrow, text, description, aside = "") {
  return `<div class="page-heading"><div><span class="eyebrow">${eyebrow}</span><h1>${text}</h1><p>${description}</p></div>${aside}</div>`;
}
function tableCard(t) {
  const c = S.clubs.find((c) => c.id === t.clubId),
    saved = S.profile.favoriteTables.includes(t.id);
  return `<article class="table-card ${!t.available ? "unavailable" : ""}"><div class="table-visual">${board(t)}<button class="save-table ${saved ? "saved" : ""}" data-action="save-table" data-id="${t.id}" aria-label="${saved ? "Unsave" : "Save"} Table ${t.number}, ${esc(c.name)}" aria-pressed="${saved}">${icon("star", saved)}</button>${!t.available ? '<span class="unavailable-overlay">Table unavailable</span>' : ""}</div><div class="table-card-body"><div class="table-topline"><span class="table-number">TABLE ${t.number}</span><span class="availability ${t.available ? "" : "muted"}">${t.available ? "Ready to play" : "Offline"}</span></div><h2>${esc(t.name)}</h2><a href="#club/${c.id}" class="organizer">${esc(c.name)} ${icon("arrow")}</a><div class="table-card-bottom"><span>${esc(c.city)} <span class="separator">/</span> Practice</span>${t.available ? `<a href="#table/${t.id}" class="button small">Take a seat ${icon("arrow")}</a>` : '<span class="muted">Check back later</span>'}</div></div></article>`;
}
function filteredTables() {
  return S.tables.filter(
    (t) =>
      (lobbyClub === "all" || t.clubId === lobbyClub) &&
      (lobbyFilter !== "saved" || S.profile.favoriteTables.includes(t.id)) &&
      (lobbyFilter !== "available" || t.available) &&
      (
        t.name +
        " " +
        t.number +
        " " +
        S.clubs.find((c) => c.id === t.clubId).name
      )
        .toLowerCase()
        .includes(lobbySearch.toLowerCase()),
  );
}
function tableResults() {
  const ts = filteredTables();
  return `<div class="results-label"><span>${ts.length} ${ts.length === 1 ? "table" : "tables"}</span><span>Choose your atmosphere. Play at your pace.</span></div><div class="table-grid">${ts.map(tableCard).join("") || '<div class="empty"><span>♧</span><h2>No tables here yet</h2><p>Try another search, or save a table using its star.</p><button class="button secondary" data-action="clear-filters">Clear filters</button></div>'}</div>`;
}
function lobby() {
  shell(
    `${heading("YOUR NEXT THREE CARDS", "Find your table.", "Different rooms. The same feeling when the cards turn.", `<button class="button secondary how-button" data-action="help">${icon("info")} How to play</button>`)}<div class="lobby-toolbar"><label class="search-field">${icon("search")}<input id="lobby-search" type="search" placeholder="Search tables or clubs" aria-label="Search tables or clubs" value="${esc(lobbySearch)}"></label><div class="filters" aria-label="Table filters">${[
      ["all", "All tables"],
      ["available", "Available"],
      ["saved", "Saved"],
    ]
      .map(
        ([id, label]) =>
          `<button data-action="filter" data-id="${id}" aria-pressed="${lobbyFilter === id}" class="filter ${lobbyFilter === id ? "active" : ""}">${id === "saved" ? icon("star") : ""}${label}</button>`,
      )
      .join(
        "",
      )}</div><label class="club-filter"><span class="sr-only">Filter by club</span><select id="club-filter"><option value="all">All clubs</option>${S.clubs.map((c) => `<option value="${c.id}" ${lobbyClub === c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label></div><div id="table-results">${tableResults()}</div><div class="lobby-note"><span class="outline-suit">♠</span><div><h3>A little intuition. A lot of possibilities.</h3><p>Save six favorite predictions and explore ${S.catalogue.length} offered selections. The next flop is yours to read.</p></div><button class="text-button" data-action="browse">Explore the bets ${icon("arrow")}</button></div>`,
  );
}
function clubPage() {
  const c = S.clubs.find((c) => c.id === routeId);
  if (!c) return notFound();
  shell(
    `<a class="back-link" href="#clubs">${icon("back")} All clubs</a><section class="club-hero"><div class="club-monogram ${c.tone}">${c.monogram}</div><div><span class="eyebrow">EXAMPLE ORGANIZER</span><h1>${esc(c.name)}</h1><p>${esc(c.city)} · ${esc(c.country)}</p><p>${esc(c.description)}</p></div><span class="pill">${S.tables.filter((t) => t.clubId === c.id).length} practice tables</span></section><div class="section-header"><h2>Choose a table</h2><span>Simulated play · No live club connection</span></div><div class="table-grid">${S.tables
      .filter((t) => t.clubId === c.id)
      .map(tableCard)
      .join("")}</div>`,
  );
}
function clubsPage() {
  shell(
    `${heading("FIND YOUR PEOPLE, FIND YOUR PACE", "The club directory.", "Every table belongs to a room. Explore the organizers behind them.")}<div class="club-grid">${S.clubs.map((c) => `<a class="club-panel ${c.tone}" href="#club/${c.id}"><div class="club-panel-top"><span class="pill">EXAMPLE CLUB</span>${icon("arrow")}</div><div class="club-monogram ${c.tone}">${c.monogram}</div><h2>${esc(c.name)}</h2><p>${esc(c.city)} · ${esc(c.country)}</p><div class="club-panel-footer"><span>${S.tables.filter((t) => t.clubId === c.id).length} tables</span><span>View club ${icon("arrow")}</span></div></a>`).join("")}</div><div class="notice">${icon("info")} These are example organizers for practice. Real club profiles, licensing verification and live streams will appear only after a provider is connected.</div>`,
  );
}
function selectionIcon(s) {
  if (
    s.family === "suits-colours" &&
    (s.id.includes("red") || s.id.includes("hearts"))
  )
    return '<span class="selection-symbol red">♥</span>';
  if (
    s.family === "suits-colours" &&
    (s.id.includes("black") || s.id.includes("spades"))
  )
    return '<span class="selection-symbol">♠</span>';
  if (s.family === "suits-colours")
    return '<span class="selection-symbol">♣</span>';
  if (s.family === "face-named")
    return '<span class="selection-symbol rank">A</span>';
  if (s.family === "sequences")
    return '<span class="selection-symbol">≋</span>';
  if (s.family === "totals-parity")
    return '<span class="selection-symbol rank">Σ</span>';
  return '<span class="selection-symbol">♧</span>';
}
function favoriteCard(id, index, replacement = false) {
  const s = selections.get(id);
  if (!s) return "";
  const chosen = replacement ? replaceSlot === index : selected === id;
  return `<button class="bet-card ${chosen ? "selected" : ""}" data-action="${replacement ? "slot" : "select-bet"}" data-id="${replacement ? index : id}" aria-pressed="${chosen}">${selectionIcon(s)}<span class="bet-card-text"><strong>${esc(title(s))}</strong><small>${esc(s.familyLabel)}</small><b class="odds">${odds(s)}</b></span><span class="selection-check">${chosen ? icon("check") : icon("star", !replacement)}</span></button>`;
}
function tablePage(reveal = false) {
  const t = S.tables.find((t) => t.id === routeId);
  if (!t) return notFound();
  const c = S.clubs.find((c) => c.id === t.clubId),
    s = selections.get(selected) || selections.get(S.profile.favorites[0]);
  selected = s.id;
  const previous = S.history.find((r) => r.tableId === t.id),
    cards =
      result?.tableId === t.id ? result.cards : previous?.cards || t.cards;
  const hasResult = result?.tableId === t.id;
  shell(
    `<div class="table-page-heading"><div><a class="back-link" href="#club/${c.id}">${icon("back")} ${esc(c.name)}</a><h1>${esc(t.name)} <span>Table ${t.number}</span></h1></div><div class="table-heading-actions"><span class="pill practice">PRACTICE</span><button class="icon-button" data-action="help" aria-label="How to play">${icon("info")}</button></div></div><div class="table-layout"><section class="table-stage">${board(t, cards, true, reveal)}<div class="stream-caption"><span>${hasResult ? "Your latest flop" : previous ? "Your previous flop" : "Example flop"}</span><span>Simulated · Not a live stream</span></div><div class="round-timeline"><span class="${!hasResult && !busy ? "current" : ""}"><i>1</i> Choose</span><span class="${busy ? "current" : ""}"><i>2</i> Lock</span><span class="${hasResult ? "current" : ""}"><i>3</i> Reveal</span></div>${hasResult ? resultPanel(result) : `<div class="table-context"><span class="eyebrow">${busy ? "PREDICTION LOCKED" : "A FRESH FLOP AWAITS"}</span><h2>${busy ? "Turning the cards…" : "What will the next three cards bring?"}</h2><p>${busy ? "Your selection and odds are saved." : "Pick one of your six favorites or explore the full catalogue. The cards above are not the round you are predicting."}</p></div>`}<div class="recent-rounds"><div class="section-header"><h3>Your recent flops</h3><a class="text-button" href="#activity">Activity ${icon("arrow")}</a></div><div class="flop-strip">${
      S.history
        .filter((r) => r.tableId === t.id)
        .slice(0, 4)
        .map(
          (r) =>
            `<button class="past-flop" data-action="receipt" data-id="${r.id}" aria-label="View round from ${new Date(r.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}"><span>${r.cards.map((c) => `<b class="${["h", "d"].includes(c.slice(-1)) ? "red" : ""}">${c.slice(0, -1).replace("T", "10")}${symbols[c.slice(-1)]}</b>`).join("")}</span><small>${r.net > 0 ? "+" : ""}${fmt(r.net)} chips</small></button>`,
        )
        .join("") ||
      '<p class="muted">Your completed rounds will appear here.</p>'
    }</div></div></section><section class="betting-panel" aria-label="Your prediction"><div class="section-header"><h2>Favorite bets <span>6</span></h2><button class="text-button" data-action="edit-favorites">Edit</button></div><div class="favorite-grid ${busy ? "is-busy" : ""}">${S.profile.favorites.map((id, i) => favoriteCard(id, i)).join("")}</div><button class="button browse-button" data-action="browse">${icon("grid")} Browse all ${S.catalogue.length} bets ${icon("arrow")}</button><div class="bet-slip"><div class="slip-heading"><span>${hasResult ? "Your next selection" : "Your prediction"}</span><button class="text-button" data-action="details" data-id="${s.id}">Rules ${icon("info")}</button></div><div class="slip-selection"><strong>${esc(title(s))}</strong><b>${odds(s)}</b></div><label class="amount-label" for="amount">Amount <span>10–1,000 free chips</span></label><div class="amount-controls"><button data-action="amount-down" aria-label="Decrease amount" ${busy ? "disabled" : ""}>−</button><input id="amount" type="number" min="10" max="1000" step="10" value="${amount}" inputmode="numeric" ${busy ? "disabled" : ""}><button data-action="amount-up" aria-label="Increase amount" ${busy ? "disabled" : ""}>+</button></div><div class="chip-presets">${[50, 100, 250, 500].map((n) => `<button data-action="amount" data-id="${n}" class="${amount === n ? "active" : ""}" aria-pressed="${amount === n}" ${busy ? "disabled" : ""}>${n}</button>`).join("")}</div><div class="potential"><span>Total return if correct ${icon("info")}</span><strong id="potential">${fmt(Math.floor((amount * s.oddsCenti) / 100))} chips</strong></div><small class="stake-note">Decimal odds include your original chips.</small><button id="confirm" class="button primary confirm" data-action="${hasResult ? "next" : "play"}" ${busy || !t.available ? "disabled" : ""}>${busy ? "Saving your round…" : hasResult ? "Choose next round" : requestPending ? "Retry saved prediction" : !t.available ? "Table unavailable" : `Confirm · ${fmt(amount)} chips`}</button><p class="no-cash">Free chips. No purchases, prizes or cash-out.</p>${requestPending && !hasResult ? '<p class="pending-note">A prediction is awaiting confirmation. Retry uses the same request and cannot charge twice.</p>' : ""}</div></section></div>`,
  );
}
function resultPanel(r) {
  const s = selections.get(r.selectionId);
  return `<div class="result-panel ${r.won ? "won" : ""}" role="status"><span class="eyebrow">ROUND COMPLETE</span><h2>${r.won ? "You read it right." : "A different flop."}</h2><div class="result-number">${r.net > 0 ? "+" : ""}${fmt(r.net)} <span>free chips</span></div><p>${esc(title(s))} · ${r.won ? "Correct prediction" : "Prediction not matched"}</p><button class="text-button" data-action="receipt" data-id="${r.id}">View round receipt ${icon("arrow")}</button>${roundsThisVisit >= 20 ? '<div class="pause-note">A good place to pause. Your chips and favorites are saved.<a href="#lobby">Return to lobby</a></div>' : ""}</div>`;
}
function activityPage() {
  const history = S.history.filter(
    (r) =>
      historyFilter === "all" || (historyFilter === "won" ? r.won : !r.won),
  );
  const total = S.history.reduce((n, r) => n + r.net, 0);
  shell(
    `${heading("EVERY ROUND, IN THE OPEN", "Your activity.", "A clear record of your latest 100 practice rounds.")}<div class="stat-grid"><div><small>Rounds in history</small><strong>${S.history.length}</strong></div><div><small>Correct predictions</small><strong>${S.history.filter((r) => r.won).length}</strong></div><div><small>Net chips in history</small><strong class="${total > 0 ? "positive" : ""}">${total > 0 ? "+" : ""}${fmt(total)}</strong></div></div><div class="filters activity-filters">${[
      ["all", "All rounds"],
      ["won", "Correct"],
      ["lost", "Not matched"],
    ]
      .map(
        ([id, label]) =>
          `<button class="filter ${historyFilter === id ? "active" : ""}" data-action="history-filter" data-id="${id}" aria-pressed="${historyFilter === id}">${label}</button>`,
      )
      .join("")}</div><div class="activity-list">${
      history
        .map((r) => {
          const t = S.tables.find((t) => t.id === r.tableId),
            c = S.clubs.find((c) => c.id === t.clubId);
          return `<button class="activity-row" data-action="receipt" data-id="${r.id}"><div class="mini-cards">${r.cards.map((x) => card(x)).join("")}</div><div class="activity-label"><strong>${esc(title(selections.get(r.selectionId)))}</strong><small>${esc(c.name)} · Table ${t.number}</small><small>${new Date(r.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</small></div><div class="activity-amount"><strong class="${r.net > 0 ? "positive" : ""}">${r.net > 0 ? "+" : ""}${fmt(r.net)}</strong><small>free chips</small></div>${icon("arrow")}</button>`;
        })
        .join("") ||
      '<div class="empty"><span>♧</span><h2>Your story starts with three cards.</h2><p>Completed practice rounds will appear here, including the selection, locked odds and chip receipt.</p><a class="button" href="#lobby">Find a table</a></div>'
    }</div>`,
  );
}
function profilePage() {
  shell(
    `${heading("MAKE YOURSELF AT HOME", "Your profile.", "A little personalization. A clear view of your practice account.")}<div class="profile-grid"><section class="panel"><div class="profile-identity"><span class="avatar large">${esc(S.profile.name[0].toUpperCase())}</span><div><h2>${esc(S.profile.name)}</h2><span class="pill practice">PRACTICE PLAYER</span></div></div><form id="profile-form"><label for="player-name">Display name</label><input id="player-name" name="name" maxlength="30" required value="${esc(S.profile.name)}"><button class="button secondary" type="submit">Save name</button></form><div class="profile-note">Your profile is saved on the server and linked to this browser's private session cookie. Clearing cookies creates a new profile. Cross-device sign-in is not available yet.</div></section><section class="panel balance-panel"><span class="chip-icon large">♠</span><span class="eyebrow">YOUR PRACTICE BALANCE</span><strong class="balance-display">${fmt(S.profile.balance)}</strong><p>Free chips · No cash value</p><button class="button" data-action="refill" ${S.profile.balance >= 1000 ? "disabled" : ""}>Restore to 10,000 chips</button><small>Available below 1,000 chips. Always free.</small></section><section class="panel"><h2>A game on your terms.</h2><p>Every round starts with your choice. No automatic replays, countdown pressure or paid chips.</p><button class="text-button" data-action="help">Read the practice guide ${icon("arrow")}</button><p class="muted">Animations follow your device's reduced-motion preference.</p></section><section class="panel"><h2>Your six favorites</h2><p>Personalize the bets you see first, at every table.</p><div class="favorite-chips">${S.profile.favorites.map((id) => `<span>${esc(title(selections.get(id)))}</span>`).join("")}</div><button class="text-button" data-action="edit-favorites">Manage favorites ${icon("arrow")}</button></section></div>`,
  );
}
function notFound() {
  shell(
    '<div class="empty"><h1>That table is not here.</h1><p>Choose an available table from the lobby.</p><a class="button" href="#lobby">Back to lobby</a></div>',
  );
}
function render() {
  if (!S) return;
  if (route === "lobby") lobby();
  else if (route === "clubs") clubsPage();
  else if (route === "club") clubPage();
  else if (route === "table") tablePage();
  else if (route === "activity") activityPage();
  else if (route === "profile") profilePage();
  else notFound();
}
function navigate() {
  const [r, id] = (location.hash.slice(1) || "lobby").split("/");
  route = r;
  routeId = id || "";
  if (result && result.tableId !== routeId) result = null;
  render();
  window.scrollTo(0, 0);
}
function sheetHeader(label, sub = "") {
  return `<div class="sheet-header"><div><span class="eyebrow">YOUR TABLE, YOUR WAY</span><h2 id="sheet-title">${label}</h2>${sub ? `<p>${sub}</p>` : ""}</div><button class="icon-button" data-action="close-sheet" aria-label="Close dialog">${icon("close")}</button></div>`;
}
function openSheet(kind) {
  focusReturn = document.activeElement;
  modal = kind;
  renderSheet();
  const d = $("#sheet");
  d.setAttribute("aria-labelledby", "sheet-title");
  if (!d.open) d.showModal();
}
function closeSheet() {
  const d = $("#sheet");
  if (d.open) d.close();
  modal = null;
  if (focusReturn?.isConnected) focusReturn.focus();
  else $("#main")?.focus();
}
function catalogueRows() {
  const found = S.catalogue.filter(
    (s) =>
      (family === "all" || family === s.family) &&
      `${s.label} ${s.market} ${s.description}`
        .toLowerCase()
        .includes(betQuery.toLowerCase()),
  );
  return `<div class="catalog-count">${found.length} selections <span>Decimal odds · Stake included</span></div>${
    Object.entries(S.families)
      .map(([f, label]) => {
        const list = found.filter((s) => s.family === f);
        return list.length
          ? `<section class="catalog-group"><h3>${esc(label)}</h3>${list.map((s) => `<div class="catalog-row"><button class="catalog-selection" data-action="details" data-id="${s.id}">${selectionIcon(s)}<span><strong>${esc(title(s))}</strong><small>${esc(s.market)}</small></span><b>${odds(s)}</b></button><button class="star-button ${S.profile.favorites.includes(s.id) ? "saved" : ""}" data-action="favorite" data-id="${s.id}" aria-label="${S.profile.favorites.includes(s.id) ? "Manage favorite" : "Save favorite"}: ${esc(title(s))}" aria-pressed="${S.profile.favorites.includes(s.id)}">${icon("star", S.profile.favorites.includes(s.id))}</button></div>`).join("")}</section>`
          : "";
      })
      .join("") ||
    '<div class="empty"><h3>No matching bets</h3><p>Try a different term or category.</p></div>'
  }`;
}
function renderSheet() {
  let html = "";
  if (modal === "browse")
    html =
      sheetHeader(
        "Find your next favorite.",
        "Explore the complete practice catalogue.",
      ) +
      `<label class="search-field">${icon("search")}<input id="bet-search" type="search" placeholder="Search bets, cards or rules" aria-label="Search bets" value="${esc(betQuery)}"></label><div class="category-tabs" aria-label="Bet categories">${[["all", "All bets"], ...Object.entries(S.families)].map(([id, label]) => `<button class="filter ${family === id ? "active" : ""}" data-action="family" data-id="${id}" aria-pressed="${family === id}">${esc(label)}</button>`).join("")}</div><div id="catalogue-results">${catalogueRows()}</div>`;
  if (modal === "replace")
    html =
      sheetHeader(
        "Replace a favorite.",
        "Your six slots are full. Choose one to make room.",
      ) +
      `<div class="incoming-bet">${selectionIcon(incoming)}<div><small>NEW FAVORITE</small><strong>${esc(title(incoming))}</strong></div><b>${odds(incoming)}</b></div><div class="favorite-grid replace-grid">${S.profile.favorites.map((id, i) => favoriteCard(id, i, true)).join("")}</div><div class="replacement-summary">${replaceSlot !== null ? `${esc(title(selections.get(S.profile.favorites[replaceSlot])))} ${icon("arrow")} <strong>${esc(title(incoming))}</strong>` : "Select a slot to replace."}</div><button class="button primary" data-action="replace" ${replaceSlot === null ? "disabled" : ""}>Replace favorite</button><button class="text-button cancel" data-action="back-browse">Cancel</button>`;
  if (modal === "edit")
    html =
      sheetHeader(
        "Make the table yours.",
        "Six favorites. Ready wherever you play.",
      ) +
      `<div class="edit-list">${S.profile.favorites
        .map((id, i) => {
          const s = selections.get(id);
          return `<div><span class="slot-number">${i + 1}</span>${selectionIcon(s)}<strong>${esc(title(s))}</strong><b>${odds(s)}</b><button class="text-button" data-action="edit-slot" data-id="${i}">Replace</button></div>`;
        })
        .join(
          "",
        )}</div><p class="muted">Choose Replace, then star a new selection from the catalogue.</p>`;
  if (modal === "details")
    html =
      sheetHeader(esc(title(incoming)), esc(incoming.familyLabel)) +
      `<div class="detail-odds"><strong>${odds(incoming)}</strong><span>decimal odds</span></div><h3>What needs to happen</h3><p class="detail-rule">${esc(incoming.label)}. ${esc(incoming.description)}</p><div class="detail-facts"><div><small>Exact probability</small><strong>${(incoming.probability * 100).toFixed(3)}%</strong></div><div><small>Possible flops in the engine</small><strong>22,100</strong></div></div><p class="muted">Practice prices come from the repository's direct-channel odds book. Decimal odds include the original chips. A correct 100-chip prediction returns ${fmt(Math.floor(incoming.oddsCenti))} chips in total.</p><button class="button primary" data-action="favorite" data-id="${incoming.id}">${icon("star")} ${S.profile.favorites.includes(incoming.id) ? "Already in your favorites" : "Save to favorites"}</button>${route === "table" ? `<button class="button secondary" data-action="use-bet" data-id="${incoming.id}">Use this prediction</button>` : ""}<button class="text-button cancel" data-action="back-browse">Back to all bets</button>`;
  if (modal === "receipt") {
    const r = S.history.find((r) => r.id === incoming),
      s = selections.get(r.selectionId),
      t = S.tables.find((t) => t.id === r.tableId),
      c = S.clubs.find((c) => c.id === t.clubId);
    html =
      sheetHeader("The round receipt.", "Every chip accounted for.") +
      `<div class="receipt-cards">${r.cards.map((c) => card(c)).join("")}</div><dl class="receipt-list"><div><dt>Prediction</dt><dd>${esc(title(s))}</dd></div><div><dt>Outcome</dt><dd>${r.won ? "Correct" : "Not matched"}</dd></div><div><dt>Locked odds</dt><dd>${odds(r)}</dd></div><div><dt>Chips used</dt><dd>${fmt(r.stake)}</dd></div><div><dt>Total returned</dt><dd>${fmt(r.payout)}</dd></div><div><dt>Net change</dt><dd>${r.net > 0 ? "+" : ""}${fmt(r.net)}</dd></div><div><dt>Balance after round</dt><dd>${fmt(r.balanceAfter)}</dd></div></dl><p class="muted">${esc(c.name)} · Table ${t.number}<br>${new Date(r.createdAt).toLocaleString()}<br>Simulated practice. No cash value.</p><details><summary>Round reference</summary><code>${r.id}</code></details>`;
  }
  if (modal === "help")
    html =
      sheetHeader(
        "Three cards. Your prediction.",
        "A practice game about reading the possibilities.",
      ) +
      `<ol class="guide"><li><b>Find your table</b><p>Browse example clubs and choose an available simulated table. Save rooms you like with the star.</p></li><li><b>Make it your own</b><p>Keep six favorite bets within reach. Browse the catalogue, read the rules and star a selection to replace any slot.</p></li><li><b>Choose, then confirm</b><p>Select a prediction and 10–1,000 free chips. Check the decimal odds and total return. The previous flop does not predict the next one.</p></li><li><b>See the full picture</b><p>A new random flop is chosen on the server after confirmation. The same engine that defines the selection evaluates your result. Your receipt is saved in Activity.</p></li></ol><div class="notice">Free chips cannot be purchased, transferred or redeemed. No real money or prizes. Take a break whenever you like.</div><button class="button primary" data-action="close-sheet">Find my rhythm</button>`;
  if (modal === "board") {
    const t = S.tables.find((t) => t.id === routeId);
    html =
      sheetHeader(
        "Table " + t.number,
        "Simulated flop · No live provider connected",
      ) +
      board(
        t,
        result?.cards ||
          S.history.find((r) => r.tableId === t.id)?.cards ||
          t.cards,
        true,
      );
  }
  $("#sheet").innerHTML = html;
}
async function saveFavorites(ids) {
  const data = await api("favorites", { ids, version: S.profile.version });
  S.profile = data.profile;
  selected = incoming?.id || selected;
  render();
  closeSheet();
  toast("Favorites saved. Your table, your way.");
}
async function play() {
  if (busy) return;
  const s = selections.get(selected);
  if (!Number.isSafeInteger(amount) || amount < 10 || amount > 1000) {
    toast("Choose between 10 and 1,000 whole free chips.");
    return;
  }
  if (!requestPending)
    requestPending = {
      requestId: crypto.randomUUID(),
      tableId: routeId,
      selectionId: selected,
      stake: amount,
      oddsCenti: s.oddsCenti,
    };
  try {
    sessionStorage.setItem("preflop.pending", JSON.stringify(requestPending));
  } catch {}
  busy = true;
  render();
  try {
    const data = await api("round", requestPending);
    S.profile = data.profile;
    result = data.round;
    S.history = [result, ...S.history.filter((r) => r.id !== result.id)].slice(
      0,
      100,
    );
    roundsThisVisit++;
    requestPending = null;
    try {
      sessionStorage.removeItem("preflop.pending");
    } catch {}
    busy = false;
    if (route === "table" && routeId === result.tableId) tablePage(true);
    else render();
    toast(
      result.won
        ? "Prediction correct. Your round is saved."
        : "Round complete. Your receipt is saved in Activity.",
    );
  } catch (e) {
    busy = false;
    if (e.status && e.status < 500) {
      requestPending = null;
      try {
        sessionStorage.removeItem("preflop.pending");
      } catch {}
    }
    render();
    toast(e.message);
  }
}
document.addEventListener("click", async (e) => {
  const button = e.target.closest("[data-action]");
  if (!button || button.disabled || !S) return;
  const a = button.dataset.action,
    id = button.dataset.id;
  try {
    if (a === "filter") {
      lobbyFilter = id;
      render();
    }
    if (a === "clear-filters") {
      lobbyFilter = "all";
      lobbyClub = "all";
      lobbySearch = "";
      render();
    }
    if (a === "save-table") {
      const data = await api("table-favorite", {
        tableId: id,
        saved: !S.profile.favoriteTables.includes(id),
      });
      S.profile = data.profile;
      render();
      toast("Saved tables updated.");
    }
    if (a === "help") openSheet("help");
    if (a === "board-full") openSheet("board");
    if (a === "browse") {
      replaceSlot = null;
      betQuery = "";
      family = "all";
      openSheet("browse");
    }
    if (a === "edit-favorites") openSheet("edit");
    if (a === "edit-slot") {
      replaceSlot = Number(id);
      betQuery = "";
      family = "all";
      modal = "browse";
      renderSheet();
    }
    if (a === "close-sheet") closeSheet();
    if (a === "back-browse") {
      replaceSlot = null;
      modal = "browse";
      renderSheet();
    }
    if (a === "family") {
      family = id;
      renderSheet();
    }
    if (a === "details") {
      incoming = selections.get(id);
      openSheet("details");
    }
    if (a === "favorite") {
      if (busy || requestPending) {
        toast("Finish the pending prediction before changing favorites.");
        return;
      }
      if (S.profile.favorites.includes(id)) {
        toast("Already a favorite. Use Edit to replace a slot.");
        return;
      }
      incoming = selections.get(id);
      modal = "replace";
      renderSheet();
    }
    if (a === "slot") {
      replaceSlot = Number(id);
      renderSheet();
    }
    if (a === "replace") {
      button.disabled = true;
      const ids = [...S.profile.favorites];
      ids[replaceSlot] = incoming.id;
      await saveFavorites(ids);
    }
    if (a === "use-bet" || a === "select-bet") {
      if (busy || requestPending) {
        toast("Finish the pending prediction first.");
        return;
      }
      selected = id;
      if (a === "use-bet") closeSheet();
      render();
    }
    if (a === "amount" || a === "amount-up" || a === "amount-down") {
      if (busy || requestPending) return;
      amount =
        a === "amount"
          ? Number(id)
          : Math.max(
              10,
              Math.min(1000, amount + (a === "amount-up" ? 10 : -10)),
            );
      render();
    }
    if (a === "play") await play();
    if (a === "next") {
      result = null;
      render();
    }
    if (a === "receipt") {
      incoming = id;
      openSheet("receipt");
    }
    if (a === "history-filter") {
      historyFilter = id;
      render();
    }
    if (a === "refill") {
      const data = await api("refill", {});
      S.profile = data.profile;
      render();
      toast("Your practice chips are ready.");
    }
  } catch (error) {
    toast(error.message);
    button.disabled = false;
    if (error.status === 409) {
      try {
        const d = await api("history");
        S.profile = d.profile;
        S.history = d.history;
        render();
        if (modal) renderSheet();
      } catch {}
    }
  }
});
document.addEventListener("input", (e) => {
  if (e.target.id === "lobby-search") {
    lobbySearch = e.target.value;
    $("#table-results").innerHTML = tableResults();
  }
  if (e.target.id === "bet-search") {
    betQuery = e.target.value;
    $("#catalogue-results").innerHTML = catalogueRows();
  }
  if (e.target.id === "amount") {
    if (requestPending) {
      e.target.value = requestPending.stake;
      return;
    }
    amount = Number(e.target.value);
    const valid =
      Number.isSafeInteger(amount) && amount >= 10 && amount <= 1000;
    $("#potential").textContent = valid
      ? fmt(Math.floor((amount * selections.get(selected).oddsCenti) / 100)) +
        " chips"
      : "Choose 10–1,000";
    $("#confirm").disabled = !valid;
    $("#confirm").textContent = result
      ? "Choose next round"
      : `Confirm · ${valid ? fmt(amount) : "—"} chips`;
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "club-filter") {
    lobbyClub = e.target.value;
    $("#table-results").innerHTML = tableResults();
  }
});
document.addEventListener("submit", async (e) => {
  if (e.target.id === "profile-form") {
    e.preventDefault();
    const button = e.target.querySelector("button");
    button.disabled = true;
    try {
      const d = await api("profile", { name: $("#player-name").value });
      S.profile = d.profile;
      render();
      toast("Display name saved.");
    } catch (err) {
      button.disabled = false;
      toast(err.message);
    }
  }
});
$("#sheet").addEventListener("click", (e) => {
  if (e.target === $("#sheet")) {
    const r = e.target.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      closeSheet();
  }
});
$("#sheet").addEventListener("close", () => {
  modal = null;
  $("#sheet").innerHTML = "";
});
window.addEventListener("hashchange", () => {
  closeSheet();
  navigate();
});
async function boot() {
  try {
    S = await api("bootstrap");
    selections = new Map(S.catalogue.map((s) => [s.id, s]));
    selected = S.profile.favorites[0];
    if (requestPending) {
      try {
        const d = await api(
          "round/" + encodeURIComponent(requestPending.requestId),
        );
        S.profile = d.profile;
        result = d.round;
        S.history = [
          d.round,
          ...S.history.filter((r) => r.id !== d.round.id),
        ].slice(0, 100);
        requestPending = null;
        sessionStorage.removeItem("preflop.pending");
        toast("Your last round was saved successfully.");
      } catch (e) {
        if (e.status !== 404)
          toast("Your pending round will be checked when you retry.");
      }
    }
    if (requestPending) {
      selected = requestPending.selectionId;
      amount = requestPending.stake;
      location.hash = "table/" + requestPending.tableId;
    }
    navigate();
  } catch (e) {
    $("#app").innerHTML =
      `<main class="boot"><span class="wordmark">PreFlop<span>♠</span></span><h1>We couldn’t load your table.</h1><p>${esc(e.message)}</p><button class="button" id="retry-load">Try again</button></main>`;
    $("#retry-load").onclick = boot;
  }
}
boot();
