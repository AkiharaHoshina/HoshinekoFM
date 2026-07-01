import { useState, useEffect } from 'react';

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

  useEffect(() => {
    // storing input name
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue];
};
