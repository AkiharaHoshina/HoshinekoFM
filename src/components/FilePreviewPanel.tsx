import React, { useEffect, useRef, useState } from 'react';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import type { IFile } from '../types/files';
import { Icon } from './Icon';
import { PropertiesGrid } from './PropertiesGrid';
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

/**
 * 归一化 POSIX 路径：折叠 `.`、`..` 与多余斜杠（渲染进程无 node:path）。
 * 不做任何文件系统访问——仅字符串处理，供 Markdown 相对路径解析用。
 *
 * @param p - 输入路径（可含 `.`/`..`/双斜杠）
 * @returns 归一化后的绝对路径
 */
function normalizePosixPath(p: string): string {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop();
      else out.push('..');
      continue;
    }
    out.push(part);
  }
  return (p.startsWith('/') ? '/' : '') + out.join('/');
}

/**
 * 把 Markdown 渲染结果中的本地相对图片 `src` 改写为 `preview://` 绝对路径。
 * - 相对路径（`docs/x.png`、`./x.png`、`../x.png`）按 Markdown 文件所在目录解析；
 * - 以 `/` 开头的按文件系统根路径解析；
 * - 协议相对（`//…`）、显式协议（http/https/data/preview/media 等）与锚点不处理。
 * 路径经 DOM API 写回（属性自动转义，无注入风险），`#`/`?` 编码防止
 * 被当作 URL 片段/查询截断。
 *
 * @param html - DOMPurify 消毒后的 HTML
 * @param baseDir - Markdown 文件所在目录（绝对路径）
 * @returns 图片路径改写后的 HTML
 */
