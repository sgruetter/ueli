import { app, BrowserWindow, ipcMain, globalShortcut, dialog, Tray, Menu, screen, MenuItemConstructorOptions, WebContents } from "electron";
import { autoUpdater } from "electron-updater";
import { join } from "path";
import { IpcChannels } from "../common/ipc-channels";
import { SearchResultItem } from "../common/search-result-item";
import { UserConfigOptions } from "../common/config/user-config-options";
import { ElectronStoreConfigRepository } from "../common/config/electron-store-config-repository";
import { defaultUserConfigOptions } from "../common/config/default-user-config-options";
import { AppearanceOptions } from "../common/config/appearance-options";
import { isDev } from "../common/is-dev";
import { UeliCommand } from "./plugins/ueli-command-search-plugin/ueli-command";
import { UeliCommandExecutionArgument } from "./plugins/ueli-command-search-plugin/ueli-command-execution-argument";
import { platform } from "os";
import { getProductionSearchEngine } from "./production/production-search-engine";
import { cloneDeep } from "lodash";
import { GlobalHotKey } from "../common/global-hot-key/global-hot-key";
import { defaultGeneralOptions } from "../common/config/default-general-options";
import { getErrorSearchResultItem } from "../common/error-search-result-item";
import { FileHelpers } from "./../common/helpers/file-helpers";
import { ueliTempFolder, logFilePath } from "../common/helpers/ueli-helpers";
import { getTranslationSet } from "../common/translation/translation-set-manager";
import { trayIconPathWindows, trayIconPathMacOs } from "./helpers/tray-icon-helpers";
import { isValidHotKey } from "../common/global-hot-key/global-hot-key-helpers";
import { NotificationType } from "../common/notification-type";
import { UserInputHistoryManager } from "./user-input-history-manager";
import { isWindows, isMacOs } from "../common/helpers/operating-system-helpers";
import { executeFilePathWindows, executeFilePathMacOs } from "./executors/file-path-executor";
import { WindowPosition } from "../common/window-position";
import { UpdateCheckResult } from "../common/update-check-result";
import { executeUrlMacOs } from "./executors/url-executor";
import { ProductionLogger } from "../common/logger/production-logger";
import { DevLogger } from "../common/logger/dev-logger";
import { windowIconWindows, windowIconMacOs } from "./helpers/window-icon-helpers";

if (!FileHelpers.fileExistsSync(ueliTempFolder)) {
    FileHelpers.createFolderSync(ueliTempFolder);
}

const configRepository = new ElectronStoreConfigRepository(cloneDeep(defaultUserConfigOptions));
const filePathExecutor = isWindows(platform()) ? executeFilePathWindows : executeFilePathMacOs;
const trayIconFilePath = isWindows(platform()) ? trayIconPathWindows : trayIconPathMacOs;
const windowIconFilePath = isWindows(platform()) ? windowIconWindows : windowIconMacOs;
const userInputHistoryManager = new UserInputHistoryManager();
const releaseUrl = "https://github.com/oliverschwendener/ueli/releases/latest";
const windowsPowerShellPath = "C:\\Windows\\System32\\WindowsPowerShell\\v1.0";

autoUpdater.autoDownload = false;

if (isMacOs(platform())) {
    app.dock.hide();
}

if (isWindows(platform())) {
    addPowershellToPathVariableIfMissing();
}

let trayIcon: Tray;
let mainWindow: BrowserWindow;
let settingsWindow: BrowserWindow;
let lastWindowPosition: WindowPosition;

let config = configRepository.getConfig();
let translationSet = getTranslationSet(config.generalOptions.language);
const logger = isDev()
    ? new DevLogger()
    : new ProductionLogger(logFilePath, filePathExecutor);
let searchEngine = getProductionSearchEngine(config, translationSet, logger);

let rescanInterval = config.generalOptions.rescanEnabled
    ? setInterval(() => refreshAllIndexes(), Number(config.generalOptions.rescanIntervalInSeconds) * 1000)
    : undefined;

function notifyRenderer(message: string, notificationType: NotificationType) {
    BrowserWindow.getAllWindows().forEach((window) => {
        if (window !== undefined && !window.isDestroyed()) {
            window.webContents.send(IpcChannels.notification, message, notificationType);
        }
    });
}

