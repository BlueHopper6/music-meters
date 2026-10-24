const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('desktop', {
  initial: () => ipcRenderer.invoke('initial'),
  chooseAudio: () => ipcRenderer.invoke('choose-audio'),
  chooseImage: () => ipcRenderer.invoke('choose-image'),
  loadAssets: project => ipcRenderer.invoke('load-assets', project),
  previewAt: (frame, project) => ipcRenderer.invoke('preview-at', frame, project),
  saveProject: project => ipcRenderer.invoke('save-project', project),
  openProject: () => ipcRenderer.invoke('open-project'),
  renderMp4: (project, preset) => ipcRenderer.invoke('render-mp4', project, preset),
  cancelRender: () => ipcRenderer.invoke('cancel-render'),
  onExport: listener => {
    const handler = (_event, value) => listener(value)
    ipcRenderer.on('export-event', handler)
    return () => ipcRenderer.off('export-event', handler)
  },
})
