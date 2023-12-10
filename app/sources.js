const {
    ipcRenderer
} = require("electron");

ipcRenderer.invoke("getSources").then((data) => {
    data.forEach((source) => {
        createSource(source)
    });
});

let sources = {};
function createSource(source) {
    let div = document.createElement("div");
    let img = document.createElement("img");
    img.src = source.thumbnail.toDataURL();

    let text = document.createElement("p");
    text.innerText = source.name;

    div.appendChild(img);
    div.appendChild(text);
    
    sources[source.name] = {
        name: source.name,
        id: source.id,
        div: div
    };

    div.addEventListener("click", () => {
        ipcRenderer.invoke("setSource", source);
    });

    document.getElementById("sources").appendChild(div);
}
setInterval(() => {
    ipcRenderer.invoke("getSources").then((data) => {
        let changed = [];
        data.forEach((source) => {
            if(sources[source.name]) {
                sources[source.name].div.children[0].src = source.thumbnail.toDataURL();
            } else {
                createSource(source);
            }
            changed.push(source.name);
        });
        Object.keys(sources).forEach((source) => {
            if(!changed.includes(source)) {
                document.getElementById("sources").removeChild(sources[source].div);
                delete sources[source];
            }
        });
    });
},1000);