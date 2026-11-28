/* 뉴스픽 4컷 | 앱 로직
 * - 기사 불러오기(/api/parse-article)
 * - 4컷 편집 · Canvas 미리보기 · PNG 저장
 * - 쓰레드 본문/첫 댓글 워크플로우
 * - 파트너 코드 · 히스토리 · 체크리스트 (localStorage)
 */
import {
  THEMES,
  EXPRESSIONS,
  SPEAKERS,
  LAYOUTS,
  drawComposite,
  drawSinglePanel,
} from "./canvas.js";

const THREAD_LIMIT = 500;
const KEYS = {
  partner: "np4.partner",
  history: "np4.history",
  settings: "np4.settings",
  checklist: "np4.checklist",
};

/* 뉴스픽 파트너스 추적 값 (한일 님 계정·메인 채널 공유 링크에서 확인한 값) */
const PARTNER_TRACKING = { lcp: "v9sIx86b", cp: "H0cKa48w", utmSource: "np260905v9sIx86b" };

/* 기본 파트너 — 첫 방문자(localStorage 미설정)에게 자동 적용된다.
 * 화면에서 다른 코드를 저장하면 그 코드가, 코드를 지우면 파트너 없이 링크가 만들어진다. */
const DEFAULT_PARTNER = {
  code: "661",
  raw: "pn=661&lcp=v9sIx86b&cp=H0cKa48w&utm_source=np260905v9sIx86b",
  tracking: PARTNER_TRACKING,
  isDefault: true,
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const state = {
  source: { title: "", url: "", partnerUrl: "", site: "", nid: "" },
  cuts: [],
  threadInitial: "",
  comment: "",
  theme: "red",
  layout: "grid",
  partner: null,
  partnerOff: false,
  checklist: { 1: false, 2: false, 3: false },
  history: [],
};

/* ------------------------------------------------------------------ *
 * 저장소
 * ------------------------------------------------------------------ */

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    /* 저장 공간이 막혀도 화면은 계속 동작한다 */
  }
}

/* ------------------------------------------------------------------ *
 * 공통 UI
 * ------------------------------------------------------------------ */

let toastTimer = 0;
function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("is-on"), 2200);
}

function notice(message, tone = "info") {
  const el = $("#sourceNotice");
  if (!message) {
    el.classList.add("is-hidden");
    el.textContent = "";
    return;
  }
  el.textContent = message;
  el.className = "notice" + (tone === "error" ? " error" : tone === "info" ? " info" : "");
}

function debounce(fn, wait = 90) {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

async function copyText(text) {
  const value = String(text || "");
  if (!value) return false;
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch (e) {
    try {
      const area = document.createElement("textarea");
      area.value = value;
      area.setAttribute("readonly", "");
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(area);
      return ok;
    } catch (err) {
      return false;
    }
  }
}

/* ------------------------------------------------------------------ *
 * 파트너 코드
 * ------------------------------------------------------------------ */

function parsePartner(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  const tracking = readTracking(value);
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      const pn = url.searchParams.get("pn");
      if (pn && /^[A-Za-z0-9_-]{1,24}$/.test(pn)) return { code: pn, raw: value, tracking };
      return { code: "", raw: value, tracking };
    } catch (e) {
      return null;
    }
  }
  const fromParam = value.match(/\bpn=([A-Za-z0-9_-]{1,24})/);
  if (fromParam) return { code: fromParam[1], raw: value, tracking };
  if (/^[A-Za-z0-9_-]{1,24}$/.test(value)) return { code: value, raw: value, tracking };
  return null;
}

/* 링크나 쿼리 문자열에 실린 lcp·cp·utm_source 추적 값을 읽는다. 없으면 null. */
function readTracking(value) {
  const tracking = {};
  [
    ["lcp", "lcp"],
    ["cp", "cp"],
    ["utm_source", "utmSource"],
  ].forEach(([param, name]) => {
    const match = value.match(new RegExp(`(?:^|[?&])${param}=([^&#\\s]*)`));
    const found = match ? decodeURIComponent(match[1]) : "";
    if (found && /^[A-Za-z0-9_.-]{1,48}$/.test(found)) tracking[name] = found;
  });
  return Object.keys(tracking).length ? tracking : null;
}

