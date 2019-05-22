import { resolve, join } from 'path';
import { homedir } from 'os';
import { ipcMain, Menu, app, protocol, BrowserWindow } from 'electron';
import { Store } from './src/store'
import { FlowrWindow } from './flowr-window'
const network = require('network');
const deepExtend = require('deep-extend')

const FlowrDataDir = resolve(homedir(), '.flowr')

let initTimeout: number

let isDebugMode: boolean
let isHiddenMenuDisplayed = false
let isLaunchedUrlCorrect = true

const flowrStore = new Store(FlowrDataDir, {
  // We'll call our data file 'user-preferences'
  configName: 'user-preferences',
  defaults: {
    // 800x600 is the default size of our window
    windowBounds: { width: 1280, height: 720 },
    channelData: {},
    isMaximized: false,
  },
})

export async function createWindow(): Promise<BrowserWindow> {
  const mac = await getMacAddress()
  const winBounds = flowrStore.get('windowBounds')

  const defaultUrl = buildFileUrl('config.html')

  const kiosk = flowrStore.get('isKiosk') || false
  const url = flowrStore.get('extUrl') || defaultUrl

  // Create the browser window.
  const opts = {
    width: winBounds.width, // 1280,
    height: winBounds.height + 40, // 720,
    icon: join(__dirname, './assets/icons/png/64x64.png'),
    minWidth: 430,
    minHeight: 270,
    title: 'FlowR',
    kiosk,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  }

  const mainWindow = new FlowrWindow(flowrStore, opts)

  if (flowrStore.get('isMaximized')) {
    mainWindow.maximize()
  }
  // mainWindow.setAspectRatio(16/9)
  mainWindow.setMenuBarVisibility(false)
  mainWindow.setAlwaysOnTop(true, 'floating', 0)

  if (mac) {
    mainWindow.loadURL(url)
  } else {
    const formattedPath = buildFileUrl('noconnection.html')
    mainWindow.loadURL(formattedPath)
  }

  // Open the DevTools.
  if (process.env.ENV === 'dev') {
    mainWindow.webContents.openDevTools()
    isDebugMode = true
  }

  prepareFallBackForInvalidUrl()

  return mainWindow
}

function reconnectionAttemp() {
  console.log('reconnectionAttemp.....')
  if (initTimeout) {
    clearTimeout(initTimeout)
  }
  if (!mainWindow) return

  const formattedPath = buildFileUrl('noconnection.html')
  const flowrUrl = flowrStore.get('extUrl') || buildFileUrl('config.html')
  mainWindow.loadURL(formattedPath)

  initTimeout = setTimeout(() => {
    network.get_active_interface((err: Error, obj: any) => {

      if (obj && obj.gateway_ip) {
        clearTimeout(initTimeout)
        prepareFallBackForInvalidUrl()
        mainWindow.loadURL(flowrUrl)
      } else {
        reconnectionAttemp()
      }
    })
  }, 60000)
}

function prepareFallBackForInvalidUrl() {

  if (initTimeout) {
    clearTimeout(initTimeout)
  }

  initTimeout = setTimeout(() => {
    isLaunchedUrlCorrect = false
    reconnectionAttemp()
  }, 5000)
}

function displayHiddenMenu(): void {
  const flowrUrl = flowrStore.get('extUrl') || buildFileUrl('config.html')
  const template: any = [
    { label: 'Menu',
      submenu: [
        { label: 'Config',
          click() {
            const formattedPath = buildFileUrl('config.html')
            console.log('formattedPath', formattedPath)
            mainWindow.loadURL(formattedPath)
            isHiddenMenuDisplayed = true
          },
        },
        {
          label: 'Flowr',
          click() {
            isHiddenMenuDisplayed = false
            mainWindow.loadURL(flowrUrl)
            prepareFallBackForInvalidUrl()
          },
        },
        {
          label: 'Hide Menu',
          click() {
            mainWindow.setMenuBarVisibility(false)
            if (isHiddenMenuDisplayed) {
              mainWindow.loadURL(flowrUrl)
              prepareFallBackForInvalidUrl()
            }
          },
        },
      ]},
  ]

  const appMenu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(appMenu)
  mainWindow.setMenuBarVisibility(true)
}