function rewriteMarkdownImageSrcs(html: string, baseDir: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('img').forEach((img) => {
    const src = img.getAttribute('src');
    if (!src) return;
    if (/^\/\//.test(src) || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src) || src.startsWith('#')) return;
    const clean = src.split(/[?#]/)[0];
    const abs = normalizePosixPath(clean.startsWith('/') ? clean : `${baseDir}/${clean}`);
    img.setAttribute('src', `preview://localhost${encodeURI(abs).replace(/#/g, '%23')}`);
  });
  return doc.body.innerHTML;
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
  /** 目录属性视图：未选中条目时显示该目录的只读属性（面板常驻；
   *  单选目录时由父级传该目录的路径） */
  dirPath?: string;
  /** 目录为回收站条目时的原始位置（属性网格的位置行显示） */
  dirTrashOriginalPath?: string;
  /** 面板宽度（百分比，由父级分隔条拖动控制） */
  width: number;
}

/** 目录属性加载状态（未选中条目时面板常驻展示当前目录）：
 *  ready 时携带由 getDirInfo 构造的 IFile（供共享 PropertiesGrid 渲染）
 *  与大小计算用的真实路径（trash:// 虚拟路径解析后的回收站目录） */
interface DirInfoState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  file?: IFile;
  sizePath?: string;
}

/**
 * 单页 PDF 画布：按面板宽度自适应缩放渲染（dpr 上限 2 防超大画布）。
 *
 * 并发防护：同一 canvas 上不允许两个 render 任务并行——面板宽度经
 * ResizeObserver 连续变化（初次测量/窗口缩放/分隔条拖动）会触发多次
 * 重渲染，若不取消上一轮仍在进行的任务，旧任务会在 canvas 位图被
 * 重置（canvas.width 赋值清空并复位 context 变换）后继续绘制，产生
 * 黑底/上下翻转的坏页（首屏先渲染的第一页最先命中）。清理阶段必须
 * cancel 进行中的 render 任务。
 */
const PdfPage: React.FC<{ doc: PDFDocumentProxy; pageNumber: number; width: number }> = ({ doc, pageNumber, width }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  /** 当前进行中的渲染任务（卸载/重渲染前 cancel，防旧任务画坏画布） */
  const renderTaskRef = useRef<RenderTask | null>(null);

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

        // 取消上一轮仍未结束的渲染任务（pdf.js 同一 canvas 并发 render
        // 不安全——旧任务会在画布重置后继续绘制）
        if (renderTaskRef.current) {
          renderTaskRef.current.cancel();
          renderTaskRef.current = null;
        }

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const task = page.render({
          canvas,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        renderTaskRef.current = task;
        void task.promise.catch(() => { /* 取消/渲染失败：下一轮重渲染兜底，不打断其余页面 */ });
      })
      .catch(() => { /* 单页解析失败：跳过 */ });
    return () => {
      cancelled = true;
      // 取消进行中的渲染：旧任务不得在重渲染/卸载后的画布上继续绘制
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [doc, pageNumber, width]);

  return <canvas ref={canvasRef} className="file-preview-pdf-page" />;
};

/**
 * 文件预览面板（文件浏览区右侧挤压出的区域，开启预览后常驻）：
 * - 未选中条目：显示当前浏览目录的**只读属性**（位置/大小/修改时间/
 *   权限位/属主/类型，无修改权限按钮）；
 * - 图片：`<img>` 加载 preview:// 原图（object-fit contain）；
 * - 音频：`<audio controls>`（Chromium 原生解码）；
 * - 视频：`<video controls>` 走 preview:// 的 Range/206 分段（支持 seek）；
 * - PDF：pdfjs-dist 惰性加载（动态 import，独立 chunk），逐页 canvas 渲染
 *   前 5 页（超出显示全文页数说明）；
 * - 归档：`fs:list-archive`（unzip/tar/bsdtar/7z）列出内容条目，上限 5000；
 * - Markdown：marked 渲染 + DOMPurify 消毒（防 XSS），动态 import；
 * - 文本/代码：`fs:read-preview-text`（512 KiB 上限）取回后 `<pre>` 渲染；
 * - 其他类型 / 多选：显示对应的「无法预览」占位。
 * 顶部小标题栏显示文件名与大小；媒体元素以 file.path 为 key，
 * 切换选中项时整体重建（无跨文件缓冲复用问题）。
 */
export const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({ file, multiple, dirPath, dirTrashOriginalPath, width }) => {
  const kind = file ? getPreviewKind(file) : null;
  /** 目录属性视图激活：无选中文件且传入了目录路径 */
  const dirActive = !file && !multiple && !!dirPath;
  /**
   * 文件修改时间（毫秒，原始值）：外部编辑保存 → fs:dir-changed →
   * 父级重列目录后 file.mtime 更新。作为内容变更信号驱动各预览类型的
   * 重载 effect 与媒体 URL 缓存戳（路径不变时依赖它检测内容变化）。
   */
  const mtimeMs = file?.mtime?.getTime() ?? 0;
  const [textState, setTextState] = useState<TextState>({ status: 'idle' });
  const [mdState, setMdState] = useState<TextState>({ status: 'idle' });
  const [pdfState, setPdfState] = useState<PdfState>({ status: 'idle' });
  const [archiveState, setArchiveState] = useState<ArchiveState>({ status: 'idle' });
  const [dirState, setDirState] = useState<DirInfoState>({ status: 'idle' });
  const [mediaError, setMediaError] = useState(false);

  /** 当前 PDF 文档实例（state 持有供渲染；销毁在加载 effect 的 cleanup 内完成） */
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  /** PDF 容器宽（ResizeObserver 测量，供页面自适应缩放） */
  const [pdfWidth, setPdfWidth] = useState(0);
  const pdfContainerRef = useRef<HTMLDivElement | null>(null);

  // 文件切换/内容变化（mtime）/目录变化时重置全部加载状态：React 官方
  // 「渲染期间重置状态」模式（跟踪上一个 key，变化时在渲染中同步 setState，
  // 避免 effect 内 setState 的级联渲染与瞬时陈旧态）；需要异步加载的
  // 类型初始即进入加载态，随后由对应加载 effect 拉取内容。外部编辑保存
  // 后父级重列目录会带来新的 mtime——路径不变也能触发重置与重载。
  const previewKey = file ? `${file.path}:${mtimeMs}` : (dirActive ? `dir:${dirPath}` : undefined);
  const lastPathRef = useRef<string | undefined>(undefined);
  if (lastPathRef.current !== previewKey) {
    lastPathRef.current = previewKey;
    setMediaError(false);
    setTextState({ status: kind === 'text' ? 'loading' : 'idle' });
    setMdState({ status: kind === 'markdown' ? 'loading' : 'idle' });
    setPdfState({ status: kind === 'pdf' ? 'loading' : 'idle' });
    setArchiveState({ status: kind === 'archive' ? 'loading' : 'idle' });
    setDirState({ status: dirActive ? 'loading' : 'idle' });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随文件/类型/内容变化（mtime）重载
  }, [file?.path, kind, mtimeMs]);

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
        // 本地相对图片按 Markdown 文件所在目录解析为 preview:// 绝对路径
        const baseDir = file.path.substring(0, file.path.lastIndexOf('/'));
        setMdState({ status: 'ready', content: rewriteMarkdownImageSrcs(html, baseDir) });
      } catch {
        if (!cancelled) setMdState({ status: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随文件/类型/内容变化（mtime）重载
  }, [file?.path, kind, mtimeMs]);

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
        task = pdfjs.getDocument({ url: `preview://localhost${file.path}?v=${mtimeMs}` });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随文件/类型/内容变化（mtime）重载
  }, [file?.path, kind, mtimeMs]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅随文件/类型/内容变化（mtime）重载
  }, [file?.path, kind, mtimeMs]);

  /** 目录属性惰性加载（未选中条目时的常驻视图）：
   *  轻量 IPC 只取 stat + 属主（毫秒级），构造 IFile 交给共享
   *  PropertiesGrid 渲染——大小由网格内部走 getDirectorySize（与右键
   *  属性对话框同一条 du 路径，仅大小行「计算中」，其余字段秒回） */
  useEffect(() => {
    if (!dirActive || !dirPath) return;
    let cancelled = false;
    void window.electron
      ?.getDirInfo(dirPath)
      .then((res) => {
        if (cancelled) return;
        if (!res || !res.success || !res.path) {
          setDirState({ status: 'error' });
          return;
        }
        setDirState({
          status: 'ready',
          file: {
            name: dirPath === 'trash://'
              ? 'trash://'
              : dirPath === '/'
                ? '/'
                : dirPath.split('/').filter(Boolean).pop() || '/',
            path: dirPath,
            isDirectory: true,
            size: 0,
            mtime: res.mtime ? new Date(res.mtime) : new Date(0),
            mime: 'inode/directory',
            mode: res.mode,
            uid: res.uid,
            gid: res.gid,
            userName: res.userName,
            groupName: res.groupName,
            trashOriginalPath: dirTrashOriginalPath,
          },
          sizePath: res.path,
        });
      })
      .catch(() => {
        if (!cancelled) setDirState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, [dirActive, dirPath, dirTrashOriginalPath]);

  /** 目录显示名：路径末段，根目录为 '/'，回收站虚拟目录为 'trash://' */
  const dirDisplayName = dirPath
    ? (dirPath === 'trash://'
      ? 'trash://'
      : dirPath === '/'
        ? '/'
        : dirPath.split('/').filter(Boolean).pop() || '/')
    : '';

  const headerIcon = dirActive
    ? 'folder'
    : multiple
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

  /** 标题副行（大小 + 归档条目数；目录视图显示类型） */
  const headerSub = () => {
    if (dirActive) return t('properties.directory');
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
          <span className="file-preview-name" title={dirActive ? dirPath : file?.name}>
            {dirActive ? dirDisplayName : multiple ? t('preview.multiple') : file?.name}
          </span>
          {(dirActive || (file && !multiple)) && (
            <span className="file-preview-size">{headerSub()}</span>
          )}
        </div>
      </div>

      <div className="file-preview-body">
        {multiple && renderEmpty('block', t('preview.multiple'))}

        {dirActive && dirState.status === 'loading' && (
          <div className="file-preview-loading">{t('preview.loading')}</div>
        )}
        {dirActive && dirState.status === 'error' && (
          renderEmpty('error', t('preview.load_failed'))
        )}
        {/* 目录属性：复用右键属性对话框的共享网格（权限只读，无修改按钮）；
            key = 真实路径，切换目录时按条目重建（状态自然重置） */}
        {dirActive && dirState.status === 'ready' && dirState.file && (
          <div className="file-preview-dirinfo">
            <PropertiesGrid
              key={dirState.sizePath ?? dirState.file.path}
              file={dirState.file}
              sizePath={dirState.sizePath}
              canEditPermissions={false}
            />
          </div>
        )}

        {!multiple && file && kind === 'image' && (
          mediaError
            ? renderEmpty('broken_image', t('preview.load_failed'))
            : (
              <img
                key={`${file.path}:${mtimeMs}`}
                className="file-preview-media"
                src={`preview://localhost${file.path}?v=${mtimeMs}`}
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
                key={`${file.path}:${mtimeMs}`}
                className="file-preview-media"
                src={`preview://localhost${file.path}?v=${mtimeMs}`}
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
                key={`${file.path}:${mtimeMs}`}
                className="file-preview-audio"
                src={`preview://localhost${file.path}?v=${mtimeMs}`}
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
