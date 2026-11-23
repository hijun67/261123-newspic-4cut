/* POST /api/parse-article
 * 뉴스픽(또는 뉴스픽 파트너스) 기사 URL, 직접 붙여넣은 제목·본문, 예시 프리셋을 받아
 * 4컷 만화 초안 + 쓰레드 본문 + 첫 댓글 문구를 돌려준다.
 */
import {
  buildDraft,
  detectSite,
  extractBodyHtml,
  extractMeta,
  extractTitleTag,
  htmlToParagraphs,
  isSafeFetchUrl,
  normalizeSpace,
  parsePartner,
} from "./_lib.js";
import { findPreset } from "./_presets.js";

const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

const MAX_BYTES = 2_500_000;
const FETCH_TIMEOUT = 9000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function sniffCharset(contentType, head) {
  const fromHeader = /charset=([\w-]+)/i.exec(contentType || "");
  if (fromHeader) return fromHeader[1].toLowerCase();
  const fromMeta = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head || "");
  if (fromMeta) return fromMeta[1].toLowerCase();
  return "utf-8";
}

function decode(buffer, charset) {
  const list = [charset, "utf-8", "euc-kr"];
  for (const name of list) {
    if (!name) continue;
    try {
      return new TextDecoder(name, { fatal: false }).decode(buffer);
    } catch (e) {
      /* 지원하지 않는 인코딩 → 다음 후보 */
    }
  }
  return new TextDecoder("utf-8").decode(buffer);
}

