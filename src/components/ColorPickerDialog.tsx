import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { t } from '../i18n';
import { hexToHsv, hsvToHex, hueToHex, normalizeHex } from '../services/themeEngine';
import { THEME_PRESETS } from '../types/theme';
import './ColorPickerDialog.css';

interface ColorPickerDialogProps {
  open: boolean;
  /** 初始颜色（#RRGGBB） */
  initialColor: string;
  /** 确定时返回选中的颜色；取消返回 null */
  onClose: (color: string | null) => void;
}

/**
 * 三级调色盘对话框：内置 M3 色盘（色相滑条 + 饱和度/明度方块 + hex 输入
 * + 预设种子色）。选中颜色经「确定」返回给二级主题对话框作为自定义种子色。
 * 拖拽使用 Pointer Capture，与终端标题栏拖拽同模式。
 */
export const ColorPickerDialog: React.FC<ColorPickerDialogProps> = ({ open, initialColor, onClose }) => {
  const init = normalizeHex(initialColor) ?? '#6750A4';
  const [hsv, setHsv] = useState(() => hexToHsv(init));
  const [hexInput, setHexInput] = useState(init);

  // 每次打开时重置为传入颜色
  useEffect(() => {
    if (!open) return;
    const c = normalizeHex(initialColor) ?? '#6750A4';
    setHsv(hexToHsv(c)); // eslint-disable-line react-hooks/set-state-in-effect -- 打开时同步初值
    setHexInput(c);
  }, [open, initialColor]);

  const hex = hsvToHex(hsv.h, hsv.s, hsv.v);

  const squareRef = useRef<HTMLDivElement>(null);
  const hueRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<'square' | 'hue' | null>(null);

  const updateSquare = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = squareRef.current?.getBoundingClientRect();
    if (!rect) return;
    const s = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const v = Math.min(1, Math.max(0, 1 - (e.clientY - rect.top) / rect.height));
    setHsv((prev) => ({ ...prev, s, v }));
  }, []);

  const updateHue = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const rect = hueRef.current?.getBoundingClientRect();
    if (!rect) return;
    const h = Math.min(360, Math.max(0, ((e.clientX - rect.left) / rect.width) * 360));
    setHsv((prev) => ({ ...prev, h }));
  }, []);

  const handleHexInput = (value: string) => {
    setHexInput(value);
    const norm = normalizeHex(value);
    if (norm) setHsv(hexToHsv(norm));
  };

  const hueBackground = (() => {
    const stops = [0, 60, 120, 180, 240, 300, 360].map((h) => `${hueToHex(h)} ${(h / 360) * 100}%`);
    return `linear-gradient(to right, ${stops.join(', ')})`;
  })();

  return (
    <Dialog
      title={t('picker.title')}
      open={open}
      onClose={() => onClose(null)}
      actions={
        <>
          <Button variant="text" onClick={() => onClose(null)}>
            {t('dialog.button.cancel')}
          </Button>
          <Button variant="filled" onClick={() => onClose(hex)}>
            {t('theme.confirm')}
          </Button>
        </>
      }
    >
      <div className="color-picker-content">
        <div className="color-picker-preview" style={{ backgroundColor: hex }} />

        {/* 饱和度/明度方块 */}
        <div
          ref={squareRef}
          className="color-picker-sv"
          style={{ backgroundColor: hueToHex(hsv.h) }}
          onPointerDown={(e) => {
            dragRef.current = 'square';
            e.currentTarget.setPointerCapture(e.pointerId);
            updateSquare(e);
          }}
          onPointerMove={(e) => {
            if (dragRef.current === 'square') updateSquare(e);
          }}
          onPointerUp={() => { dragRef.current = null; }}
        >
          <div className="color-picker-sv-overlay" />
          <div
            className="color-picker-sv-thumb"
            style={{
              left: `${hsv.s * 100}%`,
              top: `${(1 - hsv.v) * 100}%`,
              borderColor: hsv.v > 0.55 ? 'rgba(0,0,0,0.6)' : '#fff',
            }}
          />
        </div>

        {/* 色相滑条 */}
        <div
          ref={hueRef}
          className="color-picker-hue"
          style={{ background: hueBackground }}
          onPointerDown={(e) => {
            dragRef.current = 'hue';
            e.currentTarget.setPointerCapture(e.pointerId);
            updateHue(e);
          }}
          onPointerMove={(e) => {
            if (dragRef.current === 'hue') updateHue(e);
          }}
          onPointerUp={() => { dragRef.current = null; }}
        >
          <div
            className="color-picker-hue-thumb"
            style={{ left: `${(hsv.h / 360) * 100}%`, backgroundColor: hueToHex(hsv.h) }}
          />
        </div>

        {/* Hex 输入 */}
        <div className="color-picker-hex-row">
          <span className="color-picker-hex-label">{t('theme.hex')}</span>
          <input
            className="color-picker-hex-input"
            value={hexInput}
            maxLength={7}
            onChange={(e) => handleHexInput(e.target.value)}
            spellCheck={false}
          />
        </div>

        {/* 预设种子色：快捷取色 chip，不做选中态（避免与主题设置的预设选中状态混淆） */}
        <div className="color-picker-presets">
          {THEME_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className="color-picker-preset"
              style={{ backgroundColor: p.seed }}
              title={p.seed}
              onClick={() => {
                setHsv(hexToHsv(p.seed));
                setHexInput(p.seed);
              }}
            />
          ))}
        </div>
      </div>
    </Dialog>
  );
};