function isNewspic(url) {
  try {
    return /(^|\.)newspic\.kr$/i.test(new URL(url).hostname);
  } catch (e) {
    return false;
  }
}

function partnerUrlFor(url) {
  if (!url) return "";
  const partner = state.partner;
  if (!partner || !partner.code || !isNewspic(url)) {
    try {
      return new URL(url).toString();
    } catch (e) {
      return url;
    }
  }
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("pn", partner.code);
    const tracking = partner.tracking;
    if (tracking) {
      if (tracking.lcp) parsed.searchParams.set("lcp", tracking.lcp);
      if (tracking.cp) parsed.searchParams.set("cp", tracking.cp);
      if (tracking.utmSource) parsed.searchParams.set("utm_source", tracking.utmSource);
    }
    return parsed.toString();
  } catch (e) {
    return url;
  }
}

function updatePartnerChip() {
  const chip = $("#partnerChip");
  const partner = state.partner;
  if (partner && partner.code) {
    chip.textContent = partner.isDefault
      ? `파트너 코드 pn=${partner.code} · 기본`
      : `파트너 코드 pn=${partner.code}`;
    chip.classList.add("is-set");
    chip.title = partner.isDefault
      ? "사이트 기본 파트너 코드가 적용돼 있습니다. 눌러서 내 코드로 바꿀 수 있습니다"
      : "눌러서 파트너 링크를 바꿀 수 있습니다";
  } else {
    chip.textContent = "파트너 코드 미설정";
    chip.classList.remove("is-set");
    chip.title = "파트너 콘솔 링크나 pn 코드를 넣어 주세요";
  }
}

function refreshLinkState() {
  const partnerUrl = partnerUrlFor(state.source.url);
  state.source.partnerUrl = partnerUrl;
  state.comment = buildComment();
  const el = $("#commentText");
  el.textContent =
    state.comment || "기사를 불러오면 파트너스 링크가 들어간 댓글 문구가 여기에 표시됩니다.";
}

function buildComment() {
  const url = state.source.partnerUrl || state.source.url;
  if (!url) return "";
  const suffix = state.source.partnerUrl === state.source.url && !(state.partner && state.partner.code)
    ? ""
    : "";
  return `📎 기사 전문 보기 👉 ${url}${suffix}`;
}

/* ------------------------------------------------------------------ *
 * 테마 · 배치 버튼
 * ------------------------------------------------------------------ */

function initOptionButtons() {
  const themeBox = $("#themeButtons");
  themeBox.innerHTML = Object.values(THEMES)
    .map(
      (theme) =>
        `<button class="seg" type="button" data-theme="${theme.id}" aria-pressed="false">
           <span class="dot" style="background:${theme.accent}"></span>${theme.name}
         </button>`
    )
    .join("");

  const layoutBox = $("#layoutButtons");
  layoutBox.innerHTML = Object.values(LAYOUTS)
    .map(
      (layout) =>
        `<button class="seg" type="button" data-layout="${layout.id}" aria-pressed="false">${layout.name}</button>`
    )
    .join("");

  themeBox.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-theme]");
    if (!btn) return;
    state.theme = btn.dataset.theme;
    syncOptionButtons();
    scheduleDraw();
    persistSettings();
  });

  layoutBox.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-layout]");
    if (!btn) return;
    state.layout = btn.dataset.layout;
    syncOptionButtons();
    scheduleDraw();
    persistSettings();
  });
}

