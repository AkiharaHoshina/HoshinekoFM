import { ipcMain, shell, type WebContents } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * Job item for copy/move operations.
 * Each item represents one file/directory to process.
 */
export interface JobItem {
  /** Source path */
  src: string;
  /** Destination path */
  dest: string;
}

/**
 * Job item for trash/permanent-delete operations.
 */
export interface TrashItem {
  /** Path to trash or permanently delete */
  path: string;
}

/**
 * Parameters for starting a new job.
 */
export interface StartJobParams {
  type: 'trash' | 'copy' | 'move' | 'delete';
  items: (JobItem | TrashItem)[];
}

/**
 * Progress data pushed to the renderer during job execution.
 */
export interface JobProgress {
  jobId: string;
  /** Number of items completed so far */
  current: number;
  /** Total number of items */
  total: number;
  /** Paths that have failed so far */
  errors: string[];
}

/**
 * Completion data pushed to the renderer when a job finishes.
 */
export interface JobComplete {
  jobId: string;
  /** Number of items successfully processed */
  success: number;
  /** Number of items that failed */
  fail: number;
  /** All error paths collected during processing */
  errors: string[];
  /** Whether the job was cancelled by the user */
  cancelled: boolean;
}

interface JobInfo {
  controller: AbortController;
  type: 'trash' | 'copy' | 'move' | 'delete';
  total: number;
  completed: number;
  errors: string[];
}

const jobs = new Map<string, JobInfo>();

function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Register IPC handlers for the job system.
 *
 * The job system allows long-running batch file operations
 * (trash/delete/copy/move) to report progress and be cancelled mid-flight. It follows the same
 * push-event pattern as {@link ../pty.ts|pty.ts}:
 * - `job:start` — invoke, returns a jobId immediately
 * - `job:cancel` — invoke, aborts the running job
 * - `job:progress` — pushed from main to renderer as items complete
 * - `job:complete` — pushed when the job finishes (success, failure, or cancel)
 */
export function initJobHandlers() {
  ipcMain.handle('job:start', async (event, params: StartJobParams): Promise<string> => {
    const { type, items } = params;
    const jobId = generateJobId();
    const controller = new AbortController();
    const sender = event.sender;

    const jobInfo: JobInfo = {
      controller,
      type,
      total: items.length,
      completed: 0,
      errors: [],
    };
    jobs.set(jobId, jobInfo);

    // Fire-and-forget: process in background, clean up on completion
    processItems(jobId, type, items, controller.signal, sender)
      .then(() => {
        jobs.delete(jobId);
      });

    return jobId;
  });

  ipcMain.handle('job:cancel', async (_event, jobId: string): Promise<void> => {
    const job = jobs.get(jobId);
    if (job) {
      job.controller.abort();
    }
  });
}

async function processItems(
  jobId: string,
  type: 'trash' | 'copy' | 'move' | 'delete',
  items: StartJobParams['items'],
  signal: AbortSignal,
  sender: WebContents,
): Promise<void> {
  let completed = 0;
  const errors: string[] = [];

  for (const item of items) {
    if (signal.aborted) break;

    try {
      if (type === 'trash') {
        const ti = item as TrashItem;
        await shell.trashItem(ti.path);
      } else if (type === 'delete') {
        const ti = item as TrashItem;
        await fs.rm(ti.path, { recursive: true, force: true });
      } else if (type === 'copy') {
        const ji = item as JobItem;
        await fs.mkdir(path.dirname(ji.dest), { recursive: true });
        await fs.cp(ji.src, ji.dest, { recursive: true, force: false });
      } else if (type === 'move') {
        const ji = item as JobItem;
        // 目标父目录可能不存在（例如从回收站还原到已删除的目录）——先创建
        await fs.mkdir(path.dirname(ji.dest), { recursive: true });
        try {
          await fs.rename(ji.src, ji.dest);
        } catch (err) {
          // 跨设备移动（EXDEV）时回退为复制 + 删除
          if ((err as NodeJS.ErrnoException).code === 'EXDEV') {
            await fs.cp(ji.src, ji.dest, { recursive: true, force: false });
            await fs.rm(ji.src, { recursive: true, force: true });
          } else {
            throw err;
          }
        }
      }
    } catch {
      if (type === 'trash' || type === 'delete') {
        errors.push((item as TrashItem).path);
      } else {
        errors.push((item as JobItem).src);
      }
    }

    completed++;

    if (!sender.isDestroyed()) {
      sender.send('job:progress', {
        jobId,
        current: completed,
        total: items.length,
        errors: [...errors],
      } satisfies JobProgress);
    }
  }

  const success = completed - errors.length;
  const fail = errors.length;
  const cancelled = signal.aborted;

  if (!sender.isDestroyed()) {
    sender.send('job:complete', {
      jobId,
      success,
      fail,
      errors,
      cancelled,
    } satisfies JobComplete);
  }
}
