const server = localStorage.getItem("server");
const username = localStorage.getItem("username");
const password = localStorage.getItem("password");

const {
	ipcRenderer
} = require("electron");
const { WebSocket } = require("ws");

function getHttpUrl(s) {
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    return (s.startsWith("localhost") ? "http://" : "https://") + s;
}

function getWsUrl(s) {
    if (s.startsWith("http://")) return "ws://" + s.slice(7);
    if (s.startsWith("https://")) return "wss://" + s.slice(8);
    return (s.startsWith("localhost") ? "ws://" : "wss://") + s;
}

function checkLogin(username, password, server) {
    return new Promise((resolve, reject) => {
        if (username && password && server) {
            fetch(getHttpUrl(server)).then(res => res.text()).then(text => {
                if(text === "KlientKonnect is running!") {
                    fetch(getHttpUrl(server) + "/api/connect", {
                        headers: {
                            "p": password
                        }
                    }).then(res => {
                        if(res.ok) {
                            resolve(true);
                        } else {
                            resolve(false);
                        }
                    });
                } else {
                    resolve(false);
                }
            }).catch(err => {
                resolve(false);
            });
        } else {
            resolve(false);
        }
    });
}
(async () => {
    if (!server || !username || !password || !(await checkLogin(username, password, server))) {
        ipcRenderer.send("loadConnect");
        localStorage.removeItem("username");
        localStorage.removeItem("password");
        localStorage.removeItem("server");
    }
})();

let screensharing = false;
let incomingMessage = null;
let resolution
let offscreen
fetch(getHttpUrl(server) + "/api/resolution").then(res => res.json()).then(text => { resolution = text; offscreen = new OffscreenCanvas(resolution.width, resolution.height); offscreen = offscreen.getContext("2d", { willReadFrequently: true })});
let ws = null;
let reconnectInterval = 2000; // milliseconds
let reconnectTimer = null;

function connectWebSocket() {
    ws = new WebSocket(getWsUrl(server) + "/");

    if(ws.on === undefined) {
        ws.on = function (event, callback) {
            ws.addEventListener(event, callback);
        }
    }

    ws.binaryType = "arraybuffer";
    ws.on("open", function (event) {
        console.log("Connected to server!");
        ws.send(password);
        clearInterval(reconnectTimer);
        reconnectTimer = null;
    })

    ws.on("close", function (event) {
        console.log("Disconnected from server!");
        screensharing = false;
        document.getElementById("screenshare").innerText = "Screenshare";
        document.getElementById("screenshare").classList.remove("active");
        document.getElementById("status-badge").classList.remove("visible");
        reconnect();
    })

    ws.on("message", function (msg) {
        if(msg instanceof MessageEvent) {
            msg = msg.data;
        } else {
            msg = msg.toString();
        }
        console.log(msg);
        if(msg == "connectfailure:already") {
            ipcRenderer.invoke("showAlert", "Someone is already sharing their screen!");
        }
        if(msg == "reqfullimage") {
            getFullFrame();
        }
        if(incomingMessage) {
            incomingMessage(msg);
        }
    })
}

function reconnect() {
    if (!reconnectTimer) {
        reconnectTimer = setInterval(connectWebSocket, reconnectInterval);
    }
}

connectWebSocket();

let last_frame = null;
let rafId = null;

const MAGIC_HEADER = Buffer.from("LATFILE?ENC");
const FULL_FRAME_HEADER = Buffer.from("reqfullimage");