ipcMain.on('FlowrIsInitializing', () => {
  clearTimeout(initTimeout)
  isLaunchedUrlCorrect = true
})

ipcMain.on('getAppConfig', (evt: any) => {
  const storedConfig =  flowrStore.get('flowrConfig')
  const  config: any =  {
    debugMode : isDebugMode,
    isLaunchedUrlCorrect,
    deinterlacing: flowrStore.get('deinterlacing'),
  }
  // no need to expose the complete config
  if (storedConfig && storedConfig.ozoneApi) {
    const ozoneApi = storedConfig.ozoneApi.hostProxy || ''
    const flowrApi = (storedConfig.flowrApi && storedConfig.flowrApi.hostProxy) || ''
    const socketApi = (storedConfig.socketApi && storedConfig.socketApi.host) || ''
    const pushVodSocketApi = (storedConfig.pushVodSocketApi && storedConfig.pushVodSocketApi.host) || ''
    const aneviaVodSocketApi = (storedConfig.aneviaVodSocketApi && storedConfig.aneviaVodSocketApi.host) || ''

    config.appConfig = {
      ozoneApi: {
        hostProxy: ozoneApi,
      },
      flowrApi: {
        hostProxy: flowrApi,
      },
      socketApi: {
        host: socketApi,
      },
      pushVodSocketApi:{
        host: pushVodSocketApi,
      },
      aneviaVodSocketApi:{
        host: aneviaVodSocketApi,
      },
    }
  }

  config.extUrl = flowrStore.get('extUrl')
  config.isKiosk = flowrStore.get('isKiosk')

  evt.sender.send('receiveConfig', config)
})

ipcMain.on('getMacAddress', async(evt: any) => {
  const usedMacAddress = await getMacAddress()
  evt.sender.send('receiveMacAddress', usedMacAddress)
})

ipcMain.on('updateAppConfig', (evt: any, data: any) => {
  const currentConfig = flowrStore.get('flowrConfig')
  const newConfig =  deepExtend(currentConfig, data)
  console.log(JSON.stringify(data))
  flowrStore.set('flowrConfig', newConfig)
  app.relaunch()
  app.quit()
})

ipcMain.on('setDebugMode', (evt: any, debugMode: boolean) => {
  const currentConfig = flowrStore.get('flowrConfig')
  isDebugMode = debugMode
  if (isDebugMode) {
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.webContents.closeDevTools()
  }
})

ipcMain.on('setDeinterlacingMode', (evt: any, deinterlacingMode: any) => {
  flowrStore.set('deinterlacing', deinterlacingMode)
})

ipcMain.on('setKioskMode', (evt: any, isKiosk: boolean) => {
  flowrStore.set('isKiosk', isKiosk)
  app.relaunch()
  app.quit()
})

ipcMain.on('setExtUrl', (evt: any, newExtURl: string) => {
  console.log('set new ext url', newExtURl)
  flowrStore.set('extUrl', newExtURl)
  app.relaunch()
  app.quit()
})

ipcMain.on('openConfigMode', displayHiddenMenu)

function buildFileUrl(fileName: string): string {
  let result: string
  if (process.env.ENV === 'dev') {
    result = `http://localhost:4444/${fileName}`;
  } else {
    result = join('file://', app.getAppPath(), 'build', fileName)
  }
  return result
}

function getMacAddress(): Promise<string> {
  return new Promise(((resolve, reject) => {
    network.get_active_interface((err: Error, obj: any) => {
      if (err) {
        throw (err)
      }
      if (obj && obj.mac_address) {
        resolve(obj.mac_address)
      } else {
        reject(Error('no Mac Address Found'))
      }
    })
  }))
}