function refreshAllIndexes() {
    searchEngine.refreshIndexes()
        .then(() => {
            logger.debug("Successfully refreshed all indexes");
            notifyRenderer(translationSet.successfullyRefreshedIndexes, NotificationType.Info);
        })
        .catch((err) => {
            logger.error(err);
            notifyRenderer(err, NotificationType.Error);
        })
        .finally(() => {
            BrowserWindow.getAllWindows().forEach((window) => {
                window.webContents.send(IpcChannels.refreshIndexesCompleted);
            });
        });
}

function clearAllCaches() {
    searchEngine.clearCaches()
        .then(() => {
            logger.debug("Successfully cleared caches");
            notifyRenderer(translationSet.successfullyClearedCaches, NotificationType.Info);
        })
        .catch((err) => logger.error(err));
}

function registerGlobalKeyboardShortcut(toggleAction: () => void, newHotKey: GlobalHotKey) {
    newHotKey = isValidHotKey(newHotKey) ? newHotKey : defaultGeneralOptions.hotKey;
    globalShortcut.unregisterAll();
    globalShortcut.register(`${newHotKey.modifier ? `${newHotKey.modifier}+` : ``}${newHotKey.key}`, toggleAction);
}

function showMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isVisible()) {
            mainWindow.focus();
        } else {
            const mousePosition = screen.getCursorScreenPoint();
            const display = config.generalOptions.showAlwaysOnPrimaryDisplay
                ? screen.getPrimaryDisplay()
                : screen.getDisplayNearestPoint(mousePosition);
            const windowBounds: Electron.Rectangle = {
                height: Math.round(Number(config.appearanceOptions.userInputHeight)),
                width: Math.round(Number(config.appearanceOptions.windowWidth)),
                x: config.generalOptions.rememberWindowPosition && lastWindowPosition && lastWindowPosition.x
                    ? lastWindowPosition.x
                    : calculateX(display),
                    y: config.generalOptions.rememberWindowPosition && lastWindowPosition && lastWindowPosition.y
                    ? lastWindowPosition.y
                    : calculateY(display),
            };
            mainWindow.setBounds(windowBounds);
            mainWindow.show();
        }
        mainWindow.webContents.send(IpcChannels.mainWindowHasBeenShown);
    }
}

function calculateX(display: Electron.Display): number {
    return Math.round(Number(display.bounds.x + (display.bounds.width / 2) - (config.appearanceOptions.windowWidth / 2)));
}

function calculateY(display: Electron.Display): number {
    return Math.round(Number(display.bounds.y + (display.bounds.height / 2) - (getMaxWindowHeight(
        config.appearanceOptions.maxSearchResultsPerPage,
        config.appearanceOptions.searchResultHeight,
        config.appearanceOptions.userInputHeight) / 2)));
}

function onBlur() {
    if (config.generalOptions.hideMainWindowOnBlur) {
        hideMainWindow();
    }
}

function hideMainWindow() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcChannels.mainWindowHasBeenHidden);

        setTimeout(() => {
            updateMainWindowSize(0, config.appearanceOptions);
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.hide();
            }
        }, 25);
    }
}

function toggleMainWindow() {
    if (mainWindow.isVisible()) {
        if (!config.generalOptions.hideMainWindowOnBlur) {
            showMainWindow();
        } else {
            hideMainWindow();
        }
    } else {
        showMainWindow();
    }
}

function getMaxWindowHeight(maxSearchResultsPerPage: number, searchResultHeight: number, userInputHeight: number): number {
    return Number(maxSearchResultsPerPage) * Number(searchResultHeight) + Number(userInputHeight);
}

