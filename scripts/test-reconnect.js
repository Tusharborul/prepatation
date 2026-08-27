// Gemini ends every Live session with a GoAway once its duration cap is reached, so a long
// interview goes through several successful reconnects. This checks the retry budget counts
// consecutive failures rather than lifetime reconnects, and still gives up when the provider
// is genuinely unreachable.
//
// Run with: npx electron scripts/test-reconnect.js

const Module = require('module');
const { app, BrowserWindow, ipcMain } = require('electron');

const GOAWAY = 'Connection aborted because the client failed to close the connection after receiving a GoAway signal once the session duration expired.';

let connectCount = 0;
let failNextConnects = 0;
const liveSessions = [];

const fakeGenAi = {
    Modality: { AUDIO: 'AUDIO', TEXT: 'TEXT' },
    GoogleGenAI: class {
        constructor() {
            this.live = {
                connect: async ({ callbacks }) => {
                    connectCount++;
                    if (failNextConnects > 0) {
                        failNextConnects--;
                        throw new Error('simulated connect failure');
                    }
                    const session = { callbacks, sendRealtimeInput: async () => {}, close: async () => {} };
                    liveSessions.push(session);
                    return session;
                },
            };
            this.models = { generateContentStream: async function* () {}, generateContent: async () => ({ text: '' }) };
        }
    },
};

const originalLoad = Module._load;
Module._load = function (request) {
    if (request === '@google/genai') return fakeGenAi;
    return originalLoad.apply(this, arguments);
};

const rendererMessages = [];
BrowserWindow.getAllWindows = () => [{ webContents: { send: (channel, data) => rendererMessages.push({ channel, data }) } }];
const realHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => realHandle(channel, fn);

const results = [];
function check(name, actual, expected) {
    const pass = JSON.stringify(actual) === JSON.stringify(expected);
    results.push(pass);
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) {
        console.log(`      expected: ${JSON.stringify(expected)}`);
        console.log(`      actual:   ${JSON.stringify(actual)}`);
    }
}

const wait = ms => new Promise(r => setTimeout(r, ms));
const currentSession = () => liveSessions[liveSessions.length - 1];

// Fires the server-side GoAway close and waits out the app's 2s reconnect delay.
async function simulateGoAway() {
    currentSession().callbacks.onclose({ reason: GOAWAY });
    await wait(3500);
}

app.whenReady().then(async () => {
    const storage = require('../src/storage');
    storage.initializeStorage();

    const { initializeGeminiSession, saveConversationTurn } = require('../src/utils/gemini');
    global.geminiSessionRef = { current: null };

    const session = await initializeGeminiSession('stub-key', '', 'interview', 'en-US');
    global.geminiSessionRef.current = session;
    // Give the reconnect path some history to restore.
    saveConversationTurn('What is dependency injection?', 'A way to supply dependencies.');

    console.log('\n--- simulating 5 GoAway cycles (a long interview) ---');
    for (let cycle = 1; cycle <= 5; cycle++) {
        rendererMessages.length = 0;
        await simulateGoAway();

        const statuses = rendererMessages.filter(m => m.channel === 'update-status').map(m => m.data);
        const failed = rendererMessages.some(m => m.channel === 'reconnect-failed');
        console.log(`  cycle ${cycle}: ${JSON.stringify(statuses)}${failed ? '  <-- GAVE UP' : ''}`);

        results.push(!failed);
        if (failed) {
            console.log('FAIL  session was dropped despite every reconnect succeeding');
            break;
        }
    }
    check('survived 5 GoAway cycles without giving up', results.every(Boolean), true);

    // A provider that is genuinely down must still exhaust the budget and report failure.
    console.log('\n--- simulating a provider that is actually unreachable ---');
    rendererMessages.length = 0;
    failNextConnects = 10;
    currentSession().callbacks.onclose({ reason: 'network unreachable' });
    await wait(12000);

    const gaveUp = rendererMessages.some(m => m.channel === 'reconnect-failed');
    check('still gives up when reconnects keep failing', gaveUp, true);

    const failedCount = results.filter(r => !r).length;
    console.log(`\n==== ${results.length - failedCount}/${results.length} checks passed ====`);
    app.exit(failedCount === 0 ? 0 : 1);
});
