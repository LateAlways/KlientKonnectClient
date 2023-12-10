import { app, BrowserWindow, Menu, ipcMain, nativeImage, desktopCapturer, ipcRenderer, dialog } from 'electron';
import * as path from 'path';
import { setupTitlebar, attachTitlebarToWindow } from "custom-electron-titlebar/main";

app.commandLine.appendSwitch ("disable-http-cache");

setupTitlebar();
let win: BrowserWindow;
let win2: BrowserWindow;
const createWindow = () => {
    win = new BrowserWindow({
        resizable: false,
        webPreferences: {
            sandbox: false,
            preload: path.join(__dirname, '../app/preload.js'),
            backgroundThrottling: false,
            nodeIntegration: true,
            contextIsolation: false
        },
        titleBarStyle: 'hidden',
    });
    win.setBounds({ width: 200, height: 350 })
    Menu.setApplicationMenu(null);

    win.webContents.openDevTools();
    win.webContents.setFrameRate(240);
    win.setTitle("KlientKonnect Client");
    win.setIcon(nativeImage.createFromPath(path.join(__dirname, '../assets/icon.png')));

    win.loadFile(path.join(__dirname, '../app/connect.html'))
}

ipcMain.on("loadApp", (event, arg) => {
    win.loadFile(path.join(__dirname, '../app/app.html'));
    win.setBounds({ width: 210, height: 400 })
});

ipcMain.on("loadConnect", (event, arg) => {
    win.setBounds({ width: 200, height: 350 })
    win.loadFile(path.join(__dirname, '../app/connect.html'));
});

ipcMain.handle("getSources", async (event, arg) => {
    return await desktopCapturer.getSources({ types: ['window', 'screen'] });
});

ipcMain.on("getSource", async (event, arg) => {
    if(!win2) {
        win2 = new BrowserWindow({
            resizable: false,
            width: 200,
            height: 350,
            webPreferences: {
                sandbox: false,
                preload: path.join(__dirname, '../app/preload.js'),
                backgroundThrottling: false,
                nodeIntegration: true,
                contextIsolation: false
            },
            titleBarStyle: 'hidden',
        });
        win2.setTitle("Select source");
        win2.setIcon(nativeImage.createFromPath(path.join(__dirname, '../assets/icon.png')));
        win2.on('close', () => {
            win2 = null;
        });
    }
    win2.loadFile(path.join(__dirname, '../app/sources.html'));
    win2.show();
});

ipcMain.handle("setSource", async (event, arg) => {
    win2.close();
    win2 = null;
    win.webContents.send("setSource", arg);
});

ipcMain.handle("showAlert", async (event, arg) => {
    dialog.showMessageBox(win, {
        type: "info",
        title: "KlientKonnect",
        message: arg
    });
});

app.whenReady().then(() => {
    createWindow()
})