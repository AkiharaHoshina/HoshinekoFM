import { watch, FSWatcher } from 'fs';
import path from 'path';

interface WatcherEntry {
  watcher: FSWatcher;
  timer: ReturnType<typeof setTimeout> | null;
  /** 关注该目录的监听器集合（每个窗口注册一个） */
  listeners: Set<(changedDir: string) => void>;
}

const watchers = new Map<string, WatcherEntry>();

/** Normalize directory path for consistent Map key comparison */
function normalizeDir(dir: string): string {
  const resolved = path.resolve(dir);
  return resolved.endsWith('/') && resolved !== '/' ? resolved.slice(0, -1) : resolved;
}

/**
 * 监听目录变化（多窗口共用同一个 watcher）。
 * 同一目录只会创建一个 inotify watcher；每个调用方（窗口）
 * 通过 `onChange` 回调独立接收通知。
 */
export function startWatching(
  dir: string,
  onChange: (changedDir: string) => void,
): void {
  const normalized = normalizeDir(dir);
  const existing = watchers.get(normalized);
  if (existing) {
    existing.listeners.add(onChange);
    return;
  }

  try {
    const entry: WatcherEntry = {
      watcher: null as unknown as FSWatcher,
      timer: null,
      listeners: new Set([onChange]),
    };
    const watcher = watch(normalized, () => {
      const e = watchers.get(normalized);
      if (!e) return;

      if (e.timer) clearTimeout(e.timer);
      e.timer = setTimeout(() => {
        e.timer = null;
        e.listeners.forEach((cb) => cb(normalized));
      }, 300);
    });

    watcher.on('error', (err: Error) => {
      console.warn(`[fsWatcher] error on "${normalized}":`, err.message);
      const e = watchers.get(normalized);
      if (e) e.listeners.forEach((cb) => cb(normalized));
      stopWatching(normalized);
    });

    entry.watcher = watcher;
    watchers.set(normalized, entry);
  } catch (err) {
    console.warn(`[fsWatcher] cannot watch "${normalized}":`, (err as Error).message);
  }
}

/**
 * 停止监听。
 * @param dir - 目录路径
 * @param onChange - 若提供，只移除该监听器；该目录没有剩余监听器时才关闭 watcher
 */
export function stopWatching(dir: string, onChange?: (changedDir: string) => void): void {
  const normalized = normalizeDir(dir);
  const entry = watchers.get(normalized);
  if (!entry) return;

  if (onChange) {
    entry.listeners.delete(onChange);
    if (entry.listeners.size > 0) return;
  }

  if (entry.timer) clearTimeout(entry.timer);
  entry.watcher.close();
  watchers.delete(normalized);
}

export function stopAllWatching(): void {
  for (const [dir] of watchers) {
    stopWatching(dir);
  }
}
