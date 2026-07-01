import { useState, useEffect, useCallback } from 'react';
import { useToast } from './contexts/ToastContext';
import { initDragIcons } from './utils/dragIconRenderer';
import './index.css';
import { ToastProvider } from './contexts/ToastContext';
import { ClipboardProvider, useClipboard } from './contexts/ClipboardContext';
import { ThemeService } from './services/ThemeService';
import { TerminalService } from './services/TerminalService';
import { NavigationRail } from './components/NavigationRail';
import { Sidebar } from './components/Sidebar';
import { Icon } from './components/Icon';
import { IconButton } from './components/IconButton';
import { ContextMenu } from './components/ContextMenu';
import type { ContextMenuItem } from './components/ContextMenu';
import { SettingsDialog } from './components/SettingsDialog';
import { TerminalPane } from './components/TerminalPane'; // Import TerminalPane
import type { IFile } from './types/files';
import { Dialog } from './components/Dialog';
import { Button } from './components/Button';
import { TabBar } from './components/TabBar';
import { ExplorerTab } from './components/ExplorerTab';
import { OpenWithDialog } from './components/OpenWithDialog';
import { PropertiesDialog } from './components/PropertiesDialog';
import { useLocalStorage } from './hooks/useLocalStorage';
import {
  renameFile as renameFileOp,
  trashFile,
  pasteFiles,
  extractFile,
  openFile,
} from './utils/fileOperations';

interface TabState {
  id: string;
  title: string;
  path: string;
  version: number;
}

