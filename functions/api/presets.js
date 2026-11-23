/* GET /api/presets — 예시 기사 목록 (제목·라벨만) */
import { PRESETS } from "./_presets.js";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=600",
    },
  });
}

export async function onRequest(context) {
  const { request } = context;
  if (request.method !== "GET" && request.method !== "HEAD") {
    return json({ ok: false, code: "method_not_allowed" }, 405);
  }
  return json({
    ok: true,
    presets: PRESETS.map((preset) => ({
      id: preset.id,
      emoji: preset.emoji,
      label: preset.label,
      title: preset.title,
    })),
  });
}
