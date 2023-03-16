const Tesseract= require('tesseract.js');
const {createWorker} = Tesseract;
const sharp = require('sharp');
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const fs = require("fs");
const path = require("path");
const ffmpeg = require('fluent-ffmpeg');

var toSend = [];
async function createWindow() {
    const window = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            nodeIntegration: true,
            nodeIntegrationInWorker: true,
            contextIsolation: false,
            enableRemoteModule: true,
            allowRunningInsecureContent: true,
            experimentalFeatures: true,
            enableSourceMap: false
        },
    });
    window.loadFile("src/index.html");


    /*
    for (const { imgPath, lang } of processTesseractJs) {
    const worker = createWorker({
    cachePath: path.join(__dirname, 'lang-data'),
    logger: (m) => console.log(m),
    });
    await worker.load();
    await worker.loadLanguage(lang);
    await worker.initialize(lang);
    const imageBuffer = await sharp(imgPath)
    .flatten({ background: { r: 0, g: 0, b: 0 } })
    .negate()
    .toBuffer();
    const { data: { text } } = await worker.recognize(imageBuffer);
    results.push(text);
    await worker.terminate();
    }
    */
    ipcMain.on('processImages', async (event, processTesseractJs) => {
        let imgPath = processTesseractJs["imgPath"];
        let values = [];
        (async () => {
            const worker = await createWorker({
                langPath: path.join(__dirname,'lang-data'),
                logger: m => console.log(m),
            });
            await worker.loadLanguage(`${processTesseractJs["lang"]}`);
            await worker.initialize(`${processTesseractJs["lang"]}`);
            const img = await sharp(imgPath)
                .flatten({ background: { r: 0, g: 0, b: 0 } })
                .negate()
                .toBuffer();
            const { data: { text } } = await worker.recognize(img);
            values.push(text)
            await worker.terminate();
        })();
        console.log(values);
    });
    ipcMain.on("export-config", (event, configData) => {
        const infoDir = path.join(__dirname, "info");
        if (!fs.existsSync(infoDir)) {
            fs.mkdirSync(infoDir);
        }
        const infoPath = path.join(infoDir, "config.json");
        const jsonData = JSON.stringify(configData, null, 2);
        fs.writeFileSync(infoPath, jsonData);
        dialog.showMessageBox({
            type: "info",
            message: "Convert all videos to M3U8?",
            title: "All videos info is saved!",
            buttons: ["YES", "NO"],
        }).then((result) => {
            if (result.response === 0) {
                window.webContents.send("startRender");
                window.webContents.send("clearList");
            } else {
                window.webContents.send("clearList");
            }
        });
    });
    ipcMain.on("get-config", (event, filePath) => {
        const configPath = path.join(
            path.dirname(filePath),
            `${path.basename(filePath, path.extname(filePath))}.json`
        );
        let config = {};
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath));
        }
        event.returnValue = config;
    });
    ipcMain.on("getAllVideosData", (event) => {
        const configPath = path.join(__dirname, "info/config.json");
        if (!fs.existsSync(configPath)) {
            event.reply("infoAllVideosReturn", "Configuration file does not exist!");
        } else {
            const config = JSON.parse(fs.readFileSync(configPath));
            toSend = [];
            toSend.push({ "totalVideos": config.length, "infoFiles": config });
            event.reply("infoAllVideosReturn", toSend);
        }
    });
}
app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

function logProcess(resultados) {
    ipcMain.on('logProcess', (event, arg) => {
        event.reply('loadLog', resultados);
    });
}
function e() {
    () => {
        const configPath = path.join(__dirname, "info/config.json");
        if (!fs.existsSync(configPath)) {
            dialog.showMessageBox({ type: "error", message: "Configuration file does not exist!", title: "Error" });
            return;
        }
        const config = JSON.parse(fs.readFileSync(configPath));
        let converted = 0;
        config.map(async (video) => {
            let contador = 0;
            let vMap = 0;
            let aMap = 0;
            let sMap = 0;
            let videos = [];
            let substitles = [];
            let audios = [];
            let dirVid = [];
            let dirAud = [];
            let dirTex = [];
            const { path: videoPath, config: { media: { track } } } = video;
            const directorio = __dirname + "\\sources\\" + `${video.name}`;
            if (!fs.existsSync(directorio)) {
                fs.mkdirSync(directorio, { recursive: true }, (err) => {
                    if (err) throw err;
                });
            }
            for (var t of track) {
                if (t["@type"] === "Video") {
                    const dirRender = __dirname + "\\sources\\" + `${video.name}\\Video`;
                    if (!fs.existsSync(dirRender)) {
                        fs.mkdirSync(dirRender, { recursive: true }, (err) => {
                            if (err) throw err;
                        });
                    }
                    let toPush = await renderVideo(videoPath, directorio, contador, vMap)
                    videos.push(toPush)
                    vMap = vMap + 1
                    contador++;
                } else if (t["@type"] === "Audio") {
                    const dirRender = __dirname + "\\sources\\" + `${video.name}\\Audio`;
                    if (!fs.existsSync(dirRender)) {
                        fs.mkdirSync(dirRender, { recursive: true }, (err) => {
                            if (err) throw err;
                        });
                    }
                    let toPush = await renderAudio(videoPath, directorio, contador, aMap)
                    audios.push(toPush)
                    aMap = aMap + 1
                    contador++;
                } else if (t["@type"] === "Text") {
                    const dirRender = __dirname + "\\sources\\" + `${video.name}\\Text`;
                    if (!fs.existsSync(dirRender)) {
                        fs.mkdirSync(dirRender, { recursive: true }, (err) => {
                            if (err) throw err;
                        });
                    }
                    let toPush = await renderSubtitle(videoPath, directorio, contador, sMap)
                    substitles.push(toPush)
                    sMap = sMap + 1
                    contador++;
                } else {
                    contador++;
                }
            }

            for (v in videos) {
                const dirRender = __dirname + "\\sources\\" + `${video.name}\\Video\\${v}`;
                if (!fs.existsSync(dirRender)) {
                    fs.mkdirSync(dirRender, { recursive: true }, (err) => {
                        if (err) throw err;
                    });
                }
                logProcess("directorio creado: " + dirRender)
                dirVid.push(dirRender)
            }

            for (a in audios) {
                const dirRender = __dirname + "\\sources\\" + `${video.name}\\Audio\\${a}`;
                if (!fs.existsSync(dirRender)) {
                    fs.mkdirSync(dirRender, { recursive: true }, (err) => {
                        if (err) throw err;
                    });
                }
                logProcess("directorio creado: " + dirRender)
                dirAud.push(dirRender)
            }
            for (s in substitles) {
                const dirRender = __dirname + "\\sources\\" + `${video.name}\\Text\\${s}`;
                if (!fs.existsSync(dirRender)) {
                    fs.mkdirSync(dirRender, { recursive: true }, (err) => {
                        if (err) throw err;
                    });
                }
                logProcess("directorio creado: " + dirRender)
                dirTex.push(dirRender)
            }
        });
    };
};