function syncOptionButtons() {
  $$("#themeButtons .seg").forEach((btn) => {
    const on = btn.dataset.theme === state.theme;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  $$("#layoutButtons .seg").forEach((btn) => {
    const on = btn.dataset.layout === state.layout;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  });
  const theme = THEMES[state.theme] || THEMES.red;
  const layout = LAYOUTS[state.layout] || LAYOUTS.grid;
  $("#canvasMeta").textContent = `${layout.name} · ${theme.name}`;
  const canvas = $("#comicCanvas");
  canvas.style.aspectRatio = state.layout === "vertical" ? "2160 / 3840" : "2160 / 2700";
}

function persistSettings() {
  writeJSON(KEYS.settings, { theme: state.theme, layout: state.layout });
}

/* ------------------------------------------------------------------ *
 * 4컷 편집기
 * ------------------------------------------------------------------ */

function cutCardHTML(index) {
  const speakerOptions = SPEAKERS.map((s) => `<option value="${s}">${s}</option>`).join("");
  const expressionOptions = EXPRESSIONS.map((e) => `<option value="${e}">${e}</option>`).join("");
  return `
    <div class="cut-card" data-index="${index}">
      <div class="cut-head">
        <span class="cut-no">${index + 1}컷</span>
        <span class="cut-role" data-role></span>
      </div>
      <label class="field">
        <span>나레이션</span>
        <textarea class="cut-narration" rows="2" maxlength="140" placeholder="이 컷의 상황 설명"></textarea>
      </label>
      <label class="field">
        <span>말풍선 대사</span>
        <textarea class="cut-line" rows="2" maxlength="80" placeholder="캐릭터가 하는 말"></textarea>
      </label>
      <div class="cut-row">
        <label class="field">
          <span>화자</span>
          <select class="cut-speaker">${speakerOptions}</select>
        </label>
        <label class="field">
          <span>표정</span>
          <select class="cut-expression">${expressionOptions}</select>
        </label>
        <button class="mini" type="button" data-panel="${index}">이 컷 PNG</button>
      </div>
    </div>`;
}

function initCutEditor() {
  $("#cuts").innerHTML = [0, 1, 2, 3].map(cutCardHTML).join("");

  $("#cuts").addEventListener("input", (event) => {
    const card = event.target.closest(".cut-card");
    if (!card) return;
    const index = Number(card.dataset.index);
    const cut = state.cuts[index];
    if (!cut) return;
    if (event.target.classList.contains("cut-narration")) cut.narration = event.target.value;
    else if (event.target.classList.contains("cut-line")) cut.line = event.target.value;
    scheduleDraw();
  });

  $("#cuts").addEventListener("change", (event) => {
    const card = event.target.closest(".cut-card");
    if (!card) return;
    const index = Number(card.dataset.index);
    const cut = state.cuts[index];
    if (!cut) return;
    if (event.target.classList.contains("cut-speaker")) cut.speaker = event.target.value;
    if (event.target.classList.contains("cut-expression")) cut.expression = event.target.value;
    scheduleDraw();
  });

  $("#cuts").addEventListener("click", (event) => {
    const btn = event.target.closest("[data-panel]");
    if (!btn) return;
    downloadPanel(Number(btn.dataset.panel));
  });
}

function syncCutEditor() {
  $$("#cuts .cut-card").forEach((card, index) => {
    const cut = state.cuts[index];
    const role = $("[data-role]", card);
    if (!cut) {
      role.textContent = "";
      return;
    }
    role.textContent = `${cut.roleLabel || ""}${cut.tone ? " · " + cut.tone : ""}`;
    $(".cut-narration", card).value = cut.narration || "";
    $(".cut-line", card).value = cut.line || "";
    $(".cut-speaker", card).value = cut.speaker || "독자";
    $(".cut-expression", card).value = cut.expression || "진지";
  });
}

/* ------------------------------------------------------------------ *
 * 그리기
 * ------------------------------------------------------------------ */

let drawTimer = 0;
function scheduleDraw() {
  clearTimeout(drawTimer);
  drawTimer = setTimeout(drawPreview, 90);
}

function drawPreview() {
  const canvas = $("#comicCanvas");
  if (!canvas) return;
  const empty = $("#canvasEmpty");
  if (!state.cuts.length) {
    empty.classList.remove("is-hidden");
    return;
  }
  empty.classList.add("is-hidden");
  drawComposite(canvas, {
    cuts: state.cuts,
    theme: state.theme,
    layout: state.layout,
    site: state.source.site,
    scale: 0.5,
  });
  drawThumbnails();
}

function drawThumbnails() {
  const strip = $("#panelStrip");
  const thumbs = $$("canvas", strip);
  state.cuts.slice(0, 4).forEach((cut, i) => {
    const canvas = thumbs[i];
    if (!canvas) return;
    drawSinglePanel(canvas, cut, i, state.theme, 0.25);
  });
}

function buildPanelStrip() {
  const strip = $("#panelStrip");
  strip.innerHTML = [0, 1, 2, 3]
    .map(
      (i) =>
        `<button class="panel-thumb" type="button" data-panel="${i}" title="${i + 1}컷 PNG 저장">
           <canvas width="270" height="270"></canvas><span>${i + 1}컷</span>
         </button>`
    )
    .join("");
  strip.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-panel]");
    if (!btn) return;
    downloadPanel(Number(btn.dataset.panel));
  });
}

