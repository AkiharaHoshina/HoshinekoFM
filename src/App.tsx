import { useState, useEffect, useCallback, useRef } from "react";
import { showToast } from "./utils/toast";
import { t, setLocale, getLocale, type Locale } from "./i18n";
import { initDragIcons } from "./utils/dragIconRenderer";
import "./index.css";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import "./utils/toast.css";
import { ClipboardProvider, useClipboard } from "./contexts/ClipboardContext";
import { DragProvider } from "./contexts/DragContext";
import { ThemeService } from "./services/ThemeService";
import { NavigationRail } from "./components/NavigationRail";
import { Sidebar } from "./components/Sidebar";
import { Icon } from "./components/Icon";
import { IconButton } from "./components/IconButton";
import { ContextMenu } from "./components/ContextMenu";
import type { ContextMenuItem } from "./components/ContextMenu";
import { SettingsDialog } from "./components/SettingsDialog";
import { TerminalPane } from "./components/TerminalPane";
import type { IFile, GvfsVolume } from "./types/files";
import { Dialog } from "./components/Dialog";
import { Button } from "./components/Button";
import { OutlinedTextField } from "./components/md";
import { TabBar } from "./components/TabBar";
import { ExplorerTab } from "./components/ExplorerTab";
import { OpenWithDialog } from "./components/OpenWithDialog";
import { PropertiesDialog } from "./components/PropertiesDialog";
import { useLocalStorage } from "./hooks/useLocalStorage";
import {
  trashFiles,
  deleteFilesPermanently,
  restoreTrashItems,
  removeTrashItems,
  pasteFiles,
  extractFile,
  openFile,
  buildPermanentDeleteMessage,
  openInDefaultTerminal,
  runInDefaultTerminal,
} from "./utils/fileOperations";
import { NameInputDialog } from "./components/NameInputDialog";
import { ConflictDialog } from "./components/ConflictDialog";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DragActionDialog } from "./components/DragActionDialog";
import {
  generateSafeName,
  splitNameExt,
} from "./utils/fileConflict";
import { useTabs } from "./hooks/useTabs";
import { useContextMenu } from "./hooks/useContextMenu";
import { useRenameDialog } from "./hooks/useRenameDialog";
import { useConflictDialog } from "./hooks/useConflictDialog";
import { useConfirmDialog } from "./hooks/useConfirmDialog";
import { useDragActionDialog } from "./hooks/useDragActionDialog";
import { useCreateDialog } from "./hooks/useCreateDialog";
import { useDeviceActions } from "./hooks/useDeviceActions";
import { attachNativeDragTracker } from "./utils/nativeDragTracker";

