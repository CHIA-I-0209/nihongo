// 把 data/ 裡的教材輸出成可以在 App「匯入範例包」使用的檔案：packs/*.json
// 用法：node tools/export_packs.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(join(root, f), 'utf8'));
const seed = read('data/seed.json');
const strip = (list, keys) => list.map((x) => Object.fromEntries(keys.filter((k) => x[k] !== undefined && x[k] !== '').map((k) => [k, x[k]])));
const G = ['id', 'title', 'pattern', 'meaning', 'explanation', 'jlpt'];
const S = ['id', 'jp', 'zh', 'grammar', 'words'];

const packs = [
  {
    file: 'qa.json', id: 'qa', title: '問答文法範例',
    description: '〜か、疑問詞、〜ませんか 共 3 項文法，附 9 組 A 問 B 答的對話練習。',
    grammar: seed.grammar.filter((g) => /^gqa/.test(g.id)), sentences: seed.sentences.filter((s) => /^sqa/.test(s.id)),
  },
  { file: 'n5n4.json', id: 'n5n4', title: 'N5～N4 必備句型', description: '第 14～94 項句型，每句例句都有填空練習。', ...read('data/pack-n5n4.json') },
  { file: 'n4plus.json', id: 'n4plus', title: 'N4 文法補充', description: '〜ようです、〜ことができます、〜つもりです、〜予定です、〜てみます、〜ようになります、〜ことにします、〜のに、〜し、〜ために。', ...read('data/pack-n4plus.json') },
];
mkdirSync(join(root, 'packs'), { recursive: true });
for (const p of packs) {
  const out = {
    format: 'nihongo-pack', version: 1, id: p.id, title: p.title, description: p.description,
    grammar: strip(p.grammar, G),
    sentences: strip(p.sentences.map((s) => ({ ...s, words: '' })), S),
  };
  writeFileSync(join(root, 'packs', p.file), JSON.stringify(out, null, 2) + '\n');
  console.log(`packs/${p.file}: ${out.grammar.length} 文法、${out.sentences.length} 例句`);
}
