'use strict';

const SYSTEM_PROMPT = [
  'Kamu adalah Arah Cerdas, asisten berbahasa Indonesia di aplikasi ARAH.',
  'Jawab dengan ramah, jelas, terstruktur, dan sesuai pertanyaan. Gunakan bahasa sederhana kecuali pengguna meminta tingkat teknis.',
  'Bantu pengguna belajar, memahami konsep, menulis, merencanakan tugas, membandingkan pilihan, dan memecahkan masalah sehari-hari.',
  'Jangan mengaku memiliki akses internet, data real-time, atau kemampuan yang sebenarnya tidak tersedia. Bedakan fakta, perkiraan, dan hal yang belum pasti.',
  'Untuk informasi yang bisa berubah, beri tahu pengguna bahwa mereka perlu memeriksa sumber resmi terbaru. Jangan mengarang sumber atau kutipan.',
  'Untuk keputusan kesehatan, hukum, dan keuangan yang penting, berikan informasi umum secara hati-hati dan sarankan bantuan profesional yang sesuai.',
  'Jangan meminta kata sandi, kode verifikasi, nomor identitas, atau rahasia pribadi. Jangan pernah menampilkan kredensial atau rincian infrastruktur internal.',
  'Jangan menyebut nama penyedia model, vendor, kunci, atau sistem routing. Identitas layanan yang terlihat oleh pengguna selalu Arah Cerdas.',
  'Jika pertanyaan belum jelas, tanyakan satu hal yang paling diperlukan. Jangan mengulang pertanyaan yang sudah dijawab.'
].join(' ');

const DEFAULT_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff'
};

function json(statusCode, payload) {
  return { statusCode, headers: DEFAULT_HEADERS, body: JSON.stringify(payload) };
}

function readKeys(pluralName, singularName) {
  const raw = process.env[pluralName] || process.env[singularName] || '';
  return [...new Set(raw.split(/[\n,;]/).map(value => value.trim()).filter(Boolean))];
}

function isRetryableStatus(status) {
  return [401, 402, 403, 404, 408, 425, 429, 500, 502, 503, 504, 529].includes(Number(status));
}

function getCooldowns() {
  if (!globalThis.__arahAiCooldowns) {
    globalThis.__arahAiCooldowns = { gemini: 0, deepseek: 0 };
  }
  return globalThis.__arahAiCooldowns;
}

function getRateMap() {
  if (!globalThis.__arahAiRateMap) globalThis.__arahAiRateMap = new Map();
  return globalThis.__arahAiRateMap;
}

function checkOrigin(event) {
  const origin = event.headers?.origin || event.headers?.Origin;
  const host = event.headers?.host || event.headers?.Host;
  if (!origin || !host) return true;
  try {
    return new URL(origin).host.toLowerCase() === String(host).toLowerCase();
  } catch {
    return false;
  }
}

function validateMessages(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > 24) {
    throw new Error('Format percakapan tidak valid.');
  }
  const messages = input.slice(-12).map(item => {
    const role = item?.role;
    const content = typeof item?.content === 'string' ? item.content.trim() : '';
    if (!['user', 'assistant'].includes(role) || !content || content.length > 6000) {
      throw new Error('Pesan kosong atau terlalu panjang.');
    }
    return { role, content };
  });
  if (messages[messages.length - 1].role !== 'user') {
    throw new Error('Pesan terakhir harus berasal dari pengguna.');
  }
  return messages;
}

function providerError(provider, status, message) {
  const error = new Error(message || 'Layanan sedang tidak tersedia.');
  error.provider = provider;
  error.status = Number(status) || 503;
  error.retryable = isRetryableStatus(error.status);
  return error;
}

async function callGemini(key, messages) {
  // Model list permits a model fallback if a model name is unavailable for an account.
  const models = ['gemini-3.8-flash', 'gemini-2.5-flash'];
  let lastError;
  for (const model of models) {
    let response;
    try {
      response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: messages.map(message => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }]
          })),
          generationConfig: { temperature: 0.65, maxOutputTokens: 1500 }
        })
      });
    } catch {
      throw providerError('gemini', 503, 'Jaringan ke layanan AI sedang terganggu.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      lastError = providerError('gemini', response.status, data?.error?.message || 'Permintaan tidak berhasil.');
      if (response.status === 404) continue;
      throw lastError;
    }
    const candidate = data?.candidates?.[0];
    const answer = candidate?.content?.parts?.map(part => part?.text || '').join('').trim();
    if (!answer) {
      // Do not route around a model's safety block by sending the same prompt to another provider.
      if (data?.promptFeedback?.blockReason || candidate?.finishReason === 'SAFETY') {
        const blocked = new Error('Aku belum bisa membantu permintaan itu. Coba ubah pertanyaan agar lebih aman atau lebih spesifik.');
        blocked.retryable = false;
        blocked.userSafe = true;
        throw blocked;
      }
      lastError = providerError('gemini', 503, 'Tidak ada jawaban yang diterima.');
      continue;
    }
    return answer;
  }
  throw lastError || providerError('gemini', 503, 'Model belum tersedia.');
}

