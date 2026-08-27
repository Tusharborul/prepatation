// Verifies a real Gemini Live session using the app's own initializeGeminiSession,
// so the tool list, system prompt and session config are exactly what the app sends.
// Run with: npx electron scripts/test-gemini-live.js

const { app, BrowserWindow, ipcMain } = require('electron');

const rendererMessages = [];
BrowserWindow.getAllWindows = () => [
    { webContents: { send: (channel, data) => rendererMessages.push({ channel, data }) } },
];

const realHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => realHandle(channel, fn);

app.whenReady().then(async () => {
    const storage = require('../src/storage');
    storage.initializeStorage();

    const prefs = storage.getPreferences();
    console.log('googleSearchEnabled preference:', prefs.googleSearchEnabled);

    const { getEnabledTools, initializeGeminiSession } = require('../src/utils/gemini');

    const tools = await getEnabledTools();
    console.log('tools the app will send:', JSON.stringify(tools));

    const model = storage.getConfig().geminiLiveModel;
    console.log(`\nopening Live session (${model})...`);

    const session = await initializeGeminiSession(storage.getApiKey(), '', 'interview', 'en-US');
    if (!session) {
        console.log('RESULT: initializeGeminiSession returned null (connect failed)');
        return app.exit(1);
    }

    console.log('connect resolved; holding 20s to see if the server closes it...');
    await session.sendRealtimeInput({ text: 'Say hello.' });

    await new Promise(r => setTimeout(r, 20000));

    const statuses = rendererMessages.filter(m => m.channel === 'update-status').map(m => m.data);
    const closed = statuses.some(s => /closed|Reconnecting|Error/i.test(s));

    console.log('\nstatuses seen:', JSON.stringify(statuses));
    console.log(`\nRESULT: ${closed ? 'FAILED — session dropped' : 'session stayed open for 20s'}`);

    app.exit(closed ? 1 : 0);
});
