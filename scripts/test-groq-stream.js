// Integration test for the Groq answer path. Runs inside Electron so that the real
// src/utils/gemini.js module (which needs electron's ipcMain/BrowserWindow) can be used.
// Run with: npx electron scripts/test-groq-stream.js

const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');

const rendererMessages = [];
const ipcHandlers = {};

// Capture IPC handlers so they can be invoked directly, and capture what the module
// would have pushed to the renderer.
const realHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) => {
    ipcHandlers[channel] = fn;
    return realHandle(channel, fn);
};
BrowserWindow.getAllWindows = () => [
    {
        webContents: {
            send: (channel, data) => rendererMessages.push({ channel, data }),
        },
    },
];

function sseBody(events, chunkSize) {
    const payload = events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n';
    const bytes = Buffer.from(payload, 'utf8');
    const chunks = [];
    for (let i = 0; i < bytes.length; i += chunkSize) {
        chunks.push(new Uint8Array(bytes.subarray(i, i + chunkSize)));
    }

    let index = 0;
    return {
        ok: true,
        status: 200,
        body: {
            getReader: () => ({
                read: async () => (index < chunks.length ? { done: false, value: chunks[index++] } : { done: true, value: undefined }),
            }),
        },
    };
}

function tokenEvent(text, finishReason = null) {
    return { choices: [{ index: 0, delta: { content: text }, finish_reason: finishReason }] };
}

function lastResponseText() {
    const responses = rendererMessages.filter(m => m.channel === 'new-response' || m.channel === 'update-response');
    return responses.length ? responses[responses.length - 1].data : '';
}

const results = [];
function check(name, actual, expected) {
    const pass = actual === expected;
    results.push({ name, pass, actual, expected });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
    if (!pass) {
        console.log(`      expected: ${JSON.stringify(expected)}`);
        console.log(`      actual:   ${JSON.stringify(actual)}`);
    }
}

// The app fires the Groq request without awaiting it so audio input is never blocked.
// Every finished turn ends with an 'update-status' message, so wait for that.
async function runTextTurn(text, timeoutMs = 30000) {
    rendererMessages.length = 0;
    await ipcHandlers['send-text-message'](null, text);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (rendererMessages.some(m => m.channel === 'update-status')) return;
        await new Promise(r => setTimeout(r, 25));
    }
    throw new Error(`turn did not complete within ${timeoutMs}ms`);
}

