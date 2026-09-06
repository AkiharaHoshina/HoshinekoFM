import React, { useEffect, useRef } from 'react';
import { Dialog } from './Dialog';
import { Button } from './Button';
import { t } from '../i18n';
import hoshinekoPng from '../assets/HoshinekoAkihara.png';
import prideSvg from '../assets/Transgender_Pride_flag.svg';
import './HoshinekoNyaDialog.css';

interface HoshinekoNyaDialogProps {
  /** 是否显示（设置对话框打开期间按 Ctrl+PgDn 触发） */
  open: boolean;
  /** 关闭回调（确定按钮 / Esc） */
  onClose: () => void;
}

/** 经主进程校验（仅 http/https）后用系统默认浏览器打开外部链接 */
function openExternal(url: string) {
  if (!window.electron?.openExternal) return;
  void window.electron.openExternal(url).catch(() => { /* 打开失败静默 */ });
}

/**
 * 彩蛋对话框「Hoshineko Nya~」：设置对话框打开时按 Ctrl+PgDn 打开。
 * M3 样式（内容槽 min-width 512px → md-dialog 560px，与设置对话框
 * 同宽）+ 叠层遮罩（盖在设置对话框之上，两层之间压暗）——标题固定
 * 「Hoshineko Nya~」不随语言切换，内容为 HoshinekoAkihara.png 与
 * Transgender Pride 旗纵向排列（图片固定 293px 宽锁定渲染尺寸，
 * 不随对话框宽度/窗口高度缩放）；底部为分割线 + 贡献声明 + 相关
 * 链接 **outlined 按钮横向排列**（文案经 i18n，经 shell:open-external
 * 用系统浏览器打开）。
 *
 * PgDn/PgUp 翻页滚动：内容区无焦点元素，打开时焦点落在 actions 槽
 * 的确定按钮上（shadow scroller 之外）——Chromium 的默认翻页从焦点
 * 元素向上找可滚动祖先，永远找不到 scroller。打开期间拦截 PgDn/PgUp
 * 手动滚动（焦点已在 scroller 内时交还默认行为，避免双重滚动）。
 */
export const HoshinekoNyaDialog: React.FC<HoshinekoNyaDialogProps> = ({ open, onClose }) => {
  /** 当前打开周期的 shadow scroller（md-dialog 每次打开重挂载全新
   *  元素，须经 onScrollerReady 获取，不能自行 closest/shadowRoot 定位） */
  const scrollerRef = useRef<HTMLElement | null>(null);

  /** 焦点锚点（autofocus 目标：0×0、位于内容顶部，承接打开时的初始焦点） */
  const anchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'PageDown' && e.key !== 'PageUp') return;
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const focused = document.activeElement as HTMLElement | null;
      // 焦点已在可滚动内容内：浏览器默认翻页已可用，避免双重滚动
      if (focused && scroller.contains(focused)) return;
      e.preventDefault();
      const step = scroller.clientHeight;
      scroller.scrollTop += e.key === 'PageDown' ? step : -step;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  return (
    <Dialog
      title="Hoshineko Nya~"
      open={open}
      onClose={onClose}
      backdrop
      onScrollerReady={(scroller) => {
        scrollerRef.current = scroller;
      }}
      actions={
        <Button onClick={onClose}>{t('dialog.button.ok')}</Button>
      }
    >
      <div
        ref={(el) => {
          anchorRef.current = el;
          // autofocus 属性经 ref 回调每次（重）挂载时写入：Dialog 组件
          // 以 key={cycle} 每次打开重挂载 md-dialog，内容随之重建，
          // 挂载期 effect 只会写到已被替换的旧节点；TS 不允许 div 上的
          // autofocus 属性，React autoFocus prop 的挂载期 focus() 亦不可
          // 依赖（组件常驻渲染，closed 对话框内的 focus 是 no-op）。
          // 原生 dialog.showModal() 会强制聚焦第一个可聚焦子元素（首个
          // 链接按钮）——键盘触发下 :focus-visible 生效出现高亮环。挂
          // autofocus 让 MD 对话框改聚焦本锚点：tabindex=-1 可程序聚焦、
          // 不进 Tab 序；0×0 且位于内容顶部——聚焦滚动校正不会把
          // 高内容容器滚到底部（打开即顶部，Chromium 对可见目标不滚动）。
          // 用户按 Tab 才真正选中第一个按钮并显示边框高亮。
          el?.setAttribute('autofocus', '');
        }}
        className="hoshineko-nya-focus-anchor"
        tabIndex={-1}
      />
      <div className="hoshineko-nya-content">
        <img
          className="hoshineko-nya-img"
          src={hoshinekoPng}
          alt="Hoshineko Akihara"
          draggable={false}
        />
        <img
          className="hoshineko-nya-img"
          src={prideSvg}
          alt="Transgender Pride Flag"
          draggable={false}
        />
        <div className="hoshineko-nya-footer">
          <div className="hoshineko-nya-divider" />
          <p className="hoshineko-nya-contribution">{t('nya.contribution')}</p>
          <p className="hoshineko-nya-links-label">{t('nya.links')}</p>
          <div className="hoshineko-nya-links">
            <Button variant="outlined" onClick={() => openExternal('https://t.me/HoshinekoDiscuss')}>
              {t('nya.link.group')}
            </Button>
            <Button variant="outlined" onClick={() => openExternal('https://t.me/evelxyn331')}>
              {t('nya.link.channel')}
            </Button>
            <Button variant="outlined" onClick={() => openExternal('https://project-trans.org/')}>
              {t('nya.link.project_trans')}
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
};
