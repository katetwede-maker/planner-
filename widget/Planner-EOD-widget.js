// Kate's Planner: "By end of day" home-screen widget for the Scriptable app.
// Setup: paste this whole script into a new Scriptable script, tap Run once to sign in,
// then add a Large Scriptable widget to your home screen and choose this script.

// ---- your planner (filled in for you) ----
const API_KEY = "AIzaSyCGrd24Gd_7cihXCyOKI_FDOEUbP9kWrMs";
const PROJECT_ID = "kate-s-planner";
const PLANNER_URL = "https://katetwede-maker.github.io/planner-/";

// ---- colors (same as the planner) ----
const C = {
  bg: new Color("#F2F5EF"), ink: new Color("#26312A"), muted: new Color("#6B786E"),
  accent: new Color("#5E8261"), sage: new Color("#8DAE89"), check: new Color("#B5C4B1"),
  danger: new Color("#B0574A"), line: new Color("#DFE6DB")
};
const KC_TOKEN = "kates-planner.refreshToken";
const KC_UID = "kates-planner.uid";
const SECTION_NAMES = { inbox: "Today", react: "REAcT", work: "Work", athletics: "Athletics", wellness: "Wellness", michael: "Michael" };

// ---------- dates ----------
const pad = n => String(n).padStart(2, "0");
const fmt = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const today = fmt(new Date());
const parseDs = ds => { const p = ds.split("-").map(Number); return new Date(p[0], p[1] - 1, p[2]); };
const addDays = (ds, n) => { const d = parseDs(ds); d.setDate(d.getDate() + n); return fmt(d); };

// ---------- repeating tasks (same rules as the planner) ----------
function matchesRepeat(r, ds) {
  const d = parseDs(ds), wd = d.getDay();
  if (r.type === "daily") return true;
  if (r.type === "weekdays") return wd >= 1 && wd <= 5;
  if (r.type === "weekly") return (r.days || []).includes(wd);
  if (r.type === "monthly") { const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); return d.getDate() === Math.min(r.dom || 1, last); }
  return false;
}
function nextOccurrence(r, fromDs) {
  for (let i = 0; i < 400; i++) { const ds = addDays(fromDs, i); if (matchesRepeat(r, ds)) return ds; }
  return null;
}

// ---------- auth ----------
async function signInInteractive() {
  const a = new Alert();
  a.title = "Sign in to your planner";
  a.message = "Use the same email and password as the planner. Your password is not saved, only a sign-in token kept in your iPhone's Keychain.";
  a.addTextField("Email");
  a.addSecureTextField("Password");
  a.addAction("Sign in");
  a.addCancelAction("Cancel");
  if ((await a.presentAlert()) === -1) return false;
  const req = new Request("https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=" + API_KEY);
  req.method = "POST";
  req.headers = { "Content-Type": "application/json" };
  req.body = JSON.stringify({ email: a.textFieldValue(0).trim(), password: a.textFieldValue(1), returnSecureToken: true });
  const res = await req.loadJSON();
  if (!res.refreshToken) {
    const e = new Alert(); e.title = "Couldn't sign in"; e.message = "Check your email and password, then run the script again."; e.addAction("OK"); await e.presentAlert();
    return false;
  }
  Keychain.set(KC_TOKEN, res.refreshToken);
  Keychain.set(KC_UID, res.localId);
  return true;
}
async function idToken() {
  if (!Keychain.contains(KC_TOKEN)) return null;
  const req = new Request("https://securetoken.googleapis.com/v1/token?key=" + API_KEY);
  req.method = "POST";
  req.headers = { "Content-Type": "application/x-www-form-urlencoded" };
  req.body = "grant_type=refresh_token&refresh_token=" + encodeURIComponent(Keychain.get(KC_TOKEN));
  const res = await req.loadJSON();
  if (!res.id_token) return null;
  if (res.refresh_token) Keychain.set(KC_TOKEN, res.refresh_token);
  return res.id_token;
}
async function readDoc(token, name) {
  const uid = Keychain.get(KC_UID);
  const req = new Request("https://firestore.googleapis.com/v1/projects/" + PROJECT_ID + "/databases/(default)/documents/users/" + uid + "/planner/" + name);
  req.headers = { Authorization: "Bearer " + token };
  const res = await req.loadJSON();
  const s = res && res.fields && res.fields.data && res.fields.data.stringValue;
  return s ? JSON.parse(s) : null;
}

// ---------- data (with an offline copy) ----------
const fm = FileManager.local();
const cachePath = fm.joinPath(fm.cacheDirectory(), "kates-planner-widget.json");
async function loadData() {
  try {
    const token = await idToken();
    if (!token) return { needsSignIn: true };
    const [tasks, training, config] = await Promise.all([readDoc(token, "tasks"), readDoc(token, "training"), readDoc(token, "config")]);
    const data = { tasks: (tasks && tasks.items) || {}, training: (training && training.items) || {}, config: config || {} };
    fm.writeString(cachePath, JSON.stringify(data));
    return data;
  } catch (e) {
    if (fm.fileExists(cachePath)) { const d = JSON.parse(fm.readString(cachePath)); d.stale = true; return d; }
    return { error: true };
  }
}

