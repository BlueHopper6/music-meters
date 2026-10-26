const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  initial: () => ipcRenderer.invoke('initial'),
  chooseAudio: () => ipcRenderer.invoke('choose-audio'),
  chooseImage: () => ipcRenderer.invoke('choose-image'),
  loadAssets: project => ipcRenderer.invoke('load-assets', project),
  previewAt: (frame, project) => ipcRenderer.invoke('preview-at', frame, project),
  cancelPreview: () => ipcRenderer.invoke('cancel-preview'),
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
  renderVideo: (project, preset, audioMode) => ipcRenderer.invoke('render-video', project, preset, audioMode),
  cancelRender: () => ipcRenderer.invoke('cancel-render'),
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
