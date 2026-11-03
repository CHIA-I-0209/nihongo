// 修改 data/seed.json（新帳號的示範教材）後執行：node tools/build.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const seed = JSON.parse(readFileSync(join(root, 'data/seed.json'), 'utf8'));
writeFileSync(
  join(root, 'app/js/seed.js'),
  `// 自動產生，請改 data/seed.json 後執行 node tools/build.mjs\nexport const SEED = ${JSON.stringify(seed, null, 2)};\n`,
);
// 範例教材包（在「文法」分頁一鍵加入）
const packs = { n5n4: JSON.parse(readFileSync(join(root, 'data/pack-n5n4.json'), 'utf8')) };
writeFileSync(
  join(root, 'app/js/packs.js'),
  `// 自動產生，請改 data/pack-*.json 後執行 node tools/build.mjs\nexport const PACK_DATA = ${JSON.stringify(packs, null, 2)};\n`,
);
console.log('built app/js/seed.js and app/js/packs.js');