/* ------------------------------------------------------------------ *
 * PNG 저장 · 공유
 * ------------------------------------------------------------------ */

function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("blob failed"))), "image/png");
  });
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    anchor.remove();
  }, 1500);
}

function fileBase() {
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `newspic-4cut-${stamp}`;
}

function ensureCuts() {
  if (!state.cuts.length) {
    toast("먼저 기사를 불러와 4컷을 만들어 주세요");
    return false;
  }
  return true;
}

async function downloadComposite() {
  if (!ensureCuts()) return;
  const off = document.createElement("canvas");
  drawComposite(off, {
    cuts: state.cuts,
    theme: state.theme,
    layout: state.layout,
    site: state.source.site,
    scale: 1,
  });
  const blob = await canvasToBlob(off);
  saveBlob(blob, `${fileBase()}-${state.layout === "vertical" ? "vertical" : "2x2"}.png`);
  toast("합본 PNG를 저장했습니다");
}

async function downloadPanel(index) {
  if (!ensureCuts()) return;
  const cut = state.cuts[index];
  if (!cut) return;
  const off = document.createElement("canvas");
  drawSinglePanel(off, cut, index, state.theme, 1);
  const blob = await canvasToBlob(off);
  saveBlob(blob, `${fileBase()}-cut${index + 1}.png`);
  toast(`${index + 1}컷 PNG를 저장했습니다`);
}

async function downloadPanels() {
  if (!ensureCuts()) return;
  for (let i = 0; i < state.cuts.length; i += 1) {
    await downloadPanel(i);
    await new Promise((r) => setTimeout(r, 320));
  }
}

function initShare() {
  const btn = $("#btnShare");
  const supported = typeof navigator !== "undefined" && typeof navigator.share === "function";
  if (!supported) return;
  btn.classList.remove("is-hidden");
  btn.addEventListener("click", async () => {
    if (!ensureCuts()) return;
    try {
      const off = document.createElement("canvas");
      drawComposite(off, {
        cuts: state.cuts,
        theme: state.theme,
        layout: state.layout,
        site: state.source.site,
        scale: 1,
      });
      const blob = await canvasToBlob(off);
      const file = new File([blob], `${fileBase()}.png`, { type: "image/png" });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) {
        toast("이 브라우저는 이미지 공유를 지원하지 않습니다");
        return;
      }
      await navigator.share({
        files: [file],
        text: $("#threadBody").value.slice(0, 200),
      });
    } catch (e) {
      if (e && e.name === "AbortError") return;
      toast("공유를 시작하지 못했습니다. 이미지를 저장해 주세요");
    }
  });
}