function updateConfig(updatedConfig: UserConfigOptions, needsIndexRefresh?: boolean) {
    if (updatedConfig.generalOptions.language !== config.generalOptions.language) {
        onLanguageChange(updatedConfig);
    }

    if (updatedConfig.generalOptions.hotKey !== config.generalOptions.hotKey) {
        registerGlobalKeyboardShortcut(toggleMainWindow, updatedConfig.generalOptions.hotKey);
    }

    if (updatedConfig.generalOptions.rescanIntervalInSeconds !== config.generalOptions.rescanIntervalInSeconds) {
        if (rescanInterval) {
            clearInterval(rescanInterval);
        }
        rescanInterval = setInterval(() => refreshAllIndexes(), updatedConfig.generalOptions.rescanIntervalInSeconds * 1000);
    }

    if (!updatedConfig.generalOptions.rescanEnabled) {
        if (rescanInterval) {
            clearInterval(rescanInterval);
        }
    }

    if (Number(updatedConfig.appearanceOptions.windowWidth) !== Number(config.appearanceOptions.windowWidth)) {
        mainWindow.setResizable(true);
        mainWindow.setSize(Number(updatedConfig.appearanceOptions.windowWidth), getMaxWindowHeight(
            updatedConfig.appearanceOptions.maxSearchResultsPerPage,
            updatedConfig.appearanceOptions.searchResultHeight,
            updatedConfig.appearanceOptions.userInputHeight));
        updateMainWindowSize(0, updatedConfig.appearanceOptions);
        mainWindow.center();
        mainWindow.setResizable(false);
    }

    if (JSON.stringify(updatedConfig.appearanceOptions) !== JSON.stringify(config.appearanceOptions)) {
        mainWindow.webContents.send(IpcChannels.appearanceOptionsUpdated, updatedConfig.appearanceOptions);
    }

    if (JSON.stringify(updatedConfig.colorThemeOptions) !== JSON.stringify(config.colorThemeOptions)) {
        mainWindow.webContents.send(IpcChannels.colorThemeOptionsUpdated, updatedConfig.colorThemeOptions);
    }

    if (JSON.stringify(updatedConfig.generalOptions) !== JSON.stringify(config.generalOptions)) {
        mainWindow.webContents.send(IpcChannels.generalOptionsUpdated, updatedConfig.generalOptions);
    }

    config = updatedConfig;

    updateTrayIcon(updatedConfig);
    updateAutoStartOptions(updatedConfig);

    configRepository.saveConfig(updatedConfig)
        .then(() => {
            searchEngine.updateConfig(updatedConfig, translationSet)
                .then(() => {
                    if (needsIndexRefresh) {
                        refreshAllIndexes();
                    } else {
                        notifyRenderer(translationSet.successfullyUpdatedconfig, NotificationType.Info);
                    }
                })
                .catch((err) =>  logger.error(err));
        })
        .catch((err) => logger.error(err));
}

function updateMainWindowSize(searchResultCount: number, appearanceOptions: AppearanceOptions, center?: boolean) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setResizable(true);
        const windowHeight = searchResultCount > appearanceOptions.maxSearchResultsPerPage
            ? Math.round(getMaxWindowHeight(
                appearanceOptions.maxSearchResultsPerPage,
                appearanceOptions.searchResultHeight, appearanceOptions.userInputHeight))
            : Math.round((Number(searchResultCount) * Number(appearanceOptions.searchResultHeight)) + Number(appearanceOptions.userInputHeight));

        mainWindow.setSize(Number(appearanceOptions.windowWidth), Number(windowHeight));
        if (center) {
            mainWindow.center();
        }
        mainWindow.setResizable(false);
    }
}

function reloadApp() {
    updateMainWindowSize(0, config.appearanceOptions);
    searchEngine = getProductionSearchEngine(config, translationSet, logger);
    mainWindow.reload();
}

function beforeQuitApp(): Promise<void> {
    return new Promise((resolve, reject) => {
        destroyTrayIcon();
        if (config.generalOptions.clearCachesOnExit) {
            searchEngine.clearCaches()
                .then(() => {
                    logger.debug("Successfully cleared all caches before app quit");
                    resolve();
                })
                .catch((err) => reject(err));
        } else {
            resolve();
        }
    });
}

function quitApp() {
    beforeQuitApp()
        .then(() => { /* Do nothing */ })
        .catch((err) => logger.error(err))
        .finally(() => {
            if (rescanInterval) {
                clearInterval(rescanInterval);
            }
            globalShortcut.unregisterAll();
            app.quit();
        });
}

function updateAutoStartOptions(userConfig: UserConfigOptions) {
    if (!isDev()) {
        app.setLoginItemSettings({
            args: [],
            openAtLogin: userConfig.generalOptions.autostart,
            path: process.execPath,
        });
    }
}

function createTrayIcon() {
    if (config.generalOptions.showTrayIcon) {
        trayIcon = new Tray(trayIconFilePath);
        updateTrayIconContextMenu();
    }
}

