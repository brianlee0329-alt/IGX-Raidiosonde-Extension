// ==UserScript==
// @name         IGX Radiosonde Closer
// @namespace    https://rs.igx.kr/
// @version      1.4.1
// @description  IGX Radiosonde 페이지 개별 모델 카드 및 그룹 단위 접기↔펼치기 + 5분 강제 새로고침 + 점수 등급별 카드 배경 강조
// @author       IGX User
// @match        https://rs.igx.kr/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────
  //  ★ 강제 새로고침 (5분 = 300초)
  //    사이트 내장 updateTimer()는 DOM을 부분 갱신하므로
  //    compact header 클론 등 수치가 틀어지는 문제가 있음.
  //    location.reload()로 전체 페이지를 새로 불러와 해결.
  // ─────────────────────────────────────────────────────────
  const RELOAD_INTERVAL_MS = 5 * 60 * 1000; // 5분
  const COUNTDOWN_ID       = 'igx-reload-countdown';

  // ── 카운트다운 HUD
  function injectCountdownHUD() {
    if (document.getElementById(COUNTDOWN_ID)) return;
    const hud = document.createElement('div');
    hud.id = COUNTDOWN_ID;
    hud.style.cssText = `
      position: fixed;
      bottom: 14px;
      right: 16px;
      z-index: 99999;
      background: rgba(20, 20, 30, 0.82);
      color: rgba(255,255,255,0.55);
      font-size: 11px;
      font-family: monospace;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.10);
      pointer-events: none;
      backdrop-filter: blur(4px);
      transition: color 0.3s;
    `;
    document.body.appendChild(hud);
  }

  // ── 카운트다운 루프
  // [v1.3.1 버그 수정]
  //   - deadline을 tick() 시작 직전에 계산하도록 구조 변경
  //     (이전: IIFE 최상단에서 선점 캡처 → document.body가 없을 때
  //      DOMContentLoaded를 기다리는 동안 시간이 흘러 3~4분으로 시작하는 문제)
  //   - pageshow 이벤트로 bfcache 복원을 감지해 타이머 리셋
  //     (이전: 탭 전환 후 복원 시 오래된 deadline이 복원돼 짧은 타이머 표시)
  let tickTimer = null;

  function startReloadCountdown() {
    // 진행 중인 타이머가 있으면 중단 후 새로 시작 (bfcache 복원 등 재진입 방지)
    if (tickTimer !== null) {
      clearTimeout(tickTimer);
      tickTimer = null;
    }

    // ★ deadline을 tick() 시작 직전에 계산 (이전 버전의 핵심 버그 수정)
    const deadline = Date.now() + RELOAD_INTERVAL_MS;

    function tick() {
      const left = Math.max(0, deadline - Date.now());
      const m    = Math.floor(left / 60000);
      const s    = Math.floor((left % 60000) / 1000);
      const pad  = (n) => String(n).padStart(2, '0');

      const hud = document.getElementById(COUNTDOWN_ID);
      if (hud) {
        hud.textContent = `🔄 새로고침까지 ${pad(m)}:${pad(s)}`;
        // 30초 이하일 때 강조
        hud.style.color = left <= 30000
          ? 'rgba(255, 180, 80, 0.9)'
          : 'rgba(255,255,255,1)';
      }

      if (left <= 0) {
        tickTimer = null;
        location.reload();
        return;
      }
      tickTimer = setTimeout(tick, 500);
    }

    injectCountdownHUD();
    tick();
  }

  // body 준비 후 시작
  if (document.body) {
    startReloadCountdown();
  } else {
    document.addEventListener('DOMContentLoaded', startReloadCountdown);
  }

  // bfcache 복원 감지: persisted=true이면 JS 상태가 냉동 복원된 것이므로 타이머 리셋
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) {
      startReloadCountdown();
    }
  });

  // ─────────────────────────────────────────────────────────
  //  모델 그룹 정의
  // ─────────────────────────────────────────────────────────
  const GROUPS = [
    {
      key:    'opus',
      family: 'claude',
      label: '🔵 Claude Opus',
      color: '#7c83ff',
      match: (id) => id.startsWith('model-claude-opus'),
    },
    {
      key:    'sonnet',
      family: 'claude',
      label: '🟣 Claude Sonnet',
      color: '#C8A2C8',
      match: (id) => id.startsWith('model-claude-sonnet'),
    },
    {
      key:    'gemini-pro',
      family: 'gemini',
      label: '🟡 Gemini Pro',
      color: '#fdd663',
      match: (id) =>
        id.startsWith('model-gemini') &&
        !id.includes('flash'),
    },
    {
      key:    'gemini-flash',
      family: 'gemini',
      label: '🟠 Gemini Flash / Flash‑Lite',
      color: '#fbceb1',
      match: (id) =>
        id.startsWith('model-gemini') &&
        id.includes('flash'),
    },
  ];

  // ─────────────────────────────────────────────────────────
  //  점수 등급 정의
  //    · score < SCORE_RED_MAX          → 빨강 (굴리기 힘든 수준)
  //    · score >= tier.min (내림차순)   → 녹색(70) / 파랑(50)
  // ─────────────────────────────────────────────────────────
  const SCORE_RED_MAX = 40;           // 이 미만이면 red
  const SCORE_TIERS = [               // 내림차순 정렬 필수
    { min: 70, cls: 'igx-score-green' },
    { min: 50, cls: 'igx-score-blue'  },
  ];

  // ─────────────────────────────────────────────────────────
  //  스타일 주입
  // ─────────────────────────────────────────────────────────
  const STYLE = `
    /* ── 계열 묶음 래퍼 (Claude / Gemini) ── */
    .igx-family-wrapper {
      display: flex;
      flex-direction: row;
      gap: 8px;
      width: 100%;
      align-items: flex-start;
      overflow: hidden;
    }

    /* 그룹 래퍼 ── */
    .igx-group-wrapper {
      border: 1px solid rgba(255,255,255,0.10);
      border-radius: 10px;
      margin-bottom: 0;
      overflow: hidden;
      flex: 1 1 0;
      min-width: 0;          /* flex 자식의 overflow 제어 핵심 */
      box-sizing: border-box;
    }

    /* 그래프 컨테이너 내부도 clip */
    .igx-group-wrapper .graph-container {
      overflow: hidden;
    }

    /* 그래프 바 자체가 부모 너비를 넘지 않도록 */
    .igx-group-wrapper .graph {
      overflow: hidden;
      max-width: 100%;
    }

    /* ── 그룹 헤더 버튼 ── */
    .igx-group-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 16px;
      cursor: pointer;
      user-select: none;
      background: rgba(255,255,255,0.04);
      transition: background 0.18s;
      border: none;
      width: 100%;
      text-align: left;
      color: inherit;
      font-family: inherit;
    }
    .igx-group-header:hover {
      background: rgba(255,255,255,0.09);
    }

    .igx-group-title {
      font-size: 13px;
      font-weight: 700;
      letter-spacing: 0.4px;
    }

    .igx-group-meta {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 11px;
      color: rgba(255,255,255,0.45);
    }

    /* ── 카드별 토글 버튼 ── */
    .igx-card-toggle {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      cursor: pointer;
      background: rgba(255,255,255,0.06);
      border: none;
      border-radius: 5px;
      padding: 2px 8px;
      font-size: 11px;
      color: rgba(255,255,255,0.55);
      transition: background 0.15s, color 0.15s;
      flex-shrink: 0;
      margin-left: 8px;
      vertical-align: middle;
    }
    .igx-card-toggle:hover {
      background: rgba(255,255,255,0.14);
      color: rgba(255,255,255,0.9);
    }

    /* ── 화살표 아이콘 ── */
    .igx-chevron {
      display: inline-block;
      transition: transform 0.22s ease;
      font-style: normal;
    }
    .igx-chevron.collapsed {
      transform: rotate(-90deg);
    }

    /* ── 그룹 콘텐츠 영역 ── */
    .igx-group-body {
      overflow: hidden;
      transition: max-height 0.28s ease, opacity 0.22s ease;
      max-height: 9999px;
      opacity: 1;
    }
    .igx-group-body.collapsed {
      max-height: 0 !important;
      opacity: 0;
    }

    /* ════════════════════════════════════════════════════════
       ▼ v1.4.0 핵심 수정
       CSS 클래스 레벨에서 패딩·최소높이를 모두 초기화.
       main.css의 !important를 이기기 위해 JS 인라인 강제주입과 병행.
       ════════════════════════════════════════════════════════ */

    /* 접힌 카드: 박스 자체 수축 */
    .igx-card-collapsed {
      padding-top:    0 !important;
      padding-bottom: 0 !important;
      min-height:     0 !important;   /* ← 이전 버전에서 누락된 핵심 */
      overflow:       hidden !important;
    }

    /* 접힌 카드: screenwide / mobile-vertical 완전 숨김 */
    .igx-card-collapsed .screenwide,
    .igx-card-collapsed .mobile-vertical,
    .igx-card-collapsed .graph {
      display: none !important;
    }

    /* ── 컴팩트 헤더 (접힌 상태에서만 표시) ── */
    .igx-compact-row {
      display: none;
      align-items: center;
      gap: 8px;
      padding: 7px 12px;
      box-sizing: border-box;
      min-height: 36px;
    }
    .igx-card-collapsed .igx-compact-row {
      display: flex !important;
    }

    /* 배지 */
    .igx-compact-badge {
      flex-shrink: 0;
    }

    /* 모델명 */
    .igx-compact-name {
      font-size: 13px;
      font-weight: 600;
      color: rgba(255,255,255,0.9);
      flex: 0 0 auto;           /* ← flex:1 제거, 내용 너비만큼만 차지 */
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 300px;
    }

    /* 통계 수치 래퍼 — 버튼 바로 우측에 위치 */
    .igx-compact-stats {
      display: inline-flex;
      align-items: center;
      gap: 0;
      font-size: 11px;
      white-space: nowrap;
      margin-left: 10px;
    }
    /* 수치 개별 span — 색상은 원본 green/yellow/red 클래스 그대로 상속 */
    .igx-compact-stats .igx-stat-val {
      /* 색상은 JS에서 원본 클래스를 복사하므로 여기선 지정 안 함 */
    }
    /* 라벨 span (응답시간/속도) */
    .igx-compact-stats .igx-stat-label {
      color: rgba(255,255,255,0.38);
      margin-right: 3px;
    }
    .igx-compact-stats .igx-stat-div {
      color: rgba(255,255,255,0.3);
      margin: 0 6px;
    }

    /* ══════════════════════════════════════════════════════
       ▼ v1.4.0 점수 등급별 카드 배경 강조
       ══════════════════════════════════════════════════════ */

    /* 🔴 40점 미만 — 레드 (사용 불가 수준) */
    .igx-score-red {
      background: linear-gradient(135deg,
        rgba(255, 80, 70, 0.13) 0%,
        rgba(220, 50, 40, 0.07) 100%) !important;
      box-shadow: inset 0 0 0 1.5px rgba(255, 80, 70, 0.45),
                  0 0 12px rgba(255, 80, 70, 0.08);
      overflow: hidden !important;
    }

    /* 🔵 50점 이상 — 블루 (적당히 사용 가능) */
    .igx-score-blue {
      background: linear-gradient(135deg,
        rgba(90, 160, 255, 0.13) 0%,
        rgba(60, 120, 230, 0.07) 100%) !important;
      box-shadow: inset 0 0 0 1.5px rgba(90, 160, 255, 0.40),
                  0 0 12px rgba(90, 160, 255, 0.07);
      overflow: hidden !important;
    }

    /* 🟢 70점 이상 — 그린 (원활) */
    .igx-score-green {
      background: linear-gradient(135deg,
        rgba(70, 210, 120, 0.13) 0%,
        rgba(50, 180, 90, 0.07) 100%) !important;
      box-shadow: inset 0 0 0 1.5px rgba(70, 210, 120, 0.40),
                  0 0 12px rgba(70, 210, 120, 0.07);
      overflow: hidden !important;
    }
    /* 컴팩트 행은 별도 배경 없이 카드 그라디언트를 그대로 비춤
       (별도 배경을 깔면 border-radius 안에서 사각형 영역이 생겨 끝부분이 부자연스러워짐) */
  `;

  function injectStyle() {
    if (document.getElementById('igx-collapse-style')) return;
    const el = document.createElement('style');
    el.id = 'igx-collapse-style';
    el.textContent = STYLE;
    document.head.appendChild(el);
  }

  // ─────────────────────────────────────────────────────────
  //  상태 영속성
  // ─────────────────────────────────────────────────────────
  function loadState(key, defaultVal) {
    try {
      const raw = GM_getValue(key, null);
      return raw === null ? defaultVal : raw;
    } catch (_) {
      return defaultVal;
    }
  }
  function saveState(key, val) {
    try { GM_setValue(key, val); } catch (_) {}
  }

  // ─────────────────────────────────────────────────────────
  //  인라인 !important 강제 주입 헬퍼
  //  → main.css 에 !important 가 걸려 있어도 이쪽이 이긴다
  // ─────────────────────────────────────────────────────────
  function forceCollapse(card) {
    card.style.setProperty('padding-top',    '0', 'important');
    card.style.setProperty('padding-bottom', '0', 'important');
    card.style.setProperty('min-height',     '0', 'important');
    card.style.setProperty('overflow',   'hidden', 'important');
    const graph = card.querySelector('.graph');
    if (graph) graph.style.setProperty('display', 'none', 'important');
  }
  function restoreCollapse(card) {
    card.style.removeProperty('padding-top');
    card.style.removeProperty('padding-bottom');
    card.style.removeProperty('min-height');
    card.style.removeProperty('overflow');
    const graph = card.querySelector('.graph');
    if (graph) graph.style.removeProperty('display');
  }

  // ─────────────────────────────────────────────────────────
  //  점수 등급 강조
  // ─────────────────────────────────────────────────────────
  function highlightCardByScore(card) {
    const scoreEl = card.querySelector('.model-info-score');
    if (!scoreEl) return;

    const score = parseFloat(scoreEl.textContent);
    if (isNaN(score)) return;

    // 기존 등급 클래스 전부 초기화
    card.classList.remove('igx-score-red', 'igx-score-blue', 'igx-score-green');

    // 40점 미만 → red
    if (score < SCORE_RED_MAX) {
      card.classList.add('igx-score-red');
      return;
    }
    // 50점·70점 이상 → SCORE_TIERS 내림차순으로 첫 번째 매칭
    for (const tier of SCORE_TIERS) {
      if (score >= tier.min) {
        card.classList.add(tier.cls);
        break;
      }
    }
  }

  // ─────────────────────────────────────────────────────────
  //  카드 단위 접기/펼치기
  // ─────────────────────────────────────────────────────────
  function setupCardToggle(card) {
    // 중복 초기화 방지
    if (card.dataset.igxToggled) return;
    card.dataset.igxToggled = '1';

    const modelId    = card.id;
    const stateKey   = 'card_' + modelId;
    const isCollapsed = loadState(stateKey, false);

    const graphDiv      = card.querySelector('.graph');
    const screenwideEl  = card.querySelector('.screenwide');
    const titleSpan     = card.querySelector('.screenwide .model-title');
    if (!graphDiv || !titleSpan) return;

    // ── ① 컴팩트 헤더 행 생성 (카드 최상단에 삽입)
    const compactRow = document.createElement('div');
    compactRow.className = 'igx-compact-row';
    card.insertBefore(compactRow, card.firstChild);

    // ── ② 토글 버튼 생성 헬퍼
    function makeBtn(collapsed) {
      const btn = document.createElement('button');
      btn.className = 'igx-card-toggle';
      const chev = document.createElement('i');
      chev.className = 'igx-chevron' + (collapsed ? ' collapsed' : '');
      chev.textContent = '▼';
      btn.appendChild(chev);
      btn.appendChild(document.createTextNode(collapsed ? '펼치기' : '접기'));
      return btn;
    }

    // 풀 헤더 내 접기 버튼
    const fullBtn = makeBtn(isCollapsed);
    titleSpan.appendChild(fullBtn);

    // ── ③ 컴팩트 행 내용 빌드 (수치는 호출 시점 DOM에서 읽음)
    function buildCompact(collapsed) {
      const origBadge  = card.querySelector('.model-status .badge');
      // 원본 수치 요소 (텍스트 + 색상 클래스 모두 복사)
      const rtEl    = card.querySelector('.model-info-response-time');
      const tpsEl   = card.querySelector('.model-info-token-speed');
      const scoreEl = card.querySelector('.model-info-score');
      const nameText = Array.from(titleSpan.childNodes)
                           .filter(n => n.nodeType === Node.TEXT_NODE)
                           .map(n => n.textContent.trim())
                           .join('').trim()
                       || titleSpan.textContent.trim();

      compactRow.innerHTML = '';

      // ① 배지
      if (origBadge) {
        const clone = origBadge.cloneNode(true);
        clone.classList.add('igx-compact-badge');
        compactRow.appendChild(clone);
      }

      // ② 모델명
      const nameSpan = document.createElement('span');
      nameSpan.className = 'igx-compact-name';
      nameSpan.textContent = nameText;
      compactRow.appendChild(nameSpan);

      // ③ 토글 버튼 (모델명 바로 우측 — 통계보다 앞)
      const cBtn = makeBtn(collapsed);
      cBtn.addEventListener('click', toggleHandler);
      compactRow.appendChild(cBtn);

      // ④ 통계 (라벨 + 원본 색상 클래스 그대로 복사) — 버튼 바로 우측
      const statsWrap = document.createElement('span');
      statsWrap.className = 'igx-compact-stats';

      function makeStatSpan(el, labelText) {
        if (!el) return null;
        const wrap = document.createDocumentFragment();

        // 라벨 (응답시간 / 속도)
        if (labelText) {
          const lbl = document.createElement('span');
          lbl.className = 'igx-stat-label';
          lbl.textContent = labelText;
          wrap.appendChild(lbl);
        }

        const s = document.createElement('span');
        s.className = 'igx-stat-val';
        ['green', 'yellow', 'red'].forEach(cls => {
          if (el.classList.contains(cls)) s.classList.add(cls);
        });
        if (el.style.cssText) s.style.cssText = el.style.cssText;
        s.textContent = el.textContent.trim();
        wrap.appendChild(s);
        return wrap;
      }

      const entries = [
        { el: rtEl,    label: '응답시간 ' },
        { el: tpsEl,   label: '속도 '    },
        { el: scoreEl, label: null        },
      ].filter(e => e.el);

      entries.forEach(({ el, label }, i) => {
        const frag = makeStatSpan(el, label);
        if (frag) statsWrap.appendChild(frag);
        if (i < entries.length - 1) {
          const div = document.createElement('span');
          div.className = 'igx-stat-div';
          div.textContent = '|';
          statsWrap.appendChild(div);
        }
      });

      compactRow.appendChild(statsWrap);
    }

    // ── ④ 상태 적용
    function applyState(collapsed) {
      // 점수 등급 강조 (DOM 수치가 확정된 뒤 실행)
      highlightCardByScore(card);

      // CSS 클래스 토글
      card.classList.toggle('igx-card-collapsed', collapsed);

      if (collapsed) {
        // JS 인라인 !important 강제 주입 (main.css 우선순위 전쟁 회피)
        forceCollapse(card);
        buildCompact(true);
      } else {
        restoreCollapse(card);
        // 접혀 있는 동안 갱신된 그래프가 렌더링되지 못한 경우를 위해
        // resize 이벤트로 차트 라이브러리의 재렌더링을 유도
        setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
      }

      // 풀 버튼 갱신
      const fChev = fullBtn.querySelector('.igx-chevron');
      if (fChev) fChev.classList.toggle('collapsed', collapsed);
      fullBtn.lastChild.textContent = collapsed ? '펼치기' : '접기';
    }

    // ── ⑤ 토글 핸들러
    function toggleHandler(e) {
      e.stopPropagation();
      const nowCollapsed = !card.classList.contains('igx-card-collapsed');
      applyState(nowCollapsed);
      saveState(stateKey, nowCollapsed);
    }

    fullBtn.addEventListener('click', toggleHandler);

    // ── ⑥ 초기 상태 적용
    applyState(isCollapsed);
    if (!isCollapsed) buildCompact(false); // 펼친 상태에서도 컴팩트 행 미리 빌드
  }

  // ─────────────────────────────────────────────────────────
  //  그룹 단위 접기/펼치기
  // ─────────────────────────────────────────────────────────
  function buildGroups(dataContainer) {
    const allCards = Array.from(dataContainer.querySelectorAll('.graph-container[id]'));
    const grouped  = GROUPS.map((g) => ({ ...g, cards: [] }));
    const ungrouped = [];

    for (const card of allCards) {
      const matched = grouped.find((g) => g.match(card.id));
      if (matched) matched.cards.push(card);
      else ungrouped.push(card);
    }

    dataContainer.innerHTML = '';
    // data-container 자체는 단순 세로 스택
    dataContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px;';

    // 계열별 family 래퍼 생성
    const familyMap = {};

    function getFamilyEl(familyKey) {
      if (!familyMap[familyKey]) {
        const el = document.createElement('div');
        el.className = 'igx-family-wrapper';
        familyMap[familyKey] = el;
        dataContainer.appendChild(el);
      }
      return familyMap[familyKey];
    }

    for (const group of grouped) {
      if (group.cards.length === 0) continue;

      const stateKey    = 'group_' + group.key;
      const isCollapsed = loadState(stateKey, false);

      const wrapper = document.createElement('div');
      wrapper.className = 'igx-group-wrapper';

      const header = document.createElement('button');
      header.className = 'igx-group-header';
      header.innerHTML = `
        <span class="igx-group-title" style="color:${group.color}">${group.label}</span>
        <span class="igx-group-meta">
          <span class="igx-group-count">${group.cards.length}개 모델</span>
          <i class="igx-chevron${isCollapsed ? ' collapsed' : ''}">▼</i>
        </span>
      `;

      const gbody = document.createElement('div');
      gbody.className = 'igx-group-body' + (isCollapsed ? ' collapsed' : '');
      for (const card of group.cards) gbody.appendChild(card);

      wrapper.appendChild(header);
      wrapper.appendChild(gbody);

      // 초기 상태 반영
      if (isCollapsed) wrapper.classList.add('igx-group-collapsed');

      // 계열 래퍼에 추가
      getFamilyEl(group.family).appendChild(wrapper);

      header.addEventListener('click', () => {
        const nowCollapsed = !gbody.classList.contains('collapsed');
        gbody.classList.toggle('collapsed', nowCollapsed);
        wrapper.classList.toggle('igx-group-collapsed', nowCollapsed);
        header.querySelector('.igx-chevron').classList.toggle('collapsed', nowCollapsed);
        saveState(stateKey, nowCollapsed);
      });
    }

    for (const card of ungrouped) dataContainer.appendChild(card);
  }

  // ─────────────────────────────────────────────────────────
  //  메인 초기화
  // ─────────────────────────────────────────────────────────
  function init() {
    const dataContainer = document.getElementById('data-container');
    if (!dataContainer) return;

    injectStyle();
    buildGroups(dataContainer);

    dataContainer.querySelectorAll('.graph-container[id]')
                 .forEach(setupCardToggle);
  }

  // ─────────────────────────────────────────────────────────
  //  페이지 로드 타이밍 대응
  // ─────────────────────────────────────────────────────────
  let applied = false;

  function tryInit() {
    if (applied) return;
    const dataContainer = document.getElementById('data-container');
    if (!dataContainer) return;
    if (dataContainer.querySelectorAll('.graph-container[id]').length === 0) return;
    applied = true;
    init();
  }

  const observer = new MutationObserver(() => tryInit());
  observer.observe(document.body, { childList: true, subtree: true });
  tryInit();
  setTimeout(() => { if (!applied) init(); }, 3000);

})();
