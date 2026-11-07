function buildDarwinMenuTemplate(options = {}) {
  const appName = options.appName || 'MusicMeters'
  const onCommand = typeof options.onCommand === 'function' ? options.onCommand : () => {}
  const onRequestQuit = typeof options.onRequestQuit === 'function' ? options.onRequestQuit : () => {}
  const onRequestCloseWindow = typeof options.onRequestCloseWindow === 'function' ? options.onRequestCloseWindow : () => {}
  const onToggleFullScreen = typeof options.onToggleFullScreen === 'function' ? options.onToggleFullScreen : () => {}

  return [
    {
      label: appName,
      submenu: [
        {
          id: 'menu-about',
          label: `About ${appName}`,
          click: () => onCommand('about'),
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        {
          id: 'menu-quit',
          label: `Quit ${appName}`,
          accelerator: 'CommandOrControl+Q',
          click: () => onRequestQuit(),
        },
      ],
    },
    {
      label: 'File',
      submenu: [
        {
          id: 'menu-new-blank',
          label: 'New Blank Project',
          accelerator: 'CommandOrControl+N',
          click: () => onCommand('new-project'),
        },
        {
          id: 'menu-new-template',
          label: 'New from Template…',
          click: () => onCommand('new-from-template'),
        },
        {
          id: 'menu-open-project',
          label: 'Open Project…',
          accelerator: 'CommandOrControl+O',
          click: () => onCommand('open-project'),
        },
        { type: 'separator' },
        {
          id: 'menu-save-project',
          label: 'Save Project',
          accelerator: 'CommandOrControl+S',
          click: () => onCommand('save-project'),
        },
        {
          id: 'menu-save-project-as',
          label: 'Save Project As…',
          accelerator: 'CommandOrControl+Shift+S',
          click: () => onCommand('save-project-as'),
        },
        { type: 'separator' },
        {
          id: 'menu-export',
          label: 'Export…',
          accelerator: 'CommandOrControl+E',
          click: () => onCommand('open-export'),
        },
        { type: 'separator' },
        {
          id: 'menu-close-project',
          label: 'Close Project',
          accelerator: 'CommandOrControl+W',
          click: () => onCommand('close-project'),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          id: 'menu-undo',
          label: 'Undo',
          accelerator: 'CommandOrControl+Z',
          click: () => onCommand('undo'),
        },
        {
          id: 'menu-redo',
          label: 'Redo',
          accelerator: 'CommandOrControl+Shift+Z',
          click: () => onCommand('redo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Templates',
      submenu: [
        {
          id: 'menu-use-template',
          label: 'Use Template…',
          click: () => onCommand('use-template'),
        },
        {
          id: 'menu-save-template',
          label: 'Save as Template…',
          click: () => onCommand('save-template'),
        },
        {
          id: 'menu-manage-templates',
          label: 'Manage Templates…',
          click: () => onCommand('manage-templates'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          id: 'menu-fullscreen-preview',
          label: 'Fullscreen Preview',
          accelerator: 'CommandOrControl+F',
          click: () => onCommand('fullscreen-preview'),
        },
        {
          id: 'menu-toggle-fullscreen',
          label: 'Toggle Window Full Screen',
          accelerator: 'Ctrl+Command+F',
          click: () => onToggleFullScreen(),
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        {
          id: 'menu-close-window',
          label: 'Close Window',
          click: () => onRequestCloseWindow(),
        },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          id: 'menu-help-about',
          label: `About ${appName} & License Notices`,
          click: () => onCommand('about'),
        },
      ],
    },
  ]
}

function shouldQuitOnWindowAllClosed(options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'darwin') return true
  if (options.quitRequested) return true
  if (options.isAutomatedTest && !options.lifecycleSmoke) return true
  return false
}

function initialScreenMode({ isStartupSession, projectOpen, metadata, projectPath }) {
  if (isStartupSession) return 'project-manager-splash'
  if (!projectOpen && !metadata && !projectPath) return 'project-manager'
  return 'editor'
}

module.exports = {
  buildDarwinMenuTemplate,
  shouldQuitOnWindowAllClosed,
  initialScreenMode,
}