function updateTrayIconContextMenu() {
    if (trayIcon && !trayIcon.isDestroyed()) {
        trayIcon.setContextMenu(Menu.buildFromTemplate([
            {
                click: showMainWindow,
                label: translationSet.trayIconShow,
            },
            {
                click: openSettings,
                label: translationSet.trayIconSettings,
            },
            {
                click: refreshAllIndexes,
                label: translationSet.ueliCommandRefreshIndexes,
            },
            {
                click: quitApp,
                label: translationSet.trayIconQuit,
            },
        ]));
    }
}

function updateTrayIcon(updatedConfig: UserConfigOptions) {
    if (updatedConfig.generalOptions.showTrayIcon) {
        if (trayIcon === undefined || (trayIcon && trayIcon.isDestroyed())) {
            createTrayIcon();
        }
    } else {
        destroyTrayIcon();
    }
}

function destroyTrayIcon() {
    if (trayIcon !== undefined && !trayIcon.isDestroyed()) {
        trayIcon.destroy();
    }
}

function onMainWindowMove() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        const currentPosition = mainWindow.getPosition();
        if (currentPosition.length === 2) {
            lastWindowPosition = {
                x: currentPosition[0],
                y: currentPosition[1],
            };
        }
    }
}

function createMainWindow() {
    mainWindow = new BrowserWindow({
        backgroundColor: "#00000000",
        center: true,
        frame: false,
        height: getMaxWindowHeight(
            config.appearanceOptions.maxSearchResultsPerPage,
            config.appearanceOptions.searchResultHeight,
            config.appearanceOptions.userInputHeight),
        icon: windowIconFilePath,
        resizable: false,
        show: false,
        skipTaskbar: true,
        transparent: true,
        webPreferences: {
            nodeIntegration: true,
        },
        width: config.appearanceOptions.windowWidth,
    });
    mainWindow.on("blur", onBlur);
    mainWindow.on("closed", quitApp);
    mainWindow.on("move", onMainWindowMove);
    mainWindow.loadFile(join(__dirname, "..", "main.html"));
}

function startApp() {
    createTrayIcon();
    createMainWindow();

    const recenter = isMacOs(platform());
    updateMainWindowSize(0, config.appearanceOptions, recenter);
    registerGlobalKeyboardShortcut(toggleMainWindow, config.generalOptions.hotKey);
    updateAutoStartOptions(config);
    setKeyboardShortcuts();
    registerAllIpcListeners();
}

function setKeyboardShortcuts() {
    if (isMacOs(platform()) && !isDev()) {
        const template = [
            {
                label: "ueli",
                submenu: [
                    { label: "Quit", accelerator: "Command+Q", click: quitApp },
                    { label: "Reload", accelerator: "Command+R", click: reloadApp },
                ],
            },
            {
                label: "Edit",
                submenu: [
                    { label: "Undo", accelerator: "CmdOrCtrl+Z", selector: "undo:" },
                    { label: "Redo", accelerator: "Shift+CmdOrCtrl+Z", selector: "redo:" },
                    { type: "separator" },
                    { label: "Cut", accelerator: "CmdOrCtrl+X", selector: "cut:" },
                    { label: "Copy", accelerator: "CmdOrCtrl+C", selector: "copy:" },
                    { label: "Paste", accelerator: "CmdOrCtrl+V", selector: "paste:" },
                    { label: "Select All", accelerator: "CmdOrCtrl+A", selector: "selectAll:" },
                ],
            },
        ] as MenuItemConstructorOptions[];

        Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    }
}

function onLanguageChange(updatedConfig: UserConfigOptions) {
    translationSet = getTranslationSet(updatedConfig.generalOptions.language);

    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.setTitle(translationSet.settings);
    }

    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IpcChannels.languageUpdated, translationSet);
    }

    updateTrayIconContextMenu();
}

function onSettingsOpen() {
    if (isMacOs(platform())) {
        app.dock.show();
    }
}

function onSettingsClose() {
    if (isMacOs(platform())) {
        app.dock.hide();
    }
}

