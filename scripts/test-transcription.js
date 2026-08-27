// Verifies that Groq is asked the COMPLETE question rather than the first transcription
// fragment. Gemini's client is stubbed via a require hook so synthetic inputTranscription
// fragments can be fed through the app's real onmessage handler.
//
// Run with: npx electron scripts/test-transcription.js

const Module = require('module');
const { app, BrowserWindow, ipcMain } = require('electron');

let capturedCallbacks = null;

const fakeGenAi = {
    Modality: { AUDIO: 'AUDIO', TEXT: 'TEXT' },
    GoogleGenAI: class {
        constructor() {
            this.live = {
                connect: async ({ callbacks }) => {
                    capturedCallbacks = callbacks;
                    return { sendRealtimeInput: async () => {}, close: async () => {} };
                },
            };
            this.models = {
                generateContentStream: async function* () {},
                generateContent: async () => ({ text: '' }),
            };
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

// Captures every question actually sent to Groq.
const groqQuestions = [];
function stubGroqFetch() {
    global.fetch = async (url, options) => {
        const body = JSON.parse(options.body);
        const userMessages = body.messages.filter(m => m.role === 'user');
        groqQuestions.push(userMessages[userMessages.length - 1].content);

        const sse = Buffer.from(
            `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`,
            'utf8'
        );
        let sent = false;
        return {
            ok: true,
            status: 200,
            body: {
                getReader: () => ({
                    read: async () => (sent ? { done: true } : ((sent = true), { done: false, value: new Uint8Array(sse) })),
                }),
            },
        };
    };
}

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

const fragment = text => ({ serverContent: { inputTranscription: { text } } });
const wait = ms => new Promise(r => setTimeout(r, ms));

app.whenReady().then(async () => {
    const storage = require('../src/storage');
    storage.initializeStorage();
    stubGroqFetch();

    const { initializeGeminiSession } = require('../src/utils/gemini');

    const session = await initializeGeminiSession('stub-key', '', 'interview', 'en-US');
    if (!session || !capturedCallbacks) {
        console.log('FAIL: could not capture Live callbacks');
        return app.exit(1);
    }
    const { onmessage } = capturedCallbacks;

    // ---- Case 1: a question streamed as several fragments ----
    groqQuestions.length = 0;
    onmessage(fragment('NG module'));
    await wait(200);
    onmessage(fragment(' — how do you decide'));
    await wait(200);
    onmessage(fragment(' between that and standalone components?'));
    await wait(1400); // let the quiet-gap timer fire

    check('fragmented question is sent once, in full', groqQuestions, [
        'NG module — how do you decide between that and standalone components?',
    ]);

    onmessage({ serverContent: { turnComplete: true } });
    await wait(100);

    // ---- Case 2: turn ends before the quiet gap elapses ----
    groqQuestions.length = 0;
    onmessage(fragment('What is dependency injection'));
    await wait(150);
    onmessage(fragment(' in Angular?'));
    onmessage({ serverContent: { generationComplete: true } });
    await wait(300);

    check('turn end flushes the pending question', groqQuestions, ['What is dependency injection in Angular?']);

    onmessage({ serverContent: { turnComplete: true } });
    await wait(100);

    // ---- Case 3: one question per turn, no duplicates ----
    groqQuestions.length = 0;
    onmessage(fragment('Tell me about RxJS'));
    await wait(1200);
    onmessage({ serverContent: { generationComplete: true } });
    onmessage({ serverContent: { turnComplete: true } });
    await wait(300);

    check('exactly one Groq request per turn', groqQuestions.length, 1);

    // ---- Case 4: next turn is independent ----
    groqQuestions.length = 0;
    onmessage(fragment('Second question here?'));
    await wait(1200);

    check('a new turn asks again', groqQuestions, ['Second question here?']);

    const failed = results.filter(r => !r).length;
    console.log(`\n==== ${results.length - failed}/${results.length} checks passed ====`);
    app.exit(failed === 0 ? 0 : 1);
});
