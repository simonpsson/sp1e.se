import fs from 'node:fs';
import path from 'node:path';

const html = fs.readFileSync('mosquito.html', 'utf8');

function fail(message) {
  console.error(`FAIL ${message}`);
  process.exit(1);
}

if (!/const\s+BLACKJACK_CARD_ASSET_BASE\s*=\s*['"]assets\/casino-plugin\/cards['"]/.test(html)) {
  fail('cards should use casino-plugin PNG asset folder');
}

if (!/function\s+blackjackCardAsset\(code\)[\s\S]*\.png/.test(html)) {
  fail('blackjackCardAsset should emit PNG URLs');
}

if (!/object-fit\s*:\s*contain/.test(html)) {
  fail('card images must use object-fit: contain, not cover/crop');
}

for (const file of ['2C.png', 'tD.png', 'aS.png', 'qH.png', 'cardBack.png']) {
  if (!fs.existsSync(path.join('assets', 'casino-plugin', 'cards', file))) {
    fail(`missing local casino card asset ${file}`);
  }
}

console.log('Mosquito card asset check passed.');
