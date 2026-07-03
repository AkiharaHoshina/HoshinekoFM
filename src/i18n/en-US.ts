const enUS = {
  // ── 文件操作 ──
  'file.open': 'Open',
  'file.copy': 'Copy',
  'file.cut': 'Cut',
  'file.paste': 'Paste',
  'file.delete': 'Delete',
  'file.rename': 'Rename',
  'file.extract_here': 'Extract to this folder',
  'file.open_terminal': 'Open in built-in terminal',
  'file.open_with': 'Open with...',
  'file.properties': 'Properties',
  'file.refresh': 'Refresh',
  'file.new_folder': 'New folder',
  'file.new_file': 'New file',
  'file.select_all': 'Select all',
  'file.pin': 'Pin to dashboard',
  'file.unpin': 'Unpin from dashboard',

  // ── 右键菜单 ──
  'context_menu.open': 'Open',
  'context_menu.open_with': 'Open with...',
  'context_menu.open_terminal': 'Open in built-in terminal',
  'context_menu.copy': 'Copy',
  'context_menu.cut': 'Cut',
  'context_menu.paste': 'Paste',
  'context_menu.rename': 'Rename',
  'context_menu.delete': 'Delete',
  'context_menu.properties': 'Properties',
  'context_menu.new_folder': 'New folder',
  'context_menu.new_file': 'New file',
  'context_menu.refresh': 'Refresh',
  'context_menu.select_all': 'Select all',
  'context_menu.pin': 'Pin to dashboard',
  'context_menu.unpin': 'Unpin from dashboard',
  'context_menu.extract_here': 'Extract to this folder',

  // ── 弹窗按钮 ──
  'dialog.button.cancel': 'Cancel',
  'dialog.button.confirm': 'OK',
  'dialog.button.done': 'Done',    //Not in use but translation is not correct
  'dialog.button.close': 'Close',
  'dialog.button.open': 'Open',

  // ── 重名对话框（多选）──
  'dialog.conflict.title_move': (n: number) => n === 1 
    ? 'Move — 1 Naming Conflict' 
    : `Move — ${n} Naming Conflicts`,
  'dialog.conflict.title_copy': (n: number) => n === 1 
    ? 'Copy — 1 Naming Conflict' 
    : `Copy — ${n} Naming Conflicts`,
  'dialog.conflict.title_fallback': (n: number) => n === 1 
    ? '1 item has a naming conflict' 
    : `${n} items have naming conflicts`,
  'dialog.conflict.single_title': 'Naming Conflict',
  'dialog.conflict.skip': (n: number) => n === 1 
    ? 'Skip conflicting item' 
    : `Skip ${n} conflicting items`,
  'dialog.conflict.auto_rename': 'Auto rename',
  'dialog.conflict.manual_rename': 'Manual rename',
  'dialog.conflict.source_label': 'From',
  'dialog.conflict.operation_label': 'Operation',
  'dialog.conflict.dest_label': 'To',
  'dialog.conflict.operation_move': 'Move',
  'dialog.conflict.operation_copy': 'Copy',
  'dialog.conflict.more_items': (n: number) => `... ${n} conflicts remaining`,
  'dialog.conflict.cancel_item': 'Item canceled',

  // ── 重命名弹窗 ──
  'dialog.rename.title': 'Rename',
  'dialog.rename.cancel': 'Cancel',
  'dialog.rename.confirm': 'Rename',
  'dialog.rename.placeholder': 'New name',

  // ── 新建弹窗 ──
  'dialog.create.folder': 'New folder',
  'dialog.create.file': 'New file',
  'dialog.create.default_folder': 'New_folder',
  'dialog.create.default_file': 'New_text_file.txt',

  // ── 删除确认 ──
  'dialog.delete.confirm': (n: number) => n === 1 
    ? 'Are you sure you want to delete the selected item?' 
    : `Are you sure you want to delete the selected ${n} items?`,

  // ── 属性弹窗 ──
  'properties.title': 'Properties',
  'properties.folder': 'Folder',
  'properties.file': 'File',
  'properties.location': 'Location:',
  'properties.size': 'Size:',
  'properties.calculating': 'Calculating...',
  'properties.bytes': ' Bytes',
  'properties.modified': 'Modified time:',
  'properties.type': 'Type:',
  'properties.directory': 'Directory',             //不知所谓

  // ── 打开方式弹窗 ──
  'open_with.title': 'Open with...',
  'open_with.cancel': 'Cancel',
  'open_with.open': 'Open',
  'open_with.search': 'Search applications...',
  'open_with.recommended': 'Recommended Applications',
  'open_with.all': 'All Applications',

  // ── 设置弹窗 ──
  'settings.title': 'Settings',
  'settings.done': 'Done',
  'settings.show_hidden': 'Show hidden files',
  'settings.appearance': 'Appearance',
  'settings.view_mode': 'View mode',
  'settings.grid': 'Grid',
  'settings.list': 'List',
  'settings.icon_size': 'Icon size',
  'settings.filled_icons': 'Filled icons',
  'settings.customization': 'Customization',
  'settings.custom_css': 'Custom CSS',
  'settings.import_css': 'Import CSS',
  'settings.behavior': 'Behavior',
  'settings.language': 'Language',
  'settings.marquee_text': 'Marquee text',

  // ── Toast 消息 ──
  'toast.copied_items': (n: number) => n === 1 ? 'Copied 1 item' : `Copied ${n} items`,
  'toast.cut_items': (n: number) => n === 1 ? 'Cut 1 item' : `Cut ${n} items`,
  'toast.moved_items': (n: number) => n === 1 ? 'Moved 1 item' : `Moved ${n} items`,
  'toast.pasted_items': (n: number) => n === 1 ? 'Pasted 1 item' : `Pasted ${n} items`,
  'toast.deleted_items': (n: number) => n === 1 ? 'Deleted 1 item' : `Deleted ${n} items`,
  'toast.imported_files': (n: number) => n === 1 ? 'Imported 1 file' : `Imported ${n} files`,
  'toast.failed_items': (n: number) => n === 1 ? 'Operation failed for 1 item' : `Operation failed for ${n} items`,
  'toast.delete_fail_permission': 'Please check permissions',
  'toast.file_deleted': (name: string) => `Deleted "${name}"`,
  'toast.file_created': (name: string) => `Created file "${name}"`,
  'toast.folder_created': (name: string) => `Created folder "${name}"`,
  'toast.file_extracted': (name: string) => `Extracted "${name}"`,
  'toast.rename_success': (oldN: string, newN: string) => `Renamed: ${oldN} -> ${newN}`,
  'toast.rename_move_success': (oldN: string, newP: string) => `Renamed: ${oldN} moved to ${newP}`,
  'toast.copy_success': (src: string, destDir: string, dest: string) => `${src} → ${destDir}/${dest}`,
  'toast.move_success': (src: string, destDir: string, dest: string) => `${src} → ${destDir}/${dest}`,
  'toast.launch_failed': (exec: string, result: string) => `Open with: Failed to execute ${exec} (${result})`,

  // ── 错误消息 ──
  'error.permission_denied': 'Permission denied',
  'error.not_found': 'Not found',
  'error.cannot_access': 'Cannot access',
  'error.unknown': 'Unkouwn error',
  'error.cannot_open_dir': (msg: string) => `Cannot open directory: ${msg}`,
  'error.search_failed': (msg: string) => `Search faild: ${msg}`,
  'error.name_exists': (name: string) => `Rename faild：${name} exists`,
  'error.copy_exists': (name: string) => `Copay faild：${name} exists`,
  'error.move_exists': (name: string) => `Move faild：${name} exists`,
  'error.unsupported_format': 'Unsupported archive format',
  'error.file_open_failed': (name: string, err: string) => `Failed to open ${name}: ${err}`,
  'error.create_parent_failed': (parent: string) => `Failed to create destination directory: ${parent}`,

  // ── fileOperations 错误格式化 ──
  'file_op.exists': (op: string, ref: string) => `${op} ${ref}: A file with the same name already exists`,
  'file_op.not_found': (op: string, ref: string) => `${op} ${ref}: No such file or directory`,
  'file_op.permission': (op: string, ref: string) => `${op} ${ref}: Permission denied`,
  'file_op.no_space': (op: string, ref: string) => `${op} ${ref}: No space left on device`,
  'file_op.read_only': (op: string, ref: string) => `${op} ${ref}: Read-only file system`,
  'file_op.is_dir': (op: string, ref: string) => `${op} ${ref}: Path is a directory`,
  'file_op.not_dir': (op: string, ref: string) => `${op} ${ref}: Path is not a directory`,
  'file_op.cross_device': (op: string, ref: string) => `${op} ${ref}: Cannot move files across different devices`,
  'file_op.busy': (op: string, ref: string) => `${op} ${ref}: File is busy, please close it and try again`,
  'file_op.same_target': (op: string, ref: string) => `${op} ${ref}: Destination cannot be the same as source`,
  'file_op.generic': (op: string, ref: string, msg: string) => `${op} ${ref}: ${msg}`,

  // ── 操作动词 ──
  'operation.create_file': 'Create File',
  'operation.create_folder': 'Create Folder',
  'operation.rename_op': 'Rename',
  'operation.delete_op': 'Delete',
  'operation.copy_op': 'Copy',
  'operation.move_op': 'Move',
  'operation.extract_op': 'Extract',
  'operation.open_op': 'Open',
  'operation.launch_app': 'Launch Application',
  'operation.move_verb': 'Move',
  'operation.copy_verb': 'Copy',

  // ── 侧边栏 ──
  'sidebar.places': 'Places',
  'sidebar.devices': 'Devices',
  'sidebar.dashboard': 'Dashboard',
  'sidebar.home': 'Home',
  'sidebar.desktop': 'Desktop',
  'sidebar.documents': 'Documents',
  'sidebar.downloads': 'Downloads',
  'sidebar.music': 'Music',
  'sidebar.pictures': 'Pictures',
  'sidebar.videos': 'Videos',

  // ── 导航栏 ──
  'nav.dashboard': 'Dashboard',
  'nav.home': 'Home',
  'nav.files': 'Files',
  'nav.terminal': 'Terminal',
  'nav.settings': 'Settings',

  // ── 仪表盘 ──
  'dashboard.good_morning': 'Good morning',
  'dashboard.good_afternoon': 'Good afternoon',
  'dashboard.good_evening': 'Good evening',
  'dashboard.welcome': 'Welcome back to your dashboard.',
  'dashboard.system_storage': 'System Storage',
  'dashboard.used': 'Used',
  'dashboard.total': 'Total',
  'dashboard.loading': 'Loading statistics...',
  'dashboard.pinned': 'Pinned',
  'dashboard.add': 'Add',
  'dashboard.recent': 'Recent',
  'dashboard.no_recent': 'No recently accessed files.',
  'dashboard.unpin_tooltip': 'Unpin',

  // ── 选择模式 ──
  'selection.box_replace': 'Box Select (Replace)',
  'selection.box_union': 'Box Select (Union)',
  'selection.box_intersection': 'Box Select (Intersection)',
  'selection.box_difference': 'Box Select (Difference)',
  'selection.click_range_add': 'Click Select (Add Range)',
  'selection.click_add_remove': 'Click Select (Add/Remove)',
  'selection.click_range': 'Click Select (Range)',

  // ── 搜索 ──
  'search.results': (n: number, q: string) => `Found ${n} result(s) for "${q}"`,
  'search.clear': 'Clear Search',

  // ── 排序 ──
  'sort.toggle_grouping': 'Toggle Grouping',
  'sort.by_name': 'Sort by Name',
  'sort.by_date': 'Sort by Date Modified',

  // ── 状态栏 ──
  'status.items': (n: number) => n === 1 ? '1 item' : `${n} items`,
  'status.selected': (n: number) => `${n} selected`,

  // ── Omnibar ──
  'omnibar.placeholder': 'Enter path or search...',
  'omnibar.button_tip': 'Click to edit path or search',

  // ── 面包屑 ──
  'breadcrumbs.root': 'Root',

  // ── Tab 标题 ──
  'tab.dashboard': 'Dashboard',
  'tab.home': 'Home',
  'tab.downloads': 'Downloads',
  'tab.documents': 'Documents',
  'tab.music': 'Music',
  'tab.pictures': 'Pictures',
  'tab.videos': 'Videos',
  'tab.new_tab': 'New Tab',
  // ── 空状态 ──
  'empty.no_tabs': 'No tabs open',
  'empty.open_new_tab': 'Open a new tab',

  // ── 终端 ──
  'terminal.title': 'Terminal',
  'terminal.process_exited': '\r\nProcess exited.\r\n',

  // ── 错误边界 ──
  'error.something_wrong': 'Something went wrong',

  // ── MIME 类型 ──
  'mime.folder': 'Folder',
  'mime.symlink': 'Symbolic Link',
  'mime.broken_symlink': 'Broken Symbolic Link',
  'mime.block_device': 'Block Device',
  'mime.char_device': 'Character Device',
  'mime.named_pipe': 'Named Pipe (FIFO)',
  'mime.socket': 'Socket',
  'mime.text': 'Text Document',
  'mime.html': 'HTML Document',
  'mime.css': 'CSS Stylesheet',
  'mime.javascript': 'JavaScript Script',
  'mime.xml': 'XML Document',
  'mime.csv': 'CSV Document',
  'mime.markdown': 'Markdown Document',
  'mime.python': 'Python Script',
  'mime.c_source': 'C Source Code',
  'mime.cpp_source': 'C++ Source Code',
  'mime.java_source': 'Java Source Code',
  'mime.go_source': 'Go Source Code',
  'mime.rust_source': 'Rust Source Code',
  'mime.shell': 'Shell Script',
  'mime.yaml': 'YAML Document',
  'mime.toml': 'TOML Document',
  'mime.png': 'PNG Image',
  'mime.jpeg': 'JPEG Image',
  'mime.gif': 'GIF Image',
  'mime.svg': 'SVG Image',
  'mime.webp': 'WebP Image',
  'mime.bmp': 'BMP Image',
  'mime.tiff': 'TIFF Image',
  'mime.icon': 'Icon Image',
  'mime.heic': 'HEIC Image',
  'mime.mp3': 'MP3 Audio',
  'mime.ogg': 'OGG Audio',
  'mime.flac': 'FLAC Audio',
  'mime.wav': 'WAV Audio',
  'mime.aac': 'AAC Audio',
  'mime.mp4': 'MP4 Video',
  'mime.webm': 'WebM Video',
  'mime.avi': 'AVI Video',
  'mime.quicktime': 'QuickTime Video',
  'mime.pdf': 'PDF Document',
  'mime.zip': 'ZIP Archive',
  'mime.gzip': 'GZIP Archive',
  'mime.bzip2': 'BZIP2 Archive',
  'mime.xz': 'XZ Archive',
  'mime._7z': '7z Archive',
  'mime.rar': 'RAR Archive',
  'mime.tar': 'TAR Archive',
  'mime.iso': 'Disc Image',
  'mime.krita': 'Krita Document',
  'mime.scratch': 'Scratch Project',
  'mime.odt': 'ODT Document',
  'mime.ods': 'ODS Spreadsheet',
  'mime.odp': 'ODP Presentation',
  'mime.docx': 'DOCX Document',
  'mime.xlsx': 'XLSX Spreadsheet',
  'mime.pptx': 'PPTX Presentation',
  'mime.doc': 'DOC Document',
  'mime.xls': 'XLS Spreadsheet',
  'mime.ppt': 'PPT Presentation',
  'mime.rtf': 'RTF Document',
  'mime.elf': 'ELF Executable',
  'mime.executable': 'Executable File',
  'mime.shared_lib': 'Shared Library',
  'mime.python_bytecode': 'Python Bytecode',
  'mime.json': 'JSON Document',
  'mime.unknown_ext': (ext: string) => `${ext.toUpperCase()} File`,
  'mime.other_file': 'Other File',

  // ── MIME 分类 ──
  'mime.cat.text': 'Documents', // 或者是 'Text'
  'mime.cat.image': 'Images',
  'mime.cat.audio': 'Audio',
  'mime.cat.video': 'Videos',
  'mime.cat.font': 'Fonts',
  'mime.cat.system': 'System Files',
  'mime.cat.other': 'Other',

  // ── 文件分组 ──
  'group.folders': 'Folders',
  'group.media': 'Media',
  'group.documents': 'Documents',
  'group.code': 'Code',
  'group.archives': 'Archives',
  'group.executables': 'Executables',
  'group.others': 'Others',

  // ── 大小格式化 ──
  'size.b': 'B',
  'size.kb': 'KB',
  'size.mb': 'MB',
  'size.gb': 'GB',
  'size.tb': 'TB',
  'size.zero': '0 B',

  // ── Toast 操作 ──
  'toast.copy_action': 'Copy',
  'toast.close_action': 'Close',

  // ── 设备操作 ──
  'device.mount': 'Mount',
  'device.unmount': 'Unmount',
  'device.eject': 'Eject',
  'device.power_off': 'Power Off Drive',
  'device.mounting': 'Mounting...',
  'device.unmounting': 'Unmounting...',
  'device.mounted': 'Mounted',
  'device.unmounted': 'Not Mounted',
  'device.mount_failed': 'Mount failed',
  'device.unmount_failed': 'Unmount failed',
  'device.eject_failed': 'Eject failed',
  'device.already_mounted': 'Device is already mounted',
  'device.go_to_source': 'Go to Source Device',
  'device.type_usb': 'USB Device',
  'device.type_removable': 'Removable Device',
  'device.type_disk': 'Disk',

  // ── 软链接操作 ──
  'symlink.go_to_target': 'Go to Target',
  'symlink.broken_tooltip': (target: string) => `→ ${target} (Broken)`,
  'symlink.tooltip': (target: string) => `→ ${target}`,
  // ── 挂载点操作 ──
  'mountpoint.go_to_source': 'Switch to source device',
  // ── 语言信息 ──
  'language_name': 'English',
  'language_auto': 'System',
} as const;

export const match = (lang: string) => lang.startsWith('en');

export default enUS;
