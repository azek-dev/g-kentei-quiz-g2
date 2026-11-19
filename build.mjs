import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const out = await build({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', minify: true, write: false, target: 'es2020' });
let js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('src/template.html', 'utf8').replace('/*BUNDLE*/', () => js);
writeFileSync('index.html', html);
// Even Hub 用のパッケージ（evenhub pack app.json dist）に入れるフォルダ
mkdirSync('dist', { recursive: true });
writeFileSync('dist/index.html', html);
console.log('index.html', html.length, 'bytes');
