const server = localStorage.getItem("server");
const username = localStorage.getItem("username");
const password = localStorage.getItem("password");

const {
	ipcRenderer
} = require("electron");

function checkLogin(username, password, server) {
    return new Promise((resolve, reject) => {
        if (username && password && server) {
            fetch((!server.startsWith("http://") ?"http://": "") + server).then(res => res.text()).then(text => {
                if(text === "KlientKonnect is running!") {
                    fetch((!server.startsWith("http://") ?"http://": "") + server + "/api/connect", {
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
fetch("http://" + server + "/api/resolution").then(res => res.json()).then(text => { resolution = text; offscreen = new OffscreenCanvas(resolution.width, resolution.height); offscreen = offscreen.getContext("2d", { willReadFrequently: true })});
let ws = null;
let reconnectInterval = 2000; // milliseconds
let reconnectTimer = null;

function connectWebSocket() {
    ws = new WebSocket("ws://" + server + "/");
    ws.binaryType = "arraybuffer";
    ws.onopen = function (event) {
        console.log("Connected to server!");
        ws.send(password);
        clearInterval(reconnectTimer);
    }

    ws.onclose = function (event) {
        console.log("Disconnected from server!");
        screensharing = false;
        document.getElementById("screenshare").innerText = "Screenshare";
        reconnect();
    }

    ws.onmessage = function (event) {
        console.log(event.data);
        if(event.data == "connectfailure:already") {
            ipcRenderer.invoke("showAlert", "Someone is already sharing their screen!");
        }
        if(event.data == "reqfullimage") {
            getFullFrame();
        }
        if(incomingMessage) {
            incomingMessage(event.data);
        }
    }
}

function reconnect() {
    if (!reconnectTimer) {
        reconnectTimer = setInterval(connectWebSocket, reconnectInterval);
    }
}

const ctx = new AudioContext({sinkId: { type: 'none' }});
let audioSrc;
let analyser;
function getFrequency() {
    let l = new Uint8Array(analyser.frequencyBinCount);

    analyser.getByteFrequencyData(l);

    let totalFrequency = 0;
    let totalCount = 0;
    for(let i = 0; i < analyser.frequencyBinCount; i++) {
        const frequency = i * ctx.sampleRate / (2 * analyser.fftSize);
        const value = l[i];

        if (value > 0) {
            totalFrequency += frequency;
            totalCount++;
        }
    }
    console.log(Math.floor((totalCount > 0 ? totalFrequency / totalCount : 0)))
    return Math.floor((totalCount > 0 ? totalFrequency / totalCount : 0));
}

connectWebSocket();

let last_frame = null;
function encodeImageDataToLATFILE(image, full) {
    /* STRUCTURE OF LATFILE
    if full then ( 12 bytes reqfullimage marker ) DONE
    10 bytes LATFILE?ENC marker
    1 byte fps
    4 bytes colormap length/3 uint32
    3 bytes per color uint8
    4 bytes pixels length uint32
    4-6 bytes per pixel {
        2 bytes colorswitch? uint16
        2 bytes x uint16
        2 bytes y uint16
    }
    2 bytes frequency size uint16
    list*2 bytes frequency uint16
    */
    let message = [];
    if(full) {
        message.push(Buffer.from("reqfullimage"));
    }
    message.push(Buffer.from("LATFILE?ENC"));
    message.push(Buffer.from([60]));
    let colorMap = [];
    let realX = 0;
    let pixels = {};
    for(let y=0; y<resolution.height; y++) {
        for(let x=0; x<resolution.width; x++) {
            let red = image.data[realX];
            let green = image.data[realX+1];
            let blue = image.data[realX+2];

            if(!full && last_frame !== null) {
                let changeRed = last_frame[realX] != red;
                let changeGreen = last_frame[realX+1] != green;
                let changeBlue = last_frame[realX+2] != blue;
                if(changeRed || changeGreen || changeBlue) {
                    let colormap = colorMap.findIndex(item => item[0] == red && item[1] == green && item[2] == blue);
    
                    if(colormap == -1) {
                        colormap = colorMap.length;
                        colorMap.push([red, green, blue]);
                    }
    
                    if(!pixels[colormap]) pixels[colormap] = [[x,y]];
                    else pixels[colormap].push([x,y]);
                }
            } else {
                let colormap = colorMap.findIndex(item => item[0] == red && item[1] == green && item[2] == blue);
    
                if(colormap == -1) {
                    colormap = colorMap.length;
                    colorMap.push([red, green, blue]);
                }

                if(!pixels[colormap]) pixels[colormap] = [[x,y]];
                else pixels[colormap].push([x,y]);
            }
            realX+=4;
        }
    }
    last_frame = image.data;

    if(colorMap.length !== 0 && Object.keys(pixels).length !== 0) {
        message.push(Buffer.from(new Uint32Array([colorMap.length]).buffer));
        colorMap = [].concat.apply([], colorMap)
        message.push(Buffer.from(colorMap));
        let pixelSize = Object.keys(pixels).length;
        let pixelsLength = 0;
        let pixelss = [];
        for(let colormap_index=0; colormap_index < pixelSize; colormap_index++) {
            if(colormap_index !== 0) pixelss.push(Buffer.from([239,239]));
            for(let pixel_index = 0; pixel_index < pixels[colormap_index].length; pixel_index++){
                let pixel = pixels[colormap_index][pixel_index];
                pixelss.push(Buffer.from(new Uint16Array(pixel).buffer));
                pixelsLength++;
            }
        }
        messageSend = Buffer.concat([Buffer.concat(message), Buffer.from(new Uint32Array([pixelsLength]).buffer), Buffer.concat(pixelss), Buffer.from(new Uint16Array([getFrequency()]).buffer)]);
        ws.send(messageSend);
    }
}

function getFullFrame() {
    offscreen.drawImage(video, 0, 0, resolution.width, resolution.height);
    encodeImageDataToLATFILE(offscreen.getImageData(0, 0, resolution.width, resolution.height), true);
}

function onFrame(timestamp, frame) {
    requestAnimationFrame(onFrame);
    if(screensharing) {
        offscreen.drawImage(video, 0, 0, resolution.width, resolution.height);
        encodeImageDataToLATFILE(offscreen.getImageData(0, 0, resolution.width, resolution.height), false);
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
        audio: {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: args.id,
            }
        },
        video: {
            mandatory: {
                chromeMediaSource: 'desktop',
                chromeMediaSourceId: args.id,
                frameRate: 240,
            }
        }
      }, (stream) => {
        video.srcObject = stream;
        audioSrc = ctx.createMediaStreamSource(stream);

        analyser = ctx.createAnalyser();
        analyser.connect(ctx.destination)
        audioSrc.connect(analyser);
        analyser.fftSize = 2048;

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
