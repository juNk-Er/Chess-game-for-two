# Chess for Two

A two-player (same device) chess game built with plain HTML, CSS and JavaScript. It has no dependencies and no build step.

## Play

Open `index.html` in any modern browser.

## Features

- **Full chess rules:** legal move validation, check, checkmate, stalemate, castling, en passant and pawn promotion (you pick the piece).
- **Draw detection:** stalemate, insufficient material, threefold repetition, the 50-move rule, and draw by agreement.
- **Controls:** click-to-move or drag-and-drop (works with mouse and touch), with legal move hints.
- **Move list** in standard algebraic notation (e.g. `Nf3`, `exd5`, `O-O`, `e8=Q#`).
- **Captured pieces** and material advantage for each player.
- **Chess clocks** with optional increment (1 to 30 minutes, or no clock).
- **Undo**, **resign**, **offer draw**, **flip board**, and an optional auto-flip after every move.
- **Keyboard shortcuts:** `Ctrl/Cmd+Z` undoes a move, `Esc` cancels a selection or closes a dialog.

## Project structure

```
index.html      page layout
css/style.css   styling (responsive, works on phones)
js/chess.js     rules engine (move generation, check detection, SAN, perft)
js/app.js       UI: board rendering, input, clocks, dialogs
```

The rules engine is independent of the UI and also runs in Node (`require('./js/chess.js')`). Its move generator has been checked against standard perft reference counts.
