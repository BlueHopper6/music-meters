const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  toggleWindowFullscreen: () => ipcRenderer.invoke('toggle-window-fullscreen'),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  maximizeWindow: () => ipcRenderer.invoke('maximize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  windowState: () => ipcRenderer.invoke('window-state'),
  onWindowState: listener => {
    const handler = (_event, state) => listener(state)
    ipcRenderer.on('window-state', handler)
    return () => ipcRenderer.off('window-state', handler)
  },
  initial: () => ipcRenderer.invoke('initial'),
  chooseAudio: () => ipcRenderer.invoke('choose-audio'),
  restoreProject: project => ipcRenderer.invoke('restore-project', project),
  chooseImage: () => ipcRenderer.invoke('choose-image'),
  loadAssets: project => ipcRenderer.invoke('load-assets', project),
  previewAt: (frame, project) => ipcRenderer.invoke('preview-at', frame, project),
  cancelPreview: () => ipcRenderer.invoke('cancel-preview'),
  preparePlayback: (project, frame) => ipcRenderer.invoke('prepare-playback', project, frame),
  playbackFrames: (session, count) => ipcRenderer.invoke('playback-frames', session, count),
  cancelPlayback: () => ipcRenderer.invoke('cancel-playback'),
  saveProject: (project, asNew = false) => ipcRenderer.invoke('save-project', project, asNew),
  openProject: () => ipcRenderer.invoke('open-project'),
  openProjectPath: path => ipcRenderer.invoke('open-project-path', path),
  newBlankProject: () => ipcRenderer.invoke('new-blank-project'),
  newProjectFromTemplate: id => ipcRenderer.invoke('new-project-from-template', id),
  getRecentProjects: () => ipcRenderer.invoke('get-recent-projects'),
  listTemplates: () => ipcRenderer.invoke('list-templates'),
  saveTemplate: (name, project, overwriteId = '') => ipcRenderer.invoke('save-template', name, project, overwriteId),
  loadTemplate: (id, project) => ipcRenderer.invoke('load-template', id, project),
  duplicateTemplate: (id, name = '') => ipcRenderer.invoke('duplicate-template', id, name),
  renameTemplate: (id, name) => ipcRenderer.invoke('rename-template', id, name),
  deleteTemplate: id => ipcRenderer.invoke('delete-template', id),
  setExportPreset: preset => ipcRenderer.invoke('set-export-preset', preset),
  chooseExportDestination: (project, audioMode) => ipcRenderer.invoke('choose-export-destination', project, audioMode),
  renderVideo: (project, preset, audioMode, destination = '') => ipcRenderer.invoke('render-video', project, preset, audioMode, destination),
  cancelRender: () => ipcRenderer.invoke('cancel-render'),
  closeProject: () => ipcRenderer.invoke('close-project'),
  confirmAppClose: () => ipcRenderer.invoke('confirm-app-close'),
  onAppCloseRequested: listener => {
    const handler = () => listener()
    ipcRenderer.on('app-close-requested', handler)
    return () => ipcRenderer.off('app-close-requested', handler)
  },
  onExport: listener => {
    const handler = (_event, value) => listener(value)
    ipcRenderer.on('export-event', handler)
    return () => ipcRenderer.off('export-event', handler)
  },
})
