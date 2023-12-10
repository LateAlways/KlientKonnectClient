const { TitlebarColor, Titlebar } = require('custom-electron-titlebar')


window.addEventListener('DOMContentLoaded', () => {
	new Titlebar({
		backgroundColor: TitlebarColor.fromHex(document.getElementsByName('titlebar-themecolor')[0].content),
		minimizable: document.getElementsByName('minimizeable')[0].content == "1",
		maximizable: document.getElementsByName('maximizeable')[0].content == "1",
	});
});