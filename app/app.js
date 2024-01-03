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
    ws = new WebSocket("wss://" + server + "/");

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
    /* STRUCTURE OF LATFILE
    if full then ( 12 bytes reqfullimage marker )
    11 bytes LATFILE?ENC marker
    1 byte fps
    4 bytes colormap length/3 uint32
    3 bytes per color uint8
    4 bytes pixels length uint32
    4-6 bytes per pixel {
        2 bytes colorswitch? uint16
        2 bytes x uint16
        2 bytes y uint16
    }
    2 bytes frequency uint16
    */
    const message = [];
    if(full) {
        message.push(Buffer.from("reqfullimage"));
    }
    message.push(Buffer.from("LATFILE?ENC"));
    message.push(Buffer.from([60]));
    let colorMap = [];
    let pixels = {};
    for(let x=0; x<resolution.width*resolution.height; x++) {
        let red = image.data[x*4];
        let green = image.data[x*4+1];
        let blue = image.data[x*4+2];

        if(!full && last_frame !== null) {
            let changeRed = last_frame[x*4] != red;
            let changeGreen = last_frame[x*4+1] != green;
            let changeBlue = last_frame[x*4+2] != blue;
            if(changeRed || changeGreen || changeBlue) {
                let colormap = colorMap.findIndex(item => item[0] == red && item[1] == green && item[2] == blue);

                if(colormap == -1) {
                    colormap = colorMap.length;
                    colorMap.push([red, green, blue]);
                }

                if(!pixels[colormap]) pixels[colormap] = [x];
                else pixels[colormap].push(x);
            }
        } else {
            let colormap = colorMap.findIndex(item => item[0] == red && item[1] == green && item[2] == blue);

            if(colormap == -1) {
                colormap = colorMap.length;
                colorMap.push([red, green, blue]);
            }

            if(!pixels[colormap]) pixels[colormap] = [x];
            else pixels[colormap].push(x);
        }
    }

    if(colorMap.length !== 0 && Object.keys(pixels).length !== 0) {
        message.push(Buffer.from(new Uint32Array([colorMap.length]).buffer));
        colorMap = [].concat.apply([], colorMap)
        message.push(Buffer.from(colorMap));
        let pixelSize = Object.keys(pixels).length;
        let pixelsLength = 0;
        let pixelss = [];
        for(let colormap_index = 0; colormap_index < pixelSize; colormap_index++) {
            if(colormap_index !== 0) pixelss.push(Buffer.from([239,239]));
            for(let pixel_index = 0; pixel_index < pixels[colormap_index].length; pixel_index++){
                let pixel = pixels[colormap_index][pixel_index];
                pixelss.push(Buffer.from(new Uint16Array([pixel]).buffer));
                pixelsLength++;
            }
        }
        messageSend = Buffer.concat([Buffer.concat(message), Buffer.from(new Uint32Array([pixelsLength]).buffer), Buffer.concat(pixelss)/*, Buffer.from(new Uint8Array(getFrequency()).buffer)*/]);
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
