import path from 'node:path';
import { lstat, mkdir, readFile, realpath, link, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    if (!relative) return candidate;
    throw new Error('Đường dẫn nằm ngoài Project.');
  }
  return candidate;
}

function safeJsonName(name) {
  const base = path.basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim();
  if (!base || base === '.' || base === '..') throw new Error('Tên file JSON không hợp lệ.');
  return base.toLowerCase().endsWith('.json') ? base : `${base}.json`;
}

export async function importAnalysisFiles(projectPath, sourcePaths) {
  const root = await realpath(projectPath);
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Project path không phải thư mục an toàn.');
  const destination = path.join(root, 'analysis', 'incoming');
  inside(root, destination);
  await mkdir(destination, { recursive: true });
  const realDestination = await realpath(destination);
  inside(root, realDestination);
  const dirInfo = await lstat(realDestination);
  if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink()) throw new Error('Thư mục analysis/incoming không an toàn.');

  const results = [];
  for (const sourcePath of sourcePaths) {
    if (path.extname(sourcePath).toLowerCase() !== '.json') throw new Error(`Chỉ chấp nhận file .json: ${path.basename(sourcePath)}`);
    const source = await realpath(sourcePath);
    const info = await lstat(source);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Chỉ chấp nhận file JSON thông thường: ${path.basename(sourcePath)}`);
    const bytes = await readFile(source);
    let parsed;
    try { parsed = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); }
    catch (error) { throw new Error(`${path.basename(sourcePath)}: JSON không hợp lệ (${error.message}).`); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`${path.basename(sourcePath)}: AI Analysis phải là JSON object.`);
    }
    const fileName = safeJsonName(path.basename(sourcePath));
    let importedPath;
    for (let attempt = 0; attempt < 1000; attempt += 1) {
      const suffix = attempt === 0 ? '' : ` (${attempt})`;
      const candidate = path.join(realDestination, `${fileName.slice(0, -5)}${suffix}.json`);
      const staging = path.join(realDestination, `.import-${randomUUID()}.tmp`);
      try {
        await writeFile(staging, bytes, { flag: 'wx' });
        try { await link(staging, candidate); importedPath = candidate; }
        finally { await unlink(staging).catch(() => {}); }
        break;
      } catch (error) {
        await unlink(staging).catch(() => {});
        if (error.code === 'EEXIST' && (error.dest === candidate || error.path === staging)) continue;
        throw error;
      }
    }
    if (!importedPath) throw new Error(`Không thể tạo tên file duy nhất cho ${fileName}.`);
    results.push({ sourceName: path.basename(sourcePath), fileName: path.basename(importedPath), path: importedPath, bytes: bytes.byteLength,
      chapter: parsed.chapter && typeof parsed.chapter === 'object' && !Array.isArray(parsed.chapter) ? (parsed.chapter.title || parsed.chapter.series || `Chapter ${parsed.chapter.number ?? ''}`.trim()) : null,
      voiceBeatCount: Array.isArray(parsed.voice_beats) ? parsed.voice_beats.length : null });
  }
  return results;
}
