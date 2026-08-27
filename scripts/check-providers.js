// Diagnostic: checks the stored API keys and confirms the configured model names
// actually exist for each provider. Keys are read from the app's own credential
// store, never from the command line.
//
// Run with: npm run check:providers

const storage = require('../src/storage');

const geminiKey = storage.getApiKey();
const groqKey = storage.getGroqApiKey();
const config = storage.getConfig();

function mask(key) {
    return key ? `${key.slice(0, 6)}…(${key.length} chars)` : '(not set)';
}

async function checkGemini() {
    console.log('\n=== Gemini ===');
    console.log('key:', mask(geminiKey));
    if (!geminiKey) return;

    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', {
        headers: { 'x-goog-api-key': geminiKey },
    });

    if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        console.log(`FAIL  HTTP ${res.status}: ${body?.error?.message || '(no message)'}`);
        if (body?.error?.status === 'PERMISSION_DENIED') {
            console.log('HINT  Enable the "Generative Language API" for this key\'s Google Cloud project,');
            console.log('      or create a fresh key at https://aistudio.google.com/apikey');
        }
        return;
    }

    const names = (await res.json()).models.map(m => m.name.replace('models/', ''));
    console.log(`OK    ${names.length} models visible`);

    const live = config.geminiLiveModel;
    console.log(`live model "${live}": ${names.includes(live) ? 'OK' : 'NOT FOUND'}`);
    if (!names.includes(live)) {
        console.log('available live models:');
        names.filter(n => n.includes('live')).forEach(n => console.log('   ', n));
    }
}

async function checkGroq() {
    console.log('\n=== Groq ===');
    console.log('key:', mask(groqKey));
    if (!groqKey) return;

    const res = await fetch('https://api.groq.com/openai/v1/models', {
        headers: { Authorization: `Bearer ${groqKey}` },
    });

    if (!res.ok) {
        const body = await res.text();
        console.log(`FAIL  HTTP ${res.status}: ${body.slice(0, 200)}`);
        return;
    }

    const ids = (await res.json()).data.map(m => m.id).sort();
    console.log(`OK    ${ids.length} models available`);
    console.log(`tokens/minute limit: ${res.headers.get('x-ratelimit-limit-tokens') || 'unknown'}`);

    for (const [label, model] of [
        ['text model', config.groqModel],
        ['image model', config.groqImageModel],
    ]) {
        console.log(`${label} "${model}": ${ids.includes(model) ? 'OK' : 'NOT FOUND'}`);
    }

    if (!ids.includes(config.groqModel) || !ids.includes(config.groqImageModel)) {
        console.log('available models:');
        ids.forEach(i => console.log('   ', i));
    }
}

(async () => {
    for (const [name, fn] of [
        ['gemini', checkGemini],
        ['groq', checkGroq],
    ]) {
        try {
            await fn();
        } catch (error) {
            console.log(`${name} check threw: ${error.message}`);
        }
    }
    console.log('');
})();