app.whenReady().then(async () => {
    const storage = require('../src/storage');
    storage.initializeStorage();

    const { setupGeminiIpcHandlers, initializeNewSession } = require('../src/utils/gemini');

    // A stub Gemini Live session: the text handler requires one to exist, and we only
    // care about the Groq branch here.
    const geminiSessionRef = { current: { sendRealtimeInput: async () => {}, close: async () => {} } };
    setupGeminiIpcHandlers(geminiSessionRef);
    initializeNewSession('interview', '');

    const realFetch = global.fetch;

    // ---- Test 1: SSE events split across awkward network chunk boundaries ----
    const words = ['I', "'m", ' a', ' software', ' engineer', ' with', ' 5', ' years', ' of', ' experience', '.'];
    const expected = words.join('');

    for (const chunkSize of [1, 7, 13, 64, 4096]) {
        global.fetch = async () => sseBody(words.map(w => tokenEvent(w)), chunkSize);
        await runTextTurn('Tell me about yourself.');
        check(`split stream reassembles with ${String(chunkSize).padStart(4)}-byte chunks`, lastResponseText(), expected);
    }

    // ---- Test 2: thinking tags are stripped from displayed output ----
    global.fetch = async () => sseBody([tokenEvent('<think>hmm let me consider</think>'), tokenEvent('Final answer here.')], 9);
    await runTextTurn('Why do you want to work here?');
    check('thinking tags stripped', lastResponseText(), 'Final answer here.');

    // ---- Test 3: HTTP 413/429 surfaces a human-readable rate-limit message ----
    global.fetch = async () => ({
        ok: false,
        status: 413,
        text: async () =>
            JSON.stringify({
                error: { message: 'Request too large for model `qwen/qwen3.6-27b` ... tokens per minute (TPM): Limit 8000, Requested 16418' },
            }),
    });
    await runTextTurn('Tell me about yourself.');
    const rateLimitMsg = lastResponseText();
    check('rate-limit message is readable', /rate limit hit/i.test(rateLimitMsg) && /8000 tokens\/minute/.test(rateLimitMsg), true);
    console.log(`      message: ${rateLimitMsg}`);

    // ---- Test 4: bad key surfaces a readable message ----
    global.fetch = async () => ({
        ok: false,
        status: 401,
        text: async () => JSON.stringify({ error: { message: 'Invalid API Key' } }),
    });
    await runTextTurn('Tell me about yourself.');
    check('invalid key message is readable', /rejected the API key/i.test(lastResponseText()), true);

    // ---- Test 5: live end-to-end call against the real Groq API ----
    global.fetch = realFetch;
    await runTextTurn('Tell me about yourself.');
    const liveReply = lastResponseText();
    const statuses = rendererMessages.filter(m => m.channel === 'update-status').map(m => m.data);
    console.log(`\nlive Groq reply (${liveReply.length} chars): ${JSON.stringify(liveReply.slice(0, 180))}`);
    console.log(`live statuses: ${JSON.stringify(statuses)}`);
    check('live Groq call returned a non-empty answer', liveReply.trim().length > 0, true);

    // ---- Test 6: live screenshot-sized image fits inside the token budget ----
    // Mirrors what captureManualScreenshot sends: 1280px wide, JPEG quality ~0.7.
    const width = 1280;
    const height = 720;
    const pixels = Buffer.alloc(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            // Blocky light background with dark text-like bands, similar to a code screenshot.
            const isTextRow = y % 22 < 9 && x % 700 > 40;
            const value = isTextRow ? 40 : 245;
            pixels[i] = value;
            pixels[i + 1] = value;
            pixels[i + 2] = value;
            pixels[i + 3] = 255;
        }
    }
    const jpeg = nativeImage.createFromBuffer(pixels, { width, height }).toJPEG(70);
    console.log(`\nsynthetic screenshot: ${width}x${height}, ${(jpeg.length / 1024).toFixed(1)} KB jpeg`);

    rendererMessages.length = 0;
    const imageResult = await ipcHandlers['send-image-content'](null, {
        data: jpeg.toString('base64'),
        prompt: 'What do you see on this screen? Answer in one sentence.',
    });
    console.log(`image result: success=${imageResult.success}${imageResult.error ? ` error=${imageResult.error}` : ''}`);
    if (imageResult.text) console.log(`image reply: ${JSON.stringify(imageResult.text.slice(0, 160))}`);
    check('screenshot analysis fits the token budget', imageResult.success === true, true);

    // ---- Test 7: a dead Gemini Live session must not block Groq answers ----
    // Reproduces the state after Gemini reconnects fail: the ref still holds a session
    // object, but every send against it throws.
    global.fetch = async () => sseBody([tokenEvent('Answer despite dead Gemini session.')], 11);
    geminiSessionRef.current = {
        sendRealtimeInput: async () => {
            throw new Error('session closed');
        },
        close: async () => {},
    };
    rendererMessages.length = 0;
    const deadSessionResult = await ipcHandlers['send-text-message'](null, 'Tell me about yourself.');
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !rendererMessages.some(m => m.channel === 'update-status')) {
        await new Promise(r => setTimeout(r, 25));
    }
    console.log(`\ndead-session handler returned: ${JSON.stringify(deadSessionResult)}`);
    check('Groq still answers when Gemini session is dead', lastResponseText(), 'Answer despite dead Gemini session.');

    const failed = results.filter(r => !r.pass).length;
    console.log(`\n==== ${results.length - failed}/${results.length} checks passed ====`);
    app.exit(failed === 0 ? 0 : 1);
});
