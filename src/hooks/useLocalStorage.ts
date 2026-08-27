import { useState, useEffect, useRef } from 'react';

function getStorageValue<T>(key: string, defaultValue: T): T {
  // getting stored value
  const saved = localStorage.getItem(key);
  if (saved === null) return defaultValue;

  try {
    const initial = JSON.parse(saved);
    return initial as T;
  } catch (e) {
    console.warn(`Error parsing localStorage key "${key}":`, e);
    return defaultValue;
  }
}

export const useLocalStorage = <T>(key: string, defaultValue: T): [T, (value: T | ((val: T) => T)) => void] => {
  const [value, setValue] = useState<T>(() => {
    return getStorageValue(key, defaultValue);
  });

  /**
   * 首次挂载跳过写入：保持"键不存在 = 用户从未修改过"的语义。
   * 若首次挂载就把默认值写入，就无法区分"从未选择"与"手动选择了默认值"
   * （如设置里的语言跟随系统）。
   */
  const firstRenderRef = useRef(true);

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    // storing input name
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  // 多窗口同步：同 session 的其他窗口写入 localStorage 时，
  // 浏览器会派发 storage 事件（Electron 多窗口共享同一分区）。
  // 订阅它让仪表板固定项、最近文件、设置等状态跨窗口保持一致。
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== key || e.newValue === null) return;
      try {
        setValue(JSON.parse(e.newValue) as T);
      } catch {
        // 解析失败时保持当前值
      }
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, [key]);

  return [value, setValue];
};
