# 뉴스픽 4컷 (newspic-4cut)

뉴스픽 파트너스 기사를 **4컷 만화**로 바꾸고, **쓰레드 본문 + 첫 댓글용 파트너스 링크**까지 한 화면에서 끝내는 웹 도구입니다.
Cloudflare Pages(정적 자산) + Pages Functions(서버 API)만으로 동작하며, 별도 유료 인프라나 AI API 키가 필요 없습니다.

- 라이브: **https://newspic-4cut.pages.dev**
- 저장소: `hijun67/261123-newspic-4cut`
- Cloudflare 계정: `Hijun67@gmail.com's Account` (`00f8f24b0380ddf9e50c47a4a124c1d2`)

## 화면과 기능

| 단계 | 내용 |
|---|---|
| ① 기사 가져오기 | 뉴스픽·뉴스픽 파트너스 기사 URL / 제목+본문 직접 입력 / 예시 기사 3종 |
| ② 미리보기 | Canvas 4컷(2×2 · 세로 4컷), 테마 4종, 합본·컷별 PNG 저장, 모바일 이미지 공유 |
| ③ 4컷 대본 편집 | 컷별 나레이션·말풍선 대사·화자(독자/기자)·표정(놀람/진지/웃음/당황) 실시간 편집 |
| ④ 쓰레드 글 | 이슈 요약 본문 초안 + 500자 카운터 + 작성창 열기 + 첫 댓글 문구 복사 |
| ⑤ 업로드 3단계 | 이미지 저장 → 본문·이미지 게시 → 첫 댓글 링크, 체크 상태 자동 저장 |
| ⑥ 히스토리 | 작업 저장·불러오기·삭제 (최근 10건, localStorage) |

### 기사 파싱 (`POST /api/parse-article`)
- `og:title` / `og:description` / `og:image` / `article:published_time` 메타 추출, 없으면 `<title>`·본문으로 대체
- 뉴스픽 본문 영역(`#bo_v_atc`)을 우선 추출하고, 없으면 `itemprop="articleBody"` → `<article>` → `class*="article-body|view|content"` 순으로 시도
- 문장 분리 시 `(서울=연합뉴스)`, `홍길동 기자 =`, `[사진=…]`, `Copyright ⓒ …` 같은 기사 부속 문구를 제거
- 점수화(길이·숫자·인용·보도 동사·문장 위치)로 핵심 문장 3개를 골라 **1컷 훅 → 2컷 핵심 → 3컷 반전 → 4컷 결론**으로 배분
- 9초 타임아웃, 응답 2.5MB 상한, EUC-KR 등 인코딩 자동 판별
- 차단·타임아웃 시에도 **200 + 편집 가능한 4컷 뼈대 + 링크 유지**로 응답해 직접 입력으로 이어갈 수 있음
- SSRF 방어: http/https만, localhost·사설 IP·`.local`·`.internal` 차단

### 파트너스 링크
- 파트너 콘솔 공유 링크(`…&pn=1234`), `pn=1234`, `1234` 형식 모두 인식
- **기본 파트너 코드 `pn=661`** — 첫 방문자(localStorage 비어 있음)에게도 자동 적용되고, 추적 값 `lcp=v9sIx86b`·`cp=H0cKa48w`·`utm_source=np260905v9sIx86b`가 함께 붙습니다
- 화면의 파트너 칩에서 다른 코드를 저장하면 그 코드가, 코드를 지우면 파트너 없이 링크가 만들어집니다(기본값은 `functions/api/_lib.js`의 `DEFAULT_PARTNER`, `assets/app.js`의 `DEFAULT_PARTNER`)
- localStorage에 저장해 두고, 붙여넣은 `m.newspic.kr` 링크에 `pn`(+추적 값)을 자동 병합
- 첫 댓글 문구는 병합된 링크를 그대로 사용

### 4컷 렌더링 (`assets/canvas.js`)
- 디자인 좌표계(컷 폭 1080)에서 그린 뒤 박스 크기에 맞춰 균일 스케일
- 테마 4종: 이슈 레드 / 웹툰 파스텔 / 다크 뉴스 / 경제 블루
- 캐릭터 표정 4종(놀람·진지·웃음·당황)과 말풍선 꼬리를 하나의 패스로 그림
- 합본: 2×2 **2160×2700**, 세로 **2160×3840** / 컷별 PNG: **1080×1080**
- `navigator.canShare` 지원 시 합본을 바로 공유(모바일)

## 구조

```
index.html                 한 화면 앱
assets/style.css           디자인 시스템(반응형: 1440 / 390)
assets/app.js              상태·편집·저장·쓰레드 워크플로우
assets/canvas.js           Canvas 4컷 렌더러 + 텍스트 피팅
functions/api/parse-article.js  기사 파싱·4컷 분해·폴백
functions/api/_lib.js      순수 함수(파싱·문장·4컷·파트너 링크·쓰레드)
functions/api/_presets.js  예시 기사 3종
functions/api/presets.js   예시 목록 API
scripts/build.mjs          dist/ 생성
wrangler.toml              Pages 프로젝트 설정
```

## 로컬 실행·테스트

```bash
node scripts/build.mjs

# 단위 + API (120 checks)
/workspace/tmp/node/bin/node .local-tests/newspic-4cut/test.js

# headless Chromium UI (60 checks: 1440/390, 캔버스 렌더·다운로드·복사·인텐트·localStorage)
LD_LIBRARY_PATH=/workspace/tmp-acs/libs /workspace/tmp/node/bin/node .local-tests/newspic-4cut/ui.test.js
```

테스트 하네스(`/workspace/.local-tests/newspic-4cut/harness.js`)는 Pages Functions와 정적 자산을 로컬 HTTP로 재현하고,
외부 기사 요청은 고정 픽스처로 대체해 결과를 결정적으로 만듭니다.

## 배포

```bash
node scripts/build.mjs
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=00f8f24b0380ddf9e50c47a4a124c1d2 \
  npx wrangler pages deploy dist --project-name newspic-4cut --branch main
```

- Cloudflare Pages **직접 업로드** 프로젝트라 GitHub 푸시가 자동 배포로 이어지지 않습니다. 수정 후 위 명령을 다시 실행합니다.
- 배포용 API 토큰은 `Cloudflare Pages: Edit`만 가진 단기 토큰을 쓰고, 배포 직후 대시보드에서 삭제합니다. (삭제 후 `/user/tokens/verify` 401 확인)
- 서버 시크릿·KV·DB를 쓰지 않습니다. 파트너 코드·설정·히스토리는 브라우저 localStorage에만 저장됩니다.

## 운영 메모

- 기사 본문은 원문 문장을 그대로 쓰므로, 게시 전 사실관계와 인용을 한 번 확인하는 것을 권장합니다(화면에도 안내).
- 뉴스픽이 아닌 언론사 기사도 메타·본문 구조가 비슷하면 동작하지만, 파트너 코드는 뉴스픽 링크에만 붙습니다.
- 쓰레드 인텐트(`threads.net/intent/post`)는 본문만 넘길 수 있어 이미지는 앱에서 직접 첨부해야 합니다(3단계 안내에 포함).
