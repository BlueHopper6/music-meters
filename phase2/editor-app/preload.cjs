const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  initial: () => ipcRenderer.invoke('initial'),
  chooseAudio: () => ipcRenderer.invoke('choose-audio'),
  chooseImage: () => ipcRenderer.invoke('choose-image'),
  loadAssets: project => ipcRenderer.invoke('load-assets', project),
  previewAt: (frame, project) => ipcRenderer.invoke('preview-at', frame, project),
  saveProject: (project, asNew = false) => ipcRenderer.invoke('save-project', project, asNew),
  openProject: () => ipcRenderer.invoke('open-project'),
  listTemplates: () => ipcRenderer.invoke('list-templates'),
  saveTemplate: (name, project) => ipcRenderer.invoke('save-template', name, project),
  loadTemplate: (id, project) => ipcRenderer.invoke('load-template', id, project),
  duplicateTemplate: (id, name) => ipcRenderer.invoke('duplicate-template', id, name),
  renameTemplate: (id, name) => ipcRenderer.invoke('rename-template', id, name),
  setExportPreset: preset => ipcRenderer.invoke('set-export-preset', preset),
  renderMp4: (project, preset) => ipcRenderer.invoke('render-mp4', project, preset),
  cancelRender: () => ipcRenderer.invoke('cancel-render'),
  onExport: listener => {
    const handler = (_event, value) => listener(value)
    ipcRenderer.on('export-event', handler)
    return () => ipcRenderer.off('export-event', handler)
  },
})
