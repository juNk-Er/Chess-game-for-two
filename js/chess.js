/*
 * Chess rules engine.
 *
 * Board representation: board[r][c], r = 0 is rank 8 (Black's back rank),
 * r = 7 is rank 1 (White's back rank), c = 0 is the a-file.
 * A piece is { type: 'p'|'n'|'b'|'r'|'q'|'k', color: 'w'|'b' } or null.
 */
(function (global) {
  'use strict';

  const FILES = 'abcdefgh';
  const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const PROMOTION_TYPES = ['q', 'r', 'b', 'n'];

  const KNIGHT_STEPS = [[-2, -1], [-2, 1], [-1, -2], [-1, 2], [1, -2], [1, 2], [2, -1], [2, 1]];
  const KING_STEPS = [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 1], [1, -1], [1, 0], [1, 1]];
  const ROOK_DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const BISHOP_DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  const other = (color) => (color === 'w' ? 'b' : 'w');
  const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
  const squareName = (r, c) => FILES[c] + (8 - r);

  function emptyBoard() {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }

  function fromFEN(fen) {
    const [placement, turn = 'w', castling = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/);
    const board = emptyBoard();
    placement.split('/').forEach((row, r) => {
      let c = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) {
          c += Number(ch);
        } else {
          board[r][c] = { type: ch.toLowerCase(), color: ch === ch.toUpperCase() ? 'w' : 'b' };
          c++;
        }
      }
    });
    return {
      board,
      turn,
      castling: {
        wK: castling.includes('K'),
        wQ: castling.includes('Q'),
        bK: castling.includes('k'),
        bQ: castling.includes('q'),
      },
      ep: ep !== '-' ? { r: 8 - Number(ep[1]), c: FILES.indexOf(ep[0]) } : null,
      halfmove: Number(half) || 0,
      fullmove: Number(full) || 1,
    };
  }

  function createInitialState() {
    return fromFEN(START_FEN);
  }

  function cloneState(state) {
    return {
      board: state.board.map((row) => row.map((p) => (p ? { ...p } : null))),
      turn: state.turn,
      castling: { ...state.castling },
      ep: state.ep ? { ...state.ep } : null,
      halfmove: state.halfmove,
      fullmove: state.fullmove,
    };
  }

  function findKing(board, color) {
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (p && p.type === 'k' && p.color === color) return { r, c };
      }
    }
    return null;
  }

  /** Is square (r, c) attacked by any piece of color `by`? */
  function isAttacked(board, r, c, by) {
    // Pawns: a white pawn on (r+1) attacks row r; a black pawn on (r-1) does.
    const pr = r + (by === 'w' ? 1 : -1);
    for (const dc of [-1, 1]) {
      const pc = c + dc;
      if (inBounds(pr, pc)) {
        const p = board[pr][pc];
        if (p && p.color === by && p.type === 'p') return true;
      }
    }
    for (const [dr, dc] of KNIGHT_STEPS) {
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc)) {
        const p = board[nr][nc];
        if (p && p.color === by && p.type === 'n') return true;
      }
    }
    for (const [dr, dc] of KING_STEPS) {
      const nr = r + dr, nc = c + dc;
      if (inBounds(nr, nc)) {
        const p = board[nr][nc];
        if (p && p.color === by && p.type === 'k') return true;
      }
    }
    const slides = [[ROOK_DIRS, 'r'], [BISHOP_DIRS, 'b']];
    for (const [dirs, type] of slides) {
      for (const [dr, dc] of dirs) {
        let nr = r + dr, nc = c + dc;
        while (inBounds(nr, nc)) {
          const p = board[nr][nc];
          if (p) {
            if (p.color === by && (p.type === type || p.type === 'q')) return true;
            break;
          }
          nr += dr;
          nc += dc;
        }
      }
    }
    return false;
  }

  function inCheck(board, color) {
    const k = findKing(board, color);
    return k ? isAttacked(board, k.r, k.c, other(color)) : false;
  }

  /** Moves that follow piece movement rules but may leave the own king in check. */
  function pseudoMoves(state, r, c) {
    const { board } = state;
    const piece = board[r][c];
    if (!piece) return [];
    const moves = [];
    const enemy = other(piece.color);
    const add = (tr, tc, extra) => moves.push({ from: { r, c }, to: { r: tr, c: tc }, ...extra });

    const step = (offsets) => {
      for (const [dr, dc] of offsets) {
        const nr = r + dr, nc = c + dc;
        if (!inBounds(nr, nc)) continue;
        const t = board[nr][nc];
        if (!t || t.color === enemy) add(nr, nc);
      }
    };
    const slide = (dirs) => {
      for (const [dr, dc] of dirs) {
        let nr = r + dr, nc = c + dc;
        while (inBounds(nr, nc)) {
          const t = board[nr][nc];
          if (t) {
            if (t.color === enemy) add(nr, nc);
            break;
          }
          add(nr, nc);
          nr += dr;
          nc += dc;
        }
      }
    };

    switch (piece.type) {
      case 'p': {
        const dir = piece.color === 'w' ? -1 : 1;
        const startRow = piece.color === 'w' ? 6 : 1;
        const lastRow = piece.color === 'w' ? 0 : 7;
        const one = r + dir;
        if (!inBounds(one, c)) break;
        const promo = one === lastRow ? { promotion: true } : {};
        if (!board[one][c]) {
          add(one, c, promo);
          const two = r + 2 * dir;
          if (r === startRow && !board[two][c]) add(two, c, { double: true });
        }
        for (const dc of [-1, 1]) {
          const tc = c + dc;
          if (!inBounds(one, tc)) continue;
          const t = board[one][tc];
          if (t && t.color === enemy) {
            add(one, tc, promo);
          } else if (!t && state.ep && state.ep.r === one && state.ep.c === tc) {
            add(one, tc, { enPassant: true });
          }
        }
        break;
      }
      case 'n':
        step(KNIGHT_STEPS);
        break;
      case 'b':
        slide(BISHOP_DIRS);
        break;
      case 'r':
        slide(ROOK_DIRS);
        break;
      case 'q':
        slide(ROOK_DIRS);
        slide(BISHOP_DIRS);
        break;
      case 'k': {
        step(KING_STEPS);
        const row = piece.color === 'w' ? 7 : 0;
        if (r === row && c === 4 && !isAttacked(board, row, 4, enemy)) {
          const rookAt = (col) => {
            const p = board[row][col];
            return p && p.type === 'r' && p.color === piece.color;
          };
          if (state.castling[piece.color + 'K'] && rookAt(7) &&
              !board[row][5] && !board[row][6] &&
              !isAttacked(board, row, 5, enemy) && !isAttacked(board, row, 6, enemy)) {
            add(row, 6, { castle: 'K' });
          }
          if (state.castling[piece.color + 'Q'] && rookAt(0) &&
              !board[row][1] && !board[row][2] && !board[row][3] &&
              !isAttacked(board, row, 3, enemy) && !isAttacked(board, row, 2, enemy)) {
            add(row, 2, { castle: 'Q' });
          }
        }
        break;
      }
    }
    return moves;
  }

  /**
   * Apply a move and return { state, captured } without mutating the input.
   * `promotionType` is used for promotion moves (defaults to a queen).
   */
  function makeMove(state, move, promotionType) {
    const s = cloneState(state);
    const b = s.board;
    const { from, to } = move;
    const piece = b[from.r][from.c];
    const wasPawn = piece.type === 'p';
    let captured = b[to.r][to.c];

    if (move.enPassant) {
      captured = b[from.r][to.c];
      b[from.r][to.c] = null;
    }
    b[to.r][to.c] = piece;
    b[from.r][from.c] = null;

    if (move.promotion) piece.type = promotionType || 'q';

    if (move.castle) {
      const row = from.r;
      if (move.castle === 'K') {
        b[row][5] = b[row][7];
        b[row][7] = null;
      } else {
        b[row][3] = b[row][0];
        b[row][0] = null;
      }
    }

    // Castling rights: lost when the king moves, or a rook leaves / is captured on its home corner.
    if (piece.type === 'k') {
      s.castling[piece.color + 'K'] = false;
      s.castling[piece.color + 'Q'] = false;
    }
    for (const sq of [from, to]) {
      if (sq.r === 7 && sq.c === 0) s.castling.wQ = false;
      if (sq.r === 7 && sq.c === 7) s.castling.wK = false;
      if (sq.r === 0 && sq.c === 0) s.castling.bQ = false;
      if (sq.r === 0 && sq.c === 7) s.castling.bK = false;
    }

    s.ep = move.double ? { r: (from.r + to.r) / 2, c: from.c } : null;
    s.halfmove = wasPawn || captured ? 0 : s.halfmove + 1;
    if (s.turn === 'b') s.fullmove++;
    s.turn = other(s.turn);

    return { state: s, captured };
  }

  function legalMovesFrom(state, r, c) {
    const piece = state.board[r][c];
    if (!piece || piece.color !== state.turn) return [];
    return pseudoMoves(state, r, c).filter(
      (m) => !inCheck(makeMove(state, m).state.board, piece.color)
    );
  }

  function allLegalMoves(state) {
    const moves = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = state.board[r][c];
        if (p && p.color === state.turn) moves.push(...legalMovesFrom(state, r, c));
      }
    }
    return moves;
  }

  function insufficientMaterial(board) {
    const minors = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const p = board[r][c];
        if (!p || p.type === 'k') continue;
        if (p.type === 'b' || p.type === 'n') minors.push({ ...p, squareColor: (r + c) % 2 });
        else return false; // any pawn, rook or queen is enough to mate
      }
    }
    if (minors.length <= 1) return true; // K vs K, K+B vs K, K+N vs K
    // Any number of bishops, all on the same square color, can never mate.
    return minors.every((m) => m.type === 'b' && m.squareColor === minors[0].squareColor);
  }

  /**
   * Status of the side to move:
   * 'checkmate' | 'stalemate' | 'insufficient' | 'fifty' | 'check' | 'normal'
   */
  function getStatus(state) {
    const check = inCheck(state.board, state.turn);
    if (allLegalMoves(state).length === 0) return check ? 'checkmate' : 'stalemate';
    if (insufficientMaterial(state.board)) return 'insufficient';
    if (state.halfmove >= 100) return 'fifty';
    return check ? 'check' : 'normal';
  }

  /** Key identifying a position for threefold-repetition detection. */
  function positionKey(state) {
    let key = '';
    for (const row of state.board) {
      for (const p of row) {
        key += p ? (p.color === 'w' ? p.type.toUpperCase() : p.type) : '.';
      }
    }
    const cr = state.castling;
    key += ' ' + state.turn + ' ' + (cr.wK ? 'K' : '') + (cr.wQ ? 'Q' : '') + (cr.bK ? 'k' : '') + (cr.bQ ? 'q' : '');
    // The en passant square only matters if a capture is actually possible.
    if (state.ep && allLegalMoves(state).some((m) => m.enPassant)) {
      key += ' ' + squareName(state.ep.r, state.ep.c);
    }
    return key;
  }

  /** Standard Algebraic Notation for `move` played in `state`. */
  function toSAN(state, move, promotionType) {
    const { from, to } = move;
    const piece = state.board[from.r][from.c];
    let san;

    if (move.castle) {
      san = move.castle === 'K' ? 'O-O' : 'O-O-O';
    } else {
      const isCapture = !!state.board[to.r][to.c] || move.enPassant;
      if (piece.type === 'p') {
        san = (isCapture ? FILES[from.c] + 'x' : '') + squareName(to.r, to.c);
        if (move.promotion) san += '=' + (promotionType || 'q').toUpperCase();
      } else {
        // Disambiguate when another piece of the same type can reach the same square.
        const rivals = allLegalMoves(state).filter((m) =>
          m.to.r === to.r && m.to.c === to.c &&
          !(m.from.r === from.r && m.from.c === from.c) &&
          state.board[m.from.r][m.from.c].type === piece.type
        );
        let disambig = '';
        if (rivals.length) {
          if (!rivals.some((m) => m.from.c === from.c)) disambig = FILES[from.c];
          else if (!rivals.some((m) => m.from.r === from.r)) disambig = String(8 - from.r);
          else disambig = squareName(from.r, from.c);
        }
        san = piece.type.toUpperCase() + disambig + (isCapture ? 'x' : '') + squareName(to.r, to.c);
      }
    }

    const next = makeMove(state, move, promotionType).state;
    if (inCheck(next.board, next.turn)) {
      san += allLegalMoves(next).length === 0 ? '#' : '+';
    }
    return san;
  }

  /** Count leaf nodes of the legal move tree (used to verify move generation). */
  function perft(state, depth) {
    if (depth === 0) return 1;
    let nodes = 0;
    for (const m of allLegalMoves(state)) {
      const promos = m.promotion ? PROMOTION_TYPES : [undefined];
      for (const t of promos) {
        nodes += depth === 1 ? 1 : perft(makeMove(state, m, t).state, depth - 1);
      }
    }
    return nodes;
  }

  const Chess = {
    FILES,
    START_FEN,
    PROMOTION_TYPES,
    other,
    squareName,
    fromFEN,
    createInitialState,
    cloneState,
    isAttacked,
    inCheck,
    findKing,
    makeMove,
    legalMovesFrom,
    allLegalMoves,
    insufficientMaterial,
    getStatus,
    positionKey,
    toSAN,
    perft,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Chess;
  else global.Chess = Chess;
})(typeof window !== 'undefined' ? window : globalThis);