async function fetchArticleHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.6",
        "cache-control": "no-cache",
      },
      redirect: "follow",
      signal: controller.signal,
    });
    if (!response.ok) {
      return { ok: false, reason: `기사 페이지가 ${response.status} 응답을 보냈습니다.` };
    }
    const buffer = await response.arrayBuffer();
    const sliced = buffer.byteLength > MAX_BYTES ? buffer.slice(0, MAX_BYTES) : buffer;
    const bytes = new Uint8Array(sliced);
    const head = new TextDecoder("utf-8", { fatal: false }).decode(bytes.slice(0, 2048));
    const charset = sniffCharset(response.headers.get("content-type"), head);
    const html = decode(sliced, charset);
    const type = response.headers.get("content-type") || "";
    if (!/html|xml/i.test(type) && !/<html|<body|<meta/i.test(html.slice(0, 4000))) {
      return { ok: false, reason: "기사 페이지가 HTML 형식이 아닙니다." };
    }
    return { ok: true, html, finalUrl: response.url || url };
  } catch (error) {
    const aborted = error && (error.name === "AbortError" || /aborted|timeout/i.test(String(error)));
    return {
      ok: false,
      reason: aborted
        ? "기사 페이지 응답이 9초 안에 오지 않았습니다."
        : "기사 페이지에 접속하지 못했습니다. (차단되었거나 주소가 잘못되었을 수 있습니다)",
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== "POST") {
    return json({ ok: false, code: "method_not_allowed", message: "POST 로 호출해 주세요." }, 405);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ ok: false, code: "bad_json", message: "요청 본문을 읽지 못했습니다." }, 400);
  }
  if (!payload || typeof payload !== "object") {
    return json({ ok: false, code: "bad_json", message: "요청 본문을 읽지 못했습니다." }, 400);
  }

  const partner = parsePartner(payload.partner || payload.partnerCode || "");
  const warnings = [];

  /* 1) 예시 프리셋 */
  if (payload.preset) {
    const preset = findPreset(String(payload.preset));
    if (!preset) {
      return json({ ok: false, code: "preset_not_found", message: "예시 기사를 찾지 못했습니다." }, 404);
    }
    const draft = buildDraft({
      title: preset.title,
      description: preset.description,
      body: preset.body,
      url: "",
      image: preset.image,
      site: preset.site,
      partner,
      fetched: false,
      presetId: preset.id,
    });
    draft.warnings = ["예시 기사로 만든 초안입니다. 실제 기사로 다시 만들어 보세요."];
    return json(draft);
  }

  /* 2) 제목 + 본문 직접 입력 */
  const pastedTitle = normalizeSpace(payload.title || "");
  const pastedBody = String(payload.body || "").slice(0, 20000);
  const pastedUrl = normalizeSpace(payload.url || "");

  if (!pastedUrl && (pastedTitle || pastedBody)) {
    if (!pastedTitle && !pastedBody) {
      return json({ ok: false, code: "empty_input", message: "제목이나 본문을 입력해 주세요." }, 400);
    }
    const draft = buildDraft({
      title: pastedTitle || pastedBody.slice(0, 60),
      description: normalizeSpace(payload.description || "").slice(0, 400),
      body: pastedBody,
      url: pastedUrl,
      site: normalizeSpace(payload.site || "") || "직접 입력",
      partner,
      fetched: false,
    });
    if (!pastedBody) {
      draft.warnings = ["본문 없이 제목만으로 초안을 만들었습니다. 본문을 붙여넣으면 컷이 더 정확해집니다."];
    }
    return json(draft);
  }

  /* 3) 기사 URL */
  if (!pastedUrl) {
    return json(
      { ok: false, code: "empty_input", message: "기사 URL 또는 제목·본문을 입력해 주세요." },
      400
    );
  }
  if (!isSafeFetchUrl(pastedUrl)) {
    return json(
      { ok: false, code: "bad_url", message: "http/https 기사 주소만 불러올 수 있습니다." },
      400
    );
  }

  const fetched = await fetchArticleHtml(pastedUrl);
  if (!fetched.ok) {
    // 폴백: 링크는 첫 댓글용으로 살려 두고, 사용자가 직접 채워 이어갈 수 있게 한다.
    const draft = buildDraft({
      title: "",
      description: "",
      body: "",
      url: pastedUrl,
      site: detectSite("", pastedUrl),
      partner,
      fetched: false,
      warnings: [fetched.reason + " 기사 제목과 본문을 직접 붙여넣으면 그대로 이어서 만들 수 있습니다."],
    });
    draft.needsManual = true;
    return json(draft);
  }

  const html = fetched.html;
  const title =
    extractMeta(html, ["og:title", "twitter:title"]) || extractTitleTag(html) || "";
  const description = extractMeta(html, ["og:description", "twitter:description", "description"]);
  const image = extractMeta(html, ["og:image", "twitter:image"]);
  const publishedAt = extractMeta(html, [
    "article:published_time",
    "dcterms.created",
    "dcterms.issued",
  ]);
  const bodyHtml = extractBodyHtml(html);
  const paragraphs = htmlToParagraphs(bodyHtml);
  const body = paragraphs.join("\n");
  const site = detectSite(html, fetched.finalUrl || pastedUrl);

  if (!title && !body) {
    const draft = buildDraft({
      url: pastedUrl,
      site,
      partner,
      fetched: false,
      warnings: ["기사 제목과 본문을 찾지 못했습니다. 직접 입력으로 이어서 만들어 주세요."],
    });
    draft.needsManual = true;
    return json(draft);
  }
  if (!body) {
    warnings.push("본문을 찾지 못해 제목과 요약으로 초안을 만들었습니다. 본문을 붙여넣으면 더 정확해집니다.");
  }
  if (body.length < 120 && description) {
    const merged = [body, description].filter(Boolean).join("\n");
    const draft = buildDraft({
      title,
      description,
      body: merged,
      url: fetched.finalUrl || pastedUrl,
      image,
      site,
      publishedAt,
      partner,
      fetched: true,
      warnings,
    });
    draft.warnings = [...new Set([...warnings, "본문이 짧아 요약문을 함께 사용했습니다."])];
    return json(draft);
  }

  const draft = buildDraft({
    title,
    description,
    body,
    url: fetched.finalUrl || pastedUrl,
    image,
    site,
    publishedAt,
    partner,
    fetched: true,
    warnings,
  });
  return json(draft);
}