/* ------------------------------------------------------------------ *
 * 기사 불러오기
 * ------------------------------------------------------------------ */

function setMode(mode) {
  $$(".tab").forEach((tab) => {
    const on = tab.dataset.mode === mode;
    tab.classList.toggle("is-active", on);
    tab.setAttribute("aria-selected", String(on));
  });
  $$("[data-pane]").forEach((pane) => {
    pane.classList.toggle("is-hidden", pane.dataset.pane !== mode);
  });
}

function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle("is-busy", busy);
}

async function requestDraft(payload, button) {
  setBusy(button, true);
  notice("");
  try {
    const response = await fetch("/api/parse-article", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...payload,
        partner: state.partner ? state.partner.raw : "",
        partnerOff: state.partnerOff === true,
      }),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !data || !data.ok) {
      notice((data && data.message) || "기사를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.", "error");
      return null;
    }
    applyDraft(data);
    return data;
  } catch (e) {
    notice("서버에 연결하지 못했습니다. 네트워크를 확인하고 다시 시도해 주세요.", "error");
    return null;
  } finally {
    setBusy(button, false);
  }
}

function applyDraft(data) {
  state.source = {
    title: data.source.title || "",
    url: data.source.url || "",
    partnerUrl: data.source.partnerUrl || data.source.url || "",
    site: data.source.site || "",
    nid: data.source.nid || "",
  };
  state.cuts = (data.cuts || []).map((cut, i) => ({
    index: i + 1,
    role: cut.role,
    roleLabel: cut.roleLabel,
    tone: cut.tone,
    narration: cut.narration || "",
    line: cut.line || "",
    speaker: cut.speaker || "독자",
    expression: cut.expression || "진지",
  }));
  state.threadInitial = data.thread ? data.thread.body : "";
  $("#threadBody").value = state.threadInitial;

  if (data.source.url) $("#urlInput").value = data.source.url;
  if (data.source.url) $("#pasteUrl").value = data.source.url;

  refreshLinkState();
  syncCutEditor();
  updateThreadCount();
  drawPreview();

  const warning = (data.warnings || [])[0];
  if (warning) {
    notice(warning, data.needsManual ? "info" : "warn");
    if (data.needsManual) {
      setMode("paste");
      $("#pasteTitle").focus();
    }
  } else {
    notice(
      data.source.title
        ? `‘${data.source.title}’ 기사로 4컷 초안을 만들었습니다. 대사와 표정을 다듬어 보세요.`
        : "4컷 초안을 만들었습니다. 대사와 표정을 다듬어 보세요.",
      "info"
    );
  }

  const preview = $(".preview-card");
  if (preview && window.innerWidth <= 900) {
    preview.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

async function loadFromUrl() {
  const url = $("#urlInput").value.trim();
  if (!url) {
    notice("기사 URL을 입력해 주세요.", "error");
    $("#urlInput").focus();
    return;
  }
  await requestDraft({ url }, $("#btnLoad"));
}

async function loadFromPaste() {
  const title = $("#pasteTitle").value.trim();
  const body = $("#pasteBody").value.trim();
  const url = $("#pasteUrl").value.trim();
  if (!title && !body) {
    notice("기사 제목이나 본문을 입력해 주세요.", "error");
    return;
  }
  await requestDraft({ title, body, url }, $("#btnPaste"));
}

async function loadPreset(id, button) {
  await requestDraft({ preset: id }, button);
}

/* ------------------------------------------------------------------ *
 * 쓰레드
 * ------------------------------------------------------------------ */

function updateThreadCount() {
  const el = $("#threadBody");
  const counter = $("#threadCount");
  const len = el.value.length;
  counter.textContent = `${len} / ${THREAD_LIMIT}자`;
  counter.classList.toggle("over", len > THREAD_LIMIT);
}

function buildThreadClient() {
  const tags = (state.source.site ? ["#뉴스픽", "#오늘의이슈", state.source.site.replace(/[^가-힣A-Za-z0-9]/g, "")] : ["#뉴스픽", "#오늘의이슈"])
    .filter((t, i, arr) => t.length > 1 && arr.indexOf(t) === i)
    .slice(0, 3)
    .map((t) => "#" + t.replace(/^#/, ""));
  const shorten = (text, max) => {
    const s = String(text || "").replace(/\s+/g, " ").trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const space = cut.lastIndexOf(" ");
    return (space > max * 0.5 ? cut.slice(0, space) : cut).trim() + "…";
  };
  const headline = shorten(state.source.title || (state.cuts[0] && state.cuts[0].narration) || "오늘의 이슈", 90);
  const bullets = state.cuts.slice(1).map((cut) => "· " + shorten(cut.narration, 60));
  const tail = "\n\n👇 전체 기사는 첫 번째 댓글 링크에서 확인하세요.\n\n" + tags.join(" ");
  let body = headline + "\n\n" + bullets.join("\n") + tail;
  while (body.length > THREAD_LIMIT && bullets.length) {
    bullets.pop();
    body = headline + (bullets.length ? "\n\n" + bullets.join("\n") : "") + tail;
  }
  return body;
}

function initThread() {
  $("#threadBody").addEventListener("input", updateThreadCount);

  $("#btnResetThread").addEventListener("click", () => {
    if (!state.cuts.length) {
      toast("먼저 기사를 불러와 주세요");
      return;
    }
    $("#threadBody").value = buildThreadClient();
    updateThreadCount();
    toast("현재 4컷 기준으로 본문 초안을 다시 만들었습니다");
  });

  $("#btnCopyBody").addEventListener("click", async () => {
    const text = $("#threadBody").value.trim();
    if (!text) {
      toast("복사할 본문이 없습니다");
      return;
    }
    const ok = await copyText(text);
    toast(ok ? "쓰레드 본문을 복사했습니다" : "복사하지 못했습니다. 직접 선택해 주세요");
  });

  $("#btnIntent").addEventListener("click", () => {
    const text = $("#threadBody").value.trim();
    if (!text) {
      toast("먼저 쓰레드 본문을 만들어 주세요");
      return;
    }
    const url = "https://www.threads.net/intent/post?text=" + encodeURIComponent(text);
    window.__np4LastIntent = url;
    const win = window.open(url, "_blank", "noopener");
    if (!win) {
      toast("팝업이 차단되었습니다. 본문을 복사해 쓰레드 앱에서 붙여넣어 주세요");
    }
  });

  $("#btnCopyComment").addEventListener("click", async () => {
    refreshLinkState();
    if (!state.comment) {
      toast("기사 링크가 없습니다. 먼저 기사를 불러와 주세요");
      return;
    }
    const ok = await copyText(state.comment);
    toast(ok ? "첫 댓글 문구를 복사했습니다" : "복사하지 못했습니다. 직접 선택해 주세요");
  });
}

/* ------------------------------------------------------------------ *
 * 체크리스트 · 히스토리
 * ------------------------------------------------------------------ */

function initChecklist() {
  const saved = readJSON(KEYS.checklist, {});
  $$(".check").forEach((box) => {
    box.checked = Boolean(saved[box.dataset.check]);
    box.addEventListener("change", () => {
      const next = {};
      $$(".check").forEach((b) => (next[b.dataset.check] = b.checked));
      state.checklist = next;
      writeJSON(KEYS.checklist, next);
      if ($$(".check").every((b) => b.checked)) toast("업로드 3단계를 모두 마쳤습니다 🎉");
    });
  });
}

function renderHistory() {
  const list = $("#historyList");
  if (!state.history.length) {
    list.innerHTML = '<li class="empty">저장한 작업이 없습니다. 마음에 든 4컷은 저장해 두면 다시 불러올 수 있어요.</li>';
    return;
  }
  list.innerHTML = state.history
    .map((item) => {
      const when = new Date(item.savedAt);
      const label = `${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, "0")}:${String(when.getMinutes()).padStart(2, "0")}`;
      const title = (item.source && item.source.title) || (item.cuts && item.cuts[0] && item.cuts[0].narration) || "제목 없음";
      return `<li class="history-item" data-id="${item.id}">
        <div class="history-info">
          <div class="history-title">${escapeHtml(title)}</div>
          <div class="history-meta">${label} · ${(item.cuts || []).length}컷 · ${escapeHtml(THEMES[item.theme] ? THEMES[item.theme].name : "")}</div>
        </div>
        <div class="history-actions">
          <button class="btn small" type="button" data-load="${item.id}">불러오기</button>
          <button class="btn small ghost" type="button" data-del="${item.id}">삭제</button>
        </div>
      </li>`;
    })
    .join("");
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function initHistory() {
  $("#btnSaveWork").addEventListener("click", () => {
    if (!state.cuts.length) {
      toast("먼저 기사를 불러와 4컷을 만들어 주세요");
      return;
    }
    const item = {
      id: "w" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      savedAt: new Date().toISOString(),
      source: { ...state.source },
      cuts: state.cuts.map((c) => ({ ...c })),
      thread: $("#threadBody").value,
      theme: state.theme,
      layout: state.layout,
      partner: state.partner ? { ...state.partner } : null,
    };
    state.history = [item, ...state.history].slice(0, 10);
    writeJSON(KEYS.history, state.history);
    renderHistory();
    toast("현재 작업을 저장했습니다");
  });

  $("#historyList").addEventListener("click", (event) => {
    const load = event.target.closest("[data-load]");
    const del = event.target.closest("[data-del]");
    if (load) {
      const item = state.history.find((h) => h.id === load.dataset.load);
      if (!item) return;
      state.source = { ...state.source, ...item.source };
      state.cuts = item.cuts.map((c) => ({ ...c }));
      state.theme = item.theme || "red";
      state.layout = item.layout || "grid";
      if (item.partner) state.partner = { ...item.partner };
      $("#threadBody").value = item.thread || "";
      updateThreadCount();
      syncOptionButtons();
      syncCutEditor();
      updatePartnerChip();
      refreshLinkState();
      drawPreview();
      toast("저장한 작업을 불러왔습니다");
      $("#comicCanvas").scrollIntoView({ behavior: "smooth", block: "center" });
    }
    if (del) {
      state.history = state.history.filter((h) => h.id !== del.dataset.del);
      writeJSON(KEYS.history, state.history);
      renderHistory();
      toast("히스토리에서 삭제했습니다");
    }
  });
}

/* ------------------------------------------------------------------ *
 * 파트너 다이얼로그
 * ------------------------------------------------------------------ */

function initPartnerDialog() {
  const dialog = $("#partnerDialog");
  const input = $("#partnerInput");
  const preview = $("#partnerPreview");

  $("#partnerChip").addEventListener("click", () => {
    input.value = state.partner ? state.partner.raw : "";
    updatePartnerPreview();
    dialog.showModal();
    setTimeout(() => input.focus(), 50);
  });

  input.addEventListener("input", updatePartnerPreview);

  function updatePartnerPreview() {
    const parsed = parsePartner(input.value);
    if (!input.value.trim()) {
      preview.textContent = "코드를 비우고 저장하면 파트너 코드 없이 링크를 만듭니다.";
      return;
    }
    if (!parsed) {
      preview.textContent = "파트너 링크 또는 코드 형식이 아닙니다. 예: 1234 또는 …&pn=1234";
      return;
    }
    preview.textContent = parsed.code
      ? `적용될 코드: pn=${parsed.code} — 뉴스픽 기사 링크에 자동으로 붙습니다.${
          parsed.tracking ? " (추적 값 lcp·cp·utm_source 포함)" : ""
        }`
      : "링크에 pn 코드가 없습니다. 파트너 콘솔에서 공유 링크를 다시 복사해 주세요.";
  }

  $("#btnPartnerSave").addEventListener("click", () => {
    const parsed = parsePartner(input.value);
    if (!input.value.trim()) {
      state.partner = null;
      state.partnerOff = true;
      localStorage.removeItem(KEYS.partner);
      updatePartnerChip();
      refreshLinkState();
      dialog.close();
      toast("파트너 코드를 지웠습니다. 새로 고치면 기본 코드로 돌아갑니다");
      return;
    }
    if (!parsed || !parsed.code) {
      toast("pn 코드를 찾지 못했습니다. 공유 링크를 그대로 붙여넣어 주세요");
      return;
    }
    state.partner = parsed;
    state.partnerOff = false;
    writeJSON(KEYS.partner, parsed);
    updatePartnerChip();
    refreshLinkState();
    dialog.close();
    toast(`파트너 코드 pn=${parsed.code}를 저장했습니다`);
  });

  $("#btnPartnerClear").addEventListener("click", () => {
    state.partner = null;
    state.partnerOff = true;
    localStorage.removeItem(KEYS.partner);
    input.value = "";
    updatePartnerPreview();
    updatePartnerChip();
    refreshLinkState();
    toast("파트너 코드를 지웠습니다. 새로 고치면 기본 코드로 돌아갑니다");
  });
}

/* ------------------------------------------------------------------ *
 * 기사 입력 탭 · 예시
 * ------------------------------------------------------------------ */

function initSourceTabs() {
  $$(".tab").forEach((tab) => {
    tab.addEventListener("click", () => setMode(tab.dataset.mode));
  });
  $("#btnLoad").addEventListener("click", loadFromUrl);
  $("#btnPaste").addEventListener("click", loadFromPaste);
  $("#urlInput").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      loadFromUrl();
    }
  });
}

async function initPresets() {
  try {
    const response = await fetch("/api/presets");
    const data = await response.json();
    const items = (data && data.presets) || [];
    $("#presets").innerHTML = items
      .map(
        (preset) =>
          `<button class="preset" type="button" data-preset="${preset.id}">
             <span class="preset-label">${preset.emoji} ${escapeHtml(preset.label)} · 예시</span>
             <span class="preset-title">${escapeHtml(preset.title)}</span>
           </button>`
      )
      .join("");
    $("#presets").addEventListener("click", (event) => {
      const btn = event.target.closest("[data-preset]");
      if (!btn) return;
      loadPreset(btn.dataset.preset, btn);
    });
  } catch (e) {
    $("#presets").innerHTML = '<p class="hint">예시를 불러오지 못했습니다.</p>';
  }
}

/* ------------------------------------------------------------------ *
 * 시작
 * ------------------------------------------------------------------ */

function init() {
  const settings = readJSON(KEYS.settings, {});
  state.theme = THEMES[settings.theme] ? settings.theme : "red";
  state.layout = LAYOUTS[settings.layout] ? settings.layout : "grid";
  state.partner = readJSON(KEYS.partner, null) || {
    ...DEFAULT_PARTNER,
    tracking: { ...PARTNER_TRACKING },
  };
  state.history = readJSON(KEYS.history, []);

  initOptionButtons();
  initCutEditor();
  buildPanelStrip();
  initShare();
  initThread();
  initChecklist();
  initHistory();
  initPartnerDialog();
  initSourceTabs();
  initPresets();

  $("#btnDownloadAll").addEventListener("click", downloadComposite);
  $("#btnDownloadPanels").addEventListener("click", downloadPanels);

  syncOptionButtons();
  updatePartnerChip();
  refreshLinkState();
  updateThreadCount();
  renderHistory();
  syncCutEditor();

  $("#canvasEmpty").classList.remove("is-hidden");

  window.__np4 = {
    getState: () => state,
    applyDraft,
    drawPreview,
    buildThreadClient,
    parsePartner,
    DEFAULT_PARTNER,
  };
}

init();
