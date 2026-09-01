import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { IFile } from '../types/files';
import { Icon } from './Icon';
import { t } from '../i18n';
import './FilePreviewPanel.css';

/** 视频容器白名单：Chromium 可靠支持的容器（mkv 同容器族，编码不支持时落到「加载失败」占位） */
const VIDEO_MIME_WHITELIST = new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-matroska']);

/** 归档 mime 白名单（zip/tar/压缩流/7z） */
const ARCHIVE_MIME_WHITELIST = new Set([
  'application/zip', 'application/x-zip-compressed', 'application/java-archive',
  'application/x-tar', 'application/gzip', 'application/x-gzip',
  'application/x-xz', 'application/x-bzip2', 'application/x-7z-compressed',
]);

/** mime 缺失/未知时按扩展名判定图片的兜底白名单 */
const IMAGE_EXT_WHITELIST = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.avif', '.svg', '.ico',
]);

/** mime 缺失/未知时按扩展名判定视频的兜底白名单 */
const VIDEO_EXT_WHITELIST = new Set(['.mp4', '.m4v', '.webm', '.ogv', '.mov', '.mkv']);

/** mime 缺失/未知时按扩展名判定音频的兜底白名单 */
const AUDIO_EXT_WHITELIST = new Set(['.mp3', '.wav', '.ogg', '.oga', '.flac', '.m4a', '.aac', '.opus', '.weba']);

/** mime 缺失/未知时按扩展名判定归档的兜底白名单（.tar.gz 等经最后一段后缀命中） */
const ARCHIVE_EXT_WHITELIST = new Set(['.zip', '.jar', '.apk', '.tar', '.tgz', '.gz', '.xz', '.bz2', '.zst', '.7z']);

/** Markdown 扩展名 */
const MARKDOWN_EXT_WHITELIST = new Set(['.md', '.markdown']);

/** PDF 预览页数上限：只渲染前 5 页，超出时在尾部显示「全文不止 5 页」说明 */
const PDF_PREVIEW_PAGES = 5;

/** mime 缺失/未知时按扩展名判定文本的兜底白名单 */
const TEXT_EXT_WHITELIST = new Set([
  '.txt', '.json', '.xml', '.log', '.csv', '.ini', '.conf', '.cfg',
  '.yml', '.yaml', '.toml', '.sh', '.bash', '.zsh', '.py', '.js', '.ts', '.jsx', '.tsx',
  '.css', '.html', '.htm', '.c', '.h', '.cpp', '.hpp', '.java', '.go', '.rs', '.rb',
  '.php', '.lua', '.sql', '.less', '.scss', '.sass', '.vue', '.svelte', '.tex', '.rst',
  '.swift', '.kt', '.kts', '.pl', '.pm', '.cs', '.dockerfile', '.properties', '.env',
]);

/** 取文件扩展名（小写，含点；无扩展名返回空串） */
function fileExt(name: string): string {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  return dot >= 0 ? lower.slice(dot) : '';
}

/** 判定条目是否可按图片预览 */
function isImagePreviewable(file: IFile): boolean {
  return file.mime?.startsWith('image/') || IMAGE_EXT_WHITELIST.has(fileExt(file.name));
}

/** 判定条目是否可按视频预览（mime 白名单 + 扩展名兜底） */
function isVideoPreviewable(file: IFile): boolean {
  if (file.mime && VIDEO_MIME_WHITELIST.has(file.mime)) return true;
  return VIDEO_EXT_WHITELIST.has(fileExt(file.name));
}

/** 判定条目是否可按音频预览（mime 白名单 + 扩展名兜底） */
function isAudioPreviewable(file: IFile): boolean {
  if (file.mime?.startsWith('audio/')) return true;
  return AUDIO_EXT_WHITELIST.has(fileExt(file.name));
}

/** 判定条目是否可按 PDF 预览 */
function isPdfPreviewable(file: IFile): boolean {
  return file.mime === 'application/pdf' || fileExt(file.name) === '.pdf';
}

