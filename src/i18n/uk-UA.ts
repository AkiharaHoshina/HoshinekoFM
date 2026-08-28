/**
 * 乌克兰语（乌克兰）翻译。
 * 遵循乌克兰语正字法；名词随数词变化使用标准斯拉夫语复数规则
 * （1 елемент / 2 елементи / 5 елементів）。
 */

/**
 * 斯拉夫语复数规则：根据数值选择正确的名词形式。
 * @param n - 数值
 * @param one - 单数形式（{n} 占位符替换为数值）
 * @param few - 2–4 形式（{n} 占位符替换为数值）
 * @param many - 5+ 形式（{n} 占位符替换为数值）
 * @returns 带数值的完整名词短语
 */
function plural(n: number, one: string, few: string, many: string): string {
  const n10 = n % 10;
  const n100 = n % 100;
  const form = (n10 === 1 && n100 !== 11) ? one
    : (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) ? few
      : many;
  return form.replace('{n}', String(n));
}

const ukUA = {
  // ── 文件操作 ──
  'file.open': 'Відкрити',
  'file.copy': 'Копіювати',
  'file.cut': 'Вирізати',
  'file.paste': 'Вставити',
  'file.delete': 'Видалити',
  'file.rename': 'Перейменувати',
  'file.extract_here': 'Розпакувати сюди',
  'file.open_terminal': 'Відкрити у вбудованому терміналі',
  'file.open_with': 'Відкрити за допомогою...',
  'file.properties': 'Властивості',
  'file.refresh': 'Оновити',
  'file.new_folder': 'Нова папка',
  'file.new_file': 'Новий файл',
  'file.select_all': 'Вибрати все',
  'file.pin': 'Закріпити на панелі',
  'file.unpin': 'Відкріпити від панелі',

  // ── 右键菜单 ──
  'context_menu.open': 'Відкрити',
  'context_menu.open_with': 'Відкрити за допомогою...',
  'context_menu.open_terminal': 'Відкрити у вбудованому терміналі',
  'context_menu.open_in_terminal': 'Відкрити в стандартному терміналі',
  'context_menu.run_in_terminal': 'Запустити в стандартному терміналі',
  'context_menu.copy': 'Копіювати',
  'context_menu.cut': 'Вирізати',
  'context_menu.paste': 'Вставити',
  'context_menu.rename': 'Перейменувати',
  'context_menu.delete': 'Видалити',
  'context_menu.delete_permanent': 'Видалити назавжди',
  'drop.same_dir': 'Файли вже в цій папці',
  'drop.no_paths': 'Не вдалося отримати шляхи перетягнутих файлів',
  'context_menu.properties': 'Властивості',
  'context_menu.new_folder': 'Нова папка',
  'context_menu.new_file': 'Новий файл',
  'context_menu.refresh': 'Оновити',
  'context_menu.select_all': 'Вибрати все',
  'context_menu.pin': 'Закріпити на панелі',
  'context_menu.unpin': 'Відкріпити від панелі',
  'context_menu.extract_here': 'Розпакувати сюди',

  // ── 弹窗按钮 ──
  'dialog.button.cancel': 'Скасувати',
  'dialog.button.confirm': 'Гаразд',
  'dialog.button.done': 'Готово',
  'dialog.button.close': 'Закрити',
  'dialog.button.open': 'Відкрити',

  // ── 重名对话框（多选）──
  'dialog.conflict.title_move': (n: number) => n === 1
    ? 'Переміщення — 1 конфлікт імен'
    : `Переміщення — ${n} конфліктів імен`,
  'dialog.conflict.title_copy': (n: number) => n === 1
    ? 'Копіювання — 1 конфлікт імен'
    : `Копіювання — ${n} конфліктів імен`,
  'dialog.conflict.title_fallback': (n: number) => n === 1
    ? '1 елемент має конфлікт імен'
    : `${n} елементів мають конфлікти імен`,
  'dialog.conflict.single_title': 'Конфлікт імен',
  'dialog.conflict.skip': (n: number) => plural(n,
    'Пропустити {n} конфліктний елемент',
    'Пропустити {n} конфліктні елементи',
    'Пропустити {n} конфліктних елементів'),
  'dialog.conflict.auto_rename': 'Автоперейменування',
  'dialog.conflict.manual_rename': 'Перейменувати вручну',
  'dialog.conflict.source_label': 'Звідки',
  'dialog.conflict.operation_label': 'Операція',
  'dialog.conflict.dest_label': 'Куди',
  'dialog.conflict.operation_move': 'Перемістити',
  'dialog.conflict.operation_copy': 'Копіювати',
  'dialog.conflict.more_items': (n: number) => `... залишилося ще ${n} конфліктів`,
  'dialog.conflict.cancelled': 'Операцію скасовано',
  'dialog.conflict.skipped_items': (n: number) => plural(n,
    'Пропущено {n} конфліктний елемент',
    'Пропущено {n} конфліктні елементи',
    'Пропущено {n} конфліктних елементів'),
  'dialog.conflict.all_skipped': (n: number) => `Усі ${plural(n, '{n} елемент', '{n} елементи', '{n} елементів')} пропущено через конфлікти імен — нічого не виконано`,
  'dialog.conflict.cancel_item': 'Елемент скасовано',

  // ── 重命名弹窗 ──
  'dialog.rename.title': 'Перейменувати',
  'dialog.rename.cancel': 'Скасувати',
  'dialog.rename.confirm': 'Перейменувати',
  'dialog.rename.placeholder': 'Нове ім’я',

  // ── 新建弹窗 ──
  'dialog.create.folder': 'Нова папка',
  'dialog.create.file': 'Новий файл',
  'dialog.create.default_folder': 'Нова_папка',
  'dialog.create.default_file': 'Новий_текстовий_файл.txt',

  // ── 删除确认 ──
  'dialog.delete.confirm': (n: number) => plural(n,
    'Справді видалити вибраний {n} елемент?',
    'Справді видалити вибрані {n} елементи?',
    'Справді видалити вибрані {n} елементів?'),
  'dialog.delete.permanent_confirm': (n: number) =>
    `Це остаточно видалить ${plural(n, '{n} елемент', '{n} елементи', '{n} елементів')} без можливості скасування. Продовжити?`,
  'dialog.delete.total_size': (size: string) => `Загальний розмір: ${size}`,

  // ── 属性弹窗 ──
  'properties.title': 'Властивості',
  'properties.folder': 'Папка',
  'properties.file': 'Файл',
  'properties.location': 'Розташування:',
  'properties.size': 'Розмір:',
  'properties.calculating': 'Обчислення...',
  'properties.bytes': ' Б',
  'properties.modified': 'Час змінення:',
  'properties.permissions': 'Права доступу:',
  'properties.owner': 'Власник:',
  'properties.type': 'Тип:',
  'properties.directory': 'Каталог',

  // ── 打开方式弹窗 ──
  'open_with.title': 'Відкрити за допомогою...',
  'open_with.cancel': 'Скасувати',
  'open_with.open': 'Відкрити',
  'open_with.search': 'Пошук програм...',
  'open_with.recommended': 'Рекомендовані програми',
  'open_with.all': 'Усі програми',

  // ── 设置弹窗 ──
  'settings.title': 'Налаштування',
  'settings.done': 'Готово',
  'settings.show_hidden': 'Показувати приховані файли',
  'settings.appearance': 'Вигляд',
  'settings.view_mode': 'Режим перегляду',
  'settings.grid': 'Сітка',
  'settings.list': 'Список',
  'settings.icon_size': 'Розмір піктограм',
  'settings.filled_icons': 'Залиті піктограми',
  'settings.customization': 'Персоналізація',
  'settings.custom_css': 'Власний CSS',
  'settings.import_css': 'Імпортувати CSS',
  'settings.behavior': 'Поведінка',
  'settings.language': 'Мова',
  'settings.marquee_text': 'Біжучий текст',
  'settings.about': 'Про застосунок',
  'settings.version': 'Версія',

  // ── Toast 消息 ──
  'toast.copied_items': (n: number) => plural(n, 'Скопійовано {n} елемент', 'Скопійовано {n} елементи', 'Скопійовано {n} елементів'),
  'toast.cut_items': (n: number) => plural(n, 'Вирізано {n} елемент', 'Вирізано {n} елементи', 'Вирізано {n} елементів'),
  'toast.moved_items': (n: number) => plural(n, 'Переміщено {n} елемент', 'Переміщено {n} елементи', 'Переміщено {n} елементів'),
  'toast.pasted_items': (n: number) => plural(n, 'Вставлено {n} елемент', 'Вставлено {n} елементи', 'Вставлено {n} елементів'),
  'toast.deleted_items': (n: number) => plural(n, 'Видалено {n} елемент', 'Видалено {n} елементи', 'Видалено {n} елементів'),
  'toast.deleted_permanently': (n: number) => plural(n, 'Остаточно видалено {n} елемент', 'Остаточно видалено {n} елементи', 'Остаточно видалено {n} елементів'),
  'toast.imported_files': (n: number) => plural(n, 'Імпортовано {n} файл', 'Імпортовано {n} файли', 'Імпортовано {n} файлів'),
  'toast.imported_skipped': (ok: number, skip: number) => `Імпортовано файлів: ${ok}, пропущено: ${skip}`,
  'toast.import_all_skipped': (skip: number) => `Усі ${skip} файлів пропущено (уже існують)`,
  'toast.failed_items': (n: number) => plural(n, 'Помилка для {n} елемента', 'Помилка для {n} елементів', 'Помилка для {n} елементів'),
  'toast.delete_fail_permission': 'Перевірте права доступу',
  'toast.file_deleted': (name: string) => `Видалено «${name}»`,
  'toast.file_created': (name: string) => `Створено файл «${name}»`,
  'toast.folder_created': (name: string) => `Створено папку «${name}»`,
  'toast.file_extracted': (name: string) => `Розпаковано «${name}»`,
  'toast.rename_success': (oldN: string, newN: string) => `Перейменовано: ${oldN} -> ${newN}`,
  'toast.rename_move_success': (oldN: string, newP: string) => `Перейменовано: ${oldN} переміщено в ${newP}`,
  'toast.copy_success': (src: string, destDir: string, dest: string) => `${src} → ${destDir}/${dest}`,
  'toast.move_success': (src: string, destDir: string, dest: string) => `${src} → ${destDir}/${dest}`,
  'toast.launch_failed': (exec: string, result: string) => `Відкрити за допомогою: не вдалося виконати ${exec} (${result})`,
  'toast.no_terminal_found': 'Стандартний емулятор термінала не знайдено',
  'toast.terminal_launch_failed': (msg: string) => `Не вдалося запустити термінал: ${msg}`,

  // ── 错误消息 ──
  'error.permission_denied': 'Доступ заборонено',
  'error.not_found': 'Не знайдено',
  'error.cannot_access': 'Немає доступу',
  'error.unknown': 'Невідома помилка',
  'error.cannot_open_dir': (msg: string) => `Не вдалося відкрити каталог: ${msg}`,
  'error.search_failed': (msg: string) => `Пошук не вдався: ${msg}`,
  'error.name_exists': (name: string) => `Не вдалося перейменувати: «${name}» існує`,
  'error.copy_exists': (name: string) => `Не вдалося копіювати: «${name}» існує`,
  'error.move_exists': (name: string) => `Не вдалося перемістити: «${name}» існує`,
  'error.unsupported_format': 'Непідтримуваний формат архіву',
  'error.file_open_failed': (name: string, err: string) => `Не вдалося відкрити ${name}: ${err}`,
  'error.create_parent_failed': (parent: string) => `Не вдалося створити цільовий каталог: ${parent}`,
  'error.path_fallback': (path: string, reason: string, fallback: string) => `Немає доступу до «${path}» (${reason}), перемкнено на «${fallback}»`,

  // ── fileOperations 错误格式化 ──
  'file_op.exists': (op: string, ref: string) => `${op} ${ref}: Файл із таким самим іменем уже існує`,
  'file_op.not_found': (op: string, ref: string) => `${op} ${ref}: Немає такого файла або каталогу`,
  'file_op.permission': (op: string, ref: string) => `${op} ${ref}: Доступ заборонено`,
  'file_op.no_space': (op: string, ref: string) => `${op} ${ref}: Немає вільного місця на пристрої`,
  'file_op.read_only': (op: string, ref: string) => `${op} ${ref}: Файлова система лише для читання`,
  'file_op.is_dir': (op: string, ref: string) => `${op} ${ref}: Шлях є каталогом`,
  'file_op.not_dir': (op: string, ref: string) => `${op} ${ref}: Шлях не є каталогом`,
  'file_op.cross_device': (op: string, ref: string) => `${op} ${ref}: Не можна перемістити файли між різними пристроями`,
  'file_op.busy': (op: string, ref: string) => `${op} ${ref}: Файл зайнятий, закрийте його та спробуйте знову`,
  'file_op.same_target': (op: string, ref: string) => `${op} ${ref}: Ціль не може збігатися з джерелом`,
  'file_op.generic': (op: string, ref: string, msg: string) => `${op} ${ref}: ${msg}`,

  // ── 操作动词 ──
  'operation.create_file': 'Створити файл',
  'operation.create_folder': 'Створити папку',
  'operation.rename_op': 'Перейменувати',
  'operation.delete_op': 'Видалити',
  'operation.copy_op': 'Копіювати',
  'operation.move_op': 'Перемістити',
  'operation.extract_op': 'Розпакувати',
  'operation.open_op': 'Відкрити',
  'operation.import_op': 'Імпортувати',
  'operation.launch_app': 'Запустити програму',
  'operation.move_verb': 'Перемістити',
  'operation.copy_verb': 'Копіювати',

  // ── 侧边栏 ──
  'sidebar.places': 'Місця',
  'sidebar.devices': 'Пристрої',
  'sidebar.dashboard': 'Панель',
  'sidebar.home': 'Домашній',
  'sidebar.desktop': 'Робочий стіл',
  'sidebar.documents': 'Документи',
  'sidebar.downloads': 'Завантаження',
  'sidebar.music': 'Музика',
  'sidebar.pictures': 'Зображення',
  'sidebar.videos': 'Відео',

  // ── 导航栏 ──
  'nav.dashboard': 'Панель',
  'nav.home': 'Домашній',
  'nav.files': 'Файли',
  'nav.terminal': 'Термінал',
  'nav.settings': 'Налаштування',

  // ── 仪表盘 ──
  'dashboard.good_morning': 'Доброго ранку',
  'dashboard.good_afternoon': 'Доброго дня',
  'dashboard.good_evening': 'Доброго вечора',
  'dashboard.welcome': 'Вітаємо з поверненням на вашу панель.',
  'dashboard.system_storage': 'Системне сховище',
  'dashboard.used': 'Використано',
  'dashboard.total': 'Усього',
  'dashboard.loading': 'Завантаження статистики...',
  'dashboard.pinned': 'Закріплені',
  'dashboard.add': 'Додати',
  'dashboard.pin_folder': 'Закріпити папку',
  'dashboard.pin_file': 'Закріпити файл',
  'dashboard.recent': 'Нещодавні',
  'dashboard.no_recent': 'Немає нещодавно відкритих файлів.',
  'dashboard.unpin_tooltip': 'Відкріпити',

  // ── 选择模式 ──
  'selection.box_replace': 'Вибір рамкою (замінити)',
  'selection.box_union': 'Вибір рамкою (об’єднати)',
  'selection.box_intersection': 'Вибір рамкою (перетин)',
  'selection.box_difference': 'Вибір рамкою (різниця)',
  'selection.click_range_add': 'Вибір клацанням (додати діапазон)',
  'selection.click_add_remove': 'Вибір клацанням (додати/вилучити)',
  'selection.click_range': 'Вибір клацанням (діапазон)',

  // ── 搜索 ──
  'search.results': (n: number, q: string) => plural(n, 'Знайдено {n} результат для', 'Знайдено {n} результати для', 'Знайдено {n} результатів для') + ` «${q}»`,
  'search.clear': 'Очистити пошук',

  // ── 排序 ──
  'sort.toggle_grouping': 'Перемкнути групування',
  'sort.by_name': 'Сортувати за іменем',
  'sort.by_size': 'Сортувати за розміром',
  'sort.by_date': 'Сортувати за датою змінення',

  // ── 状态栏 ──
  'status.items': (n: number) => plural(n, '{n} елемент', '{n} елементи', '{n} елементів'),
  'status.selected': (n: number) => `Вибрано: ${n}`,

  // ── Omnibar ──
  'omnibar.placeholder': 'Введіть шлях або пошук...',
  'omnibar.button_tip': 'Клацніть, щоб змінити шлях або шукати',
  'omnibar.flatten_symlinks': 'Розгорнути символічні посилання',

  // ── 面包屑 ──
  'breadcrumbs.root': 'Корінь',
  'breadcrumbs.home': (user: string, dir: string) => `Домашній каталог ${user}\n${dir}`,
  'breadcrumbs.go_to_root': 'Перейти до кореня',
  'breadcrumbs.go_to_home': 'Перейти до домашнього каталогу',
  'breadcrumbs.go_to_trash': 'Перейти до кошика',
  'drag.action_title': 'Перемістити чи копіювати?',
  'drag.action_message': (n: number, dir: string) => plural(n, 'Перемістити чи скопіювати {n} елемент', 'Перемістити чи скопіювати {n} елементи', 'Перемістити чи скопіювати {n} елементів') + ` у «${dir}»?`,
  'drag.button.move': 'Перемістити',
  'drag.button.copy': 'Копіювати',
  'drag.trash_restore_title': 'Відновити сюди?',
  'drag.trash_restore_message': (dir: string) => `Відновити елементи у «${dir}»? Відновлення перемістить їх із кошика.`,
  'breadcrumbs.go_to_dev': 'Перейти до каталогу пристроїв',
  'breadcrumbs.root_title': (mp: string) => `Кореневий каталог\n${mp}`,
  'breadcrumbs.dev': 'Пристрої',
  'breadcrumbs.dev_title': (mp: string) => `Каталог пристроїв\n${mp}`,
  'breadcrumbs.devpts': 'Віртуальні термінали',
  'breadcrumbs.devpts_title': (mp: string) => `Каталог віртуальних терміналів\n${mp}`,
  'breadcrumbs.proc': 'Інформація про ядро',
  'breadcrumbs.proc_title': (mp: string) => `Каталог інформації про ядро\n${mp}`,
  'breadcrumbs.sysfs': 'Об’єкти ядра',
  'breadcrumbs.sysfs_title': (mp: string) => `Каталог об’єктів ядра\n${mp}`,
  'breadcrumbs.tmpfs': 'Тимчасові файли',
  'breadcrumbs.tmpfs_title': (mp: string) => `Тимчасовий каталог\n${mp}`,

  // ── Tab 标题 ──
  'tab.dashboard': 'Панель',
  'tab.home': 'Домашній',
  'tab.downloads': 'Завантаження',
  'tab.documents': 'Документи',
  'tab.music': 'Музика',
  'tab.pictures': 'Зображення',
  'tab.videos': 'Відео',
  'tab.new_tab': 'Нова вкладка',
  // ── 空状态 ──
  'empty.no_tabs': 'Немає відкритих вкладок',
  'empty.open_new_tab': 'Відкрити нову вкладку',

  // ── 终端 ──
  'terminal.title': 'Термінал',
  'terminal.process_exited': '\r\nПроцес завершено.\r\n',

  // ── 回收站 ──
  'tab.trash': 'Кошик',
  'sidebar.trash': 'Кошик',
  'trash.title': 'Кошик',
  'trash.empty': 'Кошик порожній',
  'trash.empty_trash': 'Спустошити кошик',
  'trash.empty_confirm': 'Справді спустошити кошик? Цю дію не можна скасувати.',
  'trash.emptied': (n: number) => `Кошик спустошено (${plural(n, 'вилучено {n} елемент', 'вилучено {n} елементи', 'вилучено {n} елементів')})`,
  'trash.restore': 'Відновити',
  'trash.restoring_items': 'Відновлення елементів...',
  'trash.restored_items': (n: number) => plural(n, 'Відновлено {n} елемент', 'Відновлено {n} елементи', 'Відновлено {n} елементів'),
  'trash.restore_conflicts': (n: number) => plural(n,
    'Пропущено {n} елемент, бо в місці призначення існує файл із таким самим іменем',
    'Пропущено {n} елементи, бо в місці призначення існують файли з такими самими іменами',
    'Пропущено {n} елементів, бо в місці призначення існують файли з такими самими іменами'),
  'trash.restore_no_origin': 'Не вдається відновити: немає інформації про початкове розташування',

  // ── 错误边界 ──
  'error.something_wrong': 'Щось пішло не так',

  // ── MIME 类型 ──
  'mime.folder': 'Папка',
  'mime.symlink': 'Символічне посилання',
  'mime.broken_symlink': 'Пошкоджене символічне посилання',
  'mime.block_device': 'Блочний пристрій',
  'mime.char_device': 'Символьний пристрій',
  'mime.named_pipe': 'Іменований канал (FIFO)',
  'mime.socket': 'Сокет',
  'mime.text': 'Текстовий документ',
  'mime.html': 'Документ HTML',
  'mime.css': 'Таблиця стилів CSS',
  'mime.javascript': 'Сценарій JavaScript',
  'mime.xml': 'Документ XML',
  'mime.csv': 'Документ CSV',
  'mime.markdown': 'Документ Markdown',
  'mime.python': 'Сценарій Python',
  'mime.c_source': 'Вихідний код C',
  'mime.cpp_source': 'Вихідний код C++',
  'mime.java_source': 'Вихідний код Java',
  'mime.go_source': 'Вихідний код Go',
  'mime.rust_source': 'Вихідний код Rust',
  'mime.shell': 'Сценарій оболонки',
  'mime.yaml': 'Документ YAML',
  'mime.toml': 'Документ TOML',
  'mime.png': 'Зображення PNG',
  'mime.jpeg': 'Зображення JPEG',
  'mime.gif': 'Зображення GIF',
  'mime.svg': 'Зображення SVG',
  'mime.webp': 'Зображення WebP',
  'mime.bmp': 'Зображення BMP',
  'mime.tiff': 'Зображення TIFF',
  'mime.icon': 'Піктограма',
  'mime.heic': 'Зображення HEIC',
  'mime.mp3': 'Аудіо MP3',
  'mime.ogg': 'Аудіо OGG',
  'mime.flac': 'Аудіо FLAC',
  'mime.wav': 'Аудіо WAV',
  'mime.aac': 'Аудіо AAC',
  'mime.mp4': 'Відео MP4',
  'mime.webm': 'Відео WebM',
  'mime.avi': 'Відео AVI',
  'mime.quicktime': 'Відео QuickTime',
  'mime.pdf': 'Документ PDF',
  'mime.zip': 'Архів ZIP',
  'mime.gzip': 'Архів GZIP',
  'mime.bzip2': 'Архів BZIP2',
  'mime.xz': 'Архів XZ',
  'mime._7z': 'Архів 7z',
  'mime.rar': 'Архів RAR',
  'mime.tar': 'Архів TAR',
  'mime.iso': 'Образ диска',
  'mime.krita': 'Документ Krita',
  'mime.scratch': 'Проєкт Scratch',
  'mime.odt': 'Документ ODT',
  'mime.ods': 'Таблиця ODS',
  'mime.odp': 'Презентація ODP',
  'mime.docx': 'Документ DOCX',
  'mime.xlsx': 'Таблиця XLSX',
  'mime.pptx': 'Презентація PPTX',
  'mime.doc': 'Документ DOC',
  'mime.xls': 'Таблиця XLS',
  'mime.ppt': 'Презентація PPT',
  'mime.rtf': 'Документ RTF',
  'mime.elf': 'Виконуваний файл ELF',
  'mime.executable': 'Виконуваний файл',
  'mime.shared_lib': 'Спільна бібліотека',
  'mime.python_bytecode': 'Байт-код Python',
  'mime.json': 'Документ JSON',
  'mime.unknown_ext': (ext: string) => `Файл ${ext.toUpperCase()}`,
  'mime.other_file': 'Інший файл',

  // ── MIME 分类 ──
  'mime.cat.text': 'Документи',
  'mime.cat.image': 'Зображення',
  'mime.cat.audio': 'Аудіо',
  'mime.cat.video': 'Відео',
  'mime.cat.font': 'Шрифти',
  'mime.cat.system': 'Системні файли',
  'mime.cat.other': 'Інше',

  // ── 文件分组 ──
  'group.folders': 'Папки',
  'group.media': 'Медіа',
  'group.documents': 'Документи',
  'group.code': 'Код',
  'group.archives': 'Архіви',
  'group.executables': 'Виконувані файли',
  'group.others': 'Інші',

  // ── 大小格式化 ──
  'size.b': 'Б',
  'size.kb': 'КБ',
  'size.mb': 'МБ',
  'size.gb': 'ГБ',
  'size.tb': 'ТБ',
  'size.zero': '0 Б',

  // ── Toast 操作 ──
  'toast.copy_action': 'Копіювати',
  'toast.loading_dir': (path: string) => `Завантаження ${path}...`,
  'toast.opening_file': 'Відкриття файла...',
  'toast.searching': 'Пошук...',
  'toast.cancel_action': 'Скасувати',
  'toast.deleting_items': 'Видалення елементів...',
  'toast.pasting_items': 'Вставлення елементів...',
  'toast.importing_items': 'Імпортування елементів...',
  'toast.progress_count': (current: number, total: number) => `${current} / ${total}`,
  'toast.operation_cancelled': 'Операцію скасовано',
  'toast.close_action': 'Закрити',

  // ── 设备操作 ──
  'device.mount': 'Змонтувати',
  'device.unmount': 'Розмонтувати',
  'device.eject': 'Витягнути',
  'device.power_off': 'Вимкнути диск',
  'device.mounting': (path: string) => `Монтування ${path}...`,
  'device.unmounting': (path: string) => `Розмонтування ${path}...`,
  'device.mounted': (device: string, mountpoint: string) => `Змонтовано ${device} → ${mountpoint}`,
  'device.unmounted': (device: string) => `Розмонтовано ${device}`,
  'device.mount_failed': (device: string, error?: string) => `Не вдалося змонтувати ${device}` + (error ? `: ${error}` : ''),
  'device.mount_timeout': (device: string) => `Час очікування монтування ${device} минув. Перевірте пізніше або перевірте пристрій`,
  'device.mount_no_device': (device: string) => `${device} відключено або його USB-адресу змінено. Спробуйте ще раз`,
  'device.unmount_failed': (device: string, error?: string) => `Не вдалося розмонтувати ${device}` + (error ? `: ${error}` : ''),
  'device.eject_failed': (device: string, error?: string) => `Не вдалося витягнути ${device}` + (error ? `: ${error}` : ''),
  'device.eject_partitions_mounted': (device: string) => `Спочатку розмонтуйте всі змонтовані розділи ${device}`,
  'device.already_mounted': 'Пристрій уже змонтовано',
  'device.go_to_source': 'Перейти до вихідного пристрою',
  'device.type_usb': 'USB-пристрій',
  'device.type_removable': 'Знімний пристрій',
  'device.type_mtp': 'Телефон',
  'device.type_gphoto2': 'Камера',
  'device.needs_auth': 'Для монтування пристрою потрібна автентифікація',
  'device.cannot_mount': 'Не вдається змонтувати цей тип пристрою',
  'device.type_disk': 'Диск',

  // ── 软链接操作 ──
  'symlink.go_to_target': 'Перейти до цілі',
  'symlink.broken_tooltip': (target: string) => `→ ${target} (пошкоджено)`,
  'symlink.tooltip': (target: string) => `→ ${target}`,
  // ── 挂载点操作 ──
  'mountpoint.go_to_source': 'Перейти до вихідного пристрою',
  // ── 语言信息 ──
  'language_name': 'Українська',
  'language_auto': 'Слідувати за системою',
} as const;

export const match = (lang: string) => lang.startsWith('uk');

export default ukUA;
