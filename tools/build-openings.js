#!/usr/bin/env node
/*
 * Builds data/openings.json from the Lichess opening database
 * (https://github.com/lichess-org/chess-openings, public domain / CC0).
 *
 * Usage: node tools/build-openings.js <folder with a.tsv … e.tsv>
 *
 * Output maps a position key (piece placement, side to move, castling rights)
 * to [ECO code, opening name], so transpositions are recognised too.
 */
const fs = require('fs');
const path = require('path');
const C = require('../js/chess.js');

const dir = process.argv[2];
if (!dir) {
  console.error('Usage: node tools/build-openings.js <folder with a.tsv … e.tsv>');
  process.exit(1);
}

const positionKey = (state) => C.toFEN(state).split(' ').slice(0, 3).join(' ');
const entries = {};
let count = 0;

for (const letter of 'abcde') {
  const lines = fs.readFileSync(path.join(dir, `${letter}.tsv`), 'utf8').trim().split('\n').slice(1);
  for (const line of lines) {
    const [eco, name, pgn] = line.split('\t');
    let state = C.createInitialState();
    const { sans } = C.parsePGN(pgn);
    for (const san of sans) {
      const found = C.moveFromSAN(state, san);
      if (!found) throw new Error(`Illegal move ${san} in ${eco} ${name}`);
      state = C.makeMove(state, found.move, found.promotionType).state;
    }
    const key = positionKey(state);
    // Keep the entry reached by the shortest line if several lead to the same position.
    if (!entries[key] || sans.length < entries[key].plies) entries[key] = { eco, name, plies: sans.length };
    count++;
  }
}

const out = {};
for (const [key, e] of Object.entries(entries)) out[key] = [e.eco, e.name];
fs.writeFileSync(path.join(__dirname, '..', 'data', 'openings.json'), JSON.stringify(out));
console.log(`${count} lines -> ${Object.keys(out).length} positions`);