/** 判定条目是否可按归档内容列表预览 */
function isArchivePreviewable(file: IFile): boolean {
  if (file.mime && ARCHIVE_MIME_WHITELIST.has(file.mime)) return true;
  return ARCHIVE_EXT_WHITELIST.has(fileExt(file.name));
}

/** 判定条目是否可按 Markdown 渲染预览 */
function isMarkdownPreviewable(file: IFile): boolean {
  return file.mime === 'text/markdown' || MARKDOWN_EXT_WHITELIST.has(fileExt(file.name));
}

/** 判定条目是否可按文本预览 */
function isTextPreviewable(file: IFile): boolean {
  if (file.mime?.startsWith('text/')) return true;
  if (file.mime === 'application/json' || file.mime === 'application/xml') return true;
  return TEXT_EXT_WHITELIST.has(fileExt(file.name));
}

/** 预览渲染类型 */
type PreviewKind = 'image' | 'audio' | 'video' | 'pdf' | 'archive' | 'markdown' | 'text' | 'unsupported';

/** 判定文件条目的预览渲染类型（目录不进入此判定，由调用方过滤） */
function getPreviewKind(file: IFile): PreviewKind {
  if (isImagePreviewable(file)) return 'image';
  if (isVideoPreviewable(file)) return 'video';
  if (isAudioPreviewable(file)) return 'audio';
  if (isPdfPreviewable(file)) return 'pdf';
  if (isArchivePreviewable(file)) return 'archive';
  if (isMarkdownPreviewable(file)) return 'markdown';
  if (isTextPreviewable(file)) return 'text';
  return 'unsupported';
}

/** 字节数 → 人类可读大小（预览面板标题用，与仪表盘 formatBytes 同构） */
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** 文本/Markdown 加载状态 */
interface TextState {
  status: 'idle' | 'loading' | 'ready' | 'too_large' | 'error';
  content?: string;
}

/** PDF 加载状态 */
interface PdfState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  numPages?: number;
}

/** 归档内容列表加载状态 */
interface ArchiveState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  entries?: string[];
  truncated?: boolean;
  /** 完整条目总数（截断时用于提示隐藏数量） */
  total?: number;
}

interface FilePreviewPanelProps {
  /** 单选文件条目（multiple 为 true 时忽略） */
  file?: IFile;
  /** 多选状态：显示「多个文件无法预览」占位 */
  multiple?: boolean;
  /** 面板宽度（百分比，由父级分隔条拖动控制） */
  width: number;
}

/** 单页 PDF 画布：按面板宽度自适应缩放渲染（dpr 上限 2 防超大画布） */
const PdfPage: React.FC<{ doc: PDFDocumentProxy; pageNumber: number; width: number }> = ({ doc, pageNumber, width }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    // 宽度未测量前（0）跳过渲染：ResizeObserver 测量到容器宽后会重跑
    if (width <= 0) return;
    let cancelled = false;
    void doc
      .getPage(pageNumber)
      .then((page) => {
        if (cancelled) return;
        const base = page.getViewport({ scale: 1 });
        const scale = Math.max(width / base.width, 0.25);
        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        void page
          .render({ canvas, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined })
          .promise.catch(() => { /* 渲染失败：页面保持空白，不打断其余页面 */ });
      })
      .catch(() => { /* 单页解析失败：跳过 */ });
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber, width]);

  return <canvas ref={canvasRef} className="file-preview-pdf-page" />;
};

/**
 * 文件预览面板（文件浏览区右侧挤压出的区域）：
 * - 图片：`<img>` 加载 preview:// 原图（object-fit contain）；
 * - 音频：`<audio controls>`（Chromium 原生解码）；
 * - 视频：`<video controls>` 走 preview:// 的 Range/206 分段（支持 seek）；
 * - PDF：pdfjs-dist 惰性加载（动态 import，独立 chunk），逐页 canvas 渲染
 *   + 滚动到底部追加渲染页（初始 3 页）；
 * - 归档：`fs:list-archive`（unzip/tar/bsdtar/7z）列出内容条目，上限 5000；
 * - Markdown：marked 渲染 + DOMPurify 消毒（防 XSS），动态 import；
 * - 文本/代码：`fs:read-preview-text`（512 KiB 上限）取回后 `<pre>` 渲染；
 * - 其他类型 / 多选：显示对应的「无法预览」占位。
 * 顶部小标题栏显示文件名与大小；媒体元素以 file.path 为 key，
 * 切换选中项时整体重建（无跨文件缓冲复用问题）。
 */
