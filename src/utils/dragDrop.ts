/**
 * 从拖放事件的 DataTransfer 中提取文件路径列表。
 *
 * 优先读取 `File.path`（原生文件拖放）；当 `.path` 缺失时——例如
 * Chromium ↔ Chromium 之间（本应用两个实例互拖）走 `text/uri-list`
 * 数据、`files` 里没有 path 属性——回退解析 `text/uri-list` 中的
 * `file://` URI。
 *
 * @param dataTransfer - 拖放事件的 DataTransfer 对象（可为 null）
 * @returns 绝对文件路径列表（可能为空）
 */
export function extractDropPaths(dataTransfer: DataTransfer | null): string[] {
  if (!dataTransfer) return [];

  const fromFiles = Array.from(dataTransfer.files)
    .map((f) => (f as unknown as { path?: string }).path)
    .filter((p): p is string => typeof p === 'string' && p.length > 0);
  if (fromFiles.length > 0) return fromFiles;

  const raw =
    dataTransfer.getData('text/uri-list') ||
    dataTransfer.getData('text/plain') ||
    '';

  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))
    .filter((line) => line.startsWith('file://'))
    .map((line) => {
      let path = line.slice('file://'.length);
      try {
        path = decodeURIComponent(path);
      } catch {
        // 解码失败时保留原始串
      }
      return path;
    });
}

/**
 * 判断两批路径集合是否一致（顺序无关）。
 * 用于识别 DataTransfer 里的路径与本应用登记的活跃拖拽是否同一批。
 */
export function samePathSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((v, i) => v === sb[i]);
}