function openSettings() {
    onSettingsOpen();
    if (!settingsWindow || settingsWindow.isDestroyed()) {
        settingsWindow = new BrowserWindow({
            height: 750,
            icon: windowIconFilePath,
            title: translationSet.settings,
            webPreferences: {
                nodeIntegration: true,
            },
            width: 1000,
        });
        settingsWindow.setMenu(null);
        settingsWindow.loadFile(join(__dirname, "..", "settings.html"));
        settingsWindow.on("close", onSettingsClose);
        if (isDev()) {
            settingsWindow.webContents.openDevTools();
        }
    } else {
        settingsWindow.focus();
    }
}

function updateSearchResults(results: SearchResultItem[], webcontents: WebContents, updatedUserInput?: string) {
    if (updatedUserInput) {
        webcontents.send(IpcChannels.userInputUpdated, updatedUserInput);
    }

    updateMainWindowSize(results.length, config.appearanceOptions);
    webcontents.send(IpcChannels.searchResponse, results);
}

function noSearchResultsFound() {
    if (mainWindow && !mainWindow.isDestroyed()) {
        updateMainWindowSize(1, config.appearanceOptions);
        const noResultFound = getErrorSearchResultItem(translationSet.generalErrorTitle, translationSet.generalErrorDescription);
        mainWindow.webContents.send(IpcChannels.searchResponse, [noResultFound]);
    }
}

function sendMessageToSettingsWindow(ipcChannel: IpcChannels, message: string) {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
        settingsWindow.webContents.send(ipcChannel, message);
    }
}

function registerAllIpcListeners() {
    ipcMain.on(IpcChannels.configUpdated, (event: Electron.Event, updatedConfig: UserConfigOptions, needsIndexRefresh?: boolean) => {
        updateConfig(updatedConfig, needsIndexRefresh);
    });

    ipcMain.on(IpcChannels.search, (event: Electron.Event, userInput: string) => {
        searchEngine.getSearchResults(userInput)
            .then((result) => updateSearchResults(result, event.sender))
            .catch((err) => {
                logger.error(err);
                noSearchResultsFound();
            });
    });

    ipcMain.on(IpcChannels.favoritesRequested, (event: Electron.Event) => {
        searchEngine.getFavorites()
            .then((result) => updateSearchResults(result, event.sender))
            .catch((err) => {
                logger.error(err);
                noSearchResultsFound();
            });
    });

    ipcMain.on(IpcChannels.mainWindowHideRequested, () => {
        hideMainWindow();
    });

    ipcMain.on(IpcChannels.execute, (event: Electron.Event, userInput: string, searchResultItem: SearchResultItem, privileged: boolean) => {
        searchEngine.execute(searchResultItem, privileged)
            .then(() => {
                userInputHistoryManager.addItem(userInput);
                if (searchResultItem.hideMainWindowAfterExecution) {
                    hideMainWindow();
                } else {
                    updateMainWindowSize(0, config.appearanceOptions);
                }
            })
            .catch((err) => logger.error(err));
    });

    ipcMain.on(IpcChannels.openSearchResultLocation, (event: Electron.Event, searchResultItem: SearchResultItem) => {
        searchEngine.openLocation(searchResultItem)
            .then(() => hideMainWindow())
            .catch((err) => {
                logger.error(err);
                noSearchResultsFound();
            });
    });

    ipcMain.on(IpcChannels.autoComplete, (event: Electron.Event, searchResultItem: SearchResultItem) => {
        searchEngine.autoComplete(searchResultItem)
            .then((result) => updateSearchResults(result.results, event.sender, result.updatedUserInput))
            .catch((err) => {
                logger.error(err);
                noSearchResultsFound();
            });
    });

    ipcMain.on(IpcChannels.reloadApp, () => {
        reloadApp();
    });

    ipcMain.on(IpcChannels.openSettingsWindow, () => {
        openSettings();
    });

    ipcMain.on(IpcChannels.folderPathRequested, (event: Electron.Event) => {
        dialog.showOpenDialog(settingsWindow, {
            properties: ["openDirectory"],
        }, (folderPaths: string[]) => {
            event.sender.send(IpcChannels.folderPathResult, folderPaths);
        });
    });

    ipcMain.on(IpcChannels.filePathRequested, (event: Electron.Event, filters?: Electron.FileFilter[]) => {
        dialog.showOpenDialog(settingsWindow, {
            filters,
            properties: ["openFile"],
        }, (filePaths: string[]) => {
            if (!filePaths) {
                filePaths = [];
            }
            event.sender.send(IpcChannels.filePathResult, filePaths);
        });
    });

    ipcMain.on(IpcChannels.clearExecutionLogConfirmed, (event: Electron.Event) => {
        searchEngine.clearExecutionLog()
            .then(() => notifyRenderer(translationSet.successfullyClearedExecutionLog, NotificationType.Info))
            .catch((err) => {
                logger.error(err);
                notifyRenderer(err, NotificationType.Error);
            });
    });

    ipcMain.on(IpcChannels.openDebugLogRequested, (event: Electron.Event) => {
        logger.openLog()
            .then(() => { /* do nothing */ })
            .catch((err) => notifyRenderer(err, NotificationType.Error));
    });

    ipcMain.on(IpcChannels.openTempFolderRequested, (event: Electron.Event) => {
        filePathExecutor(ueliTempFolder, false);
    });

    ipcMain.on(IpcChannels.selectInputHistoryItem, (event: Electron.Event, direction: string) => {
        const newUserInput = direction === "next"
            ? userInputHistoryManager.getNext()
            : userInputHistoryManager.getPrevious();
        event.sender.send(IpcChannels.userInputUpdated, newUserInput, true);
    });

    ipcMain.on(IpcChannels.ueliCommandExecuted, (command: UeliCommand) => {
        switch (command.executionArgument) {
            case UeliCommandExecutionArgument.Exit:
                quitApp();
                break;
            case UeliCommandExecutionArgument.Reload:
                reloadApp();
                break;
            case UeliCommandExecutionArgument.EditConfigFile:
                configRepository.openConfigFile();
                break;
            case UeliCommandExecutionArgument.OpenSettings:
                openSettings();
                break;
            case UeliCommandExecutionArgument.RefreshIndexes:
                refreshAllIndexes();
                break;
            case UeliCommandExecutionArgument.ClearCaches:
                clearAllCaches();
                break;
            default:
                logger.error("Unhandled ueli command execution");
                break;
        }
    });

    ipcMain.on(IpcChannels.checkForUpdate, (event: Electron.Event) => {
        logger.debug("Check for updates");
        if (isDev()) {
            sendMessageToSettingsWindow(IpcChannels.checkForUpdateResponse, UpdateCheckResult.NoUpdateAvailable);
        } else {
            autoUpdater.checkForUpdates();
        }
    });

    ipcMain.on(IpcChannels.downloadUpdate, (event: Electron.Event) => {
        if (isWindows(platform())) {
            logger.debug("Downloading updated");
            autoUpdater.downloadUpdate();
        } else if (isMacOs(platform())) {
            executeUrlMacOs(releaseUrl);
        }
    });
}