export const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({ file, multiple, width }) => {
  const kind = file ? getPreviewKind(file) : null;
  const [textState, setTextState] = useState<TextState>({ status: 'idle' });
  const [mdState, setMdState] = useState<TextState>({ status: 'idle' });
  const [pdfState, setPdfState] = useState<PdfState>({ status: 'idle' });
  const [archiveState, setArchiveState] = useState<ArchiveState>({ status: 'idle' });
  const [mediaError, setMediaError] = useState(false);

  /** 当前 PDF 文档实例（state 持有供渲染；销毁在加载 effect 的 cleanup 内完成） */
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  /** PDF 容器宽（ResizeObserver 测量，供页面自适应缩放） */
  const [pdfWidth, setPdfWidth] = useState(0);
  const pdfContainerRef = useRef<HTMLDivElement | null>(null);

  // 文件切换时重置全部加载状态：React 官方「渲染期间重置状态」模式
  // （跟踪上一个 file.path，变化时在渲染中同步 setState，避免 effect
  // 内 setState 的级联渲染与瞬时陈旧态）；需要异步加载的类型初始即
  // 进入加载态，随后由对应加载 effect 拉取内容。
  const lastPathRef = useRef<string | undefined>(undefined);
  if (lastPathRef.current !== file?.path) {
    lastPathRef.current = file?.path;
    setMediaError(false);
    setTextState({ status: kind === 'text' ? 'loading' : 'idle' });
    setMdState({ status: kind === 'markdown' ? 'loading' : 'idle' });
    setPdfState({ status: kind === 'pdf' ? 'loading' : 'idle' });
    setArchiveState({ status: kind === 'archive' ? 'loading' : 'idle' });
    setPdfDoc(null);
  }

  /** 文本内容惰性加载：文件变化或进入文本预览时拉取，卸载/切换时取消 */
  useEffect(() => {
    if (!file || kind !== 'text') return;
    let cancelled = false;
    void window.electron
      ?.readPreviewText(file.path)
      .then((res) => {
        if (cancelled) return;
        if (!res) setTextState({ status: 'error' });
        else if (res.success && typeof res.content === 'string') {
          setTextState({ status: 'ready', content: res.content });
        } else if (res.code === 'TOO_LARGE') {
          setTextState({ status: 'too_large' });
        } else {
          setTextState({ status: 'error' });
        }
      })
      .catch(() => {
        if (!cancelled) setTextState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随文件与类型变化重载
  }, [file?.path, kind]);

  /** Markdown 惰性加载：读文本 → marked 渲染 → DOMPurify 消毒 */
  useEffect(() => {
    if (!file || kind !== 'markdown') return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await window.electron?.readPreviewText(file.path);
        if (cancelled) return;
        if (!res) {
          setMdState({ status: 'error' });
          return;
        }
        if (!res.success) {
          setMdState({ status: res.code === 'TOO_LARGE' ? 'too_large' : 'error' });
          return;
        }
        const [{ marked }, { default: DOMPurify }] = await Promise.all([
          import('marked'),
          import('dompurify'),
        ]);
        if (cancelled) return;
        const html = DOMPurify.sanitize(marked.parse(res.content ?? '', { async: false }) as string);
        setMdState({ status: 'ready', content: html });
      } catch {
        if (!cancelled) setMdState({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随文件与类型变化重载
  }, [file?.path, kind]);

  /** PDF 惰性加载：动态 import pdfjs-dist（独立 chunk），配置 worker 后打开文档 */
  useEffect(() => {
    if (!file || kind !== 'pdf') return;
    let cancelled = false;
    // 文档实例只在 effect 作用域内引用：cleanup 经 loadingTask.destroy
    // 销毁（pdf.js v6 起 destroy 在 loadingTask 上），渲染经 state 持有
    let task: ReturnType<typeof import('pdfjs-dist').getDocument> | null = null;
    void (async () => {
      try {
        const pdfjs = await import('pdfjs-dist');
        const workerModule = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default;
        task = pdfjs.getDocument({ url: `preview://localhost${file.path}` });
        const doc = await task.promise;
        if (cancelled) {
          void task.destroy();
          return;
        }
        setPdfDoc(doc);
        setPdfState({ status: 'ready', numPages: doc.numPages });
      } catch {
        if (!cancelled) setPdfState({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
      if (task) void task.destroy().catch(() => { /* 销毁失败忽略 */ });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随文件与类型变化重载
  }, [file?.path, kind]);

  /** PDF 容器宽度测量（ResizeObserver）：页面 canvas 按容器宽自适应缩放。
   *  依赖含 pdfState.status——容器在 status==='ready' 时才挂载，
   *  只在 kind 变化时订阅会因容器尚不存在而提前退出且永不重试。 */
  useEffect(() => {
    if (kind !== 'pdf' || pdfState.status !== 'ready') return;
    const el = pdfContainerRef.current;
    if (!el) return;
    const update = () => setPdfWidth(Math.max(el.clientWidth - 20, 200));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [kind, pdfState.status]);

  /** 归档内容列表惰性加载 */
  useEffect(() => {
    if (!file || kind !== 'archive') return;
    let cancelled = false;
    void window.electron
      ?.listArchive(file.path)
      .then((res) => {
        if (cancelled) return;
        if (!res || !res.success || !Array.isArray(res.entries)) {
          setArchiveState({ status: 'error' });
        } else {
          setArchiveState({ status: 'ready', entries: res.entries, truncated: res.truncated, total: res.total });
        }
      })
      .catch(() => {
        if (!cancelled) setArchiveState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随文件与类型变化重载
  }, [file?.path, kind]);

  const headerIcon = multiple
    ? 'description'
    : kind === 'image'
      ? 'image'
      : kind === 'video'
        ? 'movie'
        : kind === 'audio'
          ? 'music_note'
          : kind === 'pdf'
            ? 'picture_as_pdf'
            : kind === 'archive'
              ? 'folder_zip'
              : kind === 'markdown' || kind === 'text'
                ? 'article'
                : 'description';

  /** 标题副行（大小 + 归档条目数） */
  const headerSub = () => {
    if (!file || multiple) return null;
    const parts = [formatBytes(file.size)];
    if (kind === 'archive' && archiveState.status === 'ready') {
      parts.push(t('preview.entries', archiveState.entries?.length ?? 0));
    }
    return parts.join(' · ');
  };

  /** 居中占位消息（多选 / 不支持格式 / 加载失败等） */
  const renderEmpty = (icon: string, message: string) => (
    <div className="file-preview-empty">
      <Icon name={icon} size={40} />
      <span>{message}</span>
    </div>
  );

  return (
    <div className="file-preview-panel" style={{ width: `${width}%` }}>
      <div className="file-preview-header">
        <Icon name={headerIcon} className="file-preview-header-icon" />
        <div className="file-preview-title">
          <span className="file-preview-name" title={file?.name}>
            {multiple ? t('preview.multiple') : file?.name}
          </span>
          {file && !multiple && (
            <span className="file-preview-size">{headerSub()}</span>
          )}
        </div>
      </div>

      <div className="file-preview-body">
        {multiple && renderEmpty('block', t('preview.multiple'))}

        {!multiple && file && kind === 'image' && (
          mediaError
            ? renderEmpty('broken_image', t('preview.load_failed'))
            : (
              <img
                key={file.path}
                className="file-preview-media"
                src={`preview://localhost${file.path}`}
                alt={file.name}
                onError={() => setMediaError(true)}
              />
            )
        )}

        {!multiple && file && kind === 'video' && (
          mediaError
            ? renderEmpty('error', t('preview.load_failed'))
            : (
              <video
                key={file.path}
                className="file-preview-media"
                src={`preview://localhost${file.path}`}
                controls
                preload="metadata"
                onError={() => setMediaError(true)}
              />
            )
        )}

        {!multiple && file && kind === 'audio' && (
          mediaError
            ? renderEmpty('error', t('preview.load_failed'))
            : (
              <audio
                key={file.path}
                className="file-preview-audio"
                src={`preview://localhost${file.path}`}
                controls
                preload="metadata"
                onError={() => setMediaError(true)}
              />
            )
        )}

        {!multiple && file && kind === 'pdf' && pdfState.status === 'loading' && (
          <div className="file-preview-loading">{t('preview.loading')}</div>
        )}
        {!multiple && file && kind === 'pdf' && pdfState.status === 'error' && (
          renderEmpty('error', t('preview.load_failed'))
        )}
        {!multiple && file && kind === 'pdf' && pdfState.status === 'ready' && (
          <div className="file-preview-pdf" ref={pdfContainerRef}>
            {pdfDoc && Array.from({ length: Math.min(PDF_PREVIEW_PAGES, pdfState.numPages ?? 0) }, (_, i) => (
              <PdfPage key={i + 1} doc={pdfDoc} pageNumber={i + 1} width={pdfWidth} />
            ))}
            {(pdfState.numPages ?? 0) > PDF_PREVIEW_PAGES && (
              <div className="file-preview-pdf-more">
                {t('preview.pdf_more_pages', pdfState.numPages)}
              </div>
            )}
          </div>
        )}

        {!multiple && file && kind === 'archive' && archiveState.status === 'loading' && (
          <div className="file-preview-loading">{t('preview.loading')}</div>
        )}
        {!multiple && file && kind === 'archive' && archiveState.status === 'error' && (
          renderEmpty('error', t('preview.load_failed'))
        )}
        {!multiple && file && kind === 'archive' && archiveState.status === 'ready' && (
          <div className="file-preview-archive">
            {archiveState.entries?.map((entry) => (
              <div key={entry} className="file-preview-archive-entry">{entry}</div>
            ))}
            {archiveState.truncated && (
              <div className="file-preview-archive-truncated">
                {t('preview.archive_truncated', Math.max((archiveState.total ?? 0) - (archiveState.entries?.length ?? 0), 0))}
              </div>
            )}
          </div>
        )}

        {!multiple && file && kind === 'markdown' && mdState.status === 'loading' && (
          <div className="file-preview-loading">{t('preview.loading')}</div>
        )}
        {!multiple && file && kind === 'markdown' && mdState.status === 'too_large' && (
          renderEmpty('file_present', t('preview.too_large'))
        )}
        {!multiple && file && kind === 'markdown' && mdState.status === 'error' && (
          renderEmpty('error', t('preview.load_failed'))
        )}
        {!multiple && file && kind === 'markdown' && mdState.status === 'ready' && (
          <div
            key={file.path}
            className="file-preview-markdown"
            // DOMPurify 已消毒（脚本/事件属性/危险协议全部移除），安全注入
            dangerouslySetInnerHTML={{ __html: mdState.content ?? '' }}
          />
        )}

        {!multiple && file && kind === 'text' && textState.status === 'loading' && (
          <div className="file-preview-loading">{t('preview.loading')}</div>
        )}
        {!multiple && file && kind === 'text' && textState.status === 'too_large' && (
          renderEmpty('file_present', t('preview.too_large'))
        )}
        {!multiple && file && kind === 'text' && textState.status === 'error' && (
          renderEmpty('error', t('preview.load_failed'))
        )}
        {!multiple && file && kind === 'text' && textState.status === 'ready' && (
          <pre key={file.path} className="file-preview-text">{textState.content}</pre>
        )}

        {!multiple && file && kind === 'unsupported' && (
          renderEmpty('block', t('preview.unsupported_format'))
        )}
      </div>
    </div>
  );
};
