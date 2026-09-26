(function () {
  'use strict';

  const C = window.Chess;

  // U+FE0E forces text (not emoji) presentation so pieces can be colored with CSS.
  const GLYPHS = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
  const NAMES = { w: 'White', b: 'Black' };
  const VALUES = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const DRAG_THRESHOLD = 5;

  const $ = (id) => document.getElementById(id);
  const els = {
    board: $('board'),
    barTop: $('bar-top'),
    barBottom: $('bar-bottom'),
    status: $('status'),
    moves: $('moves'),
    newGame: $('btn-new'),
    undo: $('btn-undo'),
    flip: $('btn-flip'),
    draw: $('btn-draw'),
    resign: $('btn-resign'),
    timeControl: $('time-control'),
    autoFlip: $('auto-flip'),
    promotion: $('promotion'),
    promoChoices: $('promo-choices'),
    gameOver: $('game-over'),
    resultTitle: $('result-title'),
    resultReason: $('result-reason'),
    review: $('btn-review'),
    rematch: $('btn-rematch'),
  };

  // ---------- State ----------

  let game;              // { states, history, keys, result }
  let selected = null;   // { r, c }
  let targets = [];      // legal moves of the selected piece
  let flipped = false;
  let pendingPromotion = null;
  let drag = null;
  const clock = { enabled: false, increment: 0, time: { w: 0, b: 0 }, running: false, lastTick: 0 };

  const current = () => game.states[game.states.length - 1];

  function pieceHTML(piece) {
    return `<span class="piece ${piece.color}">${GLYPHS[piece.type]}︎</span>`;
  }

  // ---------- Game flow ----------

  function newGame() {
    const s = C.createInitialState();
    game = { states: [s], history: [], keys: [C.positionKey(s)], result: null };
    selected = null;
    targets = [];
    pendingPromotion = null;
    flipped = false;

    const [minutes, increment] = els.timeControl.value.split(',').map(Number);
    clock.enabled = minutes > 0;
    clock.increment = increment * 1000;
    clock.time.w = clock.time.b = minutes * 60 * 1000;
    clock.running = false;

    hideModal(els.promotion);
    hideModal(els.gameOver);
    render();
  }

  function select(r, c) {
    selected = { r, c };
    targets = C.legalMovesFrom(current(), r, c);
  }

  function clearSelection() {
    selected = null;
    targets = [];
  }

  function targetAt(r, c) {
    return targets.find((m) => m.to.r === r && m.to.c === c);
  }

  function tryMove(move) {
    if (move.promotion) {
      pendingPromotion = move;
      showPromotion(current().turn);
      render();
      return;
    }
    commitMove(move);
  }

  function commitMove(move, promotionType) {
    const state = current();
    const mover = state.turn;
    tickClock();

    const san = C.toSAN(state, move, promotionType);
    const { state: next, captured } = C.makeMove(state, move, promotionType);

    game.states.push(next);
    game.keys.push(C.positionKey(next));
    game.history.push({ san, move, captured, color: mover });

    if (clock.enabled) {
      clock.time[mover] += clock.increment;
      if (!clock.running) {
        clock.running = true;
        clock.lastTick = performance.now();
      }
    }

    clearSelection();
    pendingPromotion = null;
    if (els.autoFlip.checked) flipped = next.turn === 'b';
    checkGameEnd();
    render();
  }

  function checkGameEnd() {
    const state = current();
    const status = C.getStatus(state);
    const winner = C.other(state.turn);

    if (status === 'checkmate') {
      endGame(`${NAMES[winner]} wins`, `Checkmate — ${NAMES[state.turn]} has no way out.`, winner);
    } else if (status === 'stalemate') {
      endGame('Draw', `Stalemate — ${NAMES[state.turn]} has no legal moves.`);
    } else if (status === 'insufficient') {
      endGame('Draw', 'Insufficient material to checkmate.');
    } else if (status === 'fifty') {
      endGame('Draw', '50-move rule — no capture or pawn move in 50 moves.');
    } else {
      const key = game.keys[game.keys.length - 1];
      if (game.keys.filter((k) => k === key).length >= 3) {
        endGame('Draw', 'Threefold repetition.');
      }
    }
  }

  function endGame(title, reason, winner) {
    game.result = { title, reason, winner: winner || null };
    clock.running = false;
    clearSelection();
    els.resultTitle.textContent = title;
    els.resultReason.textContent = reason;
    showModal(els.gameOver);
  }

  function undo() {
    if (pendingPromotion) {
      cancelPromotion();
      return;
    }
    if (game.history.length === 0) return;
    game.states.pop();
    game.keys.pop();
    game.history.pop();
    game.result = null;
    hideModal(els.gameOver);
    clearSelection();

    if (clock.enabled) {
      if (game.history.length === 0) {
        clock.running = false;
      } else {
        clock.running = true;
        clock.lastTick = performance.now();
      }
    }
    if (els.autoFlip.checked) flipped = current().turn === 'b';
    render();
  }

  function resign() {
    if (game.result) return;
    const loser = current().turn;
    const winner = C.other(loser);
    if (!confirm(`${NAMES[loser]}, do you really want to resign?`)) return;
    endGame(`${NAMES[winner]} wins`, `${NAMES[loser]} resigned.`, winner);
    render();
  }

  function offerDraw() {
    if (game.result) return;
    const offerer = current().turn;
    const opponent = C.other(offerer);
    if (!confirm(`${NAMES[offerer]} offers a draw.\n\n${NAMES[opponent]}, do you accept?`)) return;
    endGame('Draw', 'Draw by agreement.');
    render();
  }

  // ---------- Clock ----------

  function tickClock() {
    if (!clock.enabled || !clock.running || game.result) return;
    const now = performance.now();
    const turn = current().turn;
    clock.time[turn] -= now - clock.lastTick;
    clock.lastTick = now;

    if (clock.time[turn] <= 0) {
      clock.time[turn] = 0;
      const winner = C.other(turn);
      // A flag fall is a draw if the opponent could never checkmate.
      if (cannotMate(current().board, winner)) {
        endGame('Draw', `${NAMES[turn]} ran out of time, but ${NAMES[winner]} cannot checkmate.`);
      } else {
        endGame(`${NAMES[winner]} wins`, `${NAMES[turn]} ran out of time.`, winner);
      }
      if (drag) cancelDrag();
      hideModal(els.promotion);
      pendingPromotion = null;
      render();
    }
  }

  function cannotMate(board, color) {
    const pieces = board.flat().filter((p) => p && p.color === color && p.type !== 'k');
    return pieces.length === 0 || (pieces.length === 1 && (pieces[0].type === 'b' || pieces[0].type === 'n'));
  }

  function formatTime(ms) {
    const total = Math.max(0, ms);
    const minutes = Math.floor(total / 60000);
    const seconds = Math.floor((total % 60000) / 1000);
    if (total < 10000) return `0:${String(seconds).padStart(2, '0')}.${Math.floor((total % 1000) / 100)}`;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
  }

  function renderClocks() {
    for (const color of ['w', 'b']) {
      const el = document.getElementById(`clock-${color}`);
      if (!el) continue;
      el.textContent = formatTime(clock.time[color]);
      el.classList.toggle('active', !game.result && current().turn === color && game.history.length > 0);
      el.classList.toggle('low', clock.time[color] < 20000);
    }
  }

  setInterval(() => {
    tickClock();
    if (clock.enabled) renderClocks();
  }, 100);

  // ---------- Rendering ----------

  function render() {
    renderBoard();
    renderPlayerBars();
    renderStatus();
    renderMoves();
    renderClocks();
    els.undo.disabled = game.history.length === 0;
    els.draw.disabled = els.resign.disabled = !!game.result;
  }

  function renderBoard() {
    const state = current();
    const last = game.history.length ? game.history[game.history.length - 1].move : null;
    const checkedKing = C.inCheck(state.board, state.turn) ? C.findKing(state.board, state.turn) : null;
    const html = [];

    for (let i = 0; i < 8; i++) {
      for (let j = 0; j < 8; j++) {
        const r = flipped ? 7 - i : i;
        const c = flipped ? 7 - j : j;
        const piece = state.board[r][c];
        const classes = ['square', (r + c) % 2 === 0 ? 'light' : 'dark'];

        if (last && ((last.from.r === r && last.from.c === c) || (last.to.r === r && last.to.c === c))) {
          classes.push('last-move');
        }
        if (selected && selected.r === r && selected.c === c) classes.push('selected');
        const target = targetAt(r, c);
        if (target) classes.push('target', piece || target.enPassant ? 'capture' : 'quiet');
        if (checkedKing && checkedKing.r === r && checkedKing.c === c) classes.push('in-check');
        if (!game.result && piece && piece.color === state.turn) classes.push('movable');

        let inner = '';
        if (j === 0) inner += `<span class="coord rank">${8 - r}</span>`;
        if (i === 7) inner += `<span class="coord file">${C.FILES[c]}</span>`;
        if (piece) inner += pieceHTML(piece);

        const label = C.squareName(r, c) + (piece ? ` ${NAMES[piece.color]} ${pieceName(piece.type)}` : '');
        html.push(`<div class="${classes.join(' ')}" data-r="${r}" data-c="${c}" aria-label="${label}">${inner}</div>`);
      }
    }
    els.board.innerHTML = html.join('');
  }

  function pieceName(type) {
    return { k: 'king', q: 'queen', r: 'rook', b: 'bishop', n: 'knight', p: 'pawn' }[type];
  }

  function renderPlayerBars() {
    const topColor = flipped ? 'w' : 'b';
    renderPlayerBar(els.barTop, topColor);
    renderPlayerBar(els.barBottom, C.other(topColor));
  }

  function renderPlayerBar(el, color) {
    // Pieces captured BY `color`, i.e. the opponent's lost pieces.
    const taken = game.history
      .filter((h) => h.captured && h.color === color)
      .map((h) => h.captured)
      .sort((a, b) => VALUES[b.type] - VALUES[a.type]);

    const material = (col) => current().board.flat()
      .filter((p) => p && p.color === col)
      .reduce((sum, p) => sum + VALUES[p.type], 0);
    const advantage = material(color) - material(C.other(color));

    el.innerHTML = `
      <div class="player-name"><span class="swatch ${color}"></span>${NAMES[color]}</div>
      <div class="captured">
        ${taken.map(pieceHTML).join('')}
        ${advantage > 0 ? `<span class="advantage">+${advantage}</span>` : ''}
      </div>
      <div class="clock ${clock.enabled ? '' : 'hidden'}" id="clock-${color}"></div>`;
  }

  function renderStatus() {
    const state = current();
    els.status.className = 'status';
    if (game.result) {
      els.status.classList.add('over');
      els.status.innerHTML = `${game.result.title} — ${game.result.reason}`;
      return;
    }
    const check = C.inCheck(state.board, state.turn);
    if (check) els.status.classList.add('check');
    els.status.innerHTML =
      `<span class="turn-dot ${state.turn}"></span>` +
      `${NAMES[state.turn]} to move${check ? ' — Check!' : ''}`;
  }

  function renderMoves() {
    const { history } = game;
    if (!history.length) {
      els.moves.innerHTML = '<li class="empty">No moves yet. White starts.</li>';
      return;
    }
    const rows = [];
    for (let i = 0; i < history.length; i += 2) {
      const cls = (idx) => (idx === history.length - 1 ? ' class="latest"' : '');
      rows.push(
        `<li><span class="num">${i / 2 + 1}.</span>` +
        `<span${cls(i)}>${history[i].san}</span>` +
        `<span${cls(i + 1)}>${history[i + 1] ? history[i + 1].san : ''}</span></li>`
      );
    }
    els.moves.innerHTML = rows.join('');
    els.moves.scrollTop = els.moves.scrollHeight;
  }

  // ---------- Promotion dialog ----------

  function showPromotion(color) {
    els.promoChoices.innerHTML = C.PROMOTION_TYPES.map((t) =>
      `<button type="button" data-type="${t}" aria-label="${pieceName(t)}">${pieceHTML({ type: t, color })}</button>`
    ).join('');
    showModal(els.promotion);
    els.promoChoices.querySelector('button').focus();
  }

  function cancelPromotion() {
    pendingPromotion = null;
    hideModal(els.promotion);
    render();
  }

  els.promoChoices.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !pendingPromotion) return;
    hideModal(els.promotion);
    commitMove(pendingPromotion, btn.dataset.type);
  });

  els.promotion.addEventListener('click', (e) => {
    if (e.target === els.promotion) cancelPromotion();
  });

  function showModal(el) { el.classList.remove('hidden'); }
  function hideModal(el) { el.classList.add('hidden'); }

  // ---------- Board interaction (click and drag) ----------

  function squareFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    const sq = el && el.closest('.square');
    return sq && els.board.contains(sq) ? { r: Number(sq.dataset.r), c: Number(sq.dataset.c) } : null;
  }

  function squareEl(r, c) {
    return els.board.querySelector(`.square[data-r="${r}"][data-c="${c}"]`);
  }

  els.board.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || game.result || pendingPromotion) return;
    const sq = e.target.closest('.square');
    if (!sq) return;
    e.preventDefault();

    const r = Number(sq.dataset.r), c = Number(sq.dataset.c);
    const state = current();

    const target = selected && targetAt(r, c);
    if (target) {
      tryMove(target);
      return;
    }

    const piece = state.board[r][c];
    if (piece && piece.color === state.turn) {
      const wasSelected = !!selected && selected.r === r && selected.c === c;
      select(r, c);
      render();
      drag = { r, c, piece, wasSelected, startX: e.clientX, startY: e.clientY, moved: false, ghost: null, hover: null };
    } else {
      clearSelection();
      render();
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) return;
      drag.moved = true;
      drag.ghost = document.createElement('div');
      drag.ghost.className = 'drag-ghost';
      drag.ghost.innerHTML = pieceHTML(drag.piece);
      document.body.appendChild(drag.ghost);
      const origin = squareEl(drag.r, drag.c);
      if (origin) origin.classList.add('drag-origin');
    }
    drag.ghost.style.left = `${e.clientX}px`;
    drag.ghost.style.top = `${e.clientY}px`;

    const over = squareFromPoint(e.clientX, e.clientY);
    const overEl = over ? squareEl(over.r, over.c) : null;
    if (drag.hover !== overEl) {
      if (drag.hover) drag.hover.classList.remove('hover');
      drag.hover = overEl && targetAt(over.r, over.c) ? overEl : null;
      if (drag.hover) drag.hover.classList.add('hover');
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
        tryMove(target);
        return;
      }
    } else if (d.wasSelected) {
      // Clicking an already-selected piece deselects it.
      clearSelection();
    }
    render();
  });

  window.addEventListener('pointercancel', () => {
    if (!drag) return;
    cancelDrag();
    render();
  });

  function cancelDrag() {
    if (drag && drag.ghost) drag.ghost.remove();
    drag = null;
  }

  // ---------- Controls ----------

  els.newGame.addEventListener('click', () => {
    if (game.history.length && !game.result && !confirm('Start a new game? The current game will be lost.')) return;
    newGame();
  });
  els.rematch.addEventListener('click', newGame);
  els.review.addEventListener('click', () => hideModal(els.gameOver));
  els.undo.addEventListener('click', undo);
  els.resign.addEventListener('click', resign);
  els.draw.addEventListener('click', offerDraw);
  els.flip.addEventListener('click', () => {
    flipped = !flipped;
    render();
  });
  els.autoFlip.addEventListener('change', () => {
    if (els.autoFlip.checked) flipped = current().turn === 'b';
    render();
  });
  els.timeControl.addEventListener('change', () => {
    // Apply immediately if no move has been played yet; otherwise it applies to the next game.
    if (game.history.length === 0) newGame();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (pendingPromotion) cancelPromotion();
      else if (!els.gameOver.classList.contains('hidden')) hideModal(els.gameOver);
      else if (selected) {
        clearSelection();
        render();
      }
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      undo();
    }
  });

  newGame();
})();
