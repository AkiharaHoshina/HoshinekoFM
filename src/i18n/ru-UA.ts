/**
 * 俄语（乌克兰）翻译。
 * 基于乌克兰的俄语惯用用法与惯用词汇（受乌克兰语影响的俄语变体），例如：
 * «символьная ссылка»（源自 укр. «символьне посилання»）、
 * «распаковать тут»（源自 укр. «розпакувати тут»）、
 * «выключить диск»（源自 укр. «вимкнути диск»）、
 * «совместная библиотека»（源自 укр. «спільна бібліотека»）等。
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

const ruUA = {
  // ── 文件操作 ──
  'file.open': 'Открыть',
  'file.copy': 'Копировать',
  'file.cut': 'Вырезать',
  'file.paste': 'Вставить',
  'file.delete': 'Удалить',
  'file.rename': 'Переименовать',
  'file.extract_here': 'Распаковать тут',
  'file.open_terminal': 'Открыть во встроенном терминале',
  'file.open_with': 'Открыть с помощью...',
  'file.properties': 'Свойства',
  'file.refresh': 'Обновить',
  'file.new_folder': 'Новая папка',
  'file.new_file': 'Новый файл',
  'file.select_all': 'Выбрать все',
  'file.pin': 'Закрепить на панели',
  'file.unpin': 'Открепить от панели',

  // ── 右键菜单 ──
  'context_menu.open': 'Открыть',
  'context_menu.open_with': 'Открыть с помощью...',
  'context_menu.open_terminal': 'Открыть во встроенном терминале',
  'context_menu.open_in_terminal': 'Открыть в терминале по умолчанию',
  'context_menu.run_in_terminal': 'Запустить в терминале по умолчанию',
  'context_menu.copy': 'Копировать',
  'context_menu.cut': 'Вырезать',
  'context_menu.paste': 'Вставить',
  'context_menu.rename': 'Переименовать',
  'context_menu.delete': 'Удалить',
  'context_menu.delete_permanent': 'Удалить навсегда',
  'drop.same_dir': 'Файлы уже в этой папке',
  'drop.no_paths': 'Не удалось получить пути перетаскиваемых файлов',
  'context_menu.properties': 'Свойства',
  'context_menu.new_folder': 'Новая папка',
  'context_menu.new_file': 'Новый файл',
  'context_menu.refresh': 'Обновить',
  'context_menu.select_all': 'Выбрать все',
  'context_menu.pin': 'Закрепить на панели',
  'context_menu.unpin': 'Открепить от панели',
  'context_menu.extract_here': 'Распаковать тут',

  // ── 弹窗按钮 ──
  'dialog.button.cancel': 'Отмена',
  'dialog.button.confirm': 'ОК',
  'dialog.button.done': 'Готово',
  'dialog.button.close': 'Закрыть',
  'dialog.button.open': 'Открыть',

  // ── 重名对话框（多选）──
  'dialog.conflict.title_move': (n: number) => n === 1
    ? 'Перемещение — 1 конфликт имён'
    : `Перемещение — ${n} конфликтов имён`,
  'dialog.conflict.title_copy': (n: number) => n === 1
    ? 'Копирование — 1 конфликт имён'
    : `Копирование — ${n} конфликтов имён`,
  'dialog.conflict.title_fallback': (n: number) => n === 1
    ? '1 элемент имеет конфликт имён'
    : `${n} элементов имеют конфликты имён`,
  'dialog.conflict.single_title': 'Конфликт имён',
  'dialog.conflict.skip': (n: number) => plural(n,
    'Пропустить {n} конфликтующий элемент',
    'Пропустить {n} конфликтующих элемента',
    'Пропустить {n} конфликтующих элементов'),
  'dialog.conflict.auto_rename': 'Автопереименование',
  'dialog.conflict.manual_rename': 'Переименовать вручную',
  'dialog.conflict.source_label': 'Откуда',
  'dialog.conflict.operation_label': 'Операция',
  'dialog.conflict.dest_label': 'Куда',
  'dialog.conflict.operation_move': 'Переместить',
  'dialog.conflict.operation_copy': 'Копировать',
  'dialog.conflict.more_items': (n: number) => `... осталось ещё ${n} конфликтов`,
  'dialog.conflict.cancelled': 'Операция отменена',
  'dialog.conflict.skipped_items': (n: number) => plural(n,
    'Пропущен {n} конфликтующий элемент',
    'Пропущено {n} конфликтующих элемента',
    'Пропущено {n} конфликтующих элементов'),
  'dialog.conflict.all_skipped': (n: number) => `Все ${plural(n, '{n} элемент', '{n} элемента', '{n} элементов')} пропущены из-за конфликтов имён — ничего не выполнено`,
  'dialog.conflict.cancel_item': 'Элемент отменён',

  // ── 重命名弹窗 ──
  'dialog.rename.title': 'Переименовать',
  'dialog.rename.cancel': 'Отмена',
  'dialog.rename.confirm': 'Переименовать',
  'dialog.rename.placeholder': 'Новое имя',

  // ── 新建弹窗 ──
  'dialog.create.folder': 'Новая папка',
  'dialog.create.file': 'Новый файл',
  'dialog.create.default_folder': 'Новая_папка',
  'dialog.create.default_file': 'Новый_текстовый_файл.txt',

  // ── 删除确认 ──
  'dialog.delete.confirm': (n: number) => plural(n,
    'Вы уверены, что хотите удалить выбранный {n} элемент?',
    'Вы уверены, что хотите удалить выбранные {n} элемента?',
    'Вы уверены, что хотите удалить выбранные {n} элементов?'),
  'dialog.delete.permanent_confirm': (n: number) =>
    `Это окончательно удалит ${plural(n, '{n} элемент', '{n} элемента', '{n} элементов')} без возможности отмены. Продолжить?`,
  'dialog.delete.total_size': (size: string) => `Общий размер: ${size}`,

  // ── 属性弹窗 ──
  'properties.title': 'Свойства',
  'properties.folder': 'Папка',
  'properties.file': 'Файл',
  'properties.location': 'Расположение:',
  'properties.size': 'Размер:',
  'properties.calculating': 'Вычисление...',
  'properties.bytes': ' Б',
  'properties.modified': 'Время изменения:',
  'properties.permissions': 'Права доступа:',
  'properties.owner': 'Владелец:',
  'properties.type': 'Тип:',
  'properties.directory': 'Каталог',

  // ── 打开方式弹窗 ──
  'open_with.title': 'Открыть с помощью...',
  'open_with.cancel': 'Отмена',
  'open_with.open': 'Открыть',
  'open_with.search': 'Поиск приложений...',
  'open_with.recommended': 'Рекомендованные приложения',
  'open_with.all': 'Все приложения',

  // ── 设置弹窗 ──
  'settings.title': 'Настройки',
  'settings.done': 'Готово',
  'settings.show_hidden': 'Показывать скрытые файлы',
  'settings.appearance': 'Внешний вид',
  'settings.view_mode': 'Режим просмотра',
  'settings.grid': 'Сетка',
  'settings.list': 'Список',
  'settings.icon_size': 'Размер значков',
  'settings.filled_icons': 'Залитые значки',
  'settings.customization': 'Персонализация',
  'settings.custom_css': 'Пользовательский CSS',
  'settings.import_css': 'Импортировать CSS',
  'settings.behavior': 'Поведение',
  'settings.language': 'Язык',
  'settings.marquee_text': 'Бегущая строка',

  // ── Toast 消息 ──
  'toast.copied_items': (n: number) => plural(n, 'Скопирован {n} элемент', 'Скопировано {n} элемента', 'Скопировано {n} элементов'),
  'toast.cut_items': (n: number) => plural(n, 'Вырезан {n} элемент', 'Вырезано {n} элемента', 'Вырезано {n} элементов'),
  'toast.moved_items': (n: number) => plural(n, 'Перемещён {n} элемент', 'Перемещено {n} элемента', 'Перемещено {n} элементов'),
  'toast.pasted_items': (n: number) => plural(n, 'Вставлен {n} элемент', 'Вставлено {n} элемента', 'Вставлено {n} элементов'),
  'toast.deleted_items': (n: number) => plural(n, 'Удалён {n} элемент', 'Удалено {n} элемента', 'Удалено {n} элементов'),
  'toast.deleted_permanently': (n: number) => plural(n, 'Окончательно удалён {n} элемент', 'Окончательно удалено {n} элемента', 'Окончательно удалено {n} элементов'),
  'toast.imported_files': (n: number) => plural(n, 'Импортирован {n} файл', 'Импортировано {n} файла', 'Импортировано {n} файлов'),
  'toast.imported_skipped': (ok: number, skip: number) => `Импортировано файлов: ${ok}, пропущено: ${skip}`,
  'toast.import_all_skipped': (skip: number) => `Все ${skip} файлов пропущены (уже существуют)`,
  'toast.failed_items': (n: number) => plural(n, 'Ошибка для {n} элемента', 'Ошибка для {n} элементов', 'Ошибка для {n} элементов'),
  'toast.delete_fail_permission': 'Проверьте права доступа',
  'toast.file_deleted': (name: string) => `Удалено «${name}»`,
  'toast.file_created': (name: string) => `Создан файл «${name}»`,
  'toast.folder_created': (name: string) => `Создана папка «${name}»`,
  'toast.file_extracted': (name: string) => `Распаковано «${name}»`,
  'toast.rename_success': (oldN: string, newN: string) => `Переименовано: ${oldN} -> ${newN}`,
  'toast.rename_move_success': (oldN: string, newP: string) => `Переименовано: ${oldN} перемещено в ${newP}`,
  'toast.copy_success': (src: string, destDir: string, dest: string) => `${src} → ${destDir}/${dest}`,
  'toast.move_success': (src: string, destDir: string, dest: string) => `${src} → ${destDir}/${dest}`,
  'toast.launch_failed': (exec: string, result: string) => `Открыть с помощью: не удалось выполнить ${exec} (${result})`,
  'toast.no_terminal_found': 'Эмулятор терминала по умолчанию не найден',
  'toast.terminal_launch_failed': (msg: string) => `Не удалось запустить терминал: ${msg}`,

  // ── 错误消息 ──
  'error.permission_denied': 'Доступ запрещён',
  'error.not_found': 'Не найдено',
  'error.cannot_access': 'Нет доступа',
  'error.unknown': 'Неизвестная ошибка',
  'error.cannot_open_dir': (msg: string) => `Не удалось открыть каталог: ${msg}`,
  'error.search_failed': (msg: string) => `Поиск не удался: ${msg}`,
  'error.name_exists': (name: string) => `Не удалось переименовать: «${name}» существует`,
  'error.copy_exists': (name: string) => `Не удалось копировать: «${name}» существует`,
  'error.move_exists': (name: string) => `Не удалось переместить: «${name}» существует`,
  'error.unsupported_format': 'Неподдерживаемый формат архива',
  'error.file_open_failed': (name: string, err: string) => `Не удалось открыть ${name}: ${err}`,
  'error.create_parent_failed': (parent: string) => `Не удалось создать целевой каталог: ${parent}`,
  'error.path_fallback': (path: string, reason: string, fallback: string) => `Нет доступа к «${path}» (${reason}), переключено на «${fallback}»`,

  // ── fileOperations 错误格式化 ──
  'file_op.exists': (op: string, ref: string) => `${op} ${ref}: Файл с таким именем уже существует`,
  'file_op.not_found': (op: string, ref: string) => `${op} ${ref}: Нет такого файла или каталога`,
  'file_op.permission': (op: string, ref: string) => `${op} ${ref}: Доступ запрещён`,
  'file_op.no_space': (op: string, ref: string) => `${op} ${ref}: Нет свободного места на устройстве`,
  'file_op.read_only': (op: string, ref: string) => `${op} ${ref}: Файловая система только для чтения`,
  'file_op.is_dir': (op: string, ref: string) => `${op} ${ref}: Путь является каталогом`,
  'file_op.not_dir': (op: string, ref: string) => `${op} ${ref}: Путь не является каталогом`,
  'file_op.cross_device': (op: string, ref: string) => `${op} ${ref}: Нельзя переместить файлы между разными устройствами`,
  'file_op.busy': (op: string, ref: string) => `${op} ${ref}: Файл занят, закройте его и попробуйте ещё раз`,
  'file_op.same_target': (op: string, ref: string) => `${op} ${ref}: Цель не может совпадать с источником`,
  'file_op.generic': (op: string, ref: string, msg: string) => `${op} ${ref}: ${msg}`,

  // ── 操作动词 ──
  'operation.create_file': 'Создать файл',
  'operation.create_folder': 'Создать папку',
  'operation.rename_op': 'Переименовать',
  'operation.delete_op': 'Удалить',
  'operation.copy_op': 'Копировать',
  'operation.move_op': 'Переместить',
  'operation.extract_op': 'Распаковать',
  'operation.open_op': 'Открыть',
  'operation.import_op': 'Импортировать',
  'operation.launch_app': 'Запустить приложение',
  'operation.move_verb': 'Переместить',
  'operation.copy_verb': 'Копировать',

  // ── 侧边栏 ──
  'sidebar.places': 'Места',
  'sidebar.devices': 'Устройства',
  'sidebar.dashboard': 'Панель',
  'sidebar.home': 'Главная',
  'sidebar.desktop': 'Рабочий стол',
  'sidebar.documents': 'Документы',
  'sidebar.downloads': 'Загрузки',
  'sidebar.music': 'Музыка',
  'sidebar.pictures': 'Изображения',
  'sidebar.videos': 'Видео',

  // ── 导航栏 ──
  'nav.dashboard': 'Панель',
  'nav.home': 'Главная',
  'nav.files': 'Файлы',
  'nav.terminal': 'Терминал',
  'nav.settings': 'Настройки',

  // ── 仪表盘 ──
  'dashboard.good_morning': 'Доброе утро',
  'dashboard.good_afternoon': 'Добрый день',
  'dashboard.good_evening': 'Добрый вечер',
  'dashboard.welcome': 'С возвращением на вашу панель.',
  'dashboard.system_storage': 'Системное хранилище',
  'dashboard.used': 'Использовано',
  'dashboard.total': 'Всего',
  'dashboard.loading': 'Загрузка статистики...',
  'dashboard.pinned': 'Закреплённые',
  'dashboard.add': 'Добавить',
  'dashboard.pin_folder': 'Закрепить папку',
  'dashboard.pin_file': 'Закрепить файл',
  'dashboard.recent': 'Недавние',
  'dashboard.no_recent': 'Нет недавно открытых файлов.',
  'dashboard.unpin_tooltip': 'Открепить',

  // ── 选择模式 ──
  'selection.box_replace': 'Выбор рамкой (заменить)',
  'selection.box_union': 'Выбор рамкой (объединить)',
  'selection.box_intersection': 'Выбор рамкой (пересечение)',
  'selection.box_difference': 'Выбор рамкой (разность)',
  'selection.click_range_add': 'Выбор кликом (добавить диапазон)',
  'selection.click_add_remove': 'Выбор кликом (добавить/убрать)',
  'selection.click_range': 'Выбор кликом (диапазон)',

  // ── 搜索 ──
  'search.results': (n: number, q: string) => plural(n, 'Найден {n} результат', 'Найдено {n} результата', 'Найдено {n} результатов') + ` по запросу «${q}»`,
  'search.clear': 'Очистить поиск',

  // ── 排序 ──
  'sort.toggle_grouping': 'Переключить группировку',
  'sort.by_name': 'Сортировать по имени',
  'sort.by_size': 'Сортировать по размеру',
  'sort.by_date': 'Сортировать по дате изменения',

  // ── 状态栏 ──
  'status.items': (n: number) => plural(n, '{n} элемент', '{n} элемента', '{n} элементов'),
  'status.selected': (n: number) => `выбрано: ${n}`,

  // ── Omnibar ──
  'omnibar.placeholder': 'Введите путь или поиск...',
  'omnibar.button_tip': 'Нажмите, чтобы изменить путь или выполнить поиск',
  'omnibar.flatten_symlinks': 'Разрешить символьные ссылки',

  // ── 面包屑 ──
  'breadcrumbs.root': 'Корень',
  'breadcrumbs.home': (user: string, dir: string) => `Домашний каталог ${user}\n${dir}`,
  'breadcrumbs.go_to_root': 'Перейти к корню',
  'breadcrumbs.go_to_home': 'Перейти к домашнему каталогу',
  'breadcrumbs.go_to_trash': 'Перейти к корзине',
  'drag.action_title': 'Переместить или скопировать?',
  'drag.action_message': (n: number, dir: string) => plural(n, 'Переместить или скопировать {n} элемент', 'Переместить или скопировать {n} элемента', 'Переместить или скопировать {n} элементов') + ` в «${dir}»?`,
  'drag.button.move': 'Переместить',
  'drag.button.copy': 'Копировать',
  'drag.trash_restore_title': 'Восстановить сюда?',
  'drag.trash_restore_message': (dir: string) => `Восстановить элементы в «${dir}»? Восстановление переместит их из корзины.`,
  'breadcrumbs.go_to_dev': 'Перейти к каталогу устройств',
  'breadcrumbs.root_title': (mp: string) => `Корневой каталог\n${mp}`,
  'breadcrumbs.dev': 'Устройства',
  'breadcrumbs.dev_title': (mp: string) => `Каталог устройств\n${mp}`,
  'breadcrumbs.devpts': 'Виртуальные терминалы',
  'breadcrumbs.devpts_title': (mp: string) => `Каталог виртуальных терминалов\n${mp}`,
  'breadcrumbs.proc': 'Информация о ядре',
  'breadcrumbs.proc_title': (mp: string) => `Каталог информации о ядре\n${mp}`,
  'breadcrumbs.sysfs': 'Объекты ядра',
  'breadcrumbs.sysfs_title': (mp: string) => `Каталог объектов ядра\n${mp}`,
  'breadcrumbs.tmpfs': 'Временные файлы',
  'breadcrumbs.tmpfs_title': (mp: string) => `Временный каталог\n${mp}`,

  // ── Tab 标题 ──
  'tab.dashboard': 'Панель',
  'tab.home': 'Главная',
  'tab.downloads': 'Загрузки',
  'tab.documents': 'Документы',
  'tab.music': 'Музыка',
  'tab.pictures': 'Изображения',
  'tab.videos': 'Видео',
  'tab.new_tab': 'Новая вкладка',
  // ── 空状态 ──
  'empty.no_tabs': 'Нет открытых вкладок',
  'empty.open_new_tab': 'Открыть новую вкладку',

  // ── 终端 ──
  'terminal.title': 'Терминал',
  'terminal.process_exited': '\r\nПроцесс завершён.\r\n',

  // ── 回收站 ──
  'tab.trash': 'Корзина',
  'sidebar.trash': 'Корзина',
  'trash.title': 'Корзина',
  'trash.empty': 'Корзина пуста',
  'trash.empty_trash': 'Очистить корзину',
  'trash.empty_confirm': 'Вы уверены, что хотите очистить корзину? Это действие нельзя отменить.',
  'trash.emptied': (n: number) => `Корзина очищена (${plural(n, 'удалён {n} элемент', 'удалено {n} элемента', 'удалено {n} элементов')})`,
  'trash.restore': 'Восстановить',
  'trash.restoring_items': 'Восстановление элементов...',
  'trash.restored_items': (n: number) => plural(n, 'Восстановлен {n} элемент', 'Восстановлено {n} элемента', 'Восстановлено {n} элементов'),
  'trash.restore_conflicts': (n: number) => plural(n,
    'Пропущен {n} элемент, так как в месте назначения существует файл с таким же именем',
    'Пропущено {n} элемента, так как в месте назначения существуют файлы с такими же именами',
    'Пропущено {n} элементов, так как в месте назначения существуют файлы с такими же именами'),
  'trash.restore_no_origin': 'Невозможно восстановить: нет информации об исходном расположении',

  // ── 错误边界 ──
  'error.something_wrong': 'Что-то пошло не так',

  // ── MIME 类型 ──
  'mime.folder': 'Папка',
  'mime.symlink': 'Символьная ссылка',
  'mime.broken_symlink': 'Повреждённая символьная ссылка',
  'mime.block_device': 'Блочное устройство',
  'mime.char_device': 'Символьное устройство',
  'mime.named_pipe': 'Именованный канал (FIFO)',
  'mime.socket': 'Сокет',
  'mime.text': 'Текстовый документ',
  'mime.html': 'Документ HTML',
  'mime.css': 'Таблица стилей CSS',
  'mime.javascript': 'Сценарий JavaScript',
  'mime.xml': 'Документ XML',
  'mime.csv': 'Документ CSV',
  'mime.markdown': 'Документ Markdown',
  'mime.python': 'Сценарий Python',
  'mime.c_source': 'Исходный код C',
  'mime.cpp_source': 'Исходный код C++',
  'mime.java_source': 'Исходный код Java',
  'mime.go_source': 'Исходный код Go',
  'mime.rust_source': 'Исходный код Rust',
  'mime.shell': 'Сценарий командной оболочки',
  'mime.yaml': 'Документ YAML',
  'mime.toml': 'Документ TOML',
  'mime.png': 'Изображение PNG',
  'mime.jpeg': 'Изображение JPEG',
  'mime.gif': 'Изображение GIF',
  'mime.svg': 'Изображение SVG',
  'mime.webp': 'Изображение WebP',
  'mime.bmp': 'Изображение BMP',
  'mime.tiff': 'Изображение TIFF',
  'mime.icon': 'Значок',
  'mime.heic': 'Изображение HEIC',
  'mime.mp3': 'Аудио MP3',
  'mime.ogg': 'Аудио OGG',
  'mime.flac': 'Аудио FLAC',
  'mime.wav': 'Аудио WAV',
  'mime.aac': 'Аудио AAC',
  'mime.mp4': 'Видео MP4',
  'mime.webm': 'Видео WebM',
  'mime.avi': 'Видео AVI',
  'mime.quicktime': 'Видео QuickTime',
  'mime.pdf': 'Документ PDF',
  'mime.zip': 'Архив ZIP',
  'mime.gzip': 'Архив GZIP',
  'mime.bzip2': 'Архив BZIP2',
  'mime.xz': 'Архив XZ',
  'mime._7z': 'Архив 7z',
  'mime.rar': 'Архив RAR',
  'mime.tar': 'Архив TAR',
  'mime.iso': 'Образ диска',
  'mime.krita': 'Документ Krita',
  'mime.scratch': 'Проект Scratch',
  'mime.odt': 'Документ ODT',
  'mime.ods': 'Таблица ODS',
  'mime.odp': 'Презентация ODP',
  'mime.docx': 'Документ DOCX',
  'mime.xlsx': 'Таблица XLSX',
  'mime.pptx': 'Презентация PPTX',
  'mime.doc': 'Документ DOC',
  'mime.xls': 'Таблица XLS',
  'mime.ppt': 'Презентация PPT',
  'mime.rtf': 'Документ RTF',
  'mime.elf': 'Исполняемый файл ELF',
  'mime.executable': 'Исполняемый файл',
  'mime.shared_lib': 'Совместная библиотека',
  'mime.python_bytecode': 'Байт-код Python',
  'mime.json': 'Документ JSON',
  'mime.unknown_ext': (ext: string) => `Файл ${ext.toUpperCase()}`,
  'mime.other_file': 'Другой файл',

  // ── MIME 分类 ──
  'mime.cat.text': 'Документы',
  'mime.cat.image': 'Изображения',
  'mime.cat.audio': 'Аудио',
  'mime.cat.video': 'Видео',
  'mime.cat.font': 'Шрифты',
  'mime.cat.system': 'Системные файлы',
  'mime.cat.other': 'Другое',

  // ── 文件分组 ──
  'group.folders': 'Папки',
  'group.media': 'Медиа',
  'group.documents': 'Документы',
  'group.code': 'Код',
  'group.archives': 'Архивы',
  'group.executables': 'Исполняемые файлы',
  'group.others': 'Другие',

  // ── 大小格式化 ──
  'size.b': 'Б',
  'size.kb': 'КБ',
  'size.mb': 'МБ',
  'size.gb': 'ГБ',
  'size.tb': 'ТБ',
  'size.zero': '0 Б',

  // ── Toast 操作 ──
  'toast.copy_action': 'Копировать',
  'toast.loading_dir': (path: string) => `Загрузка ${path}...`,
  'toast.opening_file': 'Открытие файла...',
  'toast.searching': 'Поиск...',
  'toast.cancel_action': 'Отмена',
  'toast.deleting_items': 'Удаление элементов...',
  'toast.pasting_items': 'Вставка элементов...',
  'toast.importing_items': 'Импорт элементов...',
  'toast.progress_count': (current: number, total: number) => `${current} / ${total}`,
  'toast.operation_cancelled': 'Операция отменена',
  'toast.close_action': 'Закрыть',

  // ── 设备操作 ──
  'device.mount': 'Смонтировать',
  'device.unmount': 'Размонтировать',
  'device.eject': 'Извлечь',
  'device.power_off': 'Выключить диск',
  'device.mounting': (path: string) => `Монтирование ${path}...`,
  'device.unmounting': (path: string) => `Размонтирование ${path}...`,
  'device.mounted': (device: string, mountpoint: string) => `Смонтировано ${device} → ${mountpoint}`,
  'device.unmounted': (device: string) => `Размонтировано ${device}`,
  'device.mount_failed': (device: string, error?: string) => `Не удалось смонтировать ${device}` + (error ? `: ${error}` : ''),
  'device.unmount_failed': (device: string, error?: string) => `Не удалось размонтировать ${device}` + (error ? `: ${error}` : ''),
  'device.eject_failed': (device: string, error?: string) => `Не удалось извлечь ${device}` + (error ? `: ${error}` : ''),
  'device.eject_partitions_mounted': (device: string) => `Сначала размонтируйте все смонтированные разделы ${device}`,
  'device.already_mounted': 'Устройство уже смонтировано',
  'device.go_to_source': 'Перейти к исходному устройству',
  'device.type_usb': 'USB-устройство',
  'device.type_removable': 'Съёмное устройство',
  'device.needs_auth': 'Для монтирования устройства требуется аутентификация',
  'device.cannot_mount': 'Не удаётся смонтировать этот тип устройства',
  'device.type_disk': 'Диск',

  // ── 软链接操作 ──
  'symlink.go_to_target': 'Перейти к цели',
  'symlink.broken_tooltip': (target: string) => `→ ${target} (повреждена)`,
  'symlink.tooltip': (target: string) => `→ ${target}`,
  // ── 挂载点操作 ──
  'mountpoint.go_to_source': 'Перейти к исходному устройству',
  // ── 语言信息 ──
  'language_name': 'Русский (Украина)',
  'language_auto': 'Следовать системе',
} as const;

export const match = (lang: string) => lang.startsWith('ru');

export default ruUA;
