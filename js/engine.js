/*
 * Thin wrapper around the Stockfish 19 WebAssembly engine (running in a Web Worker),
 * speaking the UCI protocol. Requests are queued so only one search runs at a time.
 */
(function (global) {
  'use strict';

  const ENGINE_PATH = 'engine/stockfish-19-lite-single.js';

  class StockfishEngine {
    constructor(path = ENGINE_PATH) {
      this.path = path;
      this.worker = null;
      this.name = 'Stockfish';
      this.ready = null;       // Promise resolved once the engine answered "readyok"
      this.queue = Promise.resolve();
      this.listeners = new Set();
    }

    /** Start the engine. Rejects with a user-readable message if it cannot run. */
    init() {
      if (this.ready) return this.ready;
      this.ready = new Promise((resolve, reject) => {
        const fail = (msg) => {
          this.ready = null;
          if (this.worker) this.worker.terminate();
          this.worker = null;
          reject(new Error(msg));
        };
        const fileHint = location.protocol === 'file:'
          ? ' Browsers block the engine on pages opened straight from a file. ' +
            'Serve the folder over http instead, e.g. run "python3 -m http.server" in it and open http://localhost:8000.'
          : '';
        const timer = setTimeout(() => fail('Stockfish did not start in time.' + fileHint), 20000);

        try {
          this.worker = new Worker(this.path);
        } catch (err) {
          clearTimeout(timer);
          fail('Could not start Stockfish.' + fileHint);
          return;
        }
        this.worker.onerror = (e) => {
          clearTimeout(timer);
          if (e && e.preventDefault) e.preventDefault();
          fail('Stockfish failed to load.' + fileHint);
        };
        this.worker.onmessage = (e) => {
          const line = typeof e.data === 'string' ? e.data : '';
          for (const fn of this.listeners) fn(line);
        };

        const onLine = (line) => {
          if (line.startsWith('id name ')) this.name = line.slice(8).trim();
          if (line === 'uciok') this.send('isready');
          if (line === 'readyok') {
            clearTimeout(timer);
            this.listeners.delete(onLine);
            resolve(this);
          }
        };
        this.listeners.add(onLine);
        this.send('uci');
      });
      return this.ready;
    }

    send(cmd) {
      if (this.worker) this.worker.postMessage(cmd);
    }

    /**
     * Analyse a FEN position to a fixed depth.
     *
     * Options:
     *   depth      search depth (default 14)
     *   multiPV    number of best lines to report (default 1)
     *   onInfo     called with the current lines whenever Stockfish reports progress
     *   cancelled  function; if it returns true when the job's turn comes, the search is skipped
     *
     * Resolves to { score, pv, depth, lines, bestmove } (or null if skipped). Scores are
     * { cp } or { mate } from the side to move's point of view; `lines` is sorted best first.
     */
    analyze(fen, { depth = 14, multiPV = 1, onInfo = null, cancelled = null } = {}) {
      const job = () => new Promise((resolve) => {
        if (cancelled && cancelled()) {
          resolve(null);
          return;
        }
        const lines = [];
        const onLine = (line) => {
          if (line.startsWith('info ') && line.includes(' pv ') && !/ (lower|upper)bound /.test(line)) {
            const d = /\bdepth (\d+)/.exec(line);
            const s = /\bscore (cp|mate) (-?\d+)/.exec(line);
            const m = /\bmultipv (\d+)/.exec(line);
            const pv = / pv (.+)$/.exec(line);
            if (s && pv) {
              const idx = m ? Number(m[1]) - 1 : 0;
              lines[idx] = {
                depth: d ? Number(d[1]) : 0,
                score: { [s[1]]: Number(s[2]) },
                pv: pv[1].trim().split(/\s+/),
              };
              if (onInfo) onInfo(lines.filter(Boolean));
            }
          } else if (line.startsWith('bestmove')) {
            this.listeners.delete(onLine);
            const best = line.split(/\s+/)[1];
            const top = lines[0] || { score: { cp: 0 }, pv: [], depth: 0 };
            resolve({ ...top, lines: lines.filter(Boolean), bestmove: best && best !== '(none)' ? best : null });
          }
        };
        this.listeners.add(onLine);
        this.send('setoption name MultiPV value ' + multiPV);
        this.send('position fen ' + fen);
        this.send('go depth ' + depth);
      });
      // Run after any earlier search; keep the queue alive even if one job fails.
      const run = this.queue.then(() => this.init()).then(job);
      this.queue = run.catch(() => {});
      return run;
    }

    /** Abort the current search (it still resolves with the best result found so far). */
    stop() {
      this.send('stop');
    }

    newGame() {
      if (this.worker) {
        this.send('ucinewgame');
        this.send('isready');
      }
    }
  }

  global.StockfishEngine = StockfishEngine;
})(window);
