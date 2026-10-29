'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const publicDir = path.join(root, 'public');
const assets = ['index.html', 'styles.css', 'app.js', 'catalog.js'];

fs.mkdirSync(publicDir, { recursive: true });

for (const filename of assets) {
  const source = path.join(root, filename);
  const destination = path.join(publicDir, filename);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    throw new Error('Required Vercel asset is missing: ' + filename);
  }
  fs.copyFileSync(source, destination);
}

const required = ['index.html', 'styles.css', 'app.js', 'catalog.js', 'favicon.svg'];
for (const filename of required) {
  if (!fs.existsSync(path.join(publicDir, filename))) {
    throw new Error('Vercel output is missing: public/' + filename);
  }
}

console.log('Vercel static output prepared: ' + required.join(', '));
