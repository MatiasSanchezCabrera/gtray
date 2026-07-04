import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('tray', {
  onState: (callback: (state: unknown) => void) => {
    ipcRenderer.on('state', (_event, state) => callback(state))
  },
  select: (id: string) => ipcRenderer.send('select-account', id),
  add: () => ipcRenderer.send('add-account'),
  accountMenu: (id: string) => ipcRenderer.send('account-menu', id),
  donate: () => ipcRenderer.send('donate'),
})
