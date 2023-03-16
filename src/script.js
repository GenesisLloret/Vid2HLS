const srt = require('srt');
const util = require('util');
const { spawn } = require('child_process');
const mediainfo = require('node-mediainfo')
const { ipcRenderer } = require('electron')
const ffmpeg = require('fluent-ffmpeg');
const parser = require('xml2js').parseStringPromise;
const path = require('path');
const tesseract = require("node-tesseract-ocr")
const fs = require("fs")
const Jimp = require("jimp")
const appendFile = util.promisify(fs.appendFile);

let info2Render = [];
let infoTracks = [];
console.log(process.versions.node);
async function getVideoInfo(e) {
    const result = await mediainfo(e);
    return JSON.stringify(result);
}
async function exportConfig() {
    const fileList = document.getElementById("file-list").children;
    const configData = [];
    for (let i = 0; i < fileList.length; i++) {
        const fileName = fileList[i].textContent;
        const filePath = path.join(fileName);
        const config = ipcRenderer.sendSync("get-config", filePath);
        const info = await getVideoInfo(filePath)
        configData.push({
            name: path.basename(fileName),
            path: filePath,
            config: JSON.parse(info),
        });
    }
    ipcRenderer.send("export-config", configData);
    ipcRenderer.on("infoAllVideosReturn", async (event, data) => {
        data.map(
            async (info) => {
                let countTracks = -1;
                (info.infoFiles).forEach(
                    (d) => {
                        let { path: videoPath, config: { media: { track } } } = d;
                        for (var t of track) {
                            switch (t["@type"]) {
                                case "Video":
                                case "Audio":
                                case "Text":
                                    countTracks++;
                                    break;
                            }
                        }
                    }
                );
                let path2 = info.infoFiles[0].path;
                let numVideos = info.totalVideos - 1;
                let logResults = document.querySelector("#log");
                let countRendering = 0;
                let countRenderingTrack = 0;
                if (numVideos < 0) {
                    logResults.innerHTML = "<h3> Do not load any video</h3>";
                } else {
                    logResults.innerHTML = `<div id="logBars"><p id="infoGeneral">Total videos:<span id="countRendering">${countRendering}</span>/<span id="total2Rendering">${data[0].totalVideos}</span></p><progress id="totalProgress" value="0" max="100"></progress><p id="infoProgress">Progress of <b id="filePath">${path2}</b>:<span id="countRendering">${countRendering}</span>/<span id="file2Rendering">${countTracks}</span></p><progress id="fileProgress" value="0" max="100"></progress><progress id="renderProgress" value="0" max="100"></progress></div><div id="logText"></div>`;
                    for (var d of info.infoFiles) {
                        infoTracks = [];
                        let { path: videoPath, config: { media: { track } } } = d;
                        const directorio = __dirname + "\\sources\\" + `${d.name}`;
                        if (!fs.existsSync(directorio)) { fs.mkdirSync(directorio, { recursive: true }, (err) => { if (err) throw err; }); }
                        var i = 0;
                        var indexM3U8 = ["#EXTM3U", "#EXT-X-VERSION:3"];
                        for (var t of track) {
                            switch (t["@type"]) {
                                case "Video":
                                    console.log(`Video ${i}`);
                                    const resolution2compare = [240, 480, 720, 1080];
                                    let vidDirV = `${directorio}/video`;
                                    if (!fs.existsSync(vidDirV)) {
                                        fs.mkdirSync(vidDirV, { recursive: true });
                                    }
                                    const resolution = t.Height;
                                    const resDirs = resolution2compare.filter((res) => res <= resolution);
                                    if (!resDirs.includes(parseInt(resolution))) { resDirs.push(parseInt(resolution)); }
                                    for (let r of resDirs) { console.log(typeof (r)) }
                                    for (const res2rend of resDirs) {
                                        let resDirectory = `${vidDirV}/${res2rend}`;
                                        console.log(resDirectory);
                                        if (!fs.existsSync(resDirectory)) {
                                            fs.mkdirSync(resDirectory, { recursive: true });
                                        }
                                        let output = `${resDirectory}/index.m3u8`;
                                        await renderVideo(videoPath, output, i, res2rend);
                                        indexM3U8.push(`#EXT-X-STREAM-INF:PROGRAM-ID=1, RESOLUTION="1x${res2rend}",CODECS="avc1.4d4015,mp4a.40.2",AUDIO="aac",SUBTITLES="subs",TAG="${res2rend}p"`);
                                        indexM3U8.push(`./video/${res2rend}/index.m3u8`);
                                    }
                                    i = i + 1;
                                    break;
                                case "Audio":
                                    console.log(`Audio ${i}`);
                                    let vidDir = (directorio + "\\audio");
                                    if (!fs.existsSync(vidDir)) { fs.mkdirSync(vidDir, { recursive: true }, (err) => { if (fs.existsSync(vidDir)) { } else if (err) throw err; }); }
                                    let resDirectory = `${vidDir}/${i}`;
                                    console.log(resDirectory);
                                    if (!fs.existsSync(resDirectory)) { fs.mkdirSync(resDirectory, { recursive: true }); }
                                    output = `${resDirectory}/index.m3u8`;
                                    const ra = await renderAudio(videoPath, output, i);
                                    let nameAud = "";
                                    if (!t["Title"]) { nameAud = t["Language"]; }
                                    else { nameAud = t["Title"] }
                                    indexM3U8.push(`#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aac",NAME="${nameAud}",LANGUAGE="${t["Language"]}",DEFAULT=YES,AUTOSELECT=YES,URI="./audio/${i}/index.m3u8"`);
                                    i = i + 1;
                                    break;
                                case "Text":
                                    console.log(`Text ${i}`);
                                    console.log(t)
                                    switch (t["CodecID"]) {
                                        case "S_HDMV/PGS":
                                            let vidDirS = (directorio + "\\subs");
                                            if (!fs.existsSync(vidDirS)) { fs.mkdirSync(vidDirS, { recursive: true }, (err) => { if (fs.existsSync(vidDirS)) { } else if (err) throw err; }); }
                                            const resDirectory = `${vidDirS}\\${i}`;
                                            if (!fs.existsSync(resDirectory)) { fs.mkdirSync(resDirectory, { recursive: true }); }
                                            let st1 = await extractPGS(videoPath, resDirectory + `\\subtitle.sup`, i);
                                            let st2 = await PGS2XML(__dirname, resDirectory + `\\subtitle.sup`);
                                            let testme = await PGS2Array(`${resDirectory}\\subtitle.sup.xml`);
                                            const lang = testme["BDN"]["Description"][0]["Language"][0]["$"]["Code"];
                                            let inTC = [];
                                            let outTC = [];
                                            let png2txt = [];
                                            const events = testme.BDN.Events.Event;
                                            for (var ef of JSON.parse(((JSON.stringify(testme["BDN"]["Events"])).substring(10)).slice(0, -2))) {
                                                inTC.push(ef["$"]['InTC']);
                                                outTC.push(ef["$"]['OutTC']);
                                                png2txt.push(ef['Graphic']['0']['_'])
                                            }
                                            let subs = []
                                            for (let img of png2txt) {
                                                let l = t["Language"];
                                                switch (l) {
                                                    case "ca":
                                                        var processTesseractJs = ({ imgPath: resDirectory + "\\" + img, lang: "ca+es" }); break;
                                                    case "eu":
                                                        var processTesseractJs = ({ imgPath: resDirectory + "\\" + img, lang: "eu+es" }); break;
                                                    case "gl":
                                                        var processTesseractJs = ({ imgPath: resDirectory + "\\" + img, lang: "gl+es" }); break;
                                                    default:
                                                        var processTesseractJs = ({ imgPath: resDirectory + "\\" + img, lang: `${l}` }); break;
                                                }
                                                let transcoded = await img2txt(processTesseractJs);
                                                subs.push(transcoded);
                                            }
                                            const srt = (resDirectory + "\\subs.srt");
                                            const outputM3U8 = (resDirectory + "\\index.m3u8");
                                            const outputVTT = (resDirectory + "\\index.vtt");
                                            await writeSRT(srt, inTC, outTC, subs, png2txt);
                                            await renderSRTm3u8(srt, outputM3U8, outputVTT, i);
                                            await vtt2m3u8(outputVTT, resDirectory, i);
                                            let nameText;
                                            fs.readdir(resDirectory, (err, files) => {
                                                if (err) throw err;
                                                for (const file of files) {
                                                    const ext = path.extname(file);
                                                    if (ext === '.png' || ext === '.xml' || ext === '.sup' || ext === '.srt') {
                                                        fs.unlink(path.join(directory, file), (err) => {
                                                            if (err) throw err;
                                                            console.log(`${file} ha sido eliminado`);
                                                        });
                                                    }
                                                }
                                            });
                                            if (!t["Title"]) { nameText = t["Language"]; }
                                            else { nameText = t["Title"] }
                                            indexM3U8.push(`#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${nameText}",LANGUAGE="${t["Language"]}",DEFAULT=NO,AUTOSELECT=NO,URI="./subs/${i}/index.m3u8"`);
                                            break;
                                        default:
                                            break;
                                    }
                                    i = i + 1;
                                    break;
                                default:
                                    break;
                            }
                        }
                        const masterM3U8Content = indexM3U8.join('\n');
                        fs.writeFileSync(`${directorio}\\index.m3u8`, masterM3U8Content);
                        infoTracks.forEach((e) => console.log(e))
                    }
                }
            }
        );
        let logResults = document.querySelector("#log");
    });
}
ipcRenderer.on("startRender", () => { let info = ipcRenderer.send("getAllVideosData") });
document.addEventListener('drop', (event) => {
    event.preventDefault();
    event.stopPropagation();
    for (const f of event.dataTransfer.files) {
        console.log('File Path of dragged files: ', f.path)
        const fileList = document.getElementById('file-list')
        const fileName = path.basename(f.path)
        const listItem = document.createElement('li')
        listItem.textContent = f.path
        fileList.appendChild(listItem)
    }
});
document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
});
document.addEventListener('dragenter', (event) => { console.log('File is in the Drop Space'); });
document.addEventListener('dragleave', (event) => { console.log('File has left the Drop Space'); });
ipcRenderer.on("clearList", () => { clearList(); });
function clearList() { document.getElementById('file-list').innerHTML = ""; };
async function renderVideo(videoPath, output, i, res2rend) {
    return await new Promise((resolve, reject) => {
        const ffmpegCommand = ffmpeg(videoPath)
            .outputOptions('-map', `0:${i}`)
            .outputOptions('-threads', `0`)
            .outputOptions('-muxdelay', `0`)
            .outputOptions('-vf', `scale=-2:${res2rend}`)
            .outputOptions('-hls_time', '1')
            .outputOptions('-hls_list_size', '0')
            .outputOptions('-hls_allow_cache', '1')
            .output(output)
            .on('progress', (p) => {
                const progress = Math.round(p.percent);
                if (progress >= 0) {
                    console.log(progress);
                    renderProgress.value = progress;
                }
            })
        ffmpegCommand.on('error', (err) => {
            console.log(err);
            reject();
        })
        ffmpegCommand.on('end', () => {
            console.log(`Video Rendered - ${i}`);
            resolve();
        });
        ffmpegCommand.run();
    });
}
async function renderAudio(videoPath, output, i) {
    return await new Promise((resolve, reject) => {
        const ffmpegCommand = ffmpeg(videoPath)
            .outputOptions('-map', `0:${i}`)
            .outputOptions('-threads', `0`)
            .outputOptions('-muxdelay', `0`)
            .outputOptions('-acodec', `aac`)
            .outputOptions('-ac', `2`)
            .outputOptions('-hls_time', '1')
            .outputOptions('-hls_list_size', '0')
            .outputOptions('-hls_allow_cache', '1')
            .output(output)
            .on('progress', (p) => {
                const progress = Math.round(p.percent);
                if (progress >= 0) {
                    console.log(progress);
                    renderProgress.value = progress;
                }
            })
        ffmpegCommand.run();
        ffmpegCommand.on('error', (err) => {
            reject();
        })
        ffmpegCommand.on('end', () => {
            console.log(`Audio Rendered - ${i}`);
            resolve();
        });
    });
}
async function renderSRTm3u8(srt, outputM3U8, outputVTT, i) {
    return await new Promise((resolve, reject) => {
        const ffmpegCommand = ffmpeg(srt)
            .output(outputVTT)
            .on('progress', (p) => {
                const progress = Math.round(p.percent);
                if (progress >= 0) {
                    console.log(progress);
                    renderProgress.value = progress;
                }
            });
        ffmpegCommand.run();
        ffmpegCommand.on('error', (err) => {
            reject(err);
        })
        ffmpegCommand.on('end', () => {
            console.log(`Audio Rendered - ${i}`);
            resolve();
        });
    });
}
async function vtt2m3u8(outputVTT, resDirectory, i) {
    return new Promise(async (resolve, reject) => {
        const ffmpegCommand = ffmpeg(outputVTT)
            .outputOptions('-f', 'segment', '-segment_time', '2', '-segment_list_size', '0', '-segment_list', resDirectory + '\\index.m3u8', '-segment_format', 'webvtt', '-scodec', 'copy')
            .output(resDirectory + "\\%d.vtt")
            .on('progress', (p) => {
                const progress = Math.round(p.percent);
                if (progress >= 0) {
                    console.log(progress);
                    renderProgress.value = progress;
                }
            })
        ffmpegCommand.run();
        ffmpegCommand.on('error', (err) => {
            reject();
        })
        ffmpegCommand.on('end', () => {
            console.log(`Audio Rendered - ${i}`);
            resolve();
        });
    });
}
async function extractPGS(videoPath, output, i) {
    return await new Promise((resolve, reject) => {
        const ffmpegCommand = ffmpeg(videoPath)
            .outputOptions('-map', `0:${i}`)
            .outputOptions('-c', `copy`)
            .output(output)
            .on('progress', (p) => {
                const progress = Math.round(p.percent);
                if (progress >= 0) {
                    renderProgress.value = progress;
                }
            })
        ffmpegCommand.run();
        ffmpegCommand.on('error', (err) => {
            console.log(err)
            reject();
        })
        ffmpegCommand.on('end', () => {
            console.log(`Rendered video ${i}`);
            resolve();
        });
    });
}
async function PGS2XML(e, i) {
    return await new Promise((resolve, reject) => {
        const proceso = spawn(path.join(e, 'bdsup2sub.exe'), ['-o', `${i}.xml`, i]);
        proceso.stdout.on('data', (data) => { console.log(`Salida del proceso: ${data}`); });
        proceso.stderr.on('data', (data) => { console.error(`Error del proceso: ${data}`); });
        proceso.on('error', (error) => { console.error(`Error al ejecutar el proceso: ${error}`); });
        proceso.on('close', (code) => { console.log(`Proceso finalizado con código ${code}`); resolve(code); });
    });
}
async function PGS2Array(inputFile) {
    return new Promise(async (resolve, reject) => {
        try {
            const xml = await fs.promises.readFile(inputFile, 'utf-8');
            const result = await parser(xml);
            const items = result;
            resolve(items);
        } catch (error) {
            reject(error);
        }
    });
}
async function img2txt(processTesseractJs) {
    return new Promise(async (resolve, reject) => {
        try {
            Jimp.read(processTesseractJs["imgPath"])
                .then((image) => {
                    image.background(0xFFFFFFFF)
                    image.invert()
                    return image.getBufferAsync(Jimp.MIME_PNG)
                }).then((buffer) => {
                    const config = {
                        "tessdata-dir": "./lang-data",
                        "lang": processTesseractJs["lang"],
                        "oem": 1,
                        "psm": 3,
                    }
                    return tesseract.recognize(buffer, config)
                })
                .then((text) => {
                    resolve(text);
                })
                .catch((error) => { reject(error); })
        } catch (error) {
            reject(error);
        }
    });
}
async function writeSRT(srt, inTC, outTC, subs, png2txt) {
    return new Promise(async (resolve, reject) => {
        try {
            var stream = fs.createWriteStream(srt, { 'flags': 'a', 'encoding': 'utf8' });
            stream.once('open', function (fd) {
                let i = 1;
                for (let aa = 0; aa < png2txt.length; aa++) {
                    stream.write(i + "\r\n" + formatTimecode(inTC[aa]) + " --> " + formatTimecode(outTC[aa]) + "\r\n" + subs[aa] + "\r\n");
                    i++;
                }
                stream.end();
            });
            resolve();
        } catch (error) {
            reject(error);
        }
    });
}
function formatTimecode(time) { return time.replace(/:(\d{2})$/, ',$1'); }