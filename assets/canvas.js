/* 뉴스픽 4컷 | HTML5 Canvas 4컷 만화 렌더러
 * - 합본(2×2 / 세로 4컷)과 컷별 PNG 를 같은 페인터로 그린다.
 * - 디자인 좌표계는 컷 폭 1080 기준. 박스 크기에 맞춰 균일 스케일한다.
 */

export const THEMES = {
  red: {
    id: "red",
    name: "이슈 레드",
    bg: "#141419",
    bgInk: "#FFFFFF",
    bgMuted: "#9C9CAB",
    panel: "#FFFFFF",
    ink: "#17161C",
    muted: "#7C7C88",
    accent: "#E5342B",
    accentInk: "#FFFFFF",
    bubble: "#FFF3F1",
    bubbleLine: "#D8BEB9",
    line: "#EBE4E2",
    skin: "#F6D7BC",
    hair: "#26232B",
    decor: "#E5342B",
  },
  pastel: {
    id: "pastel",
    name: "웹툰 파스텔",
    bg: "#FBF2EC",
    bgInk: "#3B3340",
    bgMuted: "#A493A0",
    panel: "#FFFFFF",
    ink: "#3B3340",
    muted: "#9A8F9E",
    accent: "#F19CB8",
    accentInk: "#5A2A3A",
    bubble: "#FDF0F5",
    bubbleLine: "#DFBCCA",
    line: "#F2DEE6",
    skin: "#FBDDC6",
    hair: "#4A3B52",
    decor: "#F6C6D8",
  },
  dark: {
    id: "dark",
    name: "다크 뉴스",
    bg: "#08080C",
    bgInk: "#F6F6FA",
    bgMuted: "#8E8E9C",
    panel: "#17171F",
    ink: "#F4F4F7",
    muted: "#9696A6",
    accent: "#FFD447",
    accentInk: "#1A1720",
    bubble: "#25252F",
    bubbleLine: "#4B4B5A",
    line: "#34343F",
    skin: "#E9C3A6",
    hair: "#121216",
    decor: "#FFD447",
  },
  blue: {
    id: "blue",
    name: "경제 블루",
    bg: "#0E1B33",
    bgInk: "#FFFFFF",
    bgMuted: "#93A3BE",
    panel: "#FFFFFF",
    ink: "#12203A",
    muted: "#6E7C93",
    accent: "#1F6FEB",
    accentInk: "#FFFFFF",
    bubble: "#EFF5FF",
    bubbleLine: "#B7CEEC",
    line: "#DDE6F2",
    skin: "#F3D5BB",
    hair: "#1C2A44",
    decor: "#1F6FEB",
  },
};

export const EXPRESSIONS = ["놀람", "진지", "웃음", "당황"];
export const SPEAKERS = ["독자", "기자"];

export const LAYOUTS = {
  grid: { id: "grid", name: "2×2 격자", width: 2160, height: 2700 },
  vertical: { id: "vertical", name: "세로 4컷", width: 2160, height: 3840 },
};

const FONT_STACK =
  '"Pretendard","Apple SD Gothic Neo","Noto Sans CJK KR","Noto Sans KR","Malgun Gothic",system-ui,sans-serif';

export function font(size, weight = 700) {
  return `${weight} ${size}px ${FONT_STACK}`;
}

export function getTheme(id) {
  return THEMES[id] || THEMES.red;
}

export function getLayout(id) {
  return LAYOUTS[id] || LAYOUTS.grid;
}

/* ------------------------------------------------------------------ *
 * 그리기 기본기
 * ------------------------------------------------------------------ */

export function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** maxWidth 안에서 줄바꿈. maxLines 를 넘는 부분은 버린다. */
export function wrapLines(ctx, text, maxWidth, maxLines) {
  const source = String(text || "").replace(/\s+/g, " ").trim();
  if (!source) return [];
  const lines = [];
  const words = source.split(" ");
  let current = "";
  for (const word of words) {
    const candidate = current ? current + " " + word : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
      if (lines.length >= maxLines) break;
    }
    if (ctx.measureText(word).width <= maxWidth) {
      current = word;
      continue;
    }
    let rest = word;
    while (rest.length > 1 && ctx.measureText(rest).width > maxWidth) {
      let cut = rest.length;
      while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxWidth) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
      if (lines.length >= maxLines) break;
    }
    if (lines.length >= maxLines) break;
    current = rest;
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