function AppContent() {
  const {
    tabs,
    activeTabId,
    setActiveTabId,
    currentPath,
    handleAddTab,
    handleCloseTab,
    handleTabPathUpdate,
    handleSidebarNavigate,
    handleScrollToComplete,
    refreshActiveTab,
  } = useTabs();

  const {
    contextMenu,
    bgMenuItems,
    deviceContextMenu,
    gvfsContextMenu,
    handleContextMenu,
    handleDeviceContextMenu,
    handleGvfsContextMenu,
    handleBgMenuItems,
    closeContextMenu,
    closeDeviceContextMenu,
    closeGvfsContextMenu,
  } = useContextMenu();

  const {
    renameDialogOpen,
    setRenameDialogOpen,
    newName,
    setNewName,
    handleRename,
    openRenameDialog,
  } = useRenameDialog(refreshActiveTab);

  const {
    singleConflict,
    setSingleConflict,
    multiConflict,
    setMultiConflict,
    handleConflictDialog,
  } = useConflictDialog();

  const {
    confirmDialog,
    confirm,
    handleConfirm,
    handleCancel,
  } = useConfirmDialog();

  const {
    dragAction,
    requestDragAction,
    handleMove: handleDragMove,
    handleCopy: handleDragCopy,
    handleCancel: handleDragActionCancel,
  } = useDragActionDialog();

  const {
    createDialog,
    setCreateDialog,
    handleCreateDialog,
  } = useCreateDialog();

  const {
    handleDeviceMount,
    handleDeviceUnmount,
    handleDeviceEject,
    handleGvfsUnmount,
    handleGvfsMount,
  } = useDeviceActions();

  /**
   * 卸载 gvfs 卷；若当前标签页正停留于该挂载点（含子目录），
   * 先跳回仪表盘，避免停留在已失效的 FUSE 目录页
   */
  const handleGvfsUnmountWithNav = useCallback((volume: GvfsVolume) => {
    if (volume.mountpoint && currentPath.startsWith(volume.mountpoint)) {
      handleSidebarNavigate("app://dashboard");
    }
    handleGvfsUnmount(volume);
  }, [currentPath, handleSidebarNavigate, handleGvfsUnmount]);

  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalCwd, setTerminalCwd] = useState<string | undefined>(undefined);

  const openTerminalAt = useCallback((path: string) => {
    setTerminalCwd(path);
    setTerminalOpen(true);
  }, []);

  const [propertiesDialogOpen, setPropertiesDialogOpen] = useState(false);
  const [propertiesFile, setPropertiesFile] = useState<IFile | null>(null);

  // ── 原生拖拽兜底判定：Wayland 落回源窗口不派发 drop，由 tracker 合成 ──
  useEffect(() => {
    attachNativeDragTracker();
  }, []);

  const [openWithFile, setOpenWithFile] = useState<IFile | null>(null);

  /** 拖到标签页的内部拖放请求，由目标标签页的 ExplorerTab 消费 */
  const [pendingTabDrop, setPendingTabDrop] = useState<{
    tabId: string;
    files: IFile[];
    operation: "move" | "copy";
    sourcePath: string;
  } | null>(null);

  const handleDropOnTab = useCallback(
    (tabId: string, files: IFile[], operation: "move" | "copy", sourcePath: string) => {
      setPendingTabDrop({ tabId, files, operation, sourcePath });
      setActiveTabId(tabId);
    },
    [setActiveTabId],
  );

  const { clipboard, copy, cut, clear: clearClipboard } = useClipboard();

  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

  const [showHiddenFiles, setShowHiddenFiles] = useLocalStorage<boolean>(
    "settings.showHiddenFiles",
    true,
  );
  const [iconSize, setIconSize] = useLocalStorage<number>(
    "settings.iconSize",
    64,
  );
  const [viewMode, setViewMode] = useLocalStorage<"grid" | "list">(
    "settings.viewMode",
    "grid",
  );
  const [filledIcons, setFilledIcons] = useLocalStorage<boolean>(
    "settings.filledIcons",
    false,
  );
  const [customCssPath, setCustomCssPath] = useState<string>("");
  const [locale, setLocaleState] = useLocalStorage<Locale>(
    "settings.locale",
    getLocale(),
  );

  /**
   * 应用语言：先同步更新 i18n 模块（当前窗口所有订阅者立即重渲染），
   * 再更新持久化状态（useLocalStorage 写入 localStorage 并触发其他窗口
   * 的 storage 事件）。若顺序相反，App 的重渲染会发生在 _locale 更新之前，
   * 未订阅 useLocale 的组件（导航栏、标签栏等）会晚一个渲染周期才显示
   * 新语言——这正是此前"设置窗口点击确定/退出才响应"的原因。
   */
  const handleLocaleChange = useCallback((loc: Locale) => {
    setLocale(loc);
    setLocaleState(loc);
  }, [setLocaleState]);

  useEffect(() => {
    setLocale(locale);
  }, [locale]);

  const [marqueeEnabled, setMarqueeEnabled] = useLocalStorage<boolean>(
    "settings.marqueeEnabled",
    true,
  );

  const handleLoadCustomCss = async (path: string) => {
    try {
      const css = await window.electron.readFile(path);
      if (css) {
        let style = document.getElementById("custom-user-css");
        if (!style) {
          style = document.createElement("style");
          style.id = "custom-user-css";
          document.head.appendChild(style);
        }
        style.textContent = css;
        setCustomCssPath(path);
        localStorage.setItem("customCssPath", path);
      }
    } catch (err) {
      console.error("Failed to load custom css", err);
    }
  };

  const handleImportCss = async () => {
    const path = await window.electron.openFileDialog();
    if (path) {
      handleLoadCustomCss(path);
    }
  };

  const loadHome = () => {
    handleAddTab("app://dashboard");
  };

  const hasInitialized = useRef(false);

  useEffect(() => {
    if (hasInitialized.current) return;
    hasInitialized.current = true;

    ThemeService.loadTheme();
    ThemeService.init();

    const init = async () => {
      if (window.electron) {
        initDragIcons();

        const startupPath = await window.electron.getStartupPath();
        if (startupPath) {
          handleAddTab(startupPath);
        } else {
          loadHome();
        }
      }
    };
    init();

    const storedCssPath = localStorage.getItem("customCssPath");
    if (storedCssPath) {
      handleLoadCustomCss(storedCssPath); // eslint-disable-line react-hooks/set-state-in-effect
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = (e: WheelEvent) => {
      const target = e.target as Node;
      const menu = document.querySelector('.context-menu');
      if (menu) {
        if (menu.contains(target)) return;
        e.preventDefault();
        return;
      }
      const openDialog = document.querySelector('md-dialog[open]');
      if (openDialog) {
        if (openDialog.contains(target)) return;
        e.preventDefault();
      }
    };
    window.addEventListener('wheel', handler, { passive: false });
    return () => window.removeEventListener('wheel', handler);
  }, []);

  const toggleTerminal = () => {
    setTerminalOpen((prev) => !prev);
  };

  const handleOpenWithFile = useCallback((file: IFile) => {
    setOpenWithFile(file);
  }, []);

  const handlePropertiesFile = useCallback((file: IFile) => {
    setPropertiesFile(file);
    setPropertiesDialogOpen(true);
  }, []);

  const handleCopy = (files: IFile[]) => {
    copy(files);
    closeContextMenu();
  };

  const handleCut = (files: IFile[]) => {
    cut(files);
    closeContextMenu();
  };

  const handlePaste = async () => {
    if (!clipboard || clipboard.files.length === 0) return;

    await pasteFiles(
      clipboard.files,
      clipboard.operation,
      currentPath,
      [],
      clipboard.operation === "cut" ? clearClipboard : undefined,
      refreshActiveTab,
    );
    closeContextMenu();
  };

  const menuItems: ContextMenuItem[] = (() => {
    const item = contextMenu?.item;
    if (item) {
      // 回收站内：仅提供还原 / 永久删除 / 属性
      if (currentPath === "trash://") {
        const trashSelected =
          contextMenu.selected.length > 0 ? contextMenu.selected : [item];
        return [
          {
            label: t("trash.restore"),
            icon: "restore_from_trash",
            action: () => {
              restoreTrashItems(trashSelected, refreshActiveTab, handleConflictDialog);
              closeContextMenu();
            },
          },
          {
            label: t("context_menu.delete_permanent"),
            icon: "delete_forever",
            action: () => {
              const names = trashSelected.map((f) => f.name);
              const paths = trashSelected.map((f) => f.path);
              void buildPermanentDeleteMessage(paths).then((message) =>
                confirm(t("context_menu.delete_permanent"), message).then((ok) => {
                  if (ok) removeTrashItems(names, refreshActiveTab);
                }),
              );
              closeContextMenu();
            },
          },
          { divider: true, label: "", action: () => {} },
          {
            label: t("context_menu.properties"),
            icon: "info",
            action: () => {
              setPropertiesFile(item);
              setPropertiesDialogOpen(true);
              closeContextMenu();
            },
          },
        ];
      }

      // 右键命中已选中文件时，批量操作作用于整个选中集；否则只作用于命中的文件
      const selectedFiles =
        contextMenu.selected.length > 0 ? contextMenu.selected : [item];
      const items: ContextMenuItem[] = [
        {
          label: t("context_menu.open"),
          icon: "open_in_new",
          action: () => {
            openFile(item.path);
            closeContextMenu();
          },
        },
        {
          label: t("context_menu.open_terminal"),
          icon: "terminal",
          action: () => openTerminalAt(item.path),
        },
        ...(item.isDirectory
          ? [{
            label: t("context_menu.open_in_terminal"),
            icon: "terminal",
            action: () => {
              void openInDefaultTerminal(item.path);
              closeContextMenu();
            },
          }]
          : []),
        ...(item.mode !== undefined && !item.isDirectory && (item.mode & 0o111) !== 0
          ? [{
            label: t("context_menu.run_in_terminal"),
            icon: "play_arrow",
            action: () => {
              void runInDefaultTerminal(item.path);
              closeContextMenu();
            },
          }]
          : []),
        { divider: true, label: "", action: () => {} },
        {
          label: t("context_menu.copy"),
          icon: "content_copy",
          action: () => handleCopy(selectedFiles),
        },
        {
          label: t("context_menu.cut"),
          icon: "content_cut",
          action: () => handleCut(selectedFiles),
        },
        {
          label: t("context_menu.delete"),
          icon: "delete",
          action: () =>
            trashFiles(selectedFiles.map((f) => f.path), refreshActiveTab),
        },
        {
          label: t("context_menu.delete_permanent"),
          icon: "delete_forever",
          action: () => {
            const paths = selectedFiles.map((f) => f.path);
            void buildPermanentDeleteMessage(paths).then((message) =>
              confirm(t("context_menu.delete_permanent"), message).then((ok) => {
                if (ok) deleteFilesPermanently(paths, refreshActiveTab);
              }),
            );
          },
        },
        {
          label: t("context_menu.extract_here"),
          icon: "unarchive",
          action: () => {
            extractFile(item.path, refreshActiveTab);
          },
        },
        {
          label: t("context_menu.rename"),
          icon: "edit",
          action: () => {
            openRenameDialog(item);
            closeContextMenu();
          },
        },
      ];

      const specialItems: ContextMenuItem[] = [];
      if (item.symlinkTarget && item.mime !== 'inode/symlink') {
        const targetFileName = item.isDirectory
          ? item.symlinkTarget.split("/").pop() || ""
          : "";
        specialItems.push({
          label: t("symlink.go_to_target"),
          icon: "arrow_forward",
          action: () => {
            if (item.isDirectory) {
              handleSidebarNavigate(item.symlinkTarget!, targetFileName);
            } else {
              const parent = item.symlinkTarget!.substring(0, item.symlinkTarget!.lastIndexOf("/"));
              const targetFileName = item.symlinkTarget!.split("/").pop() || "";
              handleSidebarNavigate(parent || "/", targetFileName);
            }
            closeContextMenu();
          },
        });
      }
      if (item.isMountpoint && item.mountSource) {
        const isRealDevice = item.mountSource.startsWith("/dev/") &&
          !["devtmpfs", "tmpfs", "sysfs", "proc", "hugetlbfs", "mqueue", "selinuxfs", "debugfs", "fusectl", "securityfs", "pstore", "bpf", "cgroup2", "configfs"].includes(
            item.mountSource.split("/").pop() || ""
          );
        if (isRealDevice) {
          const targetFileName = item.mountSource.split("/").pop() || "";
          specialItems.push({
            label: t("mountpoint.go_to_source"),
            icon: "hard_drive",
            action: () => {
              const parent = item.mountSource!.substring(0, item.mountSource!.lastIndexOf("/"));
              handleSidebarNavigate(parent || "/", targetFileName);
              closeContextMenu();
            },
          });
        }
      }
      if (item.mime === 'inode/blockdevice' && item.isExternal) {
        const devPath = item.devicePath || item.path;
        if (item.isMountable) {
          if (item.mountedAt) {
            specialItems.push({
              label: t("device.unmount"),
              icon: "eject",
              action: () => {
                handleDeviceUnmount(devPath);
                closeContextMenu();
              },
            });
          } else {
            specialItems.push({
              label: t("device.mount"),
              icon: "hard_drive",
              action: () => {
                handleDeviceMount(devPath);
                closeContextMenu();
              },
            });
          }
        }
        if (!item.parentDisk && !item.isMountable) {
          specialItems.push({
            label: t("device.eject"),
            icon: "power_settings_new",
            action: () => {
              handleDeviceEject(devPath);
              closeContextMenu();
            },
          });
        }
      }
      if (specialItems.length > 0) {
        items.push({ divider: true, label: "", action: () => {} }, ...specialItems);
      }

      items.push(
        { divider: true, label: "", action: () => {} },
        {
          label: t("context_menu.open_with"),
          icon: "apps",
          action: () => {
            setOpenWithFile(item);
            closeContextMenu();
          },
        },
        {
          label: t("context_menu.properties"),
          icon: "info",
          action: () => {
            setPropertiesFile(item);
            setPropertiesDialogOpen(true);
            closeContextMenu();
          },
        },
      );

      return items;
    }
    return (
      bgMenuItems ??
      [{ label: t("context_menu.paste"), icon: "content_paste", action: handlePaste }].filter(
        (menuItem) => {
          if (
            menuItem.label === t("context_menu.paste") &&
            (!clipboard || clipboard.files.length === 0)
          )
            return false;
          return true;
        },
      )
    );
  })();

  return (
    <div className="app-shell" onClick={closeContextMenu}>
      <NavigationRail
        items={[
          {
            icon: <Icon name="dashboard" />,
            activeIcon: <Icon name="dashboard" filled />,
            label: "Dashboard",
            active: currentPath === "app://dashboard",
            onClick: () => {
              const existing = tabs.find((t) =>
                t.path.startsWith("app://dashboard"),
              );
              if (existing) {
                setActiveTabId(existing.id);
              } else {
                handleAddTab("app://dashboard");
              }
            },
          },
          {
            icon: <Icon name="home" />,
            activeIcon: <Icon name="home" filled />,
            label: "Home",
            active: currentPath.startsWith("/home"),
            onClick: async () => {
              const home = await window.electron.getHomePath();
              const existingHomeTab = tabs.find((t) => t.path === home);
              if (existingHomeTab) {
                setActiveTabId(existingHomeTab.id);
              } else {
                handleAddTab(home);
              }
            },
          },
          {
            icon: <Icon name="folder" />,
            activeIcon: <Icon name="folder" filled />,
            label: "Files",
            active: currentPath === "/",
            onClick: () => handleSidebarNavigate("/"),
          },
          {
            icon: <Icon name="terminal" />,
            activeIcon: <Icon name="terminal" filled />,
            label: "Terminal",
            active: terminalOpen,
            onClick: toggleTerminal,
          },
          {
            icon: <Icon name="settings" />,
            activeIcon: <Icon name="settings" filled />,
            label: "Settings",
            onClick: () => setSettingsDialogOpen(true),
          },
        ]}
      />

      <Sidebar
        onNavigate={handleSidebarNavigate}
        currentPath={currentPath}
        onDeviceContextMenu={handleDeviceContextMenu}
        onDeviceMount={handleDeviceMount}
        onDeviceUnmount={handleDeviceUnmount}
        onDeviceEject={handleDeviceEject}
        onGvfsMount={handleGvfsMount}
        onGvfsUnmount={handleGvfsUnmountWithNav}
        onGvfsContextMenu={handleGvfsContextMenu}
        marqueeEnabled={marqueeEnabled}
      />

      <main className="main-content">
        <header className="tab-header-bar">
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabClick={setActiveTabId}
            onTabClose={handleCloseTab}
            onNewTab={() => handleAddTab()}
            onDropFiles={handleDropOnTab}
          />
        </header>

        <div className="content-area">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              style={{
                display: tab.id === activeTabId ? "block" : "none",
                height: "100%",
              }}
            >
              <ExplorerTab
                tabId={tab.id}
                isActive={tab.id === activeTabId}
                initialPath={tab.path}
                onPathChange={handleTabPathUpdate}
                onContextMenu={handleContextMenu}
                onBgMenuItems={handleBgMenuItems}
                onOpenWithFile={handleOpenWithFile}
                onPropertiesFile={handlePropertiesFile}
                onOpenTerminalAt={openTerminalAt}
                onCreateDialog={handleCreateDialog}
                onConflictDialog={handleConflictDialog}
                onConfirmDialog={confirm}
                onDragAction={requestDragAction}
                showHiddenFiles={showHiddenFiles}
                iconSize={iconSize}
                viewMode={viewMode}
                filledIcons={filledIcons}
                refreshSignal={tab.version}
                scrollToFileName={tab.pendingSelectFile}
                onScrollToComplete={handleScrollToComplete}
                onMountDevice={handleDeviceMount}
                marqueeEnabled={marqueeEnabled}
                pendingDrop={pendingTabDrop?.tabId === tab.id ? pendingTabDrop : null}
                onPendingDropHandled={() => setPendingTabDrop(null)}
              />
            </div>
          ))}
          {tabs.length === 0 && (
            <div className="empty-state">
              <div className="empty-state-content">
                <Icon name="tab" size={48} />
                <p>{t("empty.no_tabs")}</p>
                <Button onClick={() => handleAddTab()}>{t("empty.open_new_tab")}</Button>
              </div>
            </div>
          )}
        </div>

        {terminalOpen && (
          <div className="terminal-panel">
            <div className="terminal-panel-header">
              <span style={{ fontSize: "12px", fontWeight: 500 }}>
                {t("terminal.title")}
              </span>
              <div style={{ flex: 1 }} />
              <IconButton
                onClick={() => setTerminalOpen(false)}
                style={{ width: 24, height: 24 }}
              >
                <Icon name="close" size={16} />
              </IconButton>
            </div>
            <div style={{ flex: 1, position: "relative" }}>
              <TerminalPane
                cwd={
                  terminalCwd ||
                  tabs.find((t) => t.id === activeTabId)?.path ||
                  undefined
                }
              />
            </div>
          </div>
        )}

        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={menuItems}
            onClose={closeContextMenu}
          />
        )}

        {deviceContextMenu && (
          <ContextMenu
            x={deviceContextMenu.x}
            y={deviceContextMenu.y}
            items={(() => {
              const d = deviceContextMenu.device;
              const items: ContextMenuItem[] = [];
              items.push({
                label: t("device.go_to_source"),
                icon: "hard_drive",
                action: () => {
                  handleSidebarNavigate("/dev", d.name);
                  closeDeviceContextMenu();
                },
              });
              if (d.mounted) {
                items.push({
                  label: t("device.unmount"),
                  icon: "eject",
                  action: () => {
                    handleDeviceUnmount(d.devicePath);
                    closeDeviceContextMenu();
                  },
                });
                if (d.type !== 'part' && (d.hotplug || d.rm || d.tran === 'usb')) {
                  items.push({
                    label: t("device.eject"),
                    icon: "power_settings_new",
                    action: () => {
                      handleDeviceEject(d.devicePath);
                      closeDeviceContextMenu();
                    },
                  });
                }
              } else {
                items.push({
                  label: t("device.mount"),
                  icon: "hard_drive",
                  action: () => {
                    handleDeviceMount(d.devicePath);
                    closeDeviceContextMenu();
                  },
                });
              }
              return items;
            })()}
            onClose={closeDeviceContextMenu}
          />
        )}

        {gvfsContextMenu && (
          <ContextMenu
            x={gvfsContextMenu.x}
            y={gvfsContextMenu.y}
            items={(() => {
              const v = gvfsContextMenu.volume;
              const items: ContextMenuItem[] = [];
              if (v.mounted) {
                items.push({
                  label: t("device.unmount"),
                  icon: "eject",
                  action: () => {
                    handleGvfsUnmountWithNav(v);
                    closeGvfsContextMenu();
                  },
                });
              } else if (v.deviceId) {
                items.push({
                  label: t("device.mount"),
                  icon: "hard_drive",
                  action: () => {
                    void handleGvfsMount(v);
                    closeGvfsContextMenu();
                  },
                });
              }
              return items;
            })()}
            onClose={closeGvfsContextMenu}
          />
        )}

        <Dialog
          title={t("dialog.rename.title")}
          open={renameDialogOpen}
          onClose={() => setRenameDialogOpen(false)}
          actions={
            <>
              <Button variant="text" onClick={() => setRenameDialogOpen(false)}>
                {t("dialog.rename.cancel")}
              </Button>
              <Button onClick={handleRename}>{t("dialog.rename.confirm")}</Button>
            </>
          }
        >
          <OutlinedTextField
            label={t("dialog.rename.title")}
            value={newName}
            onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => {
              if ((e as React.KeyboardEvent).key === "Enter") handleRename();
            }}
            style={{ width: "100%" }}
          />
        </Dialog>

        {createDialog && (
          <NameInputDialog
            title={createDialog.type === "folder" ? t("dialog.create.folder") : t("dialog.create.file")}
            defaultName={createDialog.defaultName}
            isDir={createDialog.type === "folder"}
            existingNames={createDialog.existingNames}
            onConfirm={(name) => {
              const r = createDialog.resolve;
              setCreateDialog(null);
              r(name);
            }}
            onCancel={() => {
              const r = createDialog.resolve;
              setCreateDialog(null);
              r(null);
            }}
          />
        )}

        {singleConflict &&
          (() => {
            const c = singleConflict;
            const { base, ext } = splitNameExt(
              c.conflict.entry.name,
              c.conflict.isDir,
            );
            const existingSet = new Set(c.existingNames);
            const safeName = generateSafeName(
              base,
              ext,
              existingSet,
              c.conflict.isDir,
            );
            return (
              <NameInputDialog
                title={t("dialog.conflict.single_title")}
                defaultName={safeName}
                isDir={c.conflict.isDir}
                existingNames={c.existingNames}
                sourcePath={c.sourcePath}
                operation={c.operation}
                destDir={c.destDir}
                onConfirm={(name) => {
                  const renames = new Map<string, string>();
                  renames.set(c.conflict.entry.name, name);
                  const resolve = c.resolve;
                  setSingleConflict(null);
                  resolve({ action: "auto-rename", renames });
                }}
                onCancel={() => {
                  const resolve = c.resolve;
                  setSingleConflict(null);
                  resolve({ action: "cancel" });
                }}
              />
            );
          })()}

        {multiConflict && (
          <ConflictDialog
            conflicts={multiConflict.conflicts}
            destDir={multiConflict.destDir}
            existingNames={multiConflict.existingNames}
            sourcePath={multiConflict.sourcePath}
            operation={multiConflict.operation}
            onConfirm={(result) => {
              const resolve = multiConflict.resolve;
              setMultiConflict(null);
              resolve(result);
            }}
            onCancel={() => {
              const resolve = multiConflict.resolve;
              setMultiConflict(null);
              resolve({ action: "cancel" });
            }}
          />
        )}

        <PropertiesDialog
          open={propertiesDialogOpen}
          onClose={() => setPropertiesDialogOpen(false)}
          file={propertiesFile}
        />

        <ConfirmDialog
          open={!!confirmDialog}
          title={confirmDialog?.title ?? ""}
          message={confirmDialog?.message ?? ""}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
        />

        <DragActionDialog
          open={!!dragAction}
          title={dragAction?.title ?? ""}
          message={dragAction?.message ?? ""}
          onMove={handleDragMove}
          onCopy={handleDragCopy}
          onCancel={handleDragActionCancel}
        />
        {openWithFile && (
          <OpenWithDialog
            open={!!openWithFile}
            path={openWithFile.path}
            onClose={() => setOpenWithFile(null)}
            onSelect={async (exec, desktopFile) => {
              if (openWithFile) {
                const result = await window.electron.openWith(
                  exec,
                  openWithFile.path,
                  desktopFile,
                );
                if (result !== true) {
                  showToast(t("toast.launch_failed", exec, result), "error");
                }
              }
              setOpenWithFile(null);
            }}
          />
        )}

        <SettingsDialog
          open={settingsDialogOpen}
          onClose={() => setSettingsDialogOpen(false)}
          showHiddenFiles={showHiddenFiles}
          onToggleHiddenFiles={() => setShowHiddenFiles(!showHiddenFiles)}
          iconSize={iconSize}
          onIconSizeChange={setIconSize}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          filledIcons={filledIcons}
          onToggleFilledIcons={() => setFilledIcons(!filledIcons)}
          customCssPath={customCssPath}
          onImportCss={handleImportCss}
          locale={locale}
          onLocaleChange={handleLocaleChange}
          marqueeEnabled={marqueeEnabled}
          onToggleMarquee={() => setMarqueeEnabled(!marqueeEnabled)}
        />
      </main>
    </div>
  );
}

function App() {
  return (
    <>
      <ClipboardProvider>
        <DragProvider>
          <AppContent />
        </DragProvider>
      </ClipboardProvider>
      <ToastContainer
        position="bottom-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        pauseOnHover
        theme="dark"
        limit={5}
        style={{ zIndex: 2000 }}
      />
    </>
  );
}

export default App;