async function callDeepSeek(key, messages) {
  const models = ['deepseek-flash', 'deepseek-v4-pro'];
  let lastError;
  for (const model of models) {
    let response;
    try {
      response = await fetch('https://api.deepseek.com/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            ...messages.map(message => ({ role: message.role, content: message.content }))
          ],
          max_tokens: 1500,
          temperature: 0.65,
          reasoning_effort: 'low',
          safety_check: { level: 'high' },
          stream: false
        })
      });
    } catch {
      throw providerError('deepseek', 503, 'Jaringan ke layanan AI sedang terganggu.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      lastError = providerError('deepseek', response.status, data?.error?.message || 'Permintaan tidak berhasil.');
      if (response.status === 404) continue;
      throw lastError;
    }
    if (data?.error) {
      lastError = providerError('deepseek', 503, data.error.message || 'Model sedang terganggu.');
      continue;
    }
    const answer = data?.choices?.[0]?.message?.content;
    if (typeof answer !== 'string' || !answer.trim()) {
      lastError = providerError('deepseek', 503, 'Tidak ada jawaban yang diterima.');
      continue;
    }
    return answer.trim();
  }
  throw lastError || providerError('deepseek', 503, 'Model belum tersedia.');
}

async function runProvider(provider, messages) {
  const isGemini = provider === 'gemini';
  const keys = isGemini
    ? readKeys('GEMINI_API_KEYS', 'GEMINI_API_KEY')
    : readKeys('DEEPSEEK_API_KEYS', 'DEEPSEEK_API_KEY');
  if (!keys.length) throw providerError(provider, 503, 'Layanan belum dikonfigurasi.');

  let lastError;
  for (const key of keys) {
    try {
      const reply = isGemini ? await callGemini(key, messages) : await callDeepSeek(key, messages);
      getCooldowns()[provider] = 0;
      return reply;
    } catch (error) {
      lastError = error;
      if (error.userSafe || error.retryable === false) throw error;
      // Move to the next configured key, then fail over to the other provider.
    }
  }
  throw lastError || providerError(provider, 503, 'Semua jalur layanan sedang tidak tersedia.');
}

exports.handler = async (event, context) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: DEFAULT_HEADERS, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Metode permintaan tidak didukung.' });
  if (!checkOrigin(event)) return json(403, { error: 'Permintaan tidak diizinkan dari asal ini.' });

  const ip = event.headers?.['x-nf-client-connection-ip'] || event.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || context?.ip || 'unknown';
  const now = Date.now();
  const rateMap = getRateMap();
  const windowStart = now - 60_000;
  const recent = (rateMap.get(ip) || []).filter(timestamp => timestamp > windowStart);
  if (recent.length >= 12) return json(429, { error: 'Terlalu banyak pesan dalam waktu singkat. Coba lagi sebentar.' });
  recent.push(now);
  rateMap.set(ip, recent);
  if (rateMap.size > 500) {
    for (const [key, timestamps] of rateMap) {
      if (!timestamps.length || timestamps[timestamps.length - 1] <= windowStart) rateMap.delete(key);
    }
  }

  let body;
  try {
    if (!event.body || event.body.length > 30_000) return json(413, { error: 'Pesan terlalu besar. Ringkas pertanyaanmu lalu coba lagi.' });
    body = JSON.parse(event.body);
    const messages = validateMessages(body?.messages);

    const geminiKeys = readKeys('GEMINI_API_KEYS', 'GEMINI_API_KEY');
    const deepseekKeys = readKeys('DEEPSEEK_API_KEYS', 'DEEPSEEK_API_KEY');
    if (!geminiKeys.length && !deepseekKeys.length) {
      return json(503, { error: 'Layanan Arah Cerdas belum diaktifkan pada server. Pengelola perlu mengatur kunci layanan di pengaturan hosting.' });
    }

    const cooldowns = getCooldowns();
    const preferredRoute = body?.preferredRoute === 'b' ? 'b' : 'a';
    const order = preferredRoute === 'b' ? ['deepseek', 'gemini'] : ['gemini', 'deepseek'];
    const availableOrder = order.filter(provider => {
      const hasKeys = provider === 'gemini' ? geminiKeys.length : deepseekKeys.length;
      return hasKeys && cooldowns[provider] <= now;
    });
    // If all providers are in cooldown, make one controlled attempt at the preferred provider.
    const providerOrder = availableOrder.length ? availableOrder : order.filter(provider => provider === 'gemini' ? geminiKeys.length : deepseekKeys.length);
    let lastError;

    for (const provider of providerOrder) {
      try {
        const reply = await runProvider(provider, messages);
        return json(200, { reply, nextRoute: provider === 'gemini' ? 'a' : 'b' });
      } catch (error) {
        lastError = error;
        if (error.userSafe || error.retryable === false) {
          return json(error.status || 400, { error: error.message });
        }
        if (isRetryableStatus(error.status)) cooldowns[provider] = Date.now() + (Number(error.status) === 429 || Number(error.status) === 402 ? 90_000 : 30_000);
      }
    }

    // Never expose which upstream service or API key failed.
    const message = lastError?.status === 402
      ? 'Layanan AI sedang mencapai batas penggunaan. Coba lagi nanti.'
      : 'Arah Cerdas belum bisa menjawab saat ini. Sistem sudah mencoba jalur cadangan; silakan coba lagi beberapa saat.';
    return json(503, { error: message });
  } catch (error) {
    return json(400, { error: error.message || 'Format pesan tidak valid.' });
  }
};