// ---------- same "By EOD" rules as the planner ----------
function buildToday(data) {
  // a repeating task checked off on an earlier day comes back on its next day
  const T = {};
  Object.values(data.tasks).forEach(t0 => {
    let t = t0;
    if (t.repeat && t.done && t.doneAt && t.doneAt < today) {
      const base = t.due && t.due > t.doneAt ? t.due : t.doneAt;
      t = Object.assign({}, t, { done: false, doneAt: null, eod: null, due: nextOccurrence(t.repeat, addDays(base, 1)) });
    }
    T[t.id] = t;
  });
  const onToday = t => {
    const due = (t.eod && t.eod <= today) || (t.due && t.due <= today);
    return t.done ? !!(due && t.doneAt === today) : !!due;
  };
  const ancestorOnToday = t => {
    let p = t.parent && T[t.parent], g = 0;
    while (p && g++ < 60) { if (onToday(p)) return true; p = p.parent && T[p.parent]; }
    return false;
  };
  const late = t => ((t.due && t.due < today) || (t.eod && t.eod < today)) ? 1 : 0;
  const list = Object.values(T).filter(t => onToday(t) && !ancestorOnToday(t))
    .sort((a, b) => (a.done - b.done) || (late(b) - late(a)) || (a.order - b.order));
  const acts = {};
  ((data.config && data.config.activities) || []).forEach(a => { acts[a.id] = a; });
  const train = Object.values(data.training).filter(s => s.date === today).sort((a, b) => a.order - b.order)
    .map(s => ({ name: acts[s.act] ? acts[s.act].name : "Workout", note: s.note || "", done: !!s.done, color: acts[s.act] ? acts[s.act].color : "#9AA39C" }));
  return { list, train };
}
function rightLabel(t) {
  if (!t.done && t.due && t.due < today) return { text: "Overdue", color: C.danger };
  if (!t.done && t.eod && t.eod < today) return { text: "Carried over", color: C.muted };
  return { text: SECTION_NAMES[t.section] || "", color: C.muted };
}

// ---------- widget ----------
function addCheck(stack, done, size) {
  const img = stack.addImage(SFSymbol.named(done ? "checkmark.square.fill" : "square").image);
  img.imageSize = new Size(size, size);
  img.tintColor = done ? C.sage : C.check;
}
function message(w, text) {
  w.addSpacer();
  const t = w.addText(text); t.font = Font.mediumSystemFont(14); t.textColor = C.muted; t.centerAlignText();
  w.addSpacer();
}
function build(data, family) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  if (!/^PASTE/.test(PLANNER_URL)) w.url = PLANNER_URL + "#today";
  // Ask iOS to refresh again after about a minute (iOS still decides the exact timing).
  w.refreshAfterDate = new Date(Date.now() + 60 * 1000);
  w.setPadding(16, 16, 14, 16);
  if (data.needsSignIn) { message(w, "Open Scriptable and run this script once to sign in."); return w; }
  if (data.error) { message(w, "Can't reach your planner right now."); return w; }

  const { list, train } = buildToday(data);
  const done = list.filter(t => t.done).length;
  const max = family === "large" || family === "extraLarge" ? 10 : family === "medium" ? 4 : 3;

  const head = w.addStack(); head.centerAlignContent();
  const h = head.addText(family === "small" ? "By EOD" : "By end of day");
  h.font = new Font("Georgia", family === "small" ? 17 : 20); h.textColor = C.ink;
  head.addSpacer();
  if (list.length) { const c = head.addText(done + " of " + list.length); c.font = Font.semiboldSystemFont(12); c.textColor = C.accent; }
  if (family !== "small") {
    const now = new Date();
    const when = now.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
    const at = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    const d = w.addText(when + (data.stale ? " · offline, last saved list" : " · Updated " + at));
    d.font = Font.systemFont(12); d.textColor = C.muted;
  }
  w.addSpacer(8);

  if (train.length && family !== "small") {
    const row = w.addStack(); row.centerAlignContent(); row.spacing = 6;
    const dot = row.addText("●"); dot.font = Font.systemFont(9); dot.textColor = new Color(train[0].color);
    const tt = row.addText("Training: " + train.map(s => s.name + (s.note ? " (" + s.note + ")" : "") + (s.done ? " ✓" : "")).join(", "));
    tt.font = Font.mediumSystemFont(12); tt.textColor = C.accent; tt.lineLimit = 1;
    w.addSpacer(8);
  }

  if (!list.length) { message(w, "Nothing on today’s list."); return w; }
  list.slice(0, max).forEach((t, i) => {
    if (i) w.addSpacer(family === "small" ? 4 : 7);
    const r = w.addStack(); r.centerAlignContent(); r.spacing = 8;
    addCheck(r, t.done, family === "small" ? 13 : 15);
    const title = r.addText(t.title);
    title.font = Font.systemFont(family === "small" ? 12.5 : 14); title.textColor = t.done ? C.muted : C.ink; title.lineLimit = 1;
    if (family !== "small") {
      r.addSpacer();
      const lab = rightLabel(t);
      const l = r.addText(lab.text); l.font = Font.mediumSystemFont(11); l.textColor = lab.color; l.lineLimit = 1;
    }
  });
  if (list.length > max) {
    w.addSpacer(6);
    const more = w.addText("+" + (list.length - max) + " more");
    more.font = Font.mediumSystemFont(12); more.textColor = C.muted;
  }
  w.addSpacer();
  return w;
}

// ---------- run ----------
if (!config.runsInWidget && !Keychain.contains(KC_TOKEN)) await signInInteractive();
const data = await loadData();
const widget = build(data, config.widgetFamily || "large");
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentLarge();
Script.complete();