function AppContent() {
  const { showToast } = useToast();

  // Tabs State
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');

  // Note: loading/files state is now internal to ExplorerTab
  const [terminalOpen, setTerminalOpen] = useState(false);

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: IFile | null } | null>(null);
  const [bgMenuItems, setBgMenuItems] = useState<ContextMenuItem[] | null>(null);

  // Rename Dialog State
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameFile, setRenameFile] = useState<IFile | null>(null);
  const [newName, setNewName] = useState('');

  // Properties Dialog State
  const [propertiesDialogOpen, setPropertiesDialogOpen] = useState(false);
  const [propertiesFile, setPropertiesFile] = useState<IFile | null>(null);

  // Open With Dialog State
  const [openWithFile, setOpenWithFile] = useState<IFile | null>(null);

  // Clipboard State (from Context)
  const { clipboard, copy, cut, clear: clearClipboard } = useClipboard();

  // Settings State
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);

  const [showHiddenFiles, setShowHiddenFiles] = useLocalStorage<boolean>('settings.showHiddenFiles', true);
  const [iconSize, setIconSize] = useLocalStorage<number>('settings.iconSize', 64);
  const [viewMode, setViewMode] = useLocalStorage<'grid' | 'list'>('settings.viewMode', 'grid');
  const [filledIcons, setFilledIcons] = useLocalStorage<boolean>('settings.filledIcons', false);
  const [customCssPath, setCustomCssPath] = useState<string>('');

  // -- Handlers (Defined before effects) --

  const handleLoadCustomCss = async (path: string) => {
    try {
      const css = await window.electron.readFile(path);
      if (css) {
        let style = document.getElementById('custom-user-css');
        if (!style) {
          style = document.createElement('style');
          style.id = 'custom-user-css';
          document.head.appendChild(style);
        }
        style.textContent = css;
        setCustomCssPath(path);
        localStorage.setItem('customCssPath', path);
      }
    } catch (err) {
      console.error('Failed to load custom css', err);
    }
  };

  const handleImportCss = async () => {
    const path = await window.electron.openFileDialog();
    if (path) {
      handleLoadCustomCss(path);
    }
  };

  const loadHome = async () => {
    handleAddTab('app://dashboard');
  };

  // -- Effects --

  useEffect(() => {
    ThemeService.loadTheme();
    ThemeService.init();

    // Check for startup args
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

    const storedCssPath = localStorage.getItem('customCssPath');
    if (storedCssPath) {
      handleLoadCustomCss(storedCssPath);
    }
  }, []);

  const currentPath = tabs.find(t => t.id === activeTabId)?.path || '';

  // Tab Handlers
  const handleAddTab = useCallback((path?: string) => {
    const newTabId = Date.now().toString();
    const newPath = path || currentPath || '/'; // Default to current or root
    const newTab: TabState = { id: newTabId, title: 'New Tab', path: newPath, version: 0 };

    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTabId);
  }, [currentPath]);

  const handleCloseTab = useCallback((id: string) => {
    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== id);
      return newTabs;
    });

    // Note: Active tab logic needs to read current state, but strict mode might be tricky.
    // Simplifying: update active ID separately or rely on effect? 
    // Actually, accessing state inside callback is fine if deps are correct.
    // Refactoring to use functional updates fully or include deps.
    // To match original logic's intent without stale closures:
    setTabs(prevTabs => {
      const newTabs = prevTabs.filter(t => t.id !== id);
      if (id === activeTabId) {
        if (newTabs.length > 0) {
          setActiveTabId(newTabs[newTabs.length - 1].id);
        } else {
          setActiveTabId('');
        }
      }
      return newTabs;
    });
  }, [activeTabId]);

  const handleTabPathUpdate = useCallback((id: string, path: string) => {
    const folderName = path.split('/').pop() || path;
    setTabs(prev => prev.map(t => {
      if (t.id === id) return { ...t, path, title: folderName };
      return t;
    }));
  }, []);

  // Terminal Follows Active Tab
  useEffect(() => {
    if (terminalOpen && currentPath) {
      TerminalService.cd(currentPath);
    }
  }, [currentPath, terminalOpen]);

  const toggleTerminal = async () => {
    if (!terminalOpen) {
      // await TerminalService.open(); // Removed: Uses embedded terminal now
      setTerminalOpen(true);
    } else {
      setTerminalOpen(!terminalOpen);
    }
  };

  const handleSidebarNavigate = useCallback((path: string) => {
    setTabs(prev => {
      if (prev.length === 0) {
        // Side effect in reducer? No, handleAddTab logic duplicated here safely
        const newTabId = Date.now().toString();
        const newTab: TabState = { id: newTabId, title: 'New Tab', path, version: 0 };
        setActiveTabId(newTabId);
        return [newTab];
      }
      return prev.map(t => t.id === activeTabId ? { ...t, path } : t);
    });
  }, [activeTabId]);

  const handleContextMenu = useCallback((e: React.MouseEvent, file: IFile | null) => {
    e.preventDefault();
    e.stopPropagation(); // Prevent bubbling if handled
    setContextMenu({ x: e.clientX, y: e.clientY, item: file });
  }, []);

  const handleBgMenuItems = useCallback((items: ContextMenuItem[]) => {
    setBgMenuItems(items);
  }, []);

  const handleOpenWithFile = useCallback((file: IFile) => {
    setOpenWithFile(file);
  }, []);

  const handlePropertiesFile = useCallback((file: IFile) => {
    setPropertiesFile(file);
    setPropertiesDialogOpen(true);
  }, []);

  const handleCopy = (file: IFile) => {
    copy([file]);
    setContextMenu(null);
  };

  const handleCut = (file: IFile) => {
    cut([file]);
    setContextMenu(null);
  };

  const handlePaste = async () => {
    if (!clipboard || clipboard.files.length === 0) return;

    await pasteFiles(
      clipboard.files,
      clipboard.operation,
      currentPath,
      showToast,
      clipboard.operation === 'cut' ? clearClipboard : undefined,
      () => setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, version: t.version + 1 } : t)),
    );
    setContextMenu(null);
  };

  const menuItems: ContextMenuItem[] = contextMenu?.item ? [
    {
      label: 'Open', icon: 'open_in_new', action: () => {
        openFile(contextMenu.item!.path, showToast);
        setContextMenu(null);
      }
    },
    { label: 'Open in Terminal', icon: 'terminal', action: () => TerminalService.cd(contextMenu.item!.path) },
    { divider: true, label: '', action: () => { } },
    { label: 'Copy', icon: 'content_copy', action: () => handleCopy(contextMenu.item!) },
    { label: 'Cut', icon: 'content_cut', action: () => handleCut(contextMenu.item!) },
    {
      label: 'Delete', icon: 'delete', action: () => trashFile(contextMenu.item!.path, showToast, () => {
        setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, version: t.version + 1 } : t));
      })
    },
    {
      label: 'Extract Here',
      icon: 'unarchive',
      action: () => {
        const file = contextMenu.item!;
        extractFile(file.path, showToast, () =>
          setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, version: t.version + 1 } : t)),
        );
      }
    },
    {
      label: 'Rename', icon: 'edit', action: () => {
        setRenameFile(contextMenu.item);
        setNewName(contextMenu.item!.name);
        setRenameDialogOpen(true);
        setContextMenu(null); // Close menu
      }
    },
    { divider: true, label: '', action: () => { } },
    {
      label: 'Open With...', icon: 'apps', action: () => {
        setOpenWithFile(contextMenu.item);
        setContextMenu(null);
      }
    },
    {
      label: 'Properties', icon: 'info', action: () => {
        setPropertiesFile(contextMenu.item);
        setPropertiesDialogOpen(true);
        setContextMenu(null);
      }
    }
  ] : (bgMenuItems ?? [
    { label: 'Paste', icon: 'content_paste', action: handlePaste },
  ].filter(item => {
    if (item.label === 'Paste' && (!clipboard || clipboard.files.length === 0)) return false;
    return true;
  }));

  const handleRename = async () => {
    if (renameFile && newName && newName !== renameFile.name) {
      const lastSlashIndex = renameFile.path.lastIndexOf('/');
      const parentDir = renameFile.path.substring(0, lastSlashIndex);
      await renameFileOp(renameFile.path, `${parentDir}/${newName}`, showToast, () =>
        setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, version: t.version + 1 } : t)),
      );
    }
    setRenameDialogOpen(false);
    setRenameFile(null);
  };

  return (
    <div className="app-shell" style={{ display: 'flex', height: '100vh', width: '100vw', background: 'var(--md-sys-color-background)' }} onClick={() => setContextMenu(null)}>
      <NavigationRail
        items={[
          {
            icon: <Icon name="dashboard" />,
            activeIcon: <Icon name="dashboard" filled />,
            label: 'Dashboard',
            active: currentPath === 'app://dashboard',
            onClick: () => {
              const existing = tabs.find(t => t.path.startsWith('app://dashboard'));
              if (existing) {
                setActiveTabId(existing.id);
              } else {
                handleAddTab('app://dashboard');
              }
            }
          },
          {
            icon: <Icon name="home" />,
            activeIcon: <Icon name="home" filled />,
            label: 'Home',
            active: currentPath.startsWith('/home'),
            onClick: async () => {
              const home = await window.electron.getHomePath();
              const existingHomeTab = tabs.find(t => t.path === home);
              if (existingHomeTab) {
                setActiveTabId(existingHomeTab.id);
              } else {
                handleAddTab(home);
              }
            }
          },
          {
            icon: <Icon name="folder" />,
            activeIcon: <Icon name="folder" filled />,
            label: 'Files',
            active: currentPath === '/',
            onClick: () => handleSidebarNavigate('/')
          },
          {
            icon: <Icon name="terminal" />,
            activeIcon: <Icon name="terminal" filled />,
            label: 'Terminal',
            active: terminalOpen,
            onClick: toggleTerminal
          },
          {
            icon: <Icon name="settings" />,
            activeIcon: <Icon name="settings" filled />,
            label: 'Settings',
            onClick: () => setSettingsDialogOpen(true)
          }
        ]}
      />

      {/* Places Sidebar */}
      <Sidebar onNavigate={handleSidebarNavigate} currentPath={currentPath} />

      {/* Main Content Area */}
      <main className="main-content" style={{
        flex: 1,
        height: '100%',
        background: 'var(--md-sys-color-background)',
        borderRadius: '24px 0 0 0',
        overflow: 'hidden',
        display: 'flex',
        flexDirection: 'column'
      }}>
        {/* Top Bar */}
        <header style={{ height: 'auto', display: 'flex', flexDirection: 'column', background: 'var(--md-sys-color-surface)' }}>
          <TabBar
            tabs={tabs}
            activeTabId={activeTabId}
            onTabClick={setActiveTabId}
            onTabClose={handleCloseTab}
            onNewTab={() => handleAddTab()}
          />
        </header>

        {/* File Tabs Content */}
        <div className="content-area" style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          {tabs.map(tab => (
            <div key={tab.id} style={{ display: tab.id === activeTabId ? 'block' : 'none', height: '100%' }}>
              <ExplorerTab
                tabId={tab.id}
                isActive={tab.id === activeTabId}
                initialPath={tab.path}
                onPathChange={handleTabPathUpdate}
                onContextMenu={handleContextMenu}
                onBgMenuItems={handleBgMenuItems}
                onOpenWithFile={handleOpenWithFile}
                onPropertiesFile={handlePropertiesFile}
                showHiddenFiles={showHiddenFiles}
                iconSize={iconSize}
                viewMode={viewMode}
                filledIcons={filledIcons}
                refreshSignal={tab.version}
              />
            </div>
          ))}
          {tabs.length === 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
              <div style={{ textAlign: 'center' }}>
                <Icon name="tab" size={48} />
                <p>No tabs open</p>
                <Button onClick={() => handleAddTab()}>Open New Tab</Button>
              </div>
            </div>
          )}
        </div>

        {/* Terminal Panel */}
        {terminalOpen && (
          <div style={{ height: '300px', borderTop: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', padding: '4px 8px', background: 'var(--surface-variant)' }}>
              <span style={{ fontSize: '12px', fontWeight: 500 }}>Terminal</span>
              <div style={{ flex: 1 }} />
              <IconButton onClick={() => setTerminalOpen(false)} style={{ width: 24, height: 24 }}>
                <Icon name="close" size={16} />
              </IconButton>
            </div>
            <div style={{ flex: 1, position: 'relative' }}>
              <TerminalPane cwd={tabs.find(t => t.id === activeTabId)?.path || undefined} />
            </div>
          </div>
        )}

        {
          contextMenu && (
            <ContextMenu
              x={contextMenu.x}
              y={contextMenu.y}
              items={menuItems}
              onClose={() => setContextMenu(null)}
            />
          )
        }

        <Dialog
          title="Rename"
          open={renameDialogOpen}
          onClose={() => setRenameDialogOpen(false)}
          actions={
            <>
              <Button variant="text" onClick={() => setRenameDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleRename}>Rename</Button>
            </>
          }
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="md3-text-field"
            style={{
              width: '100%',
              padding: '12px',
              borderRadius: '4px',
              border: '1px solid var(--md-sys-color-outline)',
              background: 'var(--md-sys-color-surface)',
              color: 'var(--md-sys-color-on-surface)',
              fontSize: '16px',
              boxSizing: 'border-box'
            }}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleRename();
            }}
          />
        </Dialog>

        <PropertiesDialog
          open={propertiesDialogOpen}
          onClose={() => setPropertiesDialogOpen(false)}
          file={propertiesFile}
        />
        {openWithFile && (
          <OpenWithDialog
            open={!!openWithFile}
            path={openWithFile.path}
            onClose={() => setOpenWithFile(null)}
            onSelect={async (exec) => {
              if (openWithFile) {
                const result = await window.electron.openWith(exec, openWithFile.path);
                if (result !== true) {
                  showToast(`打开方式：${exec} 启动失败（${result}）`, 'error');
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
        />
      </main>
    </div>
  );
}

function App() {
  return (
    <ToastProvider>
      <ClipboardProvider>
        <AppContent />
      </ClipboardProvider>
    </ToastProvider>
  );
}

export default App;
