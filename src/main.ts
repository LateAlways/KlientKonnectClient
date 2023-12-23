import { app, BrowserWindow, Menu, ipcMain, nativeImage, desktopCapturer, ipcRenderer, dialog } from 'electron';
import * as path from 'path';
import { setupTitlebar, attachTitlebarToWindow } from "custom-electron-titlebar/main";
import * as cp from 'child_process';

if (handleSquirrelEvent()) {
    app.quit();
}

app.commandLine.appendSwitch("disable-http-cache");

function executeSquirrelCommand(args: any, done: any) {
    let updateDotExe = path.resolve(path.dirname(process.execPath),
        '..', 'Update.exe');
    let child = cp.spawn(updateDotExe, args, { detached: true });

    child.on('close', function (code) {
        done();
    });
};

function install(done: any) {
    let target = path.basename(process.execPath);
    executeSquirrelCommand(["--createShortcut", target], done);
};

function uninstall(done: any) {
    let target = path.basename(process.execPath);
    executeSquirrelCommand(["--removeShortcut", target], done);
};

function handleSquirrelEvent() {
    let squirrelEvent = process.argv[1];

    switch (squirrelEvent) {
        case '--squirrel-install':
            install(app.quit);
            return true;
        case '--squirrel-updated':
            install(app.quit);
            return true;
        case '--squirrel-obsolete':
            app.quit();
            return true;
        case '--squirrel-uninstall':
            uninstall(app.quit);
            return true;
    }

    return false;
}

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
            contextIsolation: false,
        },
        titleBarStyle: 'hidden',
    });
    win.setBounds({ width: 200, height: 350 })
    Menu.setApplicationMenu(null);
    win.webContents.setFrameRate(240);

    win.setTitle("KlientKonnect Client");
    win.webContents.toggleDevTools();
    win.setIcon(nativeImage.createFromPath(path.join(__dirname, '../assets/icon.png')));

    win.loadFile(path.join(__dirname, '../app/connect.html'))
}

ipcMain.on("loadApp", (event, arg) => {
    win.loadFile(path.join(__dirname, '../app/app.html'));
    win.setBounds({ width: 210, height: 400 });
    win.webContents.setFrameRate(240);
});

ipcMain.on("loadConnect", (event, arg) => {
    win.setBounds({ width: 200, height: 350 })
    win.loadFile(path.join(__dirname, '../app/connect.html'));
    win.webContents.setFrameRate(240);
});

ipcMain.handle("getSources", async (event, arg) => {
    return await desktopCapturer.getSources({ types: ['window', 'screen'] });
});

ipcMain.on("getSource", async (event, arg) => {
    if (!win2) {
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

if(!app.requestSingleInstanceLock()) {
    app.quit();
}