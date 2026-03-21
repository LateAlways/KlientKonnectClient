const { ipcRenderer } = require("electron");

const usernameInput = document.getElementById('username-input');
const passwordInput = document.getElementById('password-input');
const serverInput = document.getElementById('server-input');

function getHttpUrl(s) {
    if (s.startsWith("http://") || s.startsWith("https://")) return s;
    return (s.startsWith("localhost") ? "http://" : "https://") + s;
}

function checkLogin(username, password, server) {
    return new Promise((resolve) => {
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
            }).catch(() => {
                resolve(false);
            });
        } else {
            resolve(false);
        }
    });
}
(async () => {
    if((await checkLogin(localStorage.getItem("username"), localStorage.getItem("password"), localStorage.getItem("server")))) {
        ipcRenderer.send("loadApp");
    } else {
        localStorage.removeItem("username");
        localStorage.removeItem("password");
        localStorage.removeItem("server");
    }
})()


const form = document.querySelector('form');
form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = usernameInput.value;
    const password = passwordInput.value;
    const server = serverInput.value;
    if (username && password && server) {
        if(await checkLogin(username, password, server)) {
            localStorage.setItem("username", username);
            localStorage.setItem("password", password);
            localStorage.setItem("server", server);
            ipcRenderer.send("loadApp")
        } else {
            localStorage.removeItem("username");
            localStorage.removeItem("password");
            localStorage.removeItem("server");
            document.getElementById("error").innerText = "Invalid login!";
        }
    }
});
