# Chess for Two

A two-player (same device) chess game built with plain HTML, CSS and JavaScript, with game review by **Stockfish 19**. There are no dependencies and no build step.

## Play

Serve the folder over HTTP and open it in a browser:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly (file://) also works for playing. Browsers block the Stockfish engine on file:// pages, though, so game analysis needs the page served over HTTP (a local server as above, or GitHub Pages).

## Play on iPhone / iPad / Android

Once the game is hosted (e.g. on GitHub Pages, see below), open its address in **Safari** and tap **Share → Add to Home Screen**. It then works like an app:

- its own icon on the home screen, opening full-screen without the browser bar,
- **works offline** after the first visit, including Stockfish analysis,
- touch controls (tap-to-move or drag), and a layout that fits around the notch / Dynamic Island.

Tip: the iPhone's silent switch also mutes the game's sound effects.

### Hosting on GitHub Pages

In the repository on GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**, choose `main` and `/ (root)`, then **Save**. After a minute the game is live at `https://<your-user>.github.io/<repo-name>/`. Free GitHub Pages needs a public repository.

## Features

**Playing**
- Full chess rules: legal moves only, check, checkmate, stalemate, castling, en passant and promotion (you choose the piece).
- Automatic draws: stalemate, insufficient material, threefold repetition, the 50-move rule, plus draw by agreement.
- Click-to-move or drag-and-drop (mouse and touch), with legal-move hints and smooth piece animation.
- Chess clocks with optional increment. **Undo also restores the clock time** spent on the undone move.
- Player names and a running score across games (win = 1, draw = ½). Use *Swap sides* to change colours.
- Sound effects for moves, captures, castling, check, promotion, low time and game end (can be muted).
- **Save & resume:** the game, clocks, names, score and settings are saved automatically in the browser (localStorage). Closing or refreshing the page does not lose the game.

**Reviewing**
- Step through the game with ⏮ ◀ ▶ ⏭, the arrow keys / Home / End, by clicking a move, or by clicking the evaluation graph.
- **Analyze with Stockfish 19**, which evaluates every position and shows:
  - an evaluation bar next to the board and an evaluation graph of the whole game,
  - a green arrow for the best move in each position, and the engine's main line,
  - each move classified as best (★), inaccuracy (?!), mistake (?) or blunder (??), using Lichess's winning-chance thresholds,
  - an accuracy percentage and error counts per player.
- **PGN:** copy or download the game as PGN, including `[%clk]` clock times and, once analyzed, `[%eval]` scores and annotations. Import any PGN (pasted or from a file) to review it.

**Keyboard shortcuts:** `Ctrl/Cmd+Z` undo · `←` `→` `Home` `End` navigate moves · `Esc` cancel / close dialog.

## Project structure

```
index.html            page layout
css/style.css         styling (responsive, works on phones)
js/chess.js           rules engine: move generation, SAN, FEN, UCI, PGN, perft
js/engine.js          Stockfish UCI wrapper (Web Worker)
js/sound.js           synthesized sound effects (Web Audio)
js/app.js             UI: board, input, clocks, saving, review and analysis
manifest.webmanifest  home-screen app settings (name, icons, full-screen)
sw.js                 service worker for offline play
engine/               Stockfish 19 (stockfish.js 19.0.0 lite single-threaded WASM build)
assets/pieces/        SVG chess pieces
assets/icons/         app icons
```

The rules engine is independent of the UI and also runs in Node (`require('./js/chess.js')`). Its move generator has been checked against standard perft reference counts.

## Credits and licences

- **Stockfish 19** by the Stockfish developers, compiled to WebAssembly by [stockfish.js](https://github.com/nmrugg/stockfish.js). GPLv3; see `engine/COPYING.txt`. The *lite* build uses a smaller neural network (≈1.8 MB instead of ≈99 MB) and is still far stronger than any human player.
- **Chess pieces:** "cburnett" set by Colin M.L. Burnett, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
