const server = localStorage.getItem("server");
const username = localStorage.getItem("username");
const password = localStorage.getItem("password");

const {
	ipcRenderer
} = require("electron");
const { WebSocket } = require("ws");

function checkLogin(username, password, server) {
    return new Promise((resolve, reject) => {
        if (username && password && server) {
            fetch((!(server.startsWith("https://") || server.startsWith("http://")) ?"https://": "") + server).then(res => res.text()).then(text => {
                if(text === "KlientKonnect is running!") {
                    fetch((!(server.startsWith("https://") || server.startsWith("http://")) ?"https://": "") + server + "/api/connect", {
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
if(!server || !username || !password || !checkLogin(username, password, server)) {
    ipcRenderer.send("loadConnect")
    localStorage.removeItem("username");
    localStorage.removeItem("password");
    localStorage.removeItem("server");
}

let screensharing = false;
let incomingMessage = null;
let resolution
let offscreen
fetch("https://" + server + "/api/resolution").then(res => res.json()).then(text => { resolution = text; offscreen = new OffscreenCanvas(resolution.width, resolution.height); offscreen = offscreen.getContext("2d", { willReadFrequently: true })});
let ws = null;
let reconnectInterval = 2000; // milliseconds
let reconnectTimer = null;

function connectWebSocket() {
    ws = new WebSocket((server.startsWith("localhost") ? "ws" : "wss") + "://" + server + "/");

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
    })

    ws.on("close", function (event) {
        console.log("Disconnected from server!");
        screensharing = false;
        document.getElementById("screenshare").innerText = "Screenshare";
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

/*const ctx = new AudioContext({sinkId: { type: 'none' }});
let audioSrc;
let analyser;*/
function getFrequency() {
    //let l = new Uint8Array(analyser.frequencyBinCount);

    //analyser.getByteFrequencyData(l);

    // transform l into a normal []
    let arr = [];
    for(let i = 0; i < /*l.length*/128; i++) {
        //arr.push(Math.floor(Math.pow(10, byteToDecibel(l[i])/10)*255));
        arr.push(0);
    }
    
    return arr
}
function byteToDecibel(byte) {
    const MINIMUM_POSITIVE_VALUE = 1e-6;
    return 20 * Math.log10((byte == 0 ? MINIMUM_POSITIVE_VALUE : byte) / 255);
}

connectWebSocket();

let last_frame = null;

const encodeImageDataToLATFILE = function(image, full) {
    const message = [];
    if (full) {
        message.push(Buffer.from("reqfullimage"));
    }
    message.push(Buffer.from("LATFILE?ENC"));

    const colorMap = new Map(); // Use a Map for O(1) lookups
    const pixels = [];
    let biggest_pixel = 0;
    for (let x = 0; x < resolution.width * resolution.height; x++) {
        const red = image.data[x * 4];
        const green = image.data[x * 4 + 1];
        const blue = image.data[x * 4 + 2];

        if (!full && last_frame !== null) {
            const lastRed = last_frame[x * 4];
            const lastGreen = last_frame[x * 4 + 1];
            const lastBlue = last_frame[x * 4 + 2];

            if (lastRed === red && lastGreen === green && lastBlue === blue) {
                continue; // Skip if no change
            }
        }

        const colorKey = `${red},${green},${blue}`;
        let colormapIndex = colorMap.get(colorKey);

        if (colormapIndex === undefined) {
            colormapIndex = colorMap.size;
            colorMap.set(colorKey, colormapIndex);
            pixels[colormapIndex] = []; // Initialize the pixel array for this color
        }

        if(x*4 > biggest_pixel) {
            biggest_pixel = x*4;
        }

        pixels[colormapIndex].push(x*4); // Add the pixel index to the corresponding color
    }

    const colorMapArray = new Uint8Array(colorMap.size * 3);
    let index = 0;

    for (const [key, value] of colorMap.entries()) {
        const [r, g, b] = key.split(',').map(Number);
        colorMapArray[index++] = r;
        colorMapArray[index++] = g;
        colorMapArray[index++] = b;
    }

    if (colorMap.size !== 0 && pixels.length !== 0) {
        message.push(Buffer.from(new Uint32Array([colorMap.size*3]).buffer));
        message.push(Buffer.from(colorMapArray));

        message.push(Buffer.from(new Uint8Array([biggest_pixel < 255 ? 1 : biggest_pixel < 65535 ? 2 : 4]).buffer));

        const pixelData = [];
        let totalPixelsLength = 0;

        for (let colormap_index = 0; colormap_index < pixels.length; colormap_index++) {
            const pixelList = pixels[colormap_index];
            const pixelCount = pixelList.length;
            pixelData.push(Buffer.from(new Uint32Array([pixelCount]).buffer));
            totalPixelsLength += pixelCount;
            
            if(biggest_pixel < 255) {
                for (const pixel of pixelList) {
                    pixelData.push(Buffer.from(new Uint8Array([pixel]).buffer));
                }
            } else if(biggest_pixel < 65535) {
                for (const pixel of pixelList) {
                    pixelData.push(Buffer.from(new Uint16Array([pixel]).buffer));
                }
            } else {
                for (const pixel of pixelList) {
                    pixelData.push(Buffer.from(new Uint32Array([pixel]).buffer));
                }
            }
        }

        message.push(Buffer.from(new Uint32Array([totalPixelsLength]).buffer));
        message.push(Buffer.concat(pixelData)); // Concatenate all pixel data at once

        const messageSend = Buffer.concat(message);
        ws.send(messageSend);
    }
    return 0;
}

function getFullFrame() {
    offscreen.drawImage(video, 0, 0, resolution.width, resolution.height);
    let image = offscreen.getImageData(0, 0, resolution.width, resolution.height)
    encodeImageDataToLATFILE(image, true);
    last_frame = image.data
}

function onFrame(timestamp, frame) {
    requestAnimationFrame(onFrame);
    if(screensharing) {
        offscreen.drawImage(video, 0, 0, resolution.width, resolution.height);
        let image = offscreen.getImageData(0, 0, resolution.width, resolution.height)
        encodeImageDataToLATFILE(image, false);
        last_frame = image.data
    }
}

document.getElementById("username").innerHTML = username;
document.getElementById("server").innerHTML = server;

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
    document.getElementById("streaming-src").innerText = args.name.substring(0, 10) + (args.name.length <= 10 ? "" : "...");
    navigator.webkitGetUserMedia({
        /*audio: {
            mandatory: {
                echoCancellation: true,
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: args.id,
            }
        },*/
        video: {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: args.id,
                frameRate: 60,
            }
        }
      }, (stream) => {
        video.srcObject = stream;
        /*audioSrc = ctx.createMediaStreamSource(stream);

        analyser = ctx.createAnalyser();
        analyser.connect(ctx.destination)
        audioSrc.connect(analyser);
        analyser.fftSize = 256;
        console.log(ctx.sampleRate);*/

        video.onloadedmetadata = (e) => {
          video.play()
        }

        onFrame();
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
    } else {
        new Promise((resolve, reject) => {
            incomingMessage = resolve
            ws.send("connect:"+username);
        }).then((message) => {
            incomingMessage = null;
            if(message == "connectsuccess") {
                console.log("Screensharing!");
                screensharing = true;
                document.getElementById("screenshare").innerText = "Stop";
            } else {
                console.log("Error while screensharing.");
            }
        })
    }
});
