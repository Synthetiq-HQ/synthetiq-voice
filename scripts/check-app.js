const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const required = [
  'app/main.js',
  'app/preload.js',
  'app/renderer.html',
  'app/renderer.js',
  'worker/stt_worker.py',
  'worker/requirements.txt'
];

let ok = true;
for (const relative of required) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    console.error(`Missing ${relative}`);
    ok = false;
  }
}

process.exit(ok ? 0 : 1);