function ellipsize(ctx, line, maxWidth) {
  let out = String(line);
  if (ctx.measureText(out).width <= maxWidth) return out;
  while (out.length > 1 && ctx.measureText(out + "…").width > maxWidth) out = out.slice(0, -1);
  return out.replace(/[\s,·]+$/, "") + "…";
}

/**
 * 글자를 영역에 맞춘다. 넘치면 폰트를 줄이고, 그래도 넘치면 말줄임.
 * 반환: { lines, size, lineHeight }
 */
export function fitText(ctx, text, opts) {
  const {
    maxWidth,
    maxLines = 4,
    size = 46,
    minSize = 26,
    lineHeightRatio = 1.34,
    weight = 700,
  } = opts;
  let current = size;
  for (;;) {
    ctx.font = font(current, weight);
    const lines = wrapLines(ctx, text, maxWidth, maxLines);
    const joined = lines.join(" ");
    const fits = lines.length <= maxLines && joined.replace(/\s/g, "").length >= String(text).replace(/\s/g, "").length * 0.82;
    if (fits || current <= minSize) {
      if (lines.length) lines[lines.length - 1] = ellipsize(ctx, lines[lines.length - 1], maxWidth);
      return { lines, size: current, lineHeight: Math.round(current * lineHeightRatio) };
    }
    current = Math.max(minSize, current - 2);
  }
}

function drawTextBlock(ctx, lines, x, y, lineHeight, color) {
  ctx.fillStyle = color;
  ctx.textBaseline = "top";
  lines.forEach((line, i) => ctx.fillText(line, x, y + i * lineHeight));
}

function drawBadge(ctx, x, y, text, theme, height) {
  ctx.font = font(Math.round(height * 0.52), 800);
  const textWidth = ctx.measureText(text).width;
  const w = textWidth + height * 0.9;
  ctx.fillStyle = theme.accent;
  roundRect(ctx, x, y, w, height, height / 2);
  ctx.fill();
  ctx.fillStyle = theme.accentInk;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText(text, x + w / 2, y + height / 2 + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  return w;
}

/* ------------------------------------------------------------------ *
 * 캐릭터
 * ------------------------------------------------------------------ */

function drawCharacter(ctx, cx, cy, r, expression, theme) {
  const line = theme.ink;
  const eyeY = cy - r * 0.06;

  // 몸통
  ctx.fillStyle = theme.hair;
  roundRect(ctx, cx - r * 1.24, cy + r * 0.78, r * 2.48, r * 1.5, r * 0.42);
  ctx.fill();
  // 목
  ctx.fillStyle = theme.skin;
  ctx.fillRect(cx - r * 0.24, cy + r * 0.62, r * 0.48, r * 0.3);

  // 얼굴
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = theme.skin;
  ctx.fill();
  ctx.lineWidth = Math.max(2, r * 0.045);
  ctx.strokeStyle = line;
  ctx.stroke();

  // 머리카락
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 1.02, Math.PI * 1.98);
  ctx.lineTo(cx + r * 0.92, cy - r * 0.16);
  ctx.quadraticCurveTo(cx + r * 0.46, cy - r * 0.5, cx - r * 0.1, cy - r * 0.42);
  ctx.quadraticCurveTo(cx - r * 0.62, cy - r * 0.36, cx - r * 0.92, cy - r * 0.08);
  ctx.closePath();
  ctx.fillStyle = theme.hair;
  ctx.fill();

  const eyeGap = r * 0.38;
  const eyeR = r * 0.1;

  ctx.strokeStyle = line;
  ctx.fillStyle = line;
  ctx.lineWidth = Math.max(2, r * 0.05);

  if (expression === "웃음") {
    // 눈웃음 ^ ^
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + dir * eyeGap, eyeY + eyeR * 0.5, eyeR * 0.95, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
    }
  } else if (expression === "진지") {
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + dir * eyeGap, eyeY, eyeR * 0.82, eyeR * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + dir * eyeGap - eyeR * 1.2, eyeY - eyeR * 1.7);
      ctx.lineTo(cx + dir * eyeGap + eyeR * 1.1, eyeY - eyeR * 1.5);
      ctx.stroke();
    }
  } else if (expression === "당황") {
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + dir * eyeGap, eyeY + eyeR * 0.2, eyeR * 0.7, eyeR * 0.7, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx + dir * eyeGap - eyeR * 1.3, eyeY - eyeR * 2.1);
      ctx.lineTo(cx + dir * eyeGap + eyeR * 1.2, eyeY - eyeR * 1.1);
      ctx.stroke();
    }
  } else {
    // 놀람
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + dir * eyeGap, eyeY, eyeR * 1.35, 0, Math.PI * 2);
      ctx.fillStyle = "#FFFFFF";
      ctx.fill();
      ctx.strokeStyle = line;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx + dir * eyeGap, eyeY, eyeR * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = line;
      ctx.fill();
    }
  }

  // 입
  ctx.strokeStyle = line;
  ctx.fillStyle = line;
  ctx.lineWidth = Math.max(2, r * 0.06);
  const mouthY = cy + r * 0.42;
  if (expression === "웃음") {
    ctx.beginPath();
    ctx.arc(cx, mouthY - r * 0.1, r * 0.3, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  } else if (expression === "진지") {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.22, mouthY);
    ctx.lineTo(cx + r * 0.22, mouthY);
    ctx.stroke();
  } else if (expression === "당황") {
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.26, mouthY);
    ctx.quadraticCurveTo(cx - r * 0.08, mouthY - r * 0.12, cx + r * 0.02, mouthY);
    ctx.quadraticCurveTo(cx + r * 0.14, mouthY + r * 0.12, cx + r * 0.26, mouthY - r * 0.02);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.ellipse(cx, mouthY, r * 0.16, r * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 땀방울 (놀람·당황)
  if (expression === "놀람" || expression === "당황") {
    const dx = cx + r * 0.78;
    const dy = cy - r * 0.34;
    ctx.beginPath();
    ctx.moveTo(dx, dy - r * 0.2);
    ctx.quadraticCurveTo(dx + r * 0.15, dy + r * 0.08, dx, dy + r * 0.14);
    ctx.quadraticCurveTo(dx - r * 0.15, dy + r * 0.08, dx, dy - r * 0.2);
    ctx.fillStyle = "#7EC8F2";
    ctx.fill();
  }
}

