(function () {
  'use strict';

  const C = window.Chess;
  const Sound = window.Sound;
  const engine = new window.StockfishEngine();

  const STORAGE_KEY = 'chess-for-two:v1';
  const COLOR_NAMES = { w: 'White', b: 'Black' };
  const PIECE_NAMES = { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' };
  const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const DRAG_THRESHOLD = 5;
  const ANIMATION_MS = 180;
  const LOW_TIME_MS = 10000;
  const LIVE_DEPTH = 22;       // Explore mode: how deep Stockfish searches each position
  const LIVE_LINES = 3;        // Explore mode: how many candidate lines to show

  // Move classification, as used by Lichess: drop in winning chances on a [-1, 1] scale.
  const CLASSES = {
    best: { symbol: '★', label: 'Best move' },
    good: null,
    inaccuracy: { symbol: '?!', label: 'Inaccuracy', threshold: 0.1 },
    mistake: { symbol: '?', label: 'Mistake', threshold: 0.2 },
    blunder: { symbol: '??', label: 'Blunder', threshold: 0.3 },
  };

  const $ = (id) => document.getElementById(id);
  const els = {
    modeButtons: document.querySelectorAll('.mode-switch button'),
    board: $('board'),
    arrows: $('arrows'),
    evalBar: $('eval-bar'),
    barTop: $('bar-top'),
    barBottom: $('bar-bottom'),
    status: $('status'),
    moves: $('moves'),
    opening: $('opening'),
    book: $('book'),
    newGame: $('btn-new'),
    undo: $('btn-undo'),
    flip: $('btn-flip'),
    draw: $('btn-draw'),
    resign: $('btn-resign'),
    tabs: document.querySelectorAll('.tab'),
    navFirst: $('nav-first'),
    navPrev: $('nav-prev'),
    navNext: $('nav-next'),
    navLast: $('nav-last'),
    copyPgn: $('btn-copy-pgn'),
    downloadPgn: $('btn-download-pgn'),
    importPgn: $('btn-import-pgn'),
    analysisLocked: $('analysis-locked'),
    analyze: $('btn-analyze'),
    progress: $('analysis-progress'),
    analysisError: $('analysis-error'),
    summary: $('analysis-summary'),
    graph: $('eval-graph'),
    positionInfo: $('analysis-position'),
    engineOn: $('engine-on'),
    engineLines: $('engine-lines'),
    nameW: $('name-w'),
    nameB: $('name-b'),
    swap: $('btn-swap'),
    resetScore: $('btn-reset-score'),
    scoreLine: $('score-line'),
    timeControl: $('time-control'),
    depth: $('analysis-depth'),
    autoFlip: $('auto-flip'),
    soundOn: $('sound-on'),
    promotion: $('promotion'),
    promoChoices: $('promo-choices'),
    gameOver: $('game-over'),
    resultTitle: $('result-title'),
    resultReason: $('result-reason'),
    review: $('btn-review'),
    closeResult: $('btn-close-result'),
    rematch: $('btn-rematch'),
    importDialog: $('import'),
    pgnInput: $('pgn-input'),
    pgnFile: $('pgn-file'),
    importError: $('import-error'),
    importCancel: $('btn-import-cancel'),
    importLoad: $('btn-import-load'),
    toast: $('toast'),
  };

  // ---------- State ----------

  const settings = {
    mode: 'play',            // 'play' (a real game) or 'explore' (free analysis board)
    names: { w: 'White', b: 'Black' },
    timeControl: '10,0',
    depth: 14,
    autoFlip: false,
    sound: true,
    flipped: false,
    tabs: { play: 'moves', explore: 'moves' },
    exploreEngine: false,
  };
  let score = {};            // player name -> points

  /*
   * One game per mode. game.states[i] is the position after i half-moves; game.history[i] is
   * the move from states[i] to states[i + 1]. game.clocks[i] and game.analysis[i] belong to
   * states[i]. game.view is the index of the position being looked at, or null for the latest.
   */
  const games = { play: null, explore: null };
  let game;
  let selected = null;
  let targets = [];
  let pendingPromotion = null;
  let drag = null;
  const clock = { running: false, lastTick: 0, time: { w: 0, b: 0 }, warned: { w: false, b: false } };
  const analysis = { running: false, token: 0, error: null };
  const live = { token: 0, fen: null, state: null, lines: [], running: false, error: null, terminal: null };
  let openings = null;       // position key -> [ECO, name], loaded on start-up

  const isExplore = () => settings.mode === 'explore';
  const current = () => game.states[game.states.length - 1];
  const lastIndex = () => game.states.length - 1;
  const shownIndex = () => (game.view === null ? lastIndex() : game.view);
  const shownState = () => game.states[shownIndex()];
  const isLive = () => game.view === null;

  /** Stockfish review is only offered once a game is over (or for an imported game). */
  const reviewEnabled = () => !isExplore() && (!!game.result || game.imported);

  /** Can pieces be moved on the board right now? */
  function boardInteractive() {
    if (isExplore()) return !(isLive() && game.result); // explore: branch off from any position
    return isLive() && !game.result;
  }

  function playerName(color) {
    if (isExplore()) return COLOR_NAMES[color];
    return (game.players && game.players[color]) || settings.names[color] || COLOR_NAMES[color];
  }

  function today() {
    const d = new Date();
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
  }

  function pieceImg(piece, cls = 'piece') {
    return `<img class="${cls}" src="assets/pieces/${piece.color}${piece.type.toUpperCase()}.svg" alt="" draggable="false">`;
  }

  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  // ---------- Game creation ----------

  function blankGame(startState, timeControl) {
    return {
      startFen: C.toFEN(startState),
      states: [startState],
      keys: [C.positionKey(startState)],
      history: [],
      clocks: timeControl ? [{ w: timeControl.minutes * 60000, b: timeControl.minutes * 60000 }] : null,
      timeControl,
      result: null,
      analysis: [],
      scored: null,
      date: today(),
      players: null,
      imported: false,
      headers: null,
      view: null,
    };
  }

  function parseTimeControl(value) {
    const [minutes, increment] = value.split(',').map(Number);
    return minutes > 0 ? { minutes, increment } : null;
  }

  function setGame(g) {
    games[settings.mode] = g;
    game = g;
  }

  function newGame() {
    cancelAnalysis();
    stopLive();
    setGame(blankGame(C.createInitialState(), isExplore() ? null : parseTimeControl(settings.timeControl)));
    resetTransientState();
    if (settings.autoFlip && !isExplore()) settings.flipped = false;
    engine.newGame();
    render();
    save();
  }

  function resetTransientState() {
    selected = null;
    targets = [];
    pendingPromotion = null;
    cancelDrag();
    clock.running = false;
    clock.warned = { w: false, b: false };
    if (game.clocks) clock.time = { ...game.clocks[game.clocks.length - 1] };
    hideModal(els.promotion);
    hideModal(els.gameOver);
  }

  function setMode(mode) {
    if (mode === settings.mode) return;
    cancelDrag();
    clearSelection();
    if (pendingPromotion) cancelPromotion();
    hideModal(els.gameOver);
    cancelAnalysis();
    stopLive();

    if (!isExplore()) {
      // Pause the game clock while exploring.
      tickClock();
      if (game.clocks) games.play.clockTime = { ...clock.time };
      clock.running = false;
    }

    settings.mode = mode;
    game = games[mode];

    if (!isExplore() && game.clocks) {
      clock.time = { ...(game.clockTime || game.clocks[game.clocks.length - 1]) };
      clock.running = game.history.length > 0 && !game.result;
      clock.lastTick = performance.now();
    }
    render();
    save();
  }

  // ---------- Playing moves ----------

  function select(r, c) {
    selected = { r, c };
    targets = C.legalMovesFrom(shownState(), r, c);
  }

  function clearSelection() {
    selected = null;
    targets = [];
  }

  function targetAt(r, c) {
    return targets.find((m) => m.to.r === r && m.to.c === c);
  }

  function tryMove(move, { animate = true } = {}) {
    if (move.promotion) {
      pendingPromotion = { move, animate };
      showPromotion(shownState().turn);
      renderBoard(null);
      return;
    }
    playMove(move, undefined, { animate });
  }

  /** Explore mode: moving from an earlier position replaces the moves that followed it. */
  function truncateTo(index) {
    game.states.length = index + 1;
    game.keys.length = index + 1;
    game.history.length = index;
    game.analysis.length = Math.min(game.analysis.length, index + 1);
    game.result = null;
    game.view = null;
  }

  function playMove(move, promotionType, { animate = true } = {}) {
    if (!isLive()) {
      if (!isExplore()) return;
      truncateTo(game.view);
    }
    const state = current();
    const mover = state.turn;
    tickClock();
    if (game.result) return; // the flag may have just fallen

    const san = C.toSAN(state, move, promotionType);
    const uci = C.toUCI(move, promotionType);
    const { state: next, captured } = C.makeMove(state, move, promotionType);

    if (game.clocks) {
      clock.time[mover] += game.timeControl.increment * 1000;
      if (!clock.running) clock.running = true;
      clock.lastTick = performance.now();
    }

    game.states.push(next);
    game.keys.push(C.positionKey(next));
    game.history.push({ san, uci, move, promotionType, captured, color: mover });
    if (game.clocks) game.clocks.push({ ...clock.time });

    clearSelection();
    pendingPromotion = null;
    game.view = null;
    if (settings.autoFlip && !isExplore()) settings.flipped = next.turn === 'b';

    checkGameEnd();
    if (!game.result) Sound.play(soundFor(game.history[game.history.length - 1], next));
    render({ animation: animate ? { move, reverse: false } : null });
    save();
  }

  function soundFor(entry, stateAfter) {
    if (C.inCheck(stateAfter.board, stateAfter.turn)) return 'check';
    if (entry.move.promotion) return 'promote';
    if (entry.move.castle) return 'castle';
    return entry.captured ? 'capture' : 'move';
  }

  function checkGameEnd() {
    const state = current();
    const status = C.getStatus(state);
    const winner = C.other(state.turn);

    if (status === 'checkmate') {
      endGame(`${playerName(winner)} wins`, `Checkmate — ${playerName(state.turn)} has no way out.`, winner);
    } else if (status === 'stalemate') {
      endGame('Draw', `Stalemate — ${playerName(state.turn)} has no legal moves.`);
    } else if (status === 'insufficient') {
      endGame('Draw', 'Insufficient material to checkmate.');
    } else if (status === 'fifty') {
      endGame('Draw', '50-move rule — no capture or pawn move in 50 moves.');
    } else {
      const key = game.keys[game.keys.length - 1];
      if (game.keys.filter((k) => k === key).length >= 3) endGame('Draw', 'Threefold repetition.');
    }
  }

  function endGame(title, reason, winner) {
    const code = winner === 'w' ? '1-0' : winner === 'b' ? '0-1' : '1/2-1/2';
    game.result = { title, reason, winner: winner || null, code };
    clock.running = false;
    clearSelection();
    Sound.play('end');
    if (!isExplore()) {
      recordScore();
      els.resultTitle.textContent = title;
      els.resultReason.textContent = reason;
      showModal(els.gameOver);
    }
  }

  function recordScore() {
    if (isExplore() || game.imported || game.scored) return;
    const delta = {};
    const add = (name, pts) => { delta[name] = (delta[name] || 0) + pts; };
    if (game.result.winner) {
      add(playerName(game.result.winner), 1);
      add(playerName(C.other(game.result.winner)), 0);
    } else {
      add(playerName('w'), 0.5);
      add(playerName('b'), 0.5);
    }
    for (const [name, pts] of Object.entries(delta)) score[name] = (score[name] || 0) + pts;
    game.scored = delta;
  }

  function unrecordScore() {
    if (!game.scored) return;
    for (const [name, pts] of Object.entries(game.scored)) score[name] = (score[name] || 0) - pts;
    game.scored = null;
  }

  function undo() {
    if (pendingPromotion) {
      cancelPromotion();
      return;
    }
    if (!game.history.length) return;
    const entry = game.history.pop();
    game.states.pop();
    game.keys.pop();
    game.analysis.length = Math.min(game.analysis.length, game.states.length);
    if (game.result) {
      unrecordScore();
      game.result = null;
      hideModal(els.gameOver);
      cancelAnalysis(); // the game is on again, so the review closes
    }
    if (game.clocks) {
      // Give back the time spent on the undone move.
      game.clocks.pop();
      clock.time = { ...game.clocks[game.clocks.length - 1] };
      clock.running = game.history.length > 0;
      clock.lastTick = performance.now();
      clock.warned = { w: false, b: false };
    }
    game.view = null;
    clearSelection();
    if (settings.autoFlip && !isExplore()) settings.flipped = current().turn === 'b';
    render({ animation: { move: entry.move, reverse: true } });
    save();
  }

  function resign() {
    if (game.result || isExplore()) return;
    const loser = current().turn;
    const winner = C.other(loser);
    if (!confirm(`${playerName(loser)}, do you really want to resign?`)) return;
    endGame(`${playerName(winner)} wins`, `${playerName(loser)} resigned.`, winner);
    render();
    save();
  }

  function offerDraw() {
    if (game.result || isExplore()) return;
    const offerer = current().turn;
    const opponent = C.other(offerer);
    if (!confirm(`${playerName(offerer)} offers a draw.\n\n${playerName(opponent)}, do you accept?`)) return;
    endGame('Draw', 'Draw by agreement.');
    render();
    save();
  }

  // ---------- Clock ----------

  function tickClock() {
    if (isExplore() || !game.clocks || !clock.running || game.result) return;
    const now = performance.now();
    const turn = current().turn;
    clock.time[turn] -= now - clock.lastTick;
    clock.lastTick = now;

    if (clock.time[turn] < LOW_TIME_MS && !clock.warned[turn]) {
      clock.warned[turn] = true;
      Sound.play('lowTime');
    }
    if (clock.time[turn] <= 0) {
      clock.time[turn] = 0;
      const winner = C.other(turn);
      cancelDrag();
      hideModal(els.promotion);
      pendingPromotion = null;
      // A flag fall is a draw if the opponent could never checkmate.
      if (cannotMate(current().board, winner)) {
        endGame('Draw', `${playerName(turn)} ran out of time, but ${playerName(winner)} cannot checkmate.`);
      } else {
        endGame(`${playerName(winner)} wins`, `${playerName(turn)} ran out of time.`, winner);
      }
      render();
      save();
    }
  }

  function cannotMate(board, color) {
    const pieces = board.flat().filter((p) => p && p.color === color && p.type !== 'k');
    return pieces.length === 0 || (pieces.length === 1 && (pieces[0].type === 'b' || pieces[0].type === 'n'));
  }

  function formatTime(ms) {
    const total = Math.max(0, ms);
    const hours = Math.floor(total / 3600000);
    const minutes = Math.floor((total % 3600000) / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    if (total < LOW_TIME_MS) return `0:${String(seconds).padStart(2, '0')}.${Math.floor((total % 1000) / 100)}`;
    const mm = hours ? String(minutes).padStart(2, '0') : String(minutes);
    return `${hours ? hours + ':' : ''}${mm}:${String(seconds).padStart(2, '0')}`;
  }

  function renderClocks() {
    if (isExplore() || !game.clocks) return;
    // While reviewing, show the clocks as they were at that moment.
    const times = isLive() ? clock.time : game.clocks[shownIndex()];
    for (const color of ['w', 'b']) {
      const el = document.getElementById(`clock-${color}`);
      if (!el) continue;
      el.textContent = formatTime(times[color]);
      el.classList.toggle('active', isLive() && clock.running && !game.result && current().turn === color);
      el.classList.toggle('low', times[color] < LOW_TIME_MS * 2);
    }
  }

  let lastSave = 0;
  setInterval(() => {
    tickClock();
    renderClocks();
    if (clock.running && performance.now() - lastSave > 1000) save();
  }, 100);

  // ---------- Save & resume ----------

  function serializeGame(g, clockTime) {
    return {
      startFen: g.startFen,
      moves: g.history.map((h) => h.uci),
      clocks: g.clocks,
      clockTime: g.clocks ? clockTime : null,
      timeControl: g.timeControl,
      result: g.result,
      analysis: g.analysis,
      scored: g.scored,
      date: g.date,
      players: g.players,
      imported: g.imported,
      headers: g.headers,
    };
  }

  function deserializeGame(s) {
    const g = rebuildGame(s.startFen, s.moves, s.timeControl);
    Object.assign(g, {
      clocks: s.clocks && s.clocks.length === s.moves.length + 1 ? s.clocks : g.clocks,
      clockTime: s.clockTime || null,
      result: s.result,
      analysis: (s.analysis || []).slice(0, s.moves.length + 1),
      scored: s.scored,
      date: s.date || g.date,
      players: s.players,
      imported: !!s.imported,
      headers: s.headers,
    });
    return g;
  }

  function save() {
    lastSave = performance.now();
    if (!isExplore() && games.play.clocks) games.play.clockTime = { ...clock.time };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 2,
        settings,
        score,
        games: {
          play: serializeGame(games.play, games.play.clockTime),
          explore: serializeGame(games.explore, null),
        },
      }));
    } catch (err) {
      // Storage full or disabled (e.g. private mode): the game still works, it just won't persist.
    }
  }

  function load() {
    let data;
    try {
      data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch (err) {
      data = null;
    }
    if (!data || (data.version !== 1 && data.version !== 2)) return false;

    const saved = data.settings || {};
    Object.assign(settings, saved);
    settings.names = { w: 'White', b: 'Black', ...saved.names };
    settings.tabs = { play: 'moves', explore: 'moves', ...saved.tabs };
    if (settings.mode !== 'explore') settings.mode = 'play';
    delete settings.tab; // version 1 kept a single tab
    score = data.score || {};

    // Version 1 saved only the (play) game.
    const stored = data.version === 1 ? { play: data.game } : data.games || {};
    for (const mode of ['play', 'explore']) {
      try {
        games[mode] = stored[mode] ? deserializeGame(stored[mode]) : null;
      } catch (err) {
        games[mode] = null;
      }
    }
    if (!games.play) games.play = blankGame(C.createInitialState(), parseTimeControl(settings.timeControl));
    if (!games.explore) games.explore = blankGame(C.createInitialState(), null);
    if (data.version === 1 && data.game) games.play.clockTime = data.game.clockTime;

    game = games[settings.mode];
    resetTransientState();
    const play = games.play;
    if (play.clocks) {
      clock.time = { ...(play.clockTime || play.clocks[play.clocks.length - 1]) };
      // Resume a running clock; time spent with the page closed is not counted.
      clock.running = !isExplore() && play.history.length > 0 && !play.result;
      clock.lastTick = performance.now();
    }
    return true;
  }

  /** Replay UCI moves from a FEN to rebuild a game. Throws on an illegal move. */
  function rebuildGame(startFen, ucis, timeControl) {
    const g = blankGame(C.fromFEN(startFen || C.START_FEN), timeControl);
    for (const uci of ucis) {
      const state = g.states[g.states.length - 1];
      const found = C.moveFromUCI(state, uci);
      if (!found) throw new Error('Illegal move ' + uci);
      appendMove(g, found.move, found.promotionType);
    }
    return g;
  }

  function appendMove(g, move, promotionType) {
    const state = g.states[g.states.length - 1];
    const san = C.toSAN(state, move, promotionType);
    const { state: next, captured } = C.makeMove(state, move, promotionType);
    g.history.push({ san, uci: C.toUCI(move, promotionType), move, promotionType, captured, color: state.turn });
    g.states.push(next);
    g.keys.push(C.positionKey(next));
  }

  window.addEventListener('pagehide', save);

  // ---------- Openings ----------

  const openingKey = (state) => C.toFEN(state).split(' ').slice(0, 3).join(' ');

  function loadOpenings() {
    fetch('data/openings.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        openings = data;
        renderOpening();
      })
      .catch(() => {}); // e.g. opened as file:// — the game works without opening names
  }

  /** The named opening for the shown position: the deepest named position on the way to it. */
  function openingAt(index) {
    if (!openings) return null;
    for (let i = index; i >= 0; i--) {
      const hit = openings[openingKey(game.states[i])];
      if (hit) return { eco: hit[0], name: hit[1], exact: i === index };
    }
    return null;
  }

  /** Moves from the shown position that lead to a named opening position. */
  function bookMoves(state) {
    if (!openings) return [];
    const out = [];
    for (const move of C.allLegalMoves(state)) {
      if (move.promotion) continue;
      const next = C.makeMove(state, move).state;
      const hit = openings[openingKey(next)];
      if (hit) out.push({ move, san: C.toSAN(state, move), eco: hit[0], name: hit[1] });
    }
    return out.sort((a, b) => a.eco.localeCompare(b.eco) || a.name.localeCompare(b.name));
  }

  function renderOpening() {
    const idx = shownIndex();
    const op = openingAt(idx);
    if (idx === 0 && game.startFen === C.START_FEN) {
      els.opening.innerHTML = '<span class="eco">—</span> Starting position';
    } else if (op) {
      els.opening.innerHTML = `<span class="eco">${op.eco}</span> ${escapeHTML(op.name)}`;
    } else {
      els.opening.innerHTML = openings ? '<span class="muted">Out of the opening book</span>' : '';
    }
    els.opening.classList.toggle('hidden', !els.opening.innerHTML);

    els.book.classList.toggle('hidden', !isExplore());
    if (!isExplore()) return;
    const moves = bookMoves(shownState());
    els.book.innerHTML = `<h3>Book moves</h3>` + (moves.length
      ? `<ul>${moves.map((m, i) =>
        `<li><button class="book-move" data-i="${i}"><b>${m.san}</b> <span class="eco">${m.eco}</span> ${escapeHTML(m.name)}</button></li>`
      ).join('')}</ul>`
      : `<p class="hint">${openings ? 'No known opening continues from here.' : 'Opening names need the page served over http(s).'}</p>`);
    els.book.bookMoves = moves;
  }

  els.book.addEventListener('click', (e) => {
    const btn = e.target.closest('.book-move');
    if (!btn || !boardInteractive()) return;
    const m = els.book.bookMoves[Number(btn.dataset.i)];
    if (m) playMove(m.move);
  });

  // ---------- Rendering ----------

  function render({ animation = null } = {}) {
    renderModeUI();
    renderBoard(animation);
    renderArrows();
    renderEvalBar();
    renderPlayerBars();
    renderStatus();
    renderMoves();
    renderOpening();
    renderAnalysis();
    renderEngine();
    renderSettings();
    renderClocks();
    renderTabs();

    els.undo.disabled = game.history.length === 0;
    els.draw.disabled = els.resign.disabled = !!game.result || game.history.length === 0;
    els.navFirst.disabled = els.navPrev.disabled = shownIndex() === 0;
    els.navNext.disabled = els.navLast.disabled = isLive();
    updateLiveAnalysis();
  }

  function renderModeUI() {
    const explore = isExplore();
    document.body.classList.toggle('explore', explore);
    els.modeButtons.forEach((b) => {
      const on = b.dataset.mode === settings.mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-pressed', on);
    });
    els.newGame.textContent = explore ? 'Reset board' : 'New game';
    els.undo.textContent = explore ? 'Take back' : 'Undo';
    els.draw.classList.toggle('hidden', explore);
    els.resign.classList.toggle('hidden', explore);
  }

  function displayCoords(r, c) {
    return settings.flipped ? { row: 7 - r, col: 7 - c } : { row: r, col: c };
  }

  function renderBoard(animation) {
    const idx = shownIndex();
    const state = game.states[idx];
    const last = idx > 0 ? game.history[idx - 1] : null;
    const checkedKing = C.inCheck(state.board, state.turn) ? C.findKing(state.board, state.turn) : null;
    const interactive = boardInteractive();
    const badge = last && reviewEnabled() ? classify(idx - 1) : null;
    const html = [];

    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const r = settings.flipped ? 7 - i : i;
        const c = settings.flipped ? 7 - j : j;
        const piece = state.board[r][c];
        const classes = ['square', (r + c) % 2 === 0 ? 'light' : 'dark'];

        if (last && ((last.move.from.r === r && last.move.from.c === c) || (last.move.to.r === r && last.move.to.c === c))) {
          classes.push('last-move');
        }
        if (interactive && selected && selected.r === r && selected.c === c) classes.push('selected');
        const target = interactive && targetAt(r, c);
        if (target) classes.push('target', piece || target.enPassant ? 'capture' : 'quiet');
        if (checkedKing && checkedKing.r === r && checkedKing.c === c) classes.push('in-check');
        if (interactive && piece && piece.color === state.turn) classes.push('movable');

        let inner = '';
        if (j === 0) inner += `<span class="coord rank">${8 - r}</span>`;
        if (i === 7) inner += `<span class="coord file">${C.FILES[c]}</span>`;
        if (piece) inner += pieceImg(piece);
        if (badge && CLASSES[badge] && last.move.to.r === r && last.move.to.c === c) {
          inner += `<span class="badge ${badge}" title="${CLASSES[badge].label}">${CLASSES[badge].symbol}</span>`;
        }

        const label = C.squareName(r, c) + (piece ? ` ${COLOR_NAMES[piece.color]} ${PIECE_NAMES[piece.type]}` : '');
        html.push(`<div class="${classes.join(' ')}" data-r="${r}" data-c="${c}" aria-label="${label}">${inner}</div>`);
      }
    }
    els.board.innerHTML = html.join('');
    els.board.classList.toggle('reviewing', !interactive);
    if (animation) animateMove(animation.move, animation.reverse);
  }

  function squareEl(r, c) {
    return els.board.querySelector(`.square[data-r="${r}"][data-c="${c}"]`);
  }

  /** Slide the moved piece (and the rook when castling) into place. */
  function animateMove(move, reverse) {
    const slide = (a, b) => {
      const target = squareEl(b.r, b.c);
      const origin = squareEl(a.r, a.c);
      const piece = target && target.querySelector('.piece');
      if (!piece || !origin || !piece.animate) return;
      const ra = origin.getBoundingClientRect();
      const rb = target.getBoundingClientRect();
      target.classList.add('animating');
      const anim = piece.animate(
        [{ transform: `translate(${ra.left - rb.left}px, ${ra.top - rb.top}px)` }, { transform: 'translate(0, 0)' }],
        { duration: ANIMATION_MS, easing: 'ease-out' }
      );
      anim.onfinish = anim.oncancel = () => target.classList.remove('animating');
    };
    const [a, b] = reverse ? [move.to, move.from] : [move.from, move.to];
    slide(a, b);
    if (move.castle) {
      const row = move.from.r;
      const rookFrom = { r: row, c: move.castle === 'K' ? 7 : 0 };
      const rookTo = { r: row, c: move.castle === 'K' ? 5 : 3 };
      if (reverse) slide(rookTo, rookFrom);
      else slide(rookFrom, rookTo);
    }
  }

  function renderArrows() {
    const state = shownState();
    const arrows = [];
    if (isExplore()) {
      if (settings.exploreEngine && live.state === state) {
        live.lines.forEach((line, i) => {
          if (line.pv[0]) arrows.push({ uci: line.pv[0], cls: i === 0 ? 'best-arrow' : 'alt-arrow' });
        });
      }
    } else if (reviewEnabled()) {
      const entry = game.analysis[shownIndex()];
      if (entry && entry.best) arrows.push({ uci: entry.best, cls: 'best-arrow' });
    }
    // Draw weaker suggestions first so the best one ends up on top.
    els.arrows.innerHTML = arrows.reverse().map(({ uci, cls }) => {
      const found = C.moveFromUCI(state, uci);
      return found ? arrowSVG(found.move.from, found.move.to, cls) : '';
    }).join('');
  }

  function arrowSVG(from, to, cls) {
    const a = displayCoords(from.r, from.c);
    const b = displayCoords(to.r, to.c);
    const x1 = a.col + 0.5, y1 = a.row + 0.5, x2 = b.col + 0.5, y2 = b.row + 0.5;
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len;
    const px = -uy, py = ux;
    const head = 0.42, headW = 0.26, shaftW = 0.09;
    const sx = x1 + ux * 0.2, sy = y1 + uy * 0.2;        // start a little off-centre
    const bx = x2 - ux * head, by = y2 - uy * head;       // base of the arrow head
    const pts = [
      [sx + px * shaftW, sy + py * shaftW],
      [bx + px * shaftW, by + py * shaftW],
      [bx + px * headW, by + py * headW],
      [x2, y2],
      [bx - px * headW, by - py * headW],
      [bx - px * shaftW, by - py * shaftW],
      [sx - px * shaftW, sy - py * shaftW],
    ];
    return `<polygon class="${cls}" points="${pts.map((p) => p.map((n) => n.toFixed(3)).join(',')).join(' ')}"/>`;
  }

  function renderPlayerBars() {
    const topColor = settings.flipped ? 'w' : 'b';
    renderPlayerBar(els.barTop, topColor);
    renderPlayerBar(els.barBottom, C.other(topColor));
  }

  function renderPlayerBar(el, color) {
    const idx = shownIndex();
    const board = game.states[idx].board;
    // Pieces captured BY `color` up to the shown position.
    const taken = game.history.slice(0, idx)
      .filter((h) => h.captured && h.color === color)
      .map((h) => h.captured)
      .sort((a, b) => VALUES[b.type] - VALUES[a.type]);

    const material = (col) => board.flat().filter((p) => p && p.color === col).reduce((s, p) => s + VALUES[p.type], 0);
    const advantage = material(color) - material(C.other(color));
    const name = playerName(color);
    const pts = score[name];
    const toMove = !game.result && shownState().turn === color && (isLive() || isExplore());
    const showScore = !isExplore() && !game.imported && pts !== undefined;
    const showClock = !isExplore() && game.clocks;

    el.innerHTML = `
      <div class="player-name${toMove ? ' to-move' : ''}">
        <span class="swatch ${color}"></span>
        <span class="name">${escapeHTML(name)}</span>
        ${showScore ? `<span class="score" title="Points">${formatPoints(pts)}</span>` : ''}
      </div>
      <div class="captured">
        ${taken.map((p) => pieceImg(p, 'mini')).join('')}
        ${advantage > 0 ? `<span class="advantage">+${advantage}</span>` : ''}
      </div>
      <div class="clock ${showClock ? '' : 'hidden'}" id="clock-${color}"></div>`;
  }

  function formatPoints(p) {
    const whole = Math.floor(p);
    const half = p - whole >= 0.5;
    return half ? (whole ? `${whole}½` : '½') : String(whole);
  }

  function renderStatus() {
    const state = shownState();
    els.status.className = 'status';

    if (!isLive() && !isExplore()) {
      els.status.classList.add('reviewing');
      const idx = shownIndex();
      const label = idx === 0 ? 'the start position' : `${moveLabel(idx - 1)}`;
      els.status.innerHTML = `Reviewing ${escapeHTML(label)} <button class="link" id="back-live">Back to the end ⏭</button>`;
      $('back-live').addEventListener('click', () => goTo(lastIndex()));
      return;
    }
    if (game.result && isLive()) {
      els.status.classList.add('over');
      els.status.textContent = `${game.result.title} — ${game.result.reason}`;
      return;
    }
    const check = C.inCheck(state.board, state.turn);
    if (check) els.status.classList.add('check');
    els.status.innerHTML =
      `<span class="turn-dot ${state.turn}"></span>` +
      `${escapeHTML(playerName(state.turn))} to move${check ? ' — Check!' : ''}` +
      (isExplore() ? '<span class="mode-tag">Explore</span>' : '');
  }

  /** "12. Nf3" or "12... Nc6" for history index i. */
  function moveLabel(i) {
    const start = game.states[0];
    const ply = i + (start.turn === 'b' ? 1 : 0);
    const num = start.fullmove + Math.floor(ply / 2);
    return `${num}${ply % 2 === 0 ? '.' : '...'} ${game.history[i].san}`;
  }

  function renderMoves() {
    const { history } = game;
    if (!history.length) {
      els.moves.innerHTML = `<li class="empty">${isExplore()
        ? 'Make moves for both sides to explore. Tap a book move below to follow a known opening.'
        : 'No moves yet. White starts.'}</li>`;
      return;
    }
    const shown = shownIndex();
    const showAnnotations = reviewEnabled();
    const offset = game.states[0].turn === 'b' ? 1 : 0; // games from a FEN may start with Black
    const cell = (i) => {
      if (i < 0 || i >= history.length) return '<span></span>';
      const cls = showAnnotations ? classify(i) : null;
      const info = CLASSES[cls];
      const annot = info && cls !== 'best' ? `<span class="annot ${cls}" title="${info.label}">${info.symbol}</span>` : '';
      return `<button class="move${shown === i + 1 ? ' current' : ''}" data-index="${i + 1}">${history[i].san}${annot}</button>`;
    };
    const rows = [];
    for (let p = 0; p < history.length + offset; p += 2) {
      const num = game.states[0].fullmove + p / 2;
      rows.push(`<li><span class="num">${num}.</span>${cell(p - offset)}${cell(p + 1 - offset)}</li>`);
    }
    els.moves.innerHTML = rows.join('');
    scrollMoveListTo(els.moves.querySelector('.current'));
  }

  /** Scroll only inside the move list, never the page itself. */
  function scrollMoveListTo(el) {
    const list = els.moves;
    if (!el) {
      list.scrollTop = list.scrollHeight;
      return;
    }
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight;
  }

  function renderSettings() {
    if (document.activeElement !== els.nameW) els.nameW.value = settings.names.w;
    if (document.activeElement !== els.nameB) els.nameB.value = settings.names.b;
    els.timeControl.value = settings.timeControl;
    els.depth.value = String(settings.depth);
    els.autoFlip.checked = settings.autoFlip;
    els.soundOn.checked = settings.sound;
    Sound.enabled = settings.sound;

    const w = settings.names.w, b = settings.names.b;
    els.scoreLine.textContent = `Score: ${w} ${formatPoints(score[w] || 0)} – ${formatPoints(score[b] || 0)} ${b}`;
  }

  function currentTab() {
    const tab = settings.tabs[settings.mode] || 'moves';
    // The Analysis tab belongs to Play mode, the Engine tab to Explore mode.
    if (isExplore() && tab === 'analysis') return 'engine';
    if (!isExplore() && tab === 'engine') return 'analysis';
    return tab;
  }

  function renderTabs() {
    const active = currentTab();
    els.tabs.forEach((t) => {
      const name = t.dataset.tab;
      const available = isExplore() ? name !== 'analysis' : name !== 'engine';
      t.classList.toggle('hidden', !available);
      const on = name === active;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on);
      $(`tab-${name}`).classList.toggle('hidden', !on);
    });
  }

  // ---------- Navigation ----------

  function goTo(index) {
    const target = Math.max(0, Math.min(lastIndex(), index));
    const from = shownIndex();
    if (target === from) return;
    clearSelection();
    game.view = target === lastIndex() ? null : target;

    let animation = null;
    if (target === from + 1) {
      animation = { move: game.history[from].move, reverse: false };
      Sound.play(soundFor(game.history[from], game.states[target]));
    } else if (target === from - 1) {
      animation = { move: game.history[target].move, reverse: true };
    }
    render({ animation });
  }

  // ---------- Evaluation helpers ----------

  function winChance(entry) {
    if (!entry) return 0;
    if (entry.terminal === 'checkmate') return entry.winner === 'w' ? 1 : -1;
    if (entry.terminal === 'draw') return 0;
    if (entry.mate !== undefined) return entry.mate > 0 ? 1 : entry.mate < 0 ? -1 : 0;
    return 2 / (1 + Math.exp(-0.00368208 * entry.cp)) - 1;
  }

  function formatEval(entry, { long = false } = {}) {
    if (!entry) return '–';
    if (entry.terminal === 'checkmate') return entry.winner === 'w' ? '1-0' : '0-1';
    if (entry.terminal === 'draw') return '½-½';
    if (entry.mate !== undefined) return `${entry.mate < 0 ? '-' : ''}M${Math.abs(entry.mate)}`;
    const v = entry.cp / 100;
    return (v > 0 ? '+' : '') + v.toFixed(long ? 2 : 1);
  }

  /** Convert an engine score (side to move's view) to White's point of view. */
  function whiteScore(score, turn) {
    const sign = turn === 'w' ? 1 : -1;
    return score.mate !== undefined ? { mate: score.mate * sign } : { cp: score.cp * sign };
  }

  function terminalEntry(state) {
    const status = C.getStatus(state);
    if (status === 'checkmate') return { terminal: 'checkmate', winner: C.other(state.turn) };
    if (status === 'stalemate' || status === 'insufficient') return { terminal: 'draw' };
    return null;
  }

  function renderEvalBar() {
    let entry = null, show = false;
    if (isExplore()) {
      show = settings.exploreEngine;
      if (live.state === shownState()) entry = live.terminal || (live.lines[0] ? live.lines[0].eval : null);
    } else if (reviewEnabled() && game.analysis.some(Boolean)) {
      show = true;
      entry = game.analysis[shownIndex()];
    }
    els.evalBar.classList.toggle('invisible', !show);
    if (!show) return;
    const whitePct = 50 + 50 * winChance(entry);
    els.evalBar.classList.toggle('flipped', settings.flipped);
    els.evalBar.querySelector('.eval-fill').style.height = `${whitePct}%`;
    const label = els.evalBar.querySelector('.eval-label');
    label.textContent = formatEval(entry).replace(/^\+/, '');
    // Put the number on the side that is ahead, like most chess sites.
    label.classList.toggle('white-side', whitePct >= 50);
  }

  // ---------- Game review (Play mode, after the game) ----------

  /** Classification of history[i]: 'best' | 'good' | 'inaccuracy' | 'mistake' | 'blunder' | null. */
  function classify(i) {
    const before = game.analysis[i], after = game.analysis[i + 1];
    if (!before || !after) return null;
    const move = game.history[i];
    if (before.best && before.best === move.uci) return 'best';
    const sign = move.color === 'w' ? 1 : -1;
    const loss = sign * (winChance(before) - winChance(after));
    if (loss >= CLASSES.blunder.threshold) return 'blunder';
    if (loss >= CLASSES.mistake.threshold) return 'mistake';
    if (loss >= CLASSES.inaccuracy.threshold) return 'inaccuracy';
    return 'good';
  }

  /** Lichess-style move accuracy (0-100) from the change in winning percentage. */
  function moveAccuracy(i) {
    const move = game.history[i];
    const sign = move.color === 'w' ? 1 : -1;
    const winBefore = 50 + 50 * sign * winChance(game.analysis[i]);
    const winAfter = 50 + 50 * sign * winChance(game.analysis[i + 1]);
    const acc = 103.1668 * Math.exp(-0.04354 * Math.max(0, winBefore - winAfter)) - 3.1669;
    return Math.max(0, Math.min(100, acc));
  }

  function analyzedCount() {
    let n = 0;
    for (let i = 0; i < game.states.length; i++) if (game.analysis[i]) n++;
    return n;
  }

  async function runAnalysis() {
    if (analysis.running || !reviewEnabled()) return;
    const token = ++analysis.token;
    const g = game;
    analysis.running = true;
    analysis.error = null;
    refreshAnalysisViews();

    try {
      for (let i = 0; i < g.states.length; i++) {
        if (token !== analysis.token) return;
        if (g.analysis[i]) continue;
        const state = g.states[i];
        let entry = terminalEntry(state);
        if (!entry) {
          const res = await engine.analyze(C.toFEN(state), { depth: settings.depth });
          // Ignore the result if the game changed while Stockfish was thinking.
          if (token !== analysis.token || g.states[i] !== state || !res) return;
          entry = { ...whiteScore(res.score, state.turn), best: res.bestmove, pv: res.pv.slice(0, 10), depth: res.depth };
        }
        g.analysis[i] = entry;
        refreshAnalysisViews();
      }
    } catch (err) {
      analysis.error = err.message || String(err);
    } finally {
      if (token === analysis.token) {
        analysis.running = false;
        refreshAnalysisViews();
        save();
      }
    }
  }

  function cancelAnalysis() {
    if (analysis.running) engine.stop();
    analysis.token++;
    analysis.running = false;
  }

  /** Update everything that shows analysis, without disturbing a drag in progress. */
  function refreshAnalysisViews() {
    if (!drag) renderBoard(null);
    renderArrows();
    renderEvalBar();
    renderMoves();
    renderAnalysis();
  }

  function renderAnalysis() {
    if (isExplore()) return;
    const enabled = reviewEnabled();
    els.analysisLocked.classList.toggle('hidden', enabled);
    for (const el of [els.analyze, els.summary, els.positionInfo]) el.classList.toggle('hidden', !enabled);
    if (!enabled) {
      els.progress.classList.add('hidden');
      els.analysisError.classList.add('hidden');
      els.graph.classList.add('hidden');
      return;
    }

    const total = game.states.length;
    const done = analyzedCount();
    const complete = done === total;

    els.analyze.disabled = analysis.running || game.history.length === 0 || complete;
    els.analyze.textContent = analysis.running
      ? `Analyzing… ${Math.round((done / total) * 100)}%`
      : game.history.length === 0
        ? 'No moves to analyze'
        : complete
          ? `Analyzed by ${engine.name.replace(/ WASM$/, '')}`
          : 'Analyze game with Stockfish 19';

    els.progress.classList.toggle('hidden', !analysis.running);
    els.progress.querySelector('.progress-fill').style.width = `${(done / total) * 100}%`;
    els.analysisError.classList.toggle('hidden', !analysis.error);
    els.analysisError.textContent = analysis.error || '';

    renderSummary();
    renderGraph();
    renderPositionInfo();
  }

  function renderSummary() {
    const blank = () => ({ acc: [], inaccuracy: 0, mistake: 0, blunder: 0, best: 0 });
    const stats = { w: blank(), b: blank() };
    let any = false;
    game.history.forEach((m, i) => {
      const cls = classify(i);
      if (!cls) return;
      any = true;
      const s = stats[m.color];
      s.acc.push(moveAccuracy(i));
      if (s[cls] !== undefined) s[cls]++;
    });
    if (!any) {
      els.summary.innerHTML = game.history.length
        ? '<p class="hint">Stockfish checks every move and marks inaccuracies (?!), mistakes (?) and blunders (??). The green arrow shows the best move in each position.</p>'
        : '';
      return;
    }
    const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : '–');
    const row = (label, key) =>
      `<tr><th>${label}</th><td class="${key}">${stats.w[key]}</td><td class="${key}">${stats.b[key]}</td></tr>`;
    els.summary.innerHTML = `
      <table class="summary">
        <thead><tr><th></th><th>${escapeHTML(playerName('w'))}</th><th>${escapeHTML(playerName('b'))}</th></tr></thead>
        <tbody>
          <tr><th>Accuracy</th><td class="acc">${avg(stats.w.acc)}%</td><td class="acc">${avg(stats.b.acc)}%</td></tr>
          ${row('★ Best moves', 'best')}
          ${row('?! Inaccuracies', 'inaccuracy')}
          ${row('? Mistakes', 'mistake')}
          ${row('?? Blunders', 'blunder')}
        </tbody>
      </table>`;
  }

  function renderGraph() {
    const n = lastIndex();
    const any = n > 0 && game.analysis.some(Boolean);
    els.graph.classList.toggle('hidden', !any);
    if (!any) return;
    els.graph.setAttribute('viewBox', `0 0 ${n} 100`);

    const pts = [];
    for (let i = 0; i <= n; i++) {
      if (!game.analysis[i]) continue;
      pts.push(`${i},${(50 - 50 * winChance(game.analysis[i])).toFixed(2)}`);
    }
    const firstX = pts.length ? pts[0].split(',')[0] : 0;
    const lastX = pts.length ? pts[pts.length - 1].split(',')[0] : 0;
    const markers = game.history.map((_, i) => {
      const cls = classify(i);
      if (cls !== 'mistake' && cls !== 'blunder') return '';
      return `<line class="mark ${cls}" x1="${i + 1}" x2="${i + 1}" y1="0" y2="100"/>`;
    }).join('');
    const cur = shownIndex();
    els.graph.innerHTML = `
      <rect class="bg" x="0" y="0" width="${n}" height="100"/>
      ${markers}
      <polygon class="area" points="${firstX},100 ${pts.join(' ')} ${lastX},100"/>
      <line class="mid" x1="0" x2="${n}" y1="50" y2="50"/>
      <line class="cursor" x1="${cur}" x2="${cur}" y1="0" y2="100"/>`;
  }

  function renderPositionInfo() {
    const idx = shownIndex();
    const entry = game.analysis[idx];
    const state = game.states[idx];
    const parts = [];

    if (idx > 0) {
      const cls = classify(idx - 1);
      const prev = game.analysis[idx - 1];
      if (cls && cls !== 'good') {
        const label = moveLabel(idx - 1);
        let text = cls === 'best' ? `${label} was the best move.` : `${label} is ${cls === 'inaccuracy' ? 'an' : 'a'} ${CLASSES[cls].label.toLowerCase()}.`;
        if (cls !== 'best' && prev && prev.best) {
          const bestSan = uciToSan(game.states[idx - 1], prev.best);
          if (bestSan) text += ` Best was <b>${bestSan}</b>.`;
        }
        parts.push(`<p class="verdict ${cls}">${text}</p>`);
      }
    }

    if (entry) {
      if (entry.terminal) {
        parts.push(`<p><b>${entry.terminal === 'checkmate' ? 'Checkmate' : 'Draw'}</b> — ${formatEval(entry)}</p>`);
      } else {
        const line = pvToSan(state, entry.pv || [], 8);
        parts.push(`
          <p class="engine-line"><span class="eval-chip">${formatEval(entry, { long: true })}</span>
          Best: <b>${uciToSan(state, entry.best) || '–'}</b> <small>depth ${entry.depth}</small></p>
          ${line ? `<p class="pv">${line}</p>` : ''}`);
      }
    } else if (game.analysis.some(Boolean)) {
      parts.push('<p class="hint">This position has not been analyzed yet.</p>');
    }
    els.positionInfo.innerHTML = parts.join('');
  }

  function uciToSan(state, uci) {
    const found = uci && C.moveFromUCI(state, uci);
    return found ? C.toSAN(state, found.move, found.promotionType) : null;
  }

  function pvToSan(state, pv, limit) {
    const out = [];
    let s = state;
    for (const uci of pv.slice(0, limit)) {
      const found = C.moveFromUCI(s, uci);
      if (!found) break;
      const san = C.toSAN(s, found.move, found.promotionType);
      if (s.turn === 'w') out.push(`${s.fullmove}. ${san}`);
      else out.push(out.length ? san : `${s.fullmove}... ${san}`);
      s = C.makeMove(s, found.move, found.promotionType).state;
    }
    return out.join(' ');
  }

  els.graph.addEventListener('click', (e) => {
    const rect = els.graph.getBoundingClientRect();
    goTo(Math.round(((e.clientX - rect.left) / rect.width) * lastIndex()));
  });

  // ---------- Live engine (Explore mode) ----------

  /** Keep Stockfish analysing whatever position is shown in Explore mode. */
  function updateLiveAnalysis() {
    if (!isExplore() || !settings.exploreEngine) {
      if (live.state) stopLive();
      return;
    }
    const state = shownState();
    if (live.state === state) return;
    stopLive();
    live.state = state;
    live.fen = C.toFEN(state);
    live.lines = [];
    live.error = null;
    live.terminal = terminalEntry(state);
    if (live.terminal) {
      renderLive();
      return;
    }

    const token = ++live.token;
    const isCurrent = () => token === live.token;
    let lastPaint = 0;
    live.running = true;
    engine.analyze(live.fen, {
      depth: LIVE_DEPTH,
      multiPV: LIVE_LINES,
      cancelled: () => !isCurrent(),
      onInfo: (lines) => {
        if (!isCurrent()) return;
        live.lines = lines.map((l) => ({ eval: whiteScore(l.score, state.turn), pv: l.pv, depth: l.depth }));
        const now = performance.now();
        if (now - lastPaint > 150) {
          lastPaint = now;
          renderLive();
        }
      },
    }).then((res) => {
      if (!isCurrent()) return;
      live.running = false;
      if (res) live.lines = res.lines.map((l) => ({ eval: whiteScore(l.score, state.turn), pv: l.pv, depth: l.depth }));
      renderLive();
    }).catch((err) => {
      if (!isCurrent()) return;
      live.running = false;
      live.error = err.message || String(err);
      renderLive();
    });
    renderLive();
  }

  function stopLive() {
    if (live.running) engine.stop();
    live.token++;
    live.running = false;
    live.state = null;
    live.lines = [];
    live.terminal = null;
  }

  function renderLive() {
    renderArrows();
    renderEvalBar();
    renderEngine();
  }

  function renderEngine() {
    if (!isExplore()) return;
    els.engineOn.checked = settings.exploreEngine;
    if (!settings.exploreEngine) {
      els.engineLines.innerHTML = '<p class="hint">Turn on Stockfish to see the evaluation and the best moves for any position you set up. It keeps thinking as you move.</p>';
      return;
    }
    if (live.error) {
      els.engineLines.innerHTML = `<p class="error">${escapeHTML(live.error)}</p>`;
      return;
    }
    if (live.terminal) {
      els.engineLines.innerHTML = `<p><b>${live.terminal.terminal === 'checkmate' ? 'Checkmate' : 'Draw'}</b> — ${formatEval(live.terminal)}</p>`;
      return;
    }
    const state = shownState();
    if (live.state !== state || !live.lines.length) {
      els.engineLines.innerHTML = '<p class="hint">Stockfish is thinking…</p>';
      return;
    }
    const depth = Math.max(...live.lines.map((l) => l.depth));
    els.engineLines.innerHTML = `
      <p class="engine-status">${escapeHTML(engine.name.replace(/ WASM$/, ''))} · depth ${depth}${live.running ? ' <span class="spinner" aria-hidden="true"></span>' : ''}</p>
      <ol class="engine-lines">${live.lines.map((l, i) => `
        <li><button class="engine-line-btn" data-i="${i}" title="Play the first move of this line">
          <span class="eval-chip${i ? ' alt' : ''}">${formatEval(l.eval, { long: true })}</span>
          <span class="pv">${pvToSan(state, l.pv, 10)}</span>
        </button></li>`).join('')}
      </ol>`;
  }

  els.engineLines.addEventListener('click', (e) => {
    const btn = e.target.closest('.engine-line-btn');
    if (!btn || !boardInteractive()) return;
    const line = live.lines[Number(btn.dataset.i)];
    const found = line && C.moveFromUCI(shownState(), line.pv[0]);
    if (found) playMove(found.move, found.promotionType);
  });

  els.engineOn.addEventListener('change', () => {
    settings.exploreEngine = els.engineOn.checked;
    render();
    save();
  });

  // ---------- PGN ----------

  function buildPGN() {
    const headers = {
      Event: isExplore() ? 'Analysis' : 'Casual game',
      Site: 'Chess for Two',
      Date: game.date,
      Round: '-',
      ...(game.headers || {}),
      White: playerName('w'),
      Black: playerName('b'),
      Result: game.result ? game.result.code : '*',
    };
    if (game.timeControl) headers.TimeControl = `${game.timeControl.minutes * 60}+${game.timeControl.increment}`;
    if (game.startFen !== C.START_FEN) {
      headers.SetUp = '1';
      headers.FEN = game.startFen;
    }
    const op = openingAt(lastIndex());
    if (op) {
      headers.ECO = op.eco;
      headers.Opening = op.name;
    }

    const review = reviewEnabled();
    const moves = game.history.map((h, i) => {
      const bits = [];
      const cls = review ? classify(i) : null;
      const info = CLASSES[cls];
      if (info && cls !== 'best') {
        const best = uciToSan(game.states[i], game.analysis[i].best);
        bits.push(`${info.label}.${best ? ` ${best} was best.` : ''}`);
      }
      if (review && game.analysis[i + 1] && !game.analysis[i + 1].terminal) {
        const e = game.analysis[i + 1];
        bits.push(`[%eval ${e.mate !== undefined ? '#' + e.mate : (e.cp / 100).toFixed(2)}]`);
      }
      if (game.clocks && game.clocks[i + 1]) {
        const t = Math.max(0, Math.round(game.clocks[i + 1][h.color] / 1000));
        const hms = `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
        bits.push(`[%clk ${hms}]`);
      }
      return { san: h.san + (info && cls !== 'best' ? info.symbol : ''), comment: bits.join(' ') || undefined };
    });
    return C.toPGN(headers, moves, headers.Result, game.states[0]);
  }

  function importPGN(text) {
    const { headers, sans } = C.parsePGN(text);
    const startFen = headers.FEN || C.START_FEN;
    let start;
    try {
      start = C.fromFEN(startFen);
    } catch (err) {
      throw new Error('The FEN header is not valid.');
    }
    const g = blankGame(start, null);
    sans.forEach((san, i) => {
      const found = C.moveFromSAN(g.states[g.states.length - 1], san);
      if (!found) throw new Error(`Move ${i + 1} ("${san}") is not legal in that position.`);
      appendMove(g, found.move, found.promotionType);
    });
    if (!sans.length && !headers.FEN) throw new Error('No moves found in that text.');

    cancelAnalysis();
    stopLive();
    clock.running = false;
    if (isExplore()) {
      // Explore: just load the line onto the board.
      setGame(g);
      resetTransientState();
      render();
      save();
      return;
    }

    g.imported = true;
    g.players = { w: headers.White || 'White', b: headers.Black || 'Black' };
    g.headers = {};
    for (const key of ['Event', 'Site', 'Date', 'Round']) if (headers[key]) g.headers[key] = headers[key];
    if (headers.Date) g.date = headers.Date;
    setGame(g);
    resetTransientState();

    const code = headers.Result;
    if (code === '1-0' || code === '0-1' || code === '1/2-1/2') {
      const winner = code === '1-0' ? 'w' : code === '0-1' ? 'b' : null;
      game.result = { title: winner ? `${playerName(winner)} won` : 'Draw', reason: 'Imported game.', winner, code };
    } else {
      checkGameEnd(); // an unfinished game may still end in mate on the board
    }
    hideModal(els.gameOver);
    settings.tabs.play = 'moves';
    game.view = game.history.length ? 0 : null; // start the review from the first position
    render();
    save();
  }

  function showToast(text) {
    els.toast.textContent = text;
    els.toast.classList.remove('hidden');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => els.toast.classList.add('hidden'), 2200);
  }

  els.copyPgn.addEventListener('click', async () => {
    const pgn = buildPGN();
    try {
      await navigator.clipboard.writeText(pgn);
      showToast('PGN copied to the clipboard');
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = pgn;
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      showToast(ok ? 'PGN copied to the clipboard' : 'Could not copy — use Download instead');
    }
  });

  els.downloadPgn.addEventListener('click', () => {
    const blob = new Blob([buildPGN()], { type: 'application/x-chess-pgn' });
    const a = document.createElement('a');
    const safe = (s) => s.replace(/[^\w-]+/g, '_');
    a.href = URL.createObjectURL(blob);
    a.download = isExplore()
      ? `analysis_${game.date.replace(/\./g, '-')}.pgn`
      : `${safe(playerName('w'))}_vs_${safe(playerName('b'))}_${game.date.replace(/\./g, '-')}.pgn`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  els.importPgn.addEventListener('click', () => {
    els.importError.classList.add('hidden');
    showModal(els.importDialog);
    els.pgnInput.focus({ preventScroll: true });
  });
  els.importCancel.addEventListener('click', () => hideModal(els.importDialog));
  els.pgnFile.addEventListener('change', async () => {
    const file = els.pgnFile.files[0];
    if (file) els.pgnInput.value = await file.text();
    els.pgnFile.value = '';
  });
  els.importLoad.addEventListener('click', () => {
    const text = els.pgnInput.value.trim();
    if (!text) return;
    if (!isExplore() && game.history.length && !game.result && !game.imported &&
        !confirm('Load this game? The game in progress will be lost.')) return;
    try {
      importPGN(text);
      hideModal(els.importDialog);
      els.pgnInput.value = '';
      showToast(isExplore() ? 'Line loaded onto the board' : 'Game loaded — use ▶ or → to step through it');
    } catch (err) {
      els.importError.textContent = err.message;
      els.importError.classList.remove('hidden');
    }
  });

  // ---------- Promotion dialog ----------

  function showPromotion(color) {
    els.promoChoices.innerHTML = C.PROMOTION_TYPES.map((t) =>
      `<button type="button" data-type="${t}" aria-label="${PIECE_NAMES[t]}">${pieceImg({ type: t, color })}</button>`
    ).join('');
    showModal(els.promotion);
    els.promoChoices.querySelector('button').focus({ preventScroll: true });
  }

  function cancelPromotion() {
    pendingPromotion = null;
    hideModal(els.promotion);
    renderBoard(null);
  }

  els.promoChoices.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !pendingPromotion) return;
    const { move, animate } = pendingPromotion;
    hideModal(els.promotion);
    playMove(move, btn.dataset.type, { animate });
  });

  els.promotion.addEventListener('click', (e) => {
    if (e.target === els.promotion) cancelPromotion();
  });

  function showModal(el) { el.classList.remove('hidden'); }
  function hideModal(el) { el.classList.add('hidden'); }
  const anyModalOpen = () => [els.promotion, els.gameOver, els.importDialog].some((m) => !m.classList.contains('hidden'));

  // ---------- Board interaction (click and drag) ----------

  function squareFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    const sq = el && el.closest('.square');
    return sq && els.board.contains(sq) ? { r: Number(sq.dataset.r), c: Number(sq.dataset.c) } : null;
  }

  els.board.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || pendingPromotion) return;
    if (!boardInteractive()) {
      if (!isLive() && !game.result) showToast('Reviewing an earlier move. Press ⏭ to return to the game.');
      return;
    }
    const sq = e.target.closest('.square');
    if (!sq) return;
    e.preventDefault();

    const r = Number(sq.dataset.r), c = Number(sq.dataset.c);
    const state = shownState();

    const target = selected && targetAt(r, c);
    if (target) {
      tryMove(target);
      return;
    }

    const piece = state.board[r][c];
    if (piece && piece.color === state.turn) {
      const wasSelected = !!selected && selected.r === r && selected.c === c;
      select(r, c);
      renderBoard(null);
      drag = { r, c, piece, wasSelected, startX: e.clientX, startY: e.clientY, moved: false, ghost: null, hover: null };
    } else {
      clearSelection();
      renderBoard(null);
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
      drag.moved = true;
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'drag-ghost';
      drag.ghost.innerHTML = pieceImg(drag.piece);
      document.body.appendChild(drag.ghost);
      const origin = squareEl(drag.r, drag.c);
      if (origin) origin.classList.add('drag-origin');
    }
    drag.ghost.style.left = `${e.clientX}px`;
    drag.ghost.style.top = `${e.clientY}px`;

    const over = squareFromPoint(e.clientX, e.clientY);
    const overEl = over && targetAt(over.r, over.c) ? squareEl(over.r, over.c) : null;
    if (drag.hover !== overEl) {
      if (drag.hover) drag.hover.classList.remove('hover');
      drag.hover = overEl;
      if (overEl) overEl.classList.add('hover');
    }
  });

  window.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag;
    cancelDrag();

    if (d.moved) {
      const over = squareFromPoint(e.clientX, e.clientY);
      const target = over && targetAt(over.r, over.c);
      if (target) {
        tryMove(target, { animate: false }); // the piece is already where it was dropped
        return;
      }
    } else if (d.wasSelected) {
      clearSelection(); // clicking the selected piece again deselects it
    }
    renderBoard(null);
  });

  window.addEventListener('pointercancel', () => {
    if (!drag) return;
    cancelDrag();
    renderBoard(null);
  });

  function cancelDrag() {
    if (drag && drag.ghost) drag.ghost.remove();
    drag = null;
  }

  // ---------- Controls ----------

  els.modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));

  els.newGame.addEventListener('click', () => {
    if (!isExplore() && game.history.length && !game.result && !game.imported &&
        !confirm('Start a new game? The current game will be lost.')) return;
    newGame();
  });
  els.rematch.addEventListener('click', newGame);
  els.closeResult.addEventListener('click', () => hideModal(els.gameOver));
  els.review.addEventListener('click', () => {
    hideModal(els.gameOver);
    settings.tabs.play = 'analysis';
    render();
    runAnalysis();
  });
  els.undo.addEventListener('click', undo);
  els.resign.addEventListener('click', resign);
  els.draw.addEventListener('click', offerDraw);
  els.flip.addEventListener('click', () => {
    settings.flipped = !settings.flipped;
    render();
    save();
  });

  els.tabs.forEach((t) => t.addEventListener('click', () => {
    settings.tabs[settings.mode] = t.dataset.tab;
    renderTabs();
    save();
  }));

  els.navFirst.addEventListener('click', () => goTo(0));
  els.navPrev.addEventListener('click', () => goTo(shownIndex() - 1));
  els.navNext.addEventListener('click', () => goTo(shownIndex() + 1));
  els.navLast.addEventListener('click', () => goTo(lastIndex()));
  els.moves.addEventListener('click', (e) => {
    const btn = e.target.closest('.move');
    if (btn) goTo(Number(btn.dataset.index));
  });

  els.analyze.addEventListener('click', runAnalysis);

  const onNameInput = (color, input) => () => {
    settings.names[color] = input.value.trim() || COLOR_NAMES[color];
    renderPlayerBars();
    renderClocks();
    renderStatus();
    renderSettings();
    save();
  };
  els.nameW.addEventListener('input', onNameInput('w', els.nameW));
  els.nameB.addEventListener('input', onNameInput('b', els.nameB));
  els.swap.addEventListener('click', () => {
    settings.names = { w: settings.names.b, b: settings.names.w };
    render();
    save();
  });
  els.resetScore.addEventListener('click', () => {
    if (!confirm('Reset the score for all players?')) return;
    score = {};
    render();
    save();
  });
  els.timeControl.addEventListener('change', () => {
    settings.timeControl = els.timeControl.value;
    // Apply straight away if no move has been played yet.
    const play = games.play;
    if (!isExplore() && play.history.length === 0 && !play.imported) newGame();
    else save();
  });
  els.depth.addEventListener('change', () => {
    settings.depth = Number(els.depth.value);
    save();
  });
  els.autoFlip.addEventListener('change', () => {
    settings.autoFlip = els.autoFlip.checked;
    if (settings.autoFlip && !isExplore()) settings.flipped = current().turn === 'b';
    render();
    save();
  });
  els.soundOn.addEventListener('change', () => {
    settings.sound = els.soundOn.checked;
    Sound.enabled = settings.sound;
    if (settings.sound) Sound.play('move');
    save();
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.closest('input, textarea, select')) return;
    if (e.key === 'Escape') {
      if (pendingPromotion) cancelPromotion();
      else if (!els.importDialog.classList.contains('hidden')) hideModal(els.importDialog);
      else if (!els.gameOver.classList.contains('hidden')) hideModal(els.gameOver);
      else if (selected) {
        clearSelection();
        renderBoard(null);
      }
      return;
    }
    if (anyModalOpen()) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      goTo(shownIndex() - 1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      goTo(shownIndex() + 1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      goTo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      goTo(lastIndex());
    }
  });

  // ---------- Start ----------

  if (!load()) {
    games.play = blankGame(C.createInitialState(), parseTimeControl(settings.timeControl));
    games.explore = blankGame(C.createInitialState(), null);
    game = games[settings.mode];
    resetTransientState();
  }
  render();
  loadOpenings();
})();
