import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const out = await build({ entryPoints: ['src/main.js'], bundle: true, format: 'esm', minify: true, write: false, target: 'es2020' });
let js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = readFileSync('src/template.html', 'utf8').replace('/*BUNDLE*/', () => js);
writeFileSync('index.html', html);
console.log('index.html', html.length, 'bytes');