const encodeImageDataToLATFILE = function(image, full) {
    const data = image.data;
    const totalPixels = resolution.width * resolution.height;

    const colorMap = new Map();
    const colorRGB = []; // flat [r, g, b, r, g, b, ...] for each color in map order
    const pixels = [];
    let biggest_pixel = 0;
    let totalChangedPixels = 0;

    for (let x = 0; x < totalPixels; x++) {
        const i = x << 2; // x * 4
        const red = data[i];
        const green = data[i + 1];
        const blue = data[i + 2];

        if (!full && last_frame !== null &&
            last_frame[i] === red && last_frame[i + 1] === green && last_frame[i + 2] === blue) {
            continue;
        }

        // Pack RGB into a single integer key — avoids per-pixel string allocation
        const colorKey = (red << 16) | (green << 8) | blue;
        let colormapIndex = colorMap.get(colorKey);

        if (colormapIndex === undefined) {
            colormapIndex = colorMap.size;
            colorMap.set(colorKey, colormapIndex);
            colorRGB.push(red, green, blue);
            pixels[colormapIndex] = [];
        }

        if (i > biggest_pixel) {
            biggest_pixel = i;
        }

        pixels[colormapIndex].push(i);
        totalChangedPixels++;
    }

    const numColors = colorMap.size;
    if (numColors === 0 || pixels.length === 0) return 0;

    const indexFormat = biggest_pixel < 255 ? 1 : biggest_pixel < 65535 ? 2 : 4;

    // Pre-allocate a single output buffer for the entire message
    const fullHeaderLen = (full ? FULL_FRAME_HEADER.length : 0) + MAGIC_HEADER.length;
    const colorMapSectionLen = 4 + numColors * 3;
    const pixelSectionLen = 1 + 4 + numColors * 4 + totalChangedPixels * indexFormat;
    const output = Buffer.allocUnsafe(fullHeaderLen + colorMapSectionLen + pixelSectionLen);
    let pos = 0;

    if (full) {
        FULL_FRAME_HEADER.copy(output, pos);
        pos += FULL_FRAME_HEADER.length;
    }
    MAGIC_HEADER.copy(output, pos);
    pos += MAGIC_HEADER.length;

    output.writeUInt32LE(numColors * 3, pos); pos += 4;

    // Write color map RGB — colorRGB is already [r,g,b,...] so no re-parsing needed
    for (let i = 0; i < colorRGB.length; i++) {
        output[pos++] = colorRGB[i];
    }

    output[pos++] = indexFormat;

    output.writeUInt32LE(totalChangedPixels, pos); pos += 4;

    for (let ci = 0; ci < pixels.length; ci++) {
        const pixelList = pixels[ci];
        const pixelCount = pixelList.length;
        output.writeUInt32LE(pixelCount, pos); pos += 4;

        if (indexFormat === 1) {
            for (let pi = 0; pi < pixelCount; pi++) {
                output[pos++] = pixelList[pi];
            }
        } else if (indexFormat === 2) {
            for (let pi = 0; pi < pixelCount; pi++) {
                output.writeUInt16LE(pixelList[pi], pos); pos += 2;
            }
        } else {
            for (let pi = 0; pi < pixelCount; pi++) {
                output.writeUInt32LE(pixelList[pi], pos); pos += 4;
            }
        }
    }

    ws.send(output);
    return 0;
}

function getFullFrame() {
    offscreen.drawImage(video, 0, 0, resolution.width, resolution.height);
    let image = offscreen.getImageData(0, 0, resolution.width, resolution.height)
    encodeImageDataToLATFILE(image, true);
    last_frame = image.data
}

function onFrame() {
    if(!screensharing) {
        rafId = null;
        return;
    }
    rafId = requestAnimationFrame(onFrame);
    offscreen.drawImage(video, 0, 0, resolution.width, resolution.height);
    let image = offscreen.getImageData(0, 0, resolution.width, resolution.height)
    encodeImageDataToLATFILE(image, false);
    last_frame = image.data
}

document.getElementById("username").innerHTML = username;
document.getElementById("server").innerHTML = server;
document.getElementById("user-avatar").innerText = username ? username[0].toUpperCase() : "?";

function logout() {
    localStorage.removeItem("username");
    localStorage.removeItem("password");
    localStorage.removeItem("server");
    ipcRenderer.send("loadConnect")
}
document.getElementById("logout").addEventListener("click", logout);
document.getElementById("select").addEventListener("click", () => {
    ipcRenderer.send("getSource")
});
const video = document.querySelector('video')
ipcRenderer.on("setSource", (event, args) => {
    const srcEl = document.getElementById("streaming-src");
    srcEl.innerText = args.name.substring(0, 20) + (args.name.length <= 20 ? "" : "...");
    srcEl.classList.add("selected");
    navigator.webkitGetUserMedia({
        video: {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: args.id,
                frameRate: 60,
            }
        }
      }, (stream) => {
        video.srcObject = stream;
        video.onloadedmetadata = (e) => {
          video.play()
        }

        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
      }, (err) => {
        console.log(err)
      });
});

document.getElementById("screenshare").addEventListener("click", () => {
    if(screensharing) {
        screensharing = false;
        ws.send("disconnect")
        last_frame = null;
        document.getElementById("screenshare").innerText = "Screenshare";
        document.getElementById("screenshare").classList.remove("active");
        document.getElementById("status-badge").classList.remove("visible");
    } else {
        new Promise((resolve) => {
            incomingMessage = resolve
            ws.send("connect:"+username);
        }).then((message) => {
            incomingMessage = null;
            if(message == "connectsuccess") {
                console.log("Screensharing!");
                screensharing = true;
                document.getElementById("screenshare").innerText = "Stop Screenshare";
                document.getElementById("screenshare").classList.add("active");
                document.getElementById("status-badge").classList.add("visible");
                if (rafId === null) rafId = requestAnimationFrame(onFrame);
            } else {
                console.log("Error while screensharing.");
            }
        })
    }
});