function addPowershellToPathVariableIfMissing() {
    if (process.env.PATH) {
        if (process.env.PATH.indexOf(windowsPowerShellPath) < 0) {
            process.env.PATH += `;${windowsPowerShellPath}`;
        }
    }
}

app.on("ready", () => {
    const gotSingleInstanceLock = app.requestSingleInstanceLock();
    if (gotSingleInstanceLock) {
        startApp();
    } else {
        logger.error("Other instance is already running: quitting app.");
        quitApp();
    }
});

app.on("window-all-closed", quitApp);
app.on("quit", app.quit);
app.commandLine.appendSwitch("force-color-profile", "srgb");

autoUpdater.on("update-available", () => {
    logger.debug("Update check result: update available");
    sendMessageToSettingsWindow(IpcChannels.checkForUpdateResponse, UpdateCheckResult.UpdateAvailable);
});

autoUpdater.on("update-not-available", () => {
    logger.debug("Update check result: update not available");
    sendMessageToSettingsWindow(IpcChannels.checkForUpdateResponse, UpdateCheckResult.NoUpdateAvailable);
});

autoUpdater.on("error", (error) => {
    logger.error(`Update check result: ${error}`);
    sendMessageToSettingsWindow(IpcChannels.checkForUpdateResponse, UpdateCheckResult.Error);
});

if (isWindows(platform())) {
    autoUpdater.on("update-downloaded", () => {
        logger.debug("Update downloaded");
        autoUpdater.quitAndInstall();
    });
}