/* ------------------------------------------------------------------ *
 * 컷 하나
 * ------------------------------------------------------------------ */

/**
 * 박스 안에 컷 하나를 그린다. 박스 폭 기준으로 균일 스케일.
 * box: {x, y, w, h}
 */
export function drawPanel(ctx, box, cut, index, themeId) {
  const theme = getTheme(themeId);
  const s = box.w / 1080;
  const H = box.h / s;

  ctx.save();
  ctx.translate(box.x, box.y);
  ctx.scale(s, s);

  // 그림자 + 카드
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.20)";
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = theme.panel;
  roundRect(ctx, 0, 0, 1080, H, 40);
  ctx.fill();
  ctx.restore();

  // 배경 장식 (테마 색 원)
  ctx.save();
  roundRect(ctx, 0, 0, 1080, H, 40);
  ctx.clip();
  ctx.globalAlpha = theme.id === "dark" ? 0.16 : 0.1;
  ctx.fillStyle = theme.decor;
  ctx.beginPath();
  ctx.arc(1010, H * 0.86, Math.min(430, H * 0.46), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = theme.id === "dark" ? 0.22 : 0.12;
  ctx.beginPath();
  ctx.arc(-60, -40, Math.min(260, H * 0.3), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 테두리
  ctx.strokeStyle = theme.line;
  ctx.lineWidth = 3;
  roundRect(ctx, 1.5, 1.5, 1077, H - 3, 40);
  ctx.stroke();

  const tall = H >= 760;
  const pad = 56;

  // 배지 + 역할 라벨
  const badgeH = tall ? 64 : 54;
  const badgeW = drawBadge(ctx, pad, tall ? 52 : 40, `${index + 1}컷`, theme, badgeH);
  if (cut.roleLabel) {
    ctx.font = font(tall ? 30 : 26, 700);
    ctx.fillStyle = theme.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(cut.roleLabel, 1080 - pad, (tall ? 52 : 40) + badgeH / 2 + 1);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
  }
  void badgeW;

  // 나레이션
  const narrTop = tall ? 158 : 112;
  const narrMaxWidth = 1080 - pad * 2;
  const narrMaxHeight = tall ? H * 0.34 : H * 0.34;
  const narr = fitText(ctx, cut.narration || "", {
    maxWidth: narrMaxWidth,
    maxLines: tall ? 5 : 3,
    size: tall ? 60 : 38,
    minSize: tall ? 40 : 26,
    lineHeightRatio: 1.3,
    weight: 800,
  });
  let narrBlock = narr;
  if (narrBlock.lines.length * narrBlock.lineHeight > narrMaxHeight) {
    narrBlock = fitText(ctx, cut.narration || "", {
      maxWidth: narrMaxWidth,
      maxLines: Math.max(2, Math.floor(narrMaxHeight / (narrBlock.lineHeight * 0.82))),
      size: narrBlock.size - 6,
      minSize: tall ? 36 : 24,
      lineHeightRatio: 1.3,
      weight: 800,
    });
  }
  drawTextBlock(ctx, narrBlock.lines, pad, narrTop, narrBlock.lineHeight, theme.ink);

  // 강조 밑줄 (나레이션 아래 짧은 액센트 바)
  const narrBottom = narrTop + narrBlock.lines.length * narrBlock.lineHeight;
  ctx.fillStyle = theme.accent;
  roundRect(ctx, pad, Math.min(narrBottom + 16, H * 0.5), 104, 10, 5);
  ctx.fill();

  // 빈 가운데 영역을 채우는 큰 워터마크 숫자 (긴 컷에서만)
  if (tall) {
    ctx.save();
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = theme.ink;
    ctx.font = font(Math.min(520, H * 0.42), 900);
    ctx.textBaseline = "top";
    ctx.fillText(String(index + 1).padStart(2, "0"), pad - 8, narrBottom + 60);
    ctx.restore();
  }

  // 캐릭터 (오른쪽 아래)
  const charR = tall ? Math.min(120, H * 0.092) : Math.max(48, Math.min(82, H * 0.135));
  const charX = tall ? 916 : 948;
  const charY = tall ? Math.min(H - 44 - charR * 2.28, H * 0.75) : H * 0.6;
  drawCharacter(ctx, charX, charY, charR, cut.expression, theme);

  // 말풍선 — 내용 높이에 맞춘다
  const bubbleLeft = pad;
  const bubbleWidth = tall ? 648 : 700;
  const bubblePadX = 32;
  const bubblePadY = 20;
  const speakerH = tall ? 38 : 30;
  const speech = fitText(ctx, cut.line || "", {
    maxWidth: bubbleWidth - bubblePadX * 2,
    maxLines: tall ? 4 : 2,
    size: tall ? 42 : 32,
    minSize: tall ? 28 : 22,
    lineHeightRatio: 1.3,
    weight: 600,
  });
  const contentH = bubblePadY * 2 + speakerH + speech.lines.length * speech.lineHeight;
  const maxBubbleH = tall ? H - 150 : H - 80;
  const bubbleHeight = Math.min(Math.max(contentH, tall ? 132 : 88), maxBubbleH);
  let bubbleTop = Math.max(narrBottom + 34, charY - charR * 0.55 - bubbleHeight * 0.6);
  bubbleTop = Math.min(bubbleTop, H - (tall ? 92 : 54) - bubbleHeight);

  const tailTop = bubbleTop + bubbleHeight * 0.38;
  const tailBottom = tailTop + 34;
  const tipX = bubbleLeft + bubbleWidth + 58;
  const tipY = tailTop + 17;
  const radius = 34;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.12)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.beginPath();
  ctx.moveTo(bubbleLeft + radius, bubbleTop);
  ctx.lineTo(bubbleLeft + bubbleWidth - radius, bubbleTop);
  ctx.quadraticCurveTo(bubbleLeft + bubbleWidth, bubbleTop, bubbleLeft + bubbleWidth, bubbleTop + radius);
  ctx.lineTo(bubbleLeft + bubbleWidth, tailTop);
  ctx.lineTo(tipX, tipY);
  ctx.lineTo(bubbleLeft + bubbleWidth, tailBottom);
  ctx.lineTo(bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight - radius);
  ctx.quadraticCurveTo(bubbleLeft + bubbleWidth, bubbleTop + bubbleHeight, bubbleLeft + bubbleWidth - radius, bubbleTop + bubbleHeight);
  ctx.lineTo(bubbleLeft + radius, bubbleTop + bubbleHeight);
  ctx.quadraticCurveTo(bubbleLeft, bubbleTop + bubbleHeight, bubbleLeft, bubbleTop + bubbleHeight - radius);
  ctx.lineTo(bubbleLeft, bubbleTop + radius);
  ctx.quadraticCurveTo(bubbleLeft, bubbleTop, bubbleLeft + radius, bubbleTop);
  ctx.closePath();
  ctx.fillStyle = theme.bubble;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = theme.bubbleLine || theme.line;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();

  // 화자 + 대사
  const speaker = cut.speaker || "독자";
  ctx.font = font(tall ? 26 : 22, 800);
  ctx.fillStyle = theme.accent;
  ctx.textBaseline = "top";
  ctx.fillText(speaker, bubbleLeft + bubblePadX, bubbleTop + bubblePadY);

  const lineTop = bubbleTop + bubblePadY + speakerH;
  drawTextBlock(ctx, speech.lines, bubbleLeft + bubblePadX, lineTop, speech.lineHeight, theme.ink);

  // 컷 워터마크
  ctx.font = font(tall ? 24 : 20, 700);
  ctx.fillStyle = theme.muted;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("뉴스픽 4컷", pad, H - (tall ? 40 : 30));

  ctx.restore();
}

