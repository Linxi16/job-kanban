// 直接从 PDF 提取文本（支持 FlateDecode + ToUnicode CMap），零依赖
//   node extract-resume.mjs "<pdf路径>" [输出txt]
import fs from 'fs';
import zlib from 'zlib';

const pdfPath = process.argv[2];
const outPath = process.argv[3] || '简历提取.txt';
const buf = fs.readFileSync(pdfPath);

// ---- 收集所有 stream 并解压 ----
function inflateAll(buf) {
  const out = [];
  const re = /stream\r?\n/g;
  let m;
  while ((m = re.exec(buf.toString('latin1')))) {
    const start = m.index + m[0].length;
    const end = buf.toString('latin1').indexOf('endstream', start);
    if (end < 0) continue;
    const raw = buf.subarray(start, end);
    try { out.push(zlib.inflateSync(raw).toString('latin1')); }
    catch (e) {
      try { out.push(zlib.inflateRawSync(raw).toString('latin1')); } catch (e2) { /* 跳过非压缩流 */ }
    }
  }
  return out;
}

const streams = inflateAll(buf);
console.log(`解压出 ${streams.length} 个流`);

// ---- 解析 ToUnicode CMap：<srcCode> <dstUTF16> ----
function parseCMap(txt) {
  const map = new Map();
  // beginbfchar / endbfchar
  for (const blk of txt.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const line of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const src = parseInt(line[1], 16);
      const hex = line[2];
      let s = '';
      for (let i = 0; i < hex.length; i += 4) s += String.fromCharCode(parseInt(hex.substr(i, 4), 16));
      map.set(src, s);
    }
  }
  // beginbfrange / endbfrange
  for (const blk of txt.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const line of blk[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
      const lo = parseInt(line[1], 16), hi = parseInt(line[2], 16);
      let dst = parseInt(line[3], 16);
      for (let c = lo; c <= hi && c - lo < 65536; c++, dst++) map.set(c, String.fromCharCode(dst));
    }
  }
  return map;
}

const cmaps = streams.filter((s) => /beginbfchar|beginbfrange/.test(s)).map(parseCMap);
console.log(`找到 ${cmaps.length} 个 ToUnicode 映射表`);
const merged = new Map();
for (const cm of cmaps) for (const [k, v] of cm) if (!merged.has(k)) merged.set(k, v);
console.log(`合并后 ${merged.size} 个字符映射`);

// ---- 提取内容流里的文本操作符 ----
function decodeHex(hex, cmap) {
  let s = '';
  for (let i = 0; i + 3 < hex.length + 1; i += 4) {
    const code = parseInt(hex.substr(i, 4), 16);
    s += cmap.has(code) ? cmap.get(code) : '';
  }
  return s;
}

let all = [];
for (const st of streams) {
  if (!/(TJ|Tj)/.test(st)) continue;
  // 文本块：<hex> Tj  或  [<hex> num <hex>] TJ  或 (literal) Tj
  for (const blk of st.matchAll(/\[([^\]]*)\]\s*TJ|\(((?:\\.|[^\\()])*)\)\s*Tj|<([0-9A-Fa-f\s]+)>\s*Tj/g)) {
    if (blk[3]) { all.push(decodeHex(blk[3].replace(/\s/g, ''), merged)); continue; }
    if (blk[2] != null) { all.push(blk[2].replace(/\\([()\\])/g, '$1')); continue; }
    // TJ 数组
    let line = '';
    for (const part of blk[1].matchAll(/<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\()])*)\)|(-?\d+\.?\d*)/g)) {
      if (part[1] != null) line += decodeHex(part[1].replace(/\s/g, ''), merged);
      else if (part[2] != null) line += part[2].replace(/\\([()\\])/g, '$1');
      else if (part[3] != null && parseFloat(part[3]) < -180) line += ' ';
    }
    all.push(line);
  }
}

let text = all.join('');
// 清理：连续空白折叠、去掉空字符
text = text.replace(/\u0000/g, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

fs.writeFileSync(outPath, text, 'utf8');
console.log(`\n提取完成：${text.length} 字符 → ${outPath}`);
console.log('--- 预览（前 600 字）---');
console.log(text.slice(0, 600));
