// ==UserScript==
// @name         IGX Radiosonde Alert
// @namespace    https://rs.igx.kr/
// @version      1.2.0
// @description  모델 점수 변화 감지 알림. 감시할 모델과 임계 점수를 설정하면 점수가 회복/하락할 때 소리/팝업으로 알림.
// @author       IGX User
// @match        https://rs.igx.kr/*
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // ─────────────────────────────────────────────────────────
  //  GM 스토리지 키 (Closer 스크립트와 충돌 방지를 위해 네임스페이스 구분)
  // ─────────────────────────────────────────────────────────
  const KEY = {
    watched:    'rsalert_watched',      // JSON: { [modelId]: true }
    threshold:  'rsalert_threshold',    // number
    sound:      'rsalert_sound',        // boolean
    volume:     'rsalert_volume',       // number: 0~100
    popup:      'rsalert_popup',        // boolean
    prevScores: 'rsalert_prev_scores',  // JSON: { [modelId]: number }
  };

  // ─────────────────────────────────────────────────────────
  //  영속 스토리지 헬퍼
  // ─────────────────────────────────────────────────────────
  function load(key, def) {
    try { const v = GM_getValue(key, null); return v === null ? def : v; }
    catch (_) { return def; }
  }
  function save(key, val) {
    try { GM_setValue(key, val); } catch (_) {}
  }
  function loadJSON(key, def) {
    try { return JSON.parse(load(key, null)) ?? def; }
    catch (_) { return def; }
  }
  function saveJSON(key, val) { save(key, JSON.stringify(val)); }

  // ─────────────────────────────────────────────────────────
  //  스타일
  // ─────────────────────────────────────────────────────────
  const STYLE = `
    /* ── 플로팅 버튼 ── */
    #rsalert-btn {
      position: fixed;
      bottom: 50px;
      right: 16px;
      z-index: 99999;
      width: 36px;
      height: 36px;
      border-radius: 50%;
      border: 1px solid rgba(255,255,255,0.15);
      background: rgba(20, 20, 30, 0.88);
      color: rgba(255,255,255,0.70);
      font-size: 17px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      backdrop-filter: blur(6px);
      box-shadow: 0 2px 10px rgba(0,0,0,0.35);
      transition: background 0.2s, border-color 0.2s, transform 0.15s;
      line-height: 1;
    }
    #rsalert-btn:hover {
      background: rgba(30, 30, 50, 0.95);
      border-color: rgba(255,255,255,0.28);
      transform: scale(1.08);
    }
    #rsalert-btn.on {
      border-color: rgba(80, 210, 130, 0.65);
      color: rgba(100, 235, 150, 1);
      box-shadow: 0 2px 14px rgba(60,200,100,0.22);
    }

    /* ── 설정 패널 ── */
    #rsalert-panel {
      position: fixed;
      bottom: 96px;
      right: 16px;
      z-index: 99998;
      width: 300px;
      max-width: 90vw;
      background: rgba(16, 16, 24, 0.97);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 12px;
      backdrop-filter: blur(14px);
      box-shadow: 0 10px 40px rgba(0,0,0,0.55);
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 13px;
      color: rgba(255,255,255,0.82);
      overflow: hidden;
      /* 열림/닫힘 애니메이션 */
      max-height: 0;
      opacity: 0;
      transform: translateY(8px);
      transition: max-height 0.32s cubic-bezier(.4,0,.2,1),
                  opacity   0.25s ease,
                  transform 0.25s ease;
      pointer-events: none;
    }
    #rsalert-panel.open {
      max-height: 700px;
      opacity: 1;
      transform: translateY(0);
      pointer-events: auto;
    }

    /* ── 패널 내부 ── */
    .rsa-inner { padding: 16px 16px 14px; }

    .rsa-title {
      font-size: 13px;
      font-weight: 700;
      color: rgba(255,255,255,0.95);
      letter-spacing: 0.3px;
      margin-bottom: 14px;
      padding-bottom: 10px;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      display: flex;
      align-items: center;
      gap: 7px;
    }

    /* ── 섹션 ── */
    .rsa-section {
      margin-bottom: 14px;
    }
    .rsa-section-label {
      font-size: 10.5px;
      font-weight: 700;
      color: rgba(255,255,255,0.35);
      letter-spacing: 0.8px;
      text-transform: uppercase;
      margin-bottom: 8px;
    }

    /* ── 토글 행 ── */
    .rsa-toggle-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 0;
    }
    .rsa-toggle-text {
      font-size: 12.5px;
      color: rgba(255,255,255,0.72);
    }
    .rsa-toggle-sub {
      font-size: 10.5px;
      color: rgba(255,255,255,0.32);
      margin-top: 1px;
    }

    /* 토글 스위치 */
    .rsa-sw {
      position: relative;
      width: 36px;
      height: 20px;
      flex-shrink: 0;
    }
    .rsa-sw input { opacity: 0; width: 0; height: 0; position: absolute; }
    .rsa-sw-track {
      position: absolute;
      inset: 0;
      background: rgba(255,255,255,0.10);
      border-radius: 20px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .rsa-sw-track::before {
      content: '';
      position: absolute;
      width: 14px; height: 14px;
      left: 3px; top: 3px;
      background: rgba(255,255,255,0.45);
      border-radius: 50%;
      transition: transform 0.2s, background 0.2s;
    }
    .rsa-sw input:checked + .rsa-sw-track { background: rgba(70,195,115,0.5); }
    .rsa-sw input:checked + .rsa-sw-track::before {
      transform: translateX(16px);
      background: rgba(90,230,135,1);
    }

    /* ── 볼륨 슬라이더 행 ── */
    .rsa-volume-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 0 3px;
    }
    .rsa-volume-icon {
      font-size: 13px;
      flex-shrink: 0;
      width: 18px;
      text-align: center;
      color: rgba(255,255,255,0.55);
    }
    .rsa-volume-slider {
      flex: 1;
      -webkit-appearance: none;
      appearance: none;
      height: 3px;
      border-radius: 3px;
      background: rgba(255,255,255,0.12);
      outline: none;
      cursor: pointer;
    }
    .rsa-volume-slider::-webkit-slider-thumb {
      -webkit-appearance: none;
      appearance: none;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: rgba(255,255,255,0.75);
      cursor: pointer;
      transition: background 0.15s, transform 0.15s;
    }
    .rsa-volume-slider::-webkit-slider-thumb:hover {
      background: rgba(255,255,255,1);
      transform: scale(1.15);
    }
    .rsa-volume-slider::-moz-range-thumb {
      width: 14px;
      height: 14px;
      border: none;
      border-radius: 50%;
      background: rgba(255,255,255,0.75);
      cursor: pointer;
    }
    .rsa-volume-val {
      font-family: monospace;
      font-size: 11px;
      color: rgba(255,255,255,0.45);
      flex-shrink: 0;
      width: 28px;
      text-align: right;
    }
    .rsa-test-btn {
      font-size: 10.5px;
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid rgba(255,255,255,0.13);
      background: rgba(255,255,255,0.05);
      color: rgba(255,255,255,0.48);
      cursor: pointer;
      flex-shrink: 0;
      transition: background 0.15s, color 0.15s;
    }
    .rsa-test-btn:hover {
      background: rgba(255,255,255,0.11);
      color: rgba(255,255,255,0.80);
    }
    .rsa-score-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 0;
    }
    .rsa-score-label {
      font-size: 12.5px;
      color: rgba(255,255,255,0.72);
      flex: 1;
    }
    .rsa-score-input {
      width: 58px;
      background: rgba(255,255,255,0.07);
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 6px;
      color: rgba(255,255,255,0.90);
      font-family: monospace;
      font-size: 13px;
      padding: 4px 8px;
      text-align: center;
      outline: none;
      transition: border-color 0.2s;
    }
    .rsa-score-input:focus { border-color: rgba(100,175,255,0.60); }
    .rsa-score-unit {
      font-size: 11px;
      color: rgba(255,255,255,0.30);
    }

    /* ── 구분선 ── */
    .rsa-divider {
      border: none;
      border-top: 1px solid rgba(255,255,255,0.07);
      margin: 10px 0 12px;
    }

    /* ── 모델 목록 ── */
    .rsa-model-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 8px;
    }
    .rsa-model-actions {
      display: flex;
      gap: 5px;
    }
    .rsa-mini-btn {
      font-size: 10.5px;
      padding: 2px 8px;
      border-radius: 4px;
      border: 1px solid rgba(255,255,255,0.13);
      background: rgba(255,255,255,0.05);
      color: rgba(255,255,255,0.48);
      cursor: pointer;
      transition: background 0.15s, color 0.15s;
    }
    .rsa-mini-btn:hover {
      background: rgba(255,255,255,0.11);
      color: rgba(255,255,255,0.80);
    }

    .rsa-model-list {
      display: flex;
      flex-direction: column;
      gap: 3px;
      max-height: 200px;
      overflow-y: auto;
      padding-right: 3px;
    }
    .rsa-model-list::-webkit-scrollbar { width: 3px; }
    .rsa-model-list::-webkit-scrollbar-track { background: transparent; }
    .rsa-model-list::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.13);
      border-radius: 4px;
    }

    .rsa-model-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 8px;
      border-radius: 6px;
      cursor: pointer;
      transition: background 0.14s;
      user-select: none;
    }
    .rsa-model-item:hover { background: rgba(255,255,255,0.05); }
    .rsa-model-item input[type="checkbox"] {
      width: 13px; height: 13px;
      accent-color: #50c878;
      cursor: pointer;
      flex-shrink: 0;
    }
    .rsa-model-name {
      flex: 1;
      font-size: 12px;
      color: rgba(255,255,255,0.78);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .rsa-model-score {
      font-size: 11px;
      font-family: monospace;
      flex-shrink: 0;
    }
    /* 점수 대기 뱃지 */
    .rsa-waiting {
      font-size: 9.5px;
      padding: 1px 5px;
      border-radius: 4px;
      background: rgba(255,200,60,0.12);
      border: 1px solid rgba(255,200,60,0.25);
      color: rgba(255,200,80,0.85);
      flex-shrink: 0;
    }
    .rsa-model-empty {
      font-size: 12px;
      color: rgba(255,255,255,0.28);
      padding: 6px 8px;
    }

    /* ── 알림 권한 ── */
    .rsa-perm-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }
    .rsa-perm-label {
      font-size: 12px;
      color: rgba(255,255,255,0.45);
      flex: 1;
    }
    .rsa-perm-btn {
      font-size: 11px;
      padding: 4px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255,255,255,0.14);
      background: rgba(255,255,255,0.06);
      color: rgba(255,255,255,0.58);
      cursor: pointer;
      transition: background 0.15s, border-color 0.15s;
      white-space: nowrap;
    }
    .rsa-perm-btn:hover:not(:disabled) {
      background: rgba(255,255,255,0.12);
      border-color: rgba(255,255,255,0.28);
      color: rgba(255,255,255,0.90);
    }
    .rsa-perm-btn.granted {
      border-color: rgba(70,195,115,0.45);
      color: rgba(80,225,130,0.90);
    }
    .rsa-perm-btn.denied {
      border-color: rgba(255,90,80,0.40);
      color: rgba(255,90,80,0.65);
      cursor: not-allowed;
    }

    /* ── 인앱 토스트 ── */
    #rsalert-toast-wrap {
      position: fixed;
      bottom: 96px;
      right: 16px;
      z-index: 100000;
      display: flex;
      flex-direction: column-reverse;
      gap: 8px;
      pointer-events: none;
    }
    .rsa-toast {
      background: rgba(14, 24, 18, 0.97);
      border: 1px solid rgba(70,200,110,0.45);
      border-radius: 10px;
      padding: 11px 15px;
      font-size: 12.5px;
      color: rgba(255,255,255,0.88);
      box-shadow: 0 6px 22px rgba(0,0,0,0.45);
      backdrop-filter: blur(10px);
      max-width: 270px;
      animation: rsa-in 0.28s cubic-bezier(.2,.8,.4,1) forwards;
    }
    .rsa-toast-title {
      font-weight: 700;
      font-size: 12.5px;
      color: rgba(90,230,140,1);
      margin-bottom: 4px;
    }
    .rsa-toast-model {
      font-family: monospace;
      font-size: 11.5px;
      color: rgba(255,255,255,0.55);
    }
    .rsa-toast-score {
      font-family: monospace;
      font-size: 13px;
      color: rgba(255,255,255,0.90);
      margin-top: 2px;
    }
    /* ── 하락 토스트 (색상 오버라이드) ── */
    .rsa-toast.drop {
      background: rgba(28, 14, 14, 0.97);
      border-color: rgba(220,80,70,0.55);
    }
    .rsa-toast.drop .rsa-toast-title {
      color: rgba(255,100,90,1);
    }
    @keyframes rsa-in {
      from { opacity: 0; transform: translateX(18px) scale(0.97); }
      to   { opacity: 1; transform: translateX(0) scale(1); }
    }
    @keyframes rsa-out {
      from { opacity: 1; transform: translateX(0) scale(1); }
      to   { opacity: 0; transform: translateX(18px) scale(0.97); }
    }
  `;

  function injectStyle() {
    if (document.getElementById('rsalert-style')) return;
    const el = document.createElement('style');
    el.id = 'rsalert-style';
    el.textContent = STYLE;
    document.head.appendChild(el);
  }

  // ─────────────────────────────────────────────────────────
  //  현재 DOM에서 모든 모델 점수 수집
  //  → .graph-container[id] 아래 .model-info-score 텍스트 파싱
  // ─────────────────────────────────────────────────────────
  function collectScores() {
    const map = {};
    document.querySelectorAll('.graph-container[id]').forEach(card => {
      const el = card.querySelector('.model-info-score');
      if (!el) return;
      const v = parseFloat(el.textContent);
      if (!isNaN(v)) map[card.id] = v;
    });
    return map;
  }

  // ─────────────────────────────────────────────────────────
  //  Web Audio API — 딩동 비프음
  //  AudioContext는 반드시 사용자 클릭 이후에 생성해야 함
  //  (브라우저 자동재생 정책)
  // ─────────────────────────────────────────────────────────
  let _ctx = null;

  function getCtx() {
    if (!_ctx) {
      try { _ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (_) { return null; }
    }
    if (_ctx.state === 'suspended') _ctx.resume();
    return _ctx;
  }

  function beep() {
    const ctx = getCtx();
    if (!ctx) return;
    // 볼륨: 0~100 설정값을 Web Audio gain(0~0.5) 범위로 매핑
    const vol = Math.min(100, Math.max(0, Number(load(KEY.volume, 70)))) / 100 * 0.5;
    // 880 Hz → 1108 Hz 2음 연속
    [[880, 0, 0.28], [1108, 0.20, 0.22]].forEach(([hz, t, dur]) => {
      try {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(hz, ctx.currentTime + t);
        gain.gain.setValueAtTime(0, ctx.currentTime + t);
        gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + dur);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + dur + 0.05);
      } catch (_) {}
    });
  }

  // 하락 경보음: 하강 3음 (긴박한 느낌)
  function beepDrop() {
    const ctx = getCtx();
    if (!ctx) return;
    const vol = Math.min(100, Math.max(0, Number(load(KEY.volume, 70)))) / 100 * 0.5;
    // 880 Hz → 660 Hz → 440 Hz 하강 3음
    [[880, 0, 0.20], [660, 0.18, 0.20], [440, 0.36, 0.32]].forEach(([hz, t, dur]) => {
      try {
        const osc  = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'triangle';   // 회복음(sine)과 음색 구분
        osc.frequency.setValueAtTime(hz, ctx.currentTime + t);
        gain.gain.setValueAtTime(0, ctx.currentTime + t);
        gain.gain.linearRampToValueAtTime(vol, ctx.currentTime + t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + dur);
        osc.start(ctx.currentTime + t);
        osc.stop(ctx.currentTime + t + dur + 0.05);
      } catch (_) {}
    });
  }

  // ─────────────────────────────────────────────────────────
  //  인앱 토스트
  // ─────────────────────────────────────────────────────────
  function getToastWrap() {
    let w = document.getElementById('rsalert-toast-wrap');
    if (!w) {
      w = document.createElement('div');
      w.id = 'rsalert-toast-wrap';
      document.body.appendChild(w);
    }
    return w;
  }

  function showToast(modelId, score) {
    const name = modelId.replace(/^model-/, '');
    const t    = document.createElement('div');
    t.className = 'rsa-toast';
    t.innerHTML = `
      <div class="rsa-toast-title">✅ 서버 상태 회복</div>
      <div class="rsa-toast-model">${name}</div>
      <div class="rsa-toast-score">${score}점 도달</div>
    `;
    getToastWrap().appendChild(t);
    setTimeout(() => {
      t.style.animation = 'rsa-out 0.28s ease forwards';
      setTimeout(() => t.remove(), 300);
    }, 5500);
  }

  function showDropToast(modelId, score) {
    const name = modelId.replace(/^model-/, '');
    const t    = document.createElement('div');
    t.className = 'rsa-toast drop';
    t.innerHTML = `
      <div class="rsa-toast-title">⚠️ 점수 기준치 이탈</div>
      <div class="rsa-toast-model">${name}</div>
      <div class="rsa-toast-score">${score}점으로 하락</div>
    `;
    getToastWrap().appendChild(t);
    setTimeout(() => {
      t.style.animation = 'rsa-out 0.28s ease forwards';
      setTimeout(() => t.remove(), 300);
    }, 5500);
  }

  // ─────────────────────────────────────────────────────────
  //  시스템 Notification
  // ─────────────────────────────────────────────────────────
  function sysNotify(modelId, score) {
    if (Notification.permission !== 'granted') return;
    const name = modelId.replace(/^model-/, '');
    try {
      new Notification('IGX Radiosonde — 상태 회복', {
        body: `${name}  →  ${score}점`,
        icon: '/assets/logo.svg',
        tag:  'rsalert-' + modelId,
      });
    } catch (_) {}
  }

  function sysDropNotify(modelId, score) {
    if (Notification.permission !== 'granted') return;
    const name = modelId.replace(/^model-/, '');
    try {
      new Notification('IGX Radiosonde — 점수 기준치 이탈', {
        body: `${name}  →  ${score}점으로 하락`,
        icon: '/assets/logo.svg',
        tag:  'rsalert-drop-' + modelId,
      });
    } catch (_) {}
  }

  // ─────────────────────────────────────────────────────────
  //  알림 발화
  // ─────────────────────────────────────────────────────────
  function fireAlert(modelId, score) {
    if (load(KEY.sound, true))  beep();
    if (load(KEY.popup, true)) {
      if (Notification.permission === 'granted') sysNotify(modelId, score);
      else showToast(modelId, score);
    } else {
      showToast(modelId, score);
    }
  }

  function fireDropAlert(modelId, score) {
    if (load(KEY.sound, true))  beepDrop();
    if (load(KEY.popup, true)) {
      if (Notification.permission === 'granted') sysDropNotify(modelId, score);
      else showDropToast(modelId, score);
    } else {
      showDropToast(modelId, score);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  핵심: 엣지 검출 알림 체크
  //  조건: 이전 점수 < 임계값  AND  현재 점수 >= 임계값 → 1회 발화
  //  5분 리로드로 인메모리가 소멸되므로 이전 점수는 GM에 영속
  // ─────────────────────────────────────────────────────────
  function checkAlerts() {
    const watched   = loadJSON(KEY.watched,    {});
    const threshold = Number(load(KEY.threshold, 70));
    const prev      = loadJSON(KEY.prevScores,  {});
    const cur       = collectScores();

    // 이번 사이클 점수를 먼저 저장 (다음 리로드의 prev로 사용)
    saveJSON(KEY.prevScores, cur);

    const hits = [];
    const drops = [];
    for (const [id, curScore] of Object.entries(cur)) {
      if (!watched[id]) continue;
      const prevScore = (id in prev) ? prev[id] : null;
      const wasBelow  = prevScore === null || prevScore < threshold;
      const wasAbove  = prevScore !== null && prevScore >= threshold;

      // 상승 엣지: 임계값 미만 → 이상 (상태 회복)
      if (wasBelow && curScore >= threshold) hits.push({ id, score: curScore });
      // 하락 엣지: 임계값 이상 → 미만 (기준치 이탈)
      if (wasAbove && curScore < threshold)  drops.push({ id, score: curScore });
    }

    if (hits.length > 0) {
      setTimeout(() => hits.forEach(h => fireAlert(h.id, h.score)), 900);
    }
    if (drops.length > 0) {
      setTimeout(() => drops.forEach(d => fireDropAlert(d.id, d.score)), 900);
    }
  }

  // ─────────────────────────────────────────────────────────
  //  헬퍼: 토글 스위치 생성
  // ─────────────────────────────────────────────────────────
  function makeSwitch(storageKey, defaultVal, onChange) {
    const label = document.createElement('label');
    label.className = 'rsa-sw';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = load(storageKey, defaultVal);
    input.addEventListener('change', () => {
      save(storageKey, input.checked);
      if (onChange) onChange(input.checked);
    });

    const track = document.createElement('span');
    track.className = 'rsa-sw-track';

    label.appendChild(input);
    label.appendChild(track);
    return { wrap: label, input };
  }

  // ─────────────────────────────────────────────────────────
  //  UI 빌드
  // ─────────────────────────────────────────────────────────
  function buildUI() {
    if (document.getElementById('rsalert-btn')) return;

    // ── 플로팅 버튼
    const btn = document.createElement('button');
    btn.id = 'rsalert-btn';
    btn.title = 'IGX 알림 설정';
    btn.textContent = '🔔';

    // ── 패널
    const panel = document.createElement('div');
    panel.id = 'rsalert-panel';

    const inner = document.createElement('div');
    inner.className = 'rsa-inner';

    // ── 제목
    const title = document.createElement('div');
    title.className = 'rsa-title';
    title.innerHTML = '<span>🔔</span><span>상태 회복 알림</span>';
    inner.appendChild(title);

    // ── 알림 방식 섹션
    const modeSec = document.createElement('div');
    modeSec.className = 'rsa-section';

    const modeLabel = document.createElement('div');
    modeLabel.className = 'rsa-section-label';
    modeLabel.textContent = '알림 방식';
    modeSec.appendChild(modeLabel);

    // 소리 토글
    const soundRow = document.createElement('div');
    soundRow.className = 'rsa-toggle-row';
    const soundText = document.createElement('div');
    soundText.innerHTML = `
      <div class="rsa-toggle-text">🔊 소리</div>
      <div class="rsa-toggle-sub">비프음 재생</div>
    `;
    const { wrap: soundSw, input: soundInput } = makeSwitch(KEY.sound, true);
    soundRow.appendChild(soundText);
    soundRow.appendChild(soundSw);
    modeSec.appendChild(soundRow);

    // 볼륨 슬라이더 행 (소리 ON일 때만 활성화)
    const volRow = document.createElement('div');
    volRow.className = 'rsa-volume-row';

    const volIcon = document.createElement('span');
    volIcon.className = 'rsa-volume-icon';
    volIcon.textContent = '🔈';

    const volSlider = document.createElement('input');
    volSlider.type = 'range';
    volSlider.className = 'rsa-volume-slider';
    volSlider.min = 0;
    volSlider.max = 100;
    volSlider.step = 1;
    volSlider.value = load(KEY.volume, 70);

    const volVal = document.createElement('span');
    volVal.className = 'rsa-volume-val';
    volVal.textContent = volSlider.value;

    // 아이콘을 볼륨에 따라 🔈/🔉/🔊로 업데이트
    function refreshVolIcon(v) {
      volIcon.textContent = v <= 0 ? '🔇' : v < 40 ? '🔈' : v < 75 ? '🔉' : '🔊';
    }
    refreshVolIcon(Number(volSlider.value));

    volSlider.addEventListener('input', () => {
      const v = Number(volSlider.value);
      volVal.textContent = v;
      save(KEY.volume, v);
      refreshVolIcon(v);
    });

    const testBtn = document.createElement('button');
    testBtn.className = 'rsa-test-btn';
    testBtn.textContent = '테스트';
    testBtn.title = '현재 볼륨으로 미리 듣기';
    testBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      getCtx();
      beep();
    });

    // 소리 토글 연동: OFF면 슬라이더 비활성화
    function syncVolState(on) {
      volRow.style.opacity = on ? '1' : '0.35';
      volSlider.disabled = !on;
      testBtn.disabled   = !on;
    }
    syncVolState(soundInput.checked);
    soundInput.addEventListener('change', () => syncVolState(soundInput.checked));

    volRow.appendChild(volIcon);
    volRow.appendChild(volSlider);
    volRow.appendChild(volVal);
    volRow.appendChild(testBtn);
    modeSec.appendChild(volRow);

    // 팝업 토글
    const popupRow = document.createElement('div');
    popupRow.className = 'rsa-toggle-row';
    popupRow.style.marginTop = '4px';
    const popupText = document.createElement('div');
    popupText.innerHTML = `
      <div class="rsa-toggle-text">🖥 팝업</div>
      <div class="rsa-toggle-sub">시스템 알림 또는 화면 내 토스트</div>
    `;
    const { wrap: popupSw } = makeSwitch(KEY.popup, true);
    popupRow.appendChild(popupText);
    popupRow.appendChild(popupSw);
    modeSec.appendChild(popupRow);

    inner.appendChild(modeSec);

    // ── 임계 점수 섹션
    const scoreSec = document.createElement('div');
    scoreSec.className = 'rsa-section';

    const scoreLabel = document.createElement('div');
    scoreLabel.className = 'rsa-section-label';
    scoreLabel.textContent = '임계 점수';
    scoreSec.appendChild(scoreLabel);

    const scoreRow = document.createElement('div');
    scoreRow.className = 'rsa-score-row';

    const scoreTxt = document.createElement('div');
    scoreTxt.className = 'rsa-score-label';
    scoreTxt.textContent = '이 점수 이상이면 알림';

    const scoreInput = document.createElement('input');
    scoreInput.type = 'number';
    scoreInput.className = 'rsa-score-input';
    scoreInput.min = 0;
    scoreInput.max = 100;
    scoreInput.value = load(KEY.threshold, 70);
    scoreInput.addEventListener('change', () => {
      const v = Math.min(100, Math.max(0, parseInt(scoreInput.value) || 0));
      scoreInput.value = v;
      save(KEY.threshold, v);
      // 임계값 변경 시 모델 목록의 대기 상태 뱃지 갱신
      renderModelList();
    });

    const scoreUnit = document.createElement('span');
    scoreUnit.className = 'rsa-score-unit';
    scoreUnit.textContent = '점';

    scoreRow.appendChild(scoreTxt);
    scoreRow.appendChild(scoreInput);
    scoreRow.appendChild(scoreUnit);
    scoreSec.appendChild(scoreRow);
    inner.appendChild(scoreSec);

    // ── 구분선
    const hr1 = document.createElement('hr');
    hr1.className = 'rsa-divider';
    inner.appendChild(hr1);

    // ── 모델 선택 섹션
    const modelSec = document.createElement('div');
    modelSec.className = 'rsa-section';

    const modelHeader = document.createElement('div');
    modelHeader.className = 'rsa-model-header';

    const modelSecLabel = document.createElement('div');
    modelSecLabel.className = 'rsa-section-label';
    modelSecLabel.style.marginBottom = '0';
    modelSecLabel.textContent = '감시 모델';

    const modelActions = document.createElement('div');
    modelActions.className = 'rsa-model-actions';

    function makeMinBtn(text, onClick) {
      const b = document.createElement('button');
      b.className = 'rsa-mini-btn';
      b.textContent = text;
      b.addEventListener('click', onClick);
      return b;
    }

    // 모델 목록 컨테이너 (renderModelList에서 채움)
    const modelList = document.createElement('div');
    modelList.className = 'rsa-model-list';

    function renderModelList() {
      modelList.innerHTML = '';
      const curScores = collectScores();
      const watched   = loadJSON(KEY.watched, {});
      const threshold = Number(load(KEY.threshold, 70));
      const ids = Object.keys(curScores).sort();

      if (ids.length === 0) {
        const emp = document.createElement('div');
        emp.className = 'rsa-model-empty';
        emp.textContent = '감지된 모델 없음';
        modelList.appendChild(emp);
        return;
      }

      for (const id of ids) {
        const score     = curScores[id];
        const isWatched = !!watched[id];
        const isBelow   = score < threshold;

        const item = document.createElement('label');
        item.className = 'rsa-model-item';
        item.htmlFor = 'rsa-cb-' + id;

        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.id   = 'rsa-cb-' + id;
        cb.checked = isWatched;
        cb.addEventListener('change', () => {
          const w = loadJSON(KEY.watched, {});
          w[id] = cb.checked;
          saveJSON(KEY.watched, w);
          refreshBtn();
          // 체크 상태 바뀌면 뱃지 즉시 갱신
          renderModelList();
        });

        const nameSpan = document.createElement('span');
        nameSpan.className = 'rsa-model-name';
        nameSpan.textContent = id.replace(/^model-/, '');

        const scoreSpan = document.createElement('span');
        scoreSpan.className = 'rsa-model-score';
        if      (score >= 70) scoreSpan.style.color = 'rgba(80,215,120,0.85)';
        else if (score >= 50) scoreSpan.style.color = 'rgba(90,160,255,0.85)';
        else if (score >= 40) scoreSpan.style.color = 'rgba(255,255,255,0.40)';
        else                  scoreSpan.style.color = 'rgba(255,100,90,0.85)';
        scoreSpan.textContent = isNaN(score) ? '-' : score + '점';

        item.appendChild(cb);
        item.appendChild(nameSpan);
        item.appendChild(scoreSpan);

        // 감시 중이면서 임계값 미만일 때만 대기 중 뱃지 표시
        if (isWatched && isBelow) {
          const badge = document.createElement('span');
          badge.className = 'rsa-waiting';
          badge.textContent = '대기 중';
          item.appendChild(badge);
        }

        modelList.appendChild(item);
      }
    }

    // 전체 선택/해제
    modelActions.appendChild(makeMinBtn('전체 선택', () => {
      const cur = collectScores();
      const w   = {};
      Object.keys(cur).forEach(id => { w[id] = true; });
      saveJSON(KEY.watched, w);
      renderModelList();
      refreshBtn();
    }));
    modelActions.appendChild(makeMinBtn('전체 해제', () => {
      saveJSON(KEY.watched, {});
      renderModelList();
      refreshBtn();
    }));

    modelHeader.appendChild(modelSecLabel);
    modelHeader.appendChild(modelActions);
    modelSec.appendChild(modelHeader);
    modelSec.appendChild(modelList);
    inner.appendChild(modelSec);

    // ── 구분선
    const hr2 = document.createElement('hr');
    hr2.className = 'rsa-divider';
    inner.appendChild(hr2);

    // ── 알림 권한 행
    const permRow = document.createElement('div');
    permRow.className = 'rsa-perm-row';

    const permLbl = document.createElement('span');
    permLbl.className = 'rsa-perm-label';
    permLbl.textContent = '시스템 알림 권한';

    const permBtn = document.createElement('button');
    permBtn.className = 'rsa-perm-btn';

    function refreshPermBtn() {
      const p = Notification.permission;
      if (p === 'granted') {
        permBtn.textContent = '✅ 허용됨';
        permBtn.className = 'rsa-perm-btn granted';
        permBtn.disabled = true;
      } else if (p === 'denied') {
        permBtn.textContent = '❌ 거부됨';
        permBtn.className = 'rsa-perm-btn denied';
        permBtn.disabled = true;
      } else {
        permBtn.textContent = '권한 요청';
        permBtn.className = 'rsa-perm-btn';
        permBtn.disabled = false;
      }
    }
    refreshPermBtn();

    permBtn.addEventListener('click', () => {
      // ★ 클릭 이벤트 내에서 AudioContext 초기화 (자동재생 정책 통과)
      getCtx();
      Notification.requestPermission().then(refreshPermBtn);
    });

    permRow.appendChild(permLbl);
    permRow.appendChild(permBtn);
    inner.appendChild(permRow);

    panel.appendChild(inner);

    // ── 버튼 상태 갱신 (감시 모델 있으면 초록 강조)
    function refreshBtn() {
      const w = loadJSON(KEY.watched, {});
      const on = Object.values(w).some(Boolean);
      btn.classList.toggle('on', on);
      btn.textContent = on ? '🔔' : '🔔';
      btn.title = on ? 'IGX 알림 ON' : 'IGX 알림 설정';
    }
    refreshBtn();

    // ── 패널 열기/닫기
    let open = false;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      // 클릭 시 AudioContext 초기화 (소리 알림을 위한 준비)
      getCtx();
      open = !open;
      panel.classList.toggle('open', open);
      if (open) renderModelList();
    });

    // 패널 외부 클릭 시 닫기
    document.addEventListener('click', (e) => {
      if (open && !panel.contains(e.target) && e.target !== btn) {
        open = false;
        panel.classList.remove('open');
      }
    });

    document.body.appendChild(btn);
    document.body.appendChild(panel);
  }

  // ─────────────────────────────────────────────────────────
  //  초기화
  // ─────────────────────────────────────────────────────────
  function init() {
    if (!document.getElementById('data-container')) return;
    if (document.querySelectorAll('.graph-container[id]').length === 0) return;

    injectStyle();
    buildUI();
    checkAlerts(); // 페이지 로드마다 엣지 검출 실행
  }

  // ── DOM 준비 대기
  let _ready = false;
  function tryInit() {
    if (_ready) return;
    if (document.querySelectorAll('.graph-container[id]').length === 0) return;
    _ready = true;
    init();
  }

  new MutationObserver(tryInit).observe(document.body, { childList: true, subtree: true });
  tryInit();
  setTimeout(() => { if (!_ready) init(); }, 3000);

})();
