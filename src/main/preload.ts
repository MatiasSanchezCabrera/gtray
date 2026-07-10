import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('tray', {
  onState: (callback: (state: unknown) => void) => {
    ipcRenderer.on('state', (_event, state) => callback(state))
  },
  select: (id: string) => ipcRenderer.send('select-account', id),
  add: () => ipcRenderer.send('add-account'),
  accountMenu: (id: string) => ipcRenderer.send('account-menu', id),
  accountTooltip: (payload: { text: string; y: number } | null) =>
    ipcRenderer.send('account-tooltip', payload),
  donate: () => ipcRenderer.send('donate'),
  openApp: (app: string) => ipcRenderer.send('open-app', app),
  updateOpen: () => ipcRenderer.send('update-open'),
  updateDismiss: () => ipcRenderer.send('update-dismiss'),
})