/* ------------------------------------------------------------------ *
 * 합본
 * ------------------------------------------------------------------ */

const HEADER = 168;
const FOOTER = 96;
const PAD = 72;
const GAP = 56;

export function compositeBoxes(layoutId) {
  const layout = getLayout(layoutId);
  if (layout.id === "vertical") {
    const panelW = layout.width - PAD * 2;
    const rowH = (layout.height - HEADER - FOOTER - GAP * 3) / 4;
    return Array.from({ length: 4 }, (_, i) => ({
      x: PAD,
      y: HEADER + i * (rowH + GAP),
      w: panelW,
      h: rowH,
    }));
  }
  const panelW = (layout.width - PAD * 2 - GAP) / 2;
  const panelH = (layout.height - HEADER - FOOTER - GAP) / 2;
  return Array.from({ length: 4 }, (_, i) => ({
    x: PAD + (i % 2) * (panelW + GAP),
    y: HEADER + Math.floor(i / 2) * (panelH + GAP),
    w: panelW,
    h: panelH,
  }));
}

/**
 * 합본을 그린다.
 * @param {HTMLCanvasElement} canvas
 * @param {{cuts: Array, theme: string, layout: string, site?: string, scale?: number}} opts
 */
export function drawComposite(canvas, opts) {
  const { cuts = [], theme: themeId = "red", layout: layoutId = "grid", site = "", scale = 1 } = opts;
  const theme = getTheme(themeId);
  const layout = getLayout(layoutId);

  canvas.width = Math.round(layout.width * scale);
  canvas.height = Math.round(layout.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, layout.width, layout.height);

  // 배경
  const bg = ctx.createLinearGradient(0, 0, layout.width, layout.height);
  bg.addColorStop(0, theme.bg);
  bg.addColorStop(1, theme.id === "pastel" ? "#F4E7F0" : theme.id === "dark" ? "#101018" : theme.bg);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, layout.width, layout.height);

  // 헤더
  ctx.fillStyle = theme.accent;
  roundRect(ctx, PAD, 62, 20, 52, 6);
  ctx.fill();
  ctx.font = font(52, 800);
  ctx.fillStyle = theme.bgInk;
  ctx.textBaseline = "top";
  ctx.fillText("뉴스픽 4컷", PAD + 42, 62);
  ctx.font = font(28, 600);
  ctx.fillStyle = theme.bgMuted;
  ctx.fillText("기사 하나로 만드는 4컷 뉴스", PAD + 42, 122);

  if (site) {
    ctx.font = font(30, 700);
    ctx.fillStyle = theme.bgMuted;
    ctx.textAlign = "right";
    ctx.fillText(site, layout.width - PAD, 74);
    ctx.textAlign = "left";
  }

  // 컷
  const boxes = compositeBoxes(layoutId);
  boxes.forEach((box, i) => {
    const cut = cuts[i] || { narration: "", line: "", speaker: "독자", expression: "진지", roleLabel: "" };
    drawPanel(ctx, box, cut, i, themeId);
  });

  // 푸터
  ctx.font = font(26, 600);
  ctx.fillStyle = theme.bgMuted;
  ctx.textBaseline = "middle";
  ctx.fillText("newspic-4cut.pages.dev", PAD, layout.height - FOOTER / 2);
  ctx.textAlign = "right";
  ctx.fillText(layout.id === "vertical" ? "세로 4컷" : "2×2 4컷", layout.width - PAD, layout.height - FOOTER / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
}

/** 컷 하나만 1080×1080 정사각형으로 그린다. */
export function drawSinglePanel(canvas, cut, index, themeId, scale = 1) {
  const size = 1080;
  canvas.width = Math.round(size * scale);
  canvas.height = Math.round(size * scale);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const theme = getTheme(themeId);
  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, size, size);
  drawPanel(ctx, { x: 0, y: 0, w: size, h: size }, cut, index, themeId);
}
