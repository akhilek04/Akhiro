/* Akhiro – German speaking partner. Voice: Gemini Live. Teacher: Gemini Flash. Data stays on this device. */
'use strict';

const APP_VERSION = '1.2.0';

/* =========================================================
   Small helpers
   ========================================================= */
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dayKey = (d = new Date()) => { const x = new Date(d); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
const fmtClock = (sec) => Math.floor(sec / 60) + ':' + String(Math.floor(sec % 60)).padStart(2, '0');
const fmtMin = (sec) => { const m = sec / 60; return m < 10 ? (Math.round(m * 10) / 10).toString().replace('.', ',') : String(Math.round(m)); };
const fmtNum = (v, d = 0) => v == null || isNaN(v) ? '–' : (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toString().replace('.', ',');
const fmtDate = (iso) => new Date(iso).toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' });
const DAY = 864e5;
const avg = (arr) => { const a = arr.filter((v) => v != null && !isNaN(v)); return a.length ? a.reduce((s, v) => s + v, 0) / a.length : null; };

let toastTimer;
function toast(msg, ms = 3500) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const WORD_RE = /[A-Za-zÄÖÜäöüß]+(?:['’-][A-Za-zÄÖÜäöüß]+)*/g;
const words = (t) => (String(t || '').match(WORD_RE) || []);
const SUB_CONJ = new Set(['weil', 'dass', 'obwohl', 'wenn', 'damit', 'ob', 'bevor', 'nachdem', 'falls', 'sodass', 'sobald', 'solange', 'indem', 'seitdem', 'wobei', 'weshalb', 'wodurch', 'warum', 'wie', 'wo']);

/* =========================================================
   Storage (IndexedDB, falls back to localStorage)
   ========================================================= */
const DB = {
  db: null,
  open() {
    if (this.db) return Promise.resolve(this.db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('akhiro-v1', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => { this.db = r.result; res(this.db); };
      r.onerror = () => rej(r.error);
    });
  },
  async get(k, d) {
    try {
      const db = await this.open();
      return await new Promise((res) => {
        const q = db.transaction('kv').objectStore('kv').get(k);
        q.onsuccess = () => res(q.result === undefined ? d : q.result);
        q.onerror = () => res(d);
      });
    } catch (e) {
      try { const v = localStorage.getItem('akhiro.' + k); return v ? JSON.parse(v) : d; } catch (_) { return d; }
    }
  },
  async set(k, v) {
    try {
      const db = await this.open();
      await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
    } catch (e) {
      try { localStorage.setItem('akhiro.' + k, JSON.stringify(v)); } catch (_) { toast('Speichern fehlgeschlagen'); }
    }
  },
  async del(k) {
    try { const db = await this.open(); await new Promise((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = res; tx.onerror = res; }); } catch (e) {}
    try { localStorage.removeItem('akhiro.' + k); } catch (_) {}
  }
};

/* =========================================================
   State
   ========================================================= */
const DEFAULT_SETTINGS = { apiKey: '', liveModel: 'gemini-3.8-live', textModel: 'gemini-flash-latest', activeProfileId: null };
const DEFAULT_PROFILE = {
  name: '', nativeLang: 'English', city: '', level: 'unknown', goal: 'Alltag', interests: '',
  persona: 'Akhiro', voice: 'Puck', correction: 'normal', turnMode: 'natural', pause: 'normal', echoGuard: true, dailyGoalMin: 8
};
const emptyData = () => ({
  sessions: [],
  memory: { facts: [], mistakes: [], vocab: [], summaries: [] },
  level: null, levelReason: '', levelHistory: [], strengths: [], focus: []
});
const S = { settings: { ...DEFAULT_SETTINGS }, profiles: [], profile: null, data: emptyData(), view: 'home', topic: 'Freies Gespräch' };

async function loadSettings() {
  S.settings = { ...DEFAULT_SETTINGS, ...(await DB.get('settings', {})) };
  S.profiles = await DB.get('profiles', []);
}
const saveSettings = () => DB.set('settings', S.settings);
const saveProfiles = () => DB.set('profiles', S.profiles);
const saveData = () => S.profile ? DB.set('p:' + S.profile.id, S.data) : Promise.resolve();

async function selectProfile(id) {
  const p = S.profiles.find((x) => x.id === id);
  if (!p) return;
  S.profile = { ...DEFAULT_PROFILE, ...p };
  if (S.profile.persona === 'Lena') { S.profile.persona = 'Akhiro'; if (S.profile.voice === 'Aoede') S.profile.voice = 'Puck'; }
  if (!S.profile.v12) { S.profile.turnMode = 'natural'; S.profile.v12 = true; persistProfile(); }
  const d = await DB.get('p:' + id, null);
  const base = emptyData();
  S.data = d ? { ...base, ...d, memory: { ...base.memory, ...(d.memory || {}) } } : base;
  S.settings.activeProfileId = id; saveSettings();
  renderAll();
}

/* =========================================================
   Derived numbers
   ========================================================= */
function sessionsOn(key) { return S.data.sessions.filter((s) => dayKey(s.date) === key); }
function spokenSecOn(key) { return sessionsOn(key).reduce((a, s) => a + (s.userSpeechSec || 0), 0); }
function streak() {
  const days = new Set(S.data.sessions.filter((s) => (s.userSpeechSec || 0) >= 20).map((s) => dayKey(s.date)));
  let n = 0; const d = new Date();
  if (!days.has(dayKey(d))) d.setDate(d.getDate() - 1);
  while (days.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
function bestStreak() {
  const days = [...new Set(S.data.sessions.filter((s) => (s.userSpeechSec || 0) >= 20).map((s) => dayKey(s.date)))].sort();
  let best = 0, cur = 0, prev = null;
  for (const k of days) { const t = Date.parse(k); cur = prev != null && t - prev <= DAY * 1.5 ? cur + 1 : 1; best = Math.max(best, cur); prev = t; }
  return best;
}
function lastDays(n) {
  const out = []; const d = new Date(); d.setDate(d.getDate() - (n - 1));
  for (let i = 0; i < n; i++) { const k = dayKey(d); out.push({ key: k, date: new Date(d), sec: spokenSecOn(k) }); d.setDate(d.getDate() + 1); }
  return out;
}
function recentSessions(days) { const since = Date.now() - days * DAY; return S.data.sessions.filter((s) => Date.parse(s.date) >= since && s.metrics); }
function dueWords(limit = 12) {
  const now = Date.now();
  return S.data.memory.vocab.filter((v) => (v.due || 0) <= now).sort((a, b) => (a.due || 0) - (b.due || 0)).slice(0, limit);
}

/* =========================================================
   Prompts
   ========================================================= */
const CORRECTION_RULES = {
  chill: 'Mostly recast my sentence correctly inside your answer. Explicitly correct at most one mistake every three turns, and only if it would confuse a German.',
  normal: 'Recast my sentence correctly inside your answer. Explicitly correct at most one important mistake per turn, in one short sentence, then carry on.',
  strict: 'Explicitly point out every important mistake (at most two per turn) with the correct form, very briefly, then carry on with the conversation.'
};
const TOPICS = ['Freies Gespräch', 'Mein Tag', 'Arbeit', 'Wohnung & WG', 'Freizeit', 'Essen & Einkaufen', 'Rollenspiel: Bürgeramt', 'Rollenspiel: Arzttermin', 'Rollenspiel: Hausverwaltung', 'Überrasch mich'];

function memoryBriefing() {
  const m = S.data.memory, lines = [];
  if (m.facts.length) lines.push('Facts about me: ' + m.facts.slice(0, 12).map((f) => f.text).join('; ') + '.');
  if (m.summaries.length) lines.push('Our last conversations:\n' + m.summaries.slice(-3).map((s) => '- ' + fmtDate(s.date) + ': ' + s.text).join('\n'));
  if (m.mistakes.length) lines.push('My recurring mistakes (watch for them gently): ' + m.mistakes.map((x) => x.pattern).join('; ') + '.');
  const due = dueWords(12);
  if (due.length) lines.push('Words I am learning; reuse a few naturally so I hear them again: ' + due.map((v) => v.word).join(', ') + '.');
  if (S.data.focus && S.data.focus.length) lines.push('My current focus: ' + S.data.focus.join('; ') + '.');
  return lines.join('\n');
}

function buildSystemInstruction() {
  const p = S.profile, name = p.persona || 'Akhiro';
  const region = p.city || 'Germany';
  const lvl = S.data.level ? S.data.level + ' (estimated from earlier sessions)' : (p.level === 'unknown' ? 'unknown: work it out from how I speak and adapt' : p.level);
  const mem = memoryBriefing();
  return `You are ${name}, a friendly guy in your late twenties who grew up in Germany and lives in ${region}. You are my speaking partner AND my German teacher at the same time. I am learning German.${p.name ? ' My name is ' + p.name + '.' : ''} My native language is ${p.nativeLang || 'English'}. My level: ${lvl}. My goal: ${p.goal || 'everyday life'}.${p.interests ? ' About me: ' + p.interests + '.' : ''}

THIS IS A SPOKEN CONVERSATION
- Speak German. No lists, markdown or emojis. Talk like a person on the phone.
- Keep your turns short: one to three sentences, so I speak more than you.
- This is a continuous, natural conversation. I may interrupt you at any time; if I do, stop and respond to what I just said.
- I am a learner and I pause to find words. Never finish my sentences for me. Wait.
- Don't end every turn with a question. Mix reactions, little stories about your own (invented) life, opinions and questions, like a real friend.

HOW YOU TALK
- Use real spoken German as locals talk, not textbook German: "hab", "is", "'n bisschen", "ne?", "oder?", "halt", "eben", "mal", "na ja", "krass", "passt schon", "Feierabend".
- When it fits, teach me expressions typical for ${region}.
- Adapt to my level: slower and simpler if I struggle, faster and richer if I do well.
- Only use ${p.nativeLang || 'English'} if I ask or I'm clearly stuck, then switch back to German.

HOW YOU CORRECT ME
- ${CORRECTION_RULES[p.correction] || CORRECTION_RULES.normal}
- If what I said is correct but sounds bookish, tell me how a local would say it.
- Be honest. Don't praise a sentence that was wrong.

NEW WORDS
- Introduce one or two useful everyday words or phrases per conversation, inside the conversation, with a quick meaning and an example.

ROLE-PLAYS
- If I ask for a role-play, set the scene in one sentence, play the other person realistically, and step out of the role only to correct me briefly.

If I type something in text, answer it by voice and continue the conversation.
Be warm, funny and encouraging. Never lecture.${mem ? '\n\nWHAT YOU REMEMBER ABOUT ME FROM EARLIER CONVERSATIONS\n' + mem : ''}`;
}

function kickoffText(topic) {
  const hasMem = S.data.memory.facts.length || S.data.memory.summaries.length;
  if (topic.startsWith('Rollenspiel')) {
    return `(Session start. Start a short role-play: ${topic.replace('Rollenspiel: ', '')}. Set the scene in one sentence in German, then begin in your role. Keep it short.)`;
  }
  if (topic === 'Überrasch mich') return `(Session start. Greet me casually and suggest a surprising everyday topic or mini role-play. Keep it short.)`;
  return `(Session start. Today's topic: ${topic}. Greet me casually like a friend${hasMem ? ' and, if it fits, refer to something you remember about me' : ''}, then get the conversation going. Keep it short.)`;
}

/* =========================================================
   Audio engine: mic → 16 kHz PCM16 frames (50 ms), playback at 24 kHz
   ========================================================= */
const WORKLET = `
class Cap extends AudioWorkletProcessor {
  constructor() { super(); this.ratio = sampleRate / 16000; this.t = 0; this.prev = 0; this.l1 = 0; this.l2 = 0;
    this.a = 1 - Math.exp(-2 * Math.PI * 7000 / sampleRate); this.out = new Int16Array(800); this.n = 0; this.sq = 0; this.c = 0; }
  process(inputs) {
    const inp = inputs[0] && inputs[0][0]; if (!inp) return true;
    const len = inp.length, x = new Float32Array(len);
    for (let i = 0; i < len; i++) { this.l1 += this.a * (inp[i] - this.l1); this.l2 += this.a * (this.l1 - this.l2); x[i] = this.l2; this.sq += inp[i] * inp[i]; this.c++; }
    while (this.t < len - 1) {
      const i = Math.floor(this.t), f = this.t - i, s0 = i < 0 ? this.prev : x[i], s1 = x[i + 1];
      let v = s0 + (s1 - s0) * f; v = v < -1 ? -1 : v > 1 ? 1 : v;
      this.out[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
      if (this.n === 800) { const rms = Math.sqrt(this.sq / Math.max(1, this.c));
        this.port.postMessage({ pcm: this.out.buffer, rms }, [this.out.buffer]); this.out = new Int16Array(800); this.n = 0; this.sq = 0; this.c = 0; }
      this.t += this.ratio;
    }
    this.t -= len; this.prev = x[len - 1]; return true;
  }
}
registerProcessor('cap', Cap);`;

const AudioIO = {
  ctx: null, stream: null, node: null, src: null, nextPlay: 0, sources: new Set(), partnerSec: 0, onFrame: null,
  out: null, pc1: null, pc2: null, el: null, aec: false,
  async start(onFrame, echoGuard) {
    this.onFrame = onFrame;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    await this.ctx.resume();
    this.out = this.ctx.destination; this.aec = false;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
    await this.ctx.audioWorklet.addModule(url);
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, 'cap');
    const mute = this.ctx.createGain(); mute.gain.value = 0;
    this.src.connect(this.node); this.node.connect(mute); mute.connect(this.ctx.destination);
    this.node.port.onmessage = (e) => this.onFrame && this.onFrame(e.data.pcm, e.data.rms);
    this.nextPlay = this.ctx.currentTime; this.partnerSec = 0;
    if (echoGuard && window.RTCPeerConnection) {
      try { await this.setupLoopback(); } catch (e) { console.warn('Echo guard unavailable:', e.message); this.teardownLoopback(); this.out = this.ctx.destination; }
    }
  },
  // Chrome only removes echo of audio that arrives over WebRTC. Routing the partner's voice through a
  // local RTCPeerConnection pair into an <audio> element lets the echo canceller see it, so the mic
  // can stay open while the partner talks and the learner can interrupt naturally.
  async setupLoopback() {
    const dest = this.ctx.createMediaStreamDestination();
    const pc1 = new RTCPeerConnection(), pc2 = new RTCPeerConnection();
    this.pc1 = pc1; this.pc2 = pc2;
    pc1.onicecandidate = (e) => e.candidate && pc2.addIceCandidate(e.candidate).catch(() => {});
    pc2.onicecandidate = (e) => e.candidate && pc1.addIceCandidate(e.candidate).catch(() => {});
    const el = new Audio(); el.autoplay = true; this.el = el;
    pc2.ontrack = (e) => { el.srcObject = (e.streams && e.streams[0]) || new MediaStream([e.track]); el.play().catch(() => {}); };
    dest.stream.getAudioTracks().forEach((t) => pc1.addTrack(t, dest.stream));
    const hiQ = (sdp) => sdp.replace(/a=fmtp:(\d+) ([^\r\n]*useinbandfec=1[^\r\n]*)/g, (m, pt, rest) => 'a=fmtp:' + pt + ' ' + rest + ';maxaveragebitrate=96000');
    const offer = await pc1.createOffer(); await pc1.setLocalDescription(offer);
    await pc2.setRemoteDescription({ type: 'offer', sdp: hiQ(offer.sdp) });
    const answer = await pc2.createAnswer(); await pc2.setLocalDescription(answer);
    await pc1.setRemoteDescription({ type: 'answer', sdp: hiQ(answer.sdp) });
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('loopback did not connect')), 4000);
      const ok = () => ['connected', 'completed'].includes(pc1.iceConnectionState) || pc1.connectionState === 'connected';
      const chk = () => { if (ok()) { clearTimeout(t); res(); } };
      pc1.oniceconnectionstatechange = chk; pc1.onconnectionstatechange = chk; chk();
    });
    this.out = dest; this.aec = true;
  },
  teardownLoopback() {
    try { if (this.el) { this.el.pause(); this.el.srcObject = null; } } catch (e) {}
    try { this.pc1 && this.pc1.close(); this.pc2 && this.pc2.close(); } catch (e) {}
    this.pc1 = this.pc2 = this.el = null; this.aec = false;
  },
  play(b64) {
    if (!this.ctx) return;
    const bin = atob(b64), n = bin.length >> 1; if (!n) return;
    const buf = this.ctx.createBuffer(1, n, 24000), ch = buf.getChannelData(0);
    for (let i = 0; i < n; i++) { let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8); if (v >= 0x8000) v -= 0x10000; ch[i] = v / 0x8000; }
    const s = this.ctx.createBufferSource(); s.buffer = buf; s.connect(this.out || this.ctx.destination);
    const at = Math.max(this.nextPlay, this.ctx.currentTime + 0.04);
    s.start(at); this.nextPlay = at + buf.duration; this.partnerSec += buf.duration;
    this.sources.add(s); s.onended = () => this.sources.delete(s);
  },
  stopPlayback() {
    this.sources.forEach((s) => { try { s.stop(); } catch (e) {} });
    this.sources.clear(); if (this.ctx) this.nextPlay = this.ctx.currentTime;
  },
  isPlaying(tail = 0.3) { return !!this.ctx && this.ctx.currentTime < this.nextPlay + tail; },
  stop() {
    this.stopPlayback();
    this.teardownLoopback();
    try { this.node && this.node.disconnect(); this.src && this.src.disconnect(); } catch (e) {}
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null; this.stream = null; this.node = null; this.src = null;
  }
};

/* =========================================================
   On-device speech tracker: speaking time, runs, pauses, reply delay,
   and a recording of only the learner's speech (for the teacher pass)
   ========================================================= */
class SpeechTracker {
  constructor(capSec = 390) {
    this.t = 0; this.nf = 0.004; this.inBurst = false; this.sil = 0;
    this.speechSec = 0; this.runs = 0; this.pauses = []; this.lastEnd = null;
    this.turnOpen = false; this.turns = 0; this.replyDelays = []; this.partnerEndAt = null;
    this.pre = []; this.rec = []; this.recSamples = 0; this.cap = 16000 * capSec; this.truncated = false;
  }
  frame(pcm, rms, listening) {
    this.t += 0.05;
    if (!listening) { this.closeBurst(); this.pre = []; return false; }
    const thr = Math.max(0.012, this.nf * 3.5);
    const speech = rms > thr;
    if (!speech) this.nf = this.nf * 0.97 + Math.min(rms, 0.05) * 0.03;
    if (speech) {
      if (!this.inBurst) {
        this.inBurst = true;
        if (!this.turnOpen) {
          this.turnOpen = true; this.turns++;
          if (this.partnerEndAt != null) { const d = this.t - this.partnerEndAt; if (d > 0 && d < 10) this.replyDelays.push(d); this.partnerEndAt = null; }
        } else if (this.lastEnd != null) {
          const gap = this.t - 0.05 - this.lastEnd; if (gap >= 0.25) this.pauses.push(gap);
        }
        this.pre.forEach((p) => this.record(p)); this.pre = [];
      } else if (this.sil) { this.speechSec += this.sil * 0.05; }
      this.sil = 0; this.speechSec += 0.05; this.record(pcm);
    } else if (this.inBurst) {
      this.sil++; this.record(pcm);
      if (this.sil >= 5) { this.inBurst = false; this.runs++; this.lastEnd = this.t - this.sil * 0.05; this.sil = 0; }
    } else { this.pre.push(pcm); if (this.pre.length > 4) this.pre.shift(); }
    return speech;
  }
  closeBurst() { if (this.inBurst) { this.inBurst = false; this.runs++; this.lastEnd = this.t - this.sil * 0.05; } this.sil = 0; }
  endTurn() { this.closeBurst(); this.turnOpen = false; this.lastEnd = null; }
  partnerFinished() { this.partnerEndAt = this.t; }
  record(pcm) {
    if (this.recSamples >= this.cap) { this.truncated = true; return; }
    const a = new Int16Array(pcm.slice(0)); this.rec.push(a); this.recSamples += a.length;
  }
  wav() {
    if (!this.recSamples) return null;
    const n = this.recSamples, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    let off = 44; for (const a of this.rec) { new Int16Array(buf, off, a.length).set(a); off += a.length * 2; }
    return new Uint8Array(buf);
  }
}

/* =========================================================
   Voice adapter: Gemini Live (swap this class for OpenAI later)
   Events: ready, audio, userText, partnerText, turnComplete, interrupted, goAway, closed
   ========================================================= */
class GeminiLive {
  constructor(o) { this.o = o; this.ws = null; this.ready = false; this.handle = null; this.byUs = false; }
  connect(handle) {
    this.ready = false; this.byUs = false;
    const url = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=' + encodeURIComponent(this.o.apiKey);
    const ws = new WebSocket(url); this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ setup: this.setup(handle) }));
    ws.onmessage = async (ev) => {
      let m; try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); } catch (e) { return; }
      if (this.ws === ws) this.handleMsg(m);
    };
    ws.onclose = (ev) => { if (this.ws !== ws) return; this.ready = false; this.o.on('closed', { code: ev.code, reason: ev.reason || '', byUs: this.byUs }); };
  }
  setup(handle) {
    const s = {
      model: 'models/' + this.o.model,
      generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: this.o.voice } } } },
      systemInstruction: { parts: [{ text: this.o.system }] },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      contextWindowCompression: { slidingWindow: {} },
      sessionResumption: handle ? { handle } : {}
    };
    s.realtimeInputConfig = this.o.turnMode === 'tap'
      ? { automaticActivityDetection: { disabled: true } }
      : { automaticActivityDetection: { silenceDurationMs: this.o.pauseMs || 1000, prefixPaddingMs: 200, endOfSpeechSensitivity: 'END_SENSITIVITY_LOW' } };
    return s;
  }
  handleMsg(m) {
    const on = this.o.on;
    if (m.setupComplete) { this.ready = true; on('ready'); }
    if (m.sessionResumptionUpdate && m.sessionResumptionUpdate.resumable && m.sessionResumptionUpdate.newHandle) this.handle = m.sessionResumptionUpdate.newHandle;
    if (m.goAway) on('goAway', m.goAway);
    const sc = m.serverContent; if (!sc) return;
    if (sc.interrupted) on('interrupted');
    if (sc.modelTurn && sc.modelTurn.parts) for (const p of sc.modelTurn.parts) if (p.inlineData && p.inlineData.data) on('audio', p.inlineData.data);
    if (sc.inputTranscription && sc.inputTranscription.text) on('userText', sc.inputTranscription.text);
    if (sc.outputTranscription && sc.outputTranscription.text) on('partnerText', sc.outputTranscription.text);
    if (sc.turnComplete) on('turnComplete');
  }
  send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }
  sendAudio(buf) { if (this.ready) this.send({ realtimeInput: { audio: { data: bytesToB64(new Uint8Array(buf)), mimeType: 'audio/pcm;rate=16000' } } }); }
  activityStart() { this.send({ realtimeInput: { activityStart: {} } }); }
  activityEnd() { this.send({ realtimeInput: { activityEnd: {} } }); }
  streamPause() { this.send({ realtimeInput: { audioStreamEnd: true } }); }
  sendText(t) { this.send({ clientContent: { turns: [{ role: 'user', parts: [{ text: t }] }], turnComplete: true } }); }
  close() { this.byUs = true; try { this.ws && this.ws.close(); } catch (e) {} this.ws = null; this.ready = false; }
}

/* =========================================================
   Talk controller
   ========================================================= */
const T = {
  active: false, live: null, tracker: null, startedAt: 0, transcript: [], userTalking: false, muted: false,
  wasPlaying: false, tick: null, wake: null, reconnects: 0, firstReady: true, ending: false, topic: ''
};

function setStatus(s) { $('#talkStatus').textContent = s; }
function personaName() { return (S.profile && S.profile.persona) || 'Akhiro'; }

function addLine(role, text) {
  if (!text) return;
  const last = T.transcript[T.transcript.length - 1];
  if (last && last.role === role && !last.done) last.text += text;
  else T.transcript.push({ role, text: text.replace(/^\s+/, ''), done: false });
  renderTranscript();
}
function closeLines() { T.transcript.forEach((l) => (l.done = true)); }
function renderTranscript() {
  $('#transcript').innerHTML = T.transcript.map((l, i) => `<div class="bubble ${l.role}" data-i="${i}">${esc(l.text.trim())}</div>`).join('');
  const b = $('#talkBody'); b.scrollTop = b.scrollHeight;
}

function updateMainButton() {
  const btn = $('#talkMain');
  if (!T.live || !T.live.ready) { btn.textContent = 'Verbinde …'; btn.disabled = true; return; }
  btn.disabled = false;
  if (S.profile.turnMode === 'tap') {
    if (T.userTalking) { btn.textContent = 'Fertig – senden'; btn.classList.add('dark'); }
    else { btn.textContent = AudioIO.isPlaying(0) ? 'Unterbrechen & sprechen' : 'Tippen & sprechen'; btn.classList.remove('dark'); }
  } else {
    btn.textContent = T.muted ? 'Weiter' : 'Pause'; btn.classList.toggle('dark', T.muted);
  }
}

function liveEvents(ev, data) {
  if (!T.active) return;
  switch (ev) {
    case 'ready': {
      T.reconnects = 0;
      if (T.firstReady) {
        T.firstReady = false; T.startedAt = Date.now();
        T.live.sendText(kickoffText(T.topic));
        setStatus(personaName() + ' ist dran …');
      } else if (T.freshReconnect) {
        const recent = T.transcript.slice(-6).map((l) => (l.role === 'user' ? 'Me: ' : 'You: ') + l.text.trim()).join('\n');
        T.live.sendText('(The connection dropped for a moment. Continue our conversation naturally, without greeting again. Last lines:\n' + recent + ')');
      }
      T.freshReconnect = false;
      updateMainButton();
      break;
    }
    case 'audio':
      if (T.dropAudio) break;
      if (!AudioIO.isPlaying(0)) { T.tracker.endTurn(); }
      AudioIO.play(data);
      break;
    case 'userText': addLine('user', data); break;
    case 'partnerText': if (!T.dropAudio) addLine('partner', data); break;
    case 'interrupted': AudioIO.stopPlayback(); T.dropAudio = false; closeLines(); break;
    case 'turnComplete': closeLines(); T.dropAudio = false; break;
    case 'goAway': reconnect(true); break;
    case 'closed': {
      if (data.byUs || T.ending) return;
      const r = (data.reason || '').toLowerCase();
      const fatal = data.code === 1007 || data.code === 1008 || /api key|not found|invalid|permission|quota|billing/.test(r);
      if (fatal || T.reconnects >= 3) {
        toast('Verbindung beendet: ' + (data.reason || 'Code ' + data.code), 9000);
        endTalk();
      } else reconnect(false);
      break;
    }
  }
}

function reconnect(planned) {
  if (!T.active) return;
  T.reconnects++;
  const handle = T.live.handle;
  T.live.close();
  T.live = newLive();
  T.freshReconnect = !handle;
  if (T.userTalking) { T.userTalking = false; T.tracker.endTurn(); }
  setStatus(planned ? 'Kurz neu verbinden …' : 'Verbindung weg – verbinde neu …');
  updateMainButton();
  setTimeout(() => T.active && T.live.connect(handle), planned ? 50 : 600);
}

function newLive() {
  return new GeminiLive({
    apiKey: S.settings.apiKey, model: S.settings.liveModel || DEFAULT_SETTINGS.liveModel,
    voice: S.profile.voice || 'Puck', system: buildSystemInstruction(), turnMode: S.profile.turnMode,
    pauseMs: { short: 700, normal: 1000, long: 1500 }[S.profile.pause] || 1000, on: liveEvents
  });
}

function onFrame(pcm, rms) {
  if (!T.active) return;
  let listening = false, send = false;
  if (S.profile.turnMode === 'tap') { listening = send = T.userTalking; }
  else if (!T.muted) {
    if (!AudioIO.isPlaying(0.25)) { listening = send = true; T.barge = 0; T.preroll = []; }
    else {
      // The partner is talking. Keep listening for the learner cutting in: sustained sound clearly above
      // the leftover echo for 200 ms counts as an interruption.
      const thr = Math.max(0.025, T.echoFloor * 3);
      if (rms > thr) T.barge++; else { T.barge = 0; T.echoFloor = T.echoFloor * 0.9 + rms * 0.1; }
      T.preroll.push(pcm); if (T.preroll.length > 8) T.preroll.shift();
      if (T.barge >= 4) {
        AudioIO.stopPlayback(); T.dropAudio = true; T.barge = 0; closeLines();
        if (T.live && T.live.ready) T.preroll.forEach((p) => T.live.sendAudio(p));
        T.preroll = []; listening = true;
      }
    }
  }
  $('#halo').style.transform = 'scale(' + (0.82 + clamp(listening ? rms * 5 : 0, 0, 0.3)) + ')';
  T.tracker.frame(pcm, rms, listening);
  if (send && T.live && T.live.ready) T.live.sendAudio(pcm);
}

function onTick() {
  if (!T.active) return;
  const playing = AudioIO.isPlaying(0.15);
  if (T.wasPlaying && !playing) T.tracker.partnerFinished();
  T.wasPlaying = playing;
  if (T.startedAt) $('#talkTimer').textContent = fmtClock((Date.now() - T.startedAt) / 1000);
  $('#mouth').setAttribute('d', playing ? 'M44 74 Q60 94 76 74' : 'M44 76 Q60 88 76 76');
  if (playing) $('#halo').style.transform = 'scale(' + (0.9 + Math.random() * 0.1) + ')';
  if (T.live && T.live.ready) {
    if (S.profile.turnMode === 'tap') setStatus(playing ? personaName() + ' spricht …' : T.userTalking ? 'Ich höre zu … tippe „Fertig“' : 'Du bist dran');
    else if (T.muted) setStatus('Pausiert');
    else setStatus(playing ? personaName() + ' spricht … du kannst reinreden' : 'Ich höre zu …');
  }
  updateMainButton();
}

async function startTalk() {
  if (!S.settings.apiKey) { toast('Bitte zuerst deinen Gemini-Schlüssel eintragen.'); showView('profile'); return; }
  if (T.active) return;
  Object.assign(T, { active: true, transcript: [], userTalking: false, muted: false, wasPlaying: false, reconnects: 0, firstReady: true, ending: false, startedAt: 0, freshReconnect: false, topic: S.topic, barge: 0, echoFloor: 0.01, preroll: [], dropAudio: false });
  T.tracker = new SpeechTracker();
  renderTranscript();
  $('#talkTimer').textContent = '0:00';
  $('#talkMode').textContent = S.profile.turnMode === 'tap' ? 'Tippen' : 'Natürlich';
  setStatus('Verbinde …');
  $('#talk').classList.remove('hidden');
  try { await AudioIO.start(onFrame, S.profile.turnMode !== 'tap' && S.profile.echoGuard !== false); }
  catch (err) {
    T.active = false; $('#talk').classList.add('hidden');
    toast(err && err.name === 'NotAllowedError' ? 'Mikrofon blockiert – bitte im Browser erlauben.' : 'Audio-Fehler: ' + (err.message || err), 6000);
    return;
  }
  if ('wakeLock' in navigator) navigator.wakeLock.request('screen').then((l) => (T.wake = l)).catch(() => {});
  T.live = newLive(); T.live.connect(null);
  T.tick = setInterval(onTick, 100);
  updateMainButton();
}

function mainButton() {
  if (!T.live || !T.live.ready) return;
  if (S.profile.turnMode === 'tap') {
    if (!T.userTalking) {
      if (AudioIO.isPlaying(0)) AudioIO.stopPlayback();
      T.live.activityStart(); T.userTalking = true;
    } else {
      T.live.activityEnd(); T.userTalking = false; T.tracker.endTurn();
    }
  } else {
    T.muted = !T.muted;
    if (T.muted) { T.tracker.endTurn(); T.live.streamPause(); }
  }
  updateMainButton();
}

function sendTyped() {
  const v = $('#typeInput').value.trim(); if (!v || !T.live || !T.live.ready) return;
  T.live.sendText(v); addLine('user', '✍️ ' + v); closeLines(); $('#typeInput').value = '';
}

function fixLine(i) {
  const l = T.transcript[i]; if (!l || l.role !== 'user' || !T.live || !T.live.ready) return;
  const v = prompt('Was hast du wirklich gesagt?', l.text.trim());
  if (!v || v.trim() === l.text.trim()) return;
  l.text = v.trim(); l.fixed = true; renderTranscript();
  T.live.sendText('(You misheard me. What I actually said was: "' + v.trim() + '". React to that instead.)');
}

async function endTalk() {
  if (!T.active || T.ending) return;
  T.ending = true;
  if (T.userTalking && T.live) T.live.activityEnd();
  T.tracker.endTurn();
  clearInterval(T.tick);
  if (T.live) T.live.close();
  const partnerSec = AudioIO.partnerSec;
  AudioIO.stop();
  if (T.wake) { T.wake.release().catch(() => {}); T.wake = null; }
  T.active = false;
  $('#talk').classList.add('hidden');

  const tr = T.tracker;
  const transcript = T.transcript.map((l) => ({ role: l.role, text: l.text.trim() })).filter((l) => l.text);
  const userWords = words(transcript.filter((l) => l.role === 'user').map((l) => l.text).join(' ')).length;
  if (tr.speechSec < 10 && userWords < 6) { if (T.startedAt) toast('Zu kurz für eine Auswertung – nächstes Mal etwas länger 🙂'); return; }

  const session = {
    id: uid(), date: new Date().toISOString(), topic: T.topic, mode: S.profile.turnMode,
    durationSec: T.startedAt ? Math.round((Date.now() - T.startedAt) / 1000) : 0,
    userSpeechSec: Math.round(tr.speechSec), partnerSpeechSec: Math.round(partnerSec),
    raw: { runs: tr.runs, pauses: tr.pauses.map((p) => Math.round(p * 100) / 100), turns: tr.turns, replyDelays: tr.replyDelays.map((d) => Math.round(d * 100) / 100), truncated: tr.truncated },
    transcript, feedback: null, metrics: null
  };
  S.data.sessions.push(session);
  computeMetrics(session, null);
  await saveData();
  renderAll();
  await runTeacher(session, tr.wav());
}

/* =========================================================
   Teacher pass (Gemini Flash): error-keeping transcript + grading + memory
   ========================================================= */
function teacherPrompt(session, hasAudio) {
  const p = S.profile, native = p.nativeLang || 'English', name = personaName();
  const transcript = session.transcript.map((l) => (l.role === 'user' ? 'LEARNER: ' : name.toUpperCase() + ': ') + l.text).join('\n');
  const known = {
    previousLevel: S.data.level, selfRatedLevel: p.level, knownFacts: S.data.memory.facts.map((f) => f.text),
    recurringMistakes: S.data.memory.mistakes, strengths: S.data.strengths, focus: S.data.focus
  };
  return `You are a strict but kind German teacher. You review a spoken practice conversation between a learner and their AI friend "${name}". The learner wants to sound like a local in everyday spoken German, not like a textbook. Learner: native language ${native}; lives in ${p.city || 'Germany'}; goal: ${p.goal || 'everyday life'}. Write every explanation, meaning and note in ${native}.

INPUT
${hasAudio ? '1. AUDIO: a recording of ONLY the learner\'s speech from this conversation, joined together' + (session.raw.truncated ? ' (cut off after about 6 minutes)' : '') + '. It is the most reliable record of what the learner actually said.\n2.' : '1.'} LIVE TRANSCRIPT (below) from automatic speech recognition. Its LEARNER lines may silently fix the learner's mistakes, so trust the audio more. Use the transcript for context and for what ${name} said.

LIVE TRANSCRIPT
${transcript}

WHAT WE KNOW ALREADY (JSON)
${JSON.stringify(known)}

TASKS
- "verbatim": ${hasAudio ? 'transcribe the learner audio exactly as spoken, in German, keeping every grammar mistake, wrong word, English word, hesitation word (äh, ähm) and self-correction. Never fix anything.' : 'return an empty string.'}
- Grade ONLY the learner, using the verbatim transcript if you have it, otherwise the LEARNER lines.
- Count errors honestly: grammar, word order, case, verb forms, gender/article, prepositions, wrong or unnatural word choice. Ignore hesitation words.
- "facts": up to 5 NEW, stable personal facts the learner said about themselves (job, plans, family, hobbies, where they live in general terms, likes). Skip anything already in knownFacts. Never store health details, exact addresses, phone numbers, passwords or money details.
- "level": CEFR speaking level (A1, A2, A2+, B1, B1+, B2, B2+, C1, C2). Combine this session with previousLevel; do not jump more than half a level from one session.
- "recurringMistakes": merge the known patterns with today's, max 6, drop ones that seem fixed.

Return ONLY a JSON object with exactly these keys:
{
 "verbatim": "",
 "summary": "2 sentences in ${native}: how it went and what you talked about",
 "memoryNote": "1-2 sentences in ${native} for the partner's memory: topics, what the learner shared, what was practised",
 "errorsTotal": 0,
 "errorTypes": {"wordOrder":0,"case":0,"verbForm":0,"genderArticle":0,"preposition":0,"wordChoice":0,"other":0},
 "mistakes": [{"said":"learner's words","better":"natural spoken German a local would use","why":"short reason in ${native}","type":"wordOrder|case|verbForm|genderArticle|preposition|wordChoice|other"}],
 "selfCorrections": 0,
 "nativeWords": 0,
 "colloquial": ["colloquial or regional expressions the LEARNER used"],
 "tenses": ["tenses/moods the learner used, e.g. Präsens, Perfekt, Präteritum, Futur, Konjunktiv II"],
 "newWords": [{"word":"German word or phrase","meaning":"meaning in ${native}","example":"short natural German example"}],
 "facts": ["short fact in ${native}"],
 "focusNext": "one concrete thing to work on next time, in ${native}",
 "level": "B1",
 "levelReason": "1-2 honest sentences in ${native}",
 "strengths": ["max 4 short items"],
 "recurringMistakes": [{"pattern":"short name","example":"example","tip":"how to fix it"}],
 "focus": ["exactly 3 concrete focus points for the next two weeks"]
}
Rules: "mistakes" = the 6 most important, from learner speech only. "newWords" = up to 8: words ${name} introduced, words the learner needed or got wrong, and useful colloquial expressions that came up. "nativeWords" = number of non-German words the learner used. Keep it concise.`;
}

async function callTeacher(session, wavBytes) {
  const parts = [{ text: teacherPrompt(session, !!wavBytes) }];
  if (wavBytes) parts.push({ inlineData: { mimeType: 'audio/wav', data: bytesToB64(wavBytes) } });
  const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), 150000);
  try {
    const model = S.settings.textModel || DEFAULT_SETTINGS.textModel;
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent', {
      method: 'POST', signal: ctrl.signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': S.settings.apiKey },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json' } })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((data.error && data.error.message) || 'HTTP ' + res.status);
    const cand = (data.candidates || [])[0];
    const txt = cand && cand.content && cand.content.parts ? cand.content.parts.map((p) => p.text || '').join('') : '';
    if (!txt) throw new Error('Leere Antwort vom Modell');
    return normalizeFeedback(JSON.parse(txt.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()));
  } finally { clearTimeout(timer); }
}

function normalizeFeedback(f) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  const num = (x) => (typeof x === 'number' && isFinite(x) ? x : 0);
  f.mistakes = arr(f.mistakes).filter((m) => m && m.said); f.newWords = arr(f.newWords).filter((w) => w && w.word);
  f.facts = arr(f.facts).map((x) => (typeof x === 'string' ? x : x && x.text)).filter(Boolean);
  f.colloquial = arr(f.colloquial); f.tenses = arr(f.tenses); f.strengths = arr(f.strengths); f.focus = arr(f.focus);
  f.recurringMistakes = arr(f.recurringMistakes).filter((m) => m && m.pattern);
  f.errorTypes = f.errorTypes && typeof f.errorTypes === 'object' ? f.errorTypes : {};
  f.errorsTotal = num(f.errorsTotal); f.selfCorrections = num(f.selfCorrections); f.nativeWords = num(f.nativeWords);
  f.verbatim = typeof f.verbatim === 'string' ? f.verbatim : '';
  return f;
}

async function runTeacher(session, wavBytes) {
  showResultLoading();
  let fb = null, err = null;
  try { fb = await callTeacher(session, wavBytes); }
  catch (e) {
    err = e;
    if (wavBytes) { try { fb = await callTeacher(session, null); err = null; } catch (e2) { err = e2; } }
  }
  if (!fb) { showResultError(session, err); return; }
  session.feedback = fb;
  computeMetrics(session, fb);
  applyMemory(session, fb);
  await saveData();
  renderAll();
  showResult(session);
}

async function retryTeacher(id) {
  const s = S.data.sessions.find((x) => x.id === id); if (!s) return;
  $('#result').classList.remove('hidden');
  await runTeacher(s, null);
}

/* =========================================================
   Metrics
   ========================================================= */
function computeMetrics(s, fb) {
  const liveText = s.transcript.filter((l) => l.role === 'user' && !l.text.startsWith('✍️')).map((l) => l.text).join(' ');
  const verb = fb && fb.verbatim && fb.verbatim.trim() ? fb.verbatim : '';
  // If the recording was cut off, the live transcript covers the whole talk, so use it for speed and counts.
  const userText = verb && !s.raw.truncated ? verb : liveText || verb;
  const w = words(userText), n = w.length, low = w.map((x) => x.toLowerCase());
  const gradedWords = verb ? words(verb).length : n;
  const speakMin = s.userSpeechSec / 60;
  const userTurns = s.transcript.filter((l) => l.role === 'user').length || s.raw.turns || 1;
  const m = {
    words: n,
    uniqueWords: new Set(low).size,
    wpm: speakMin > 0.15 && n ? n / speakMin : null,
    mlr: s.raw.runs ? n / s.raw.runs : null,
    pausesPerMin: speakMin > 0.15 ? s.raw.pauses.length / speakMin : null,
    longestPause: s.raw.pauses.length ? Math.max(...s.raw.pauses) : null,
    replyDelay: avg(s.raw.replyDelays),
    talkShare: s.userSpeechSec + s.partnerSpeechSec > 0 ? s.userSpeechSec / (s.userSpeechSec + s.partnerSpeechSec) : null,
    wordsPerTurn: n / userTurns,
    subClausesPer100: n ? (low.filter((x) => SUB_CONJ.has(x)).length / n) * 100 : null,
    fromAudio: !!(fb && fb.verbatim && fb.verbatim.trim())
  };
  if (fb) {
    m.errorsPer100 = gradedWords ? (fb.errorsTotal / gradedWords) * 100 : null;
    m.errorTypes = fb.errorTypes; m.selfCorrections = fb.selfCorrections;
    m.nativeShare = gradedWords ? (fb.nativeWords / gradedWords) * 100 : null;
    m.colloquial = fb.colloquial.length; m.tenses = fb.tenses;
  }
  s.metrics = m;
}

/* =========================================================
   Memory update
   ========================================================= */
function applyMemory(s, fb) {
  const mem = S.data.memory, now = Date.now();
  const norm = (t) => t.toLowerCase().replace(/[^a-zäöüß0-9 ]/g, '').trim();
  for (const f of fb.facts) {
    if (!mem.facts.some((x) => norm(x.text) === norm(f))) mem.facts.unshift({ id: uid(), text: f, added: s.date });
  }
  mem.facts = mem.facts.slice(0, 40);
  if (fb.memoryNote) { mem.summaries.push({ date: s.date, text: fb.memoryNote }); mem.summaries = mem.summaries.slice(-50); }
  if (fb.recurringMistakes.length) mem.mistakes = fb.recurringMistakes.slice(0, 6);

  // Spaced review: words the learner used again move further out; new words come back tomorrow.
  const said = ' ' + words((fb.verbatim || '') + ' ' + s.transcript.filter((l) => l.role === 'user').map((l) => l.text).join(' ')).join(' ').toLowerCase() + ' ';
  const core = (wd) => wd.toLowerCase().replace(/^(der|die|das|ein|eine|sich)\s+/, '').trim();
  for (const v of mem.vocab) {
    if (Date.parse(v.added) >= Date.parse(s.date) - 1000) continue;
    if (said.includes(' ' + core(v.word) + ' ') || said.includes(' ' + core(v.word).split(' ')[0] + ' ')) {
      v.uses = (v.uses || 0) + 1; v.interval = Math.min(60, Math.max(1, (v.interval || 1) * 2.5)); v.due = now + v.interval * DAY;
    }
  }
  for (const w of fb.newWords) {
    if (mem.vocab.some((v) => v.word.toLowerCase() === w.word.toLowerCase())) continue;
    mem.vocab.push({ id: uid(), word: w.word, meaning: w.meaning || '', example: w.example || '', added: s.date, due: now + DAY, interval: 1, uses: 0 });
  }
  if (fb.level) { S.data.level = fb.level; S.data.levelHistory.push({ date: s.date, level: fb.level }); S.data.levelHistory = S.data.levelHistory.slice(-60); }
  if (fb.levelReason) S.data.levelReason = fb.levelReason;
  if (fb.strengths.length) S.data.strengths = fb.strengths;
  if (fb.focus.length) S.data.focus = fb.focus;
  s.newFacts = fb.facts.slice();
}

/* =========================================================
   Charts (single series, hand-rolled SVG, tap/hover tooltips)
   ========================================================= */
function barChart(data, { goal = null, unit = '', fmt = (v) => fmtNum(v, 1) } = {}) {
  const W = 340, H = 170, L = 28, R = 8, Tp = 14, B = 26;
  const max = Math.max(goal || 0, ...data.map((d) => d.value), 1) * 1.15;
  const step = (W - L - R) / data.length, bw = Math.max(6, step - 6);
  const y = (v) => Tp + (H - Tp - B) * (1 - v / max);
  const ticks = niceTicks(max, 3);
  let g = ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmtNum(t)}</text>`).join('');
  if (goal) g += `<line x1="${L}" x2="${W - R}" y1="${y(goal)}" y2="${y(goal)}" stroke="#F28C28" stroke-width="2" stroke-dasharray="5 4"/><text class="axis" x="${W - R}" y="${y(goal) - 5}" text-anchor="end" fill="#B9600C">Ziel</text>`;
  const bars = data.map((d, i) => {
    const x = L + i * step + (step - bw) / 2, top = y(d.value), h = Math.max(0, H - B - top), r = Math.min(4, h, bw / 2);
    const path = h > 0 ? `M${x} ${H - B}V${top + r}Q${x} ${top} ${x + r} ${top}H${x + bw - r}Q${x + bw} ${top} ${x + bw} ${top + r}V${H - B}Z` : '';
    const tip = esc(d.tip || (d.label + ': ' + fmt(d.value) + unit));
    return `${path ? `<path d="${path}" fill="${d.hi ? '#0B1E33' : '#23AE85'}"/>` : ''}<rect class="hit" x="${L + i * step}" y="${Tp}" width="${step}" height="${H - Tp - B}" data-tip="${tip}"/>` +
      (d.showLabel ? `<text class="axis" x="${x + bw / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text>` : '');
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#D9D4DF" stroke-width="1"/>${bars}</svg>`;
}
function lineChart(points, { unit = '', fmt = (v) => fmtNum(v, 1), lowerIsBetter = false } = {}) {
  const W = 340, H = 170, L = 28, R = 30, Tp = 16, B = 22;
  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 1e-9) { lo = lo * 0.8; hi = hi * 1.2 + 1; }
  const pad = (hi - lo) * 0.2; lo = Math.max(0, lo - pad); hi = hi + pad;
  const x = (i) => L + (points.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1));
  const y = (v) => Tp + (H - Tp - B) * (1 - (v - lo) / (hi - lo));
  const ticks = niceTicks(hi, 3).filter((t) => t >= lo);
  const g = ticks.map((t) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}"/><text class="axis" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmtNum(t)}</text>`).join('');
  const d = points.map((p, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(p.value).toFixed(1)).join('');
  const last = points[points.length - 1];
  const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.value)}" r="4.5" fill="#0B1E33" stroke="#fff" stroke-width="2"/><rect class="hit" x="${x(i) - 14}" y="${Tp}" width="28" height="${H - Tp - B}" data-tip="${esc(p.label + ': ' + fmt(p.value) + unit)}"/>`).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}<line x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}" stroke="#D9D4DF" stroke-width="1"/>` +
    `<path d="${d}" fill="none" stroke="#0B1E33" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>${dots}` +
    `<text class="val" x="${x(points.length - 1) + 8}" y="${y(last.value) + 4}">${fmt(last.value)}</text>` +
    `<text class="axis" x="${L}" y="${H - 6}">${esc(points[0].label)}</text><text class="axis" x="${W - R}" y="${H - 6}" text-anchor="end">${esc(last.label)}</text></svg>` +
    (lowerIsBetter ? '<div class="tiny muted">Niedriger ist besser.</div>' : '');
}
function niceTicks(max, n) {
  const raw = max / n, mag = Math.pow(10, Math.floor(Math.log10(raw || 1))), r = raw / mag;
  const step = (r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10) * mag;
  const out = []; for (let t = 0; t <= max + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}
function ringSvg(frac) {
  const r = 46, c = 2 * Math.PI * r, f = clamp(frac, 0, 1);
  return `<svg viewBox="0 0 112 112"><circle cx="56" cy="56" r="${r}" fill="none" stroke="#E6F6F0" stroke-width="14"/>` +
    (f > 0.005 ? `<circle cx="56" cy="56" r="${r}" fill="none" stroke="${f >= 1 ? '#0B1E33' : '#23AE85'}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}"/>` : '') + '</svg>';
}
const FLAME = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3.5 5 5.5 5 11a5 5 0 0 1-10 0c0-2.4 1-4 2.3-5.2.2 1.6 1 2.7 2.2 3.2C11 8.5 11 5 12 2z"/></svg>';
const MIC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';

/* tooltip for chart marks */
(function () {
  const tip = $('#tip'); let hideT;
  const show = (e) => {
    const el = e.target.closest && e.target.closest('[data-tip]'); if (!el) return;
    tip.textContent = el.getAttribute('data-tip'); tip.classList.add('show');
    const r = el.getBoundingClientRect(), tw = tip.offsetWidth;
    tip.style.left = clamp(r.left + r.width / 2 - tw / 2, 8, window.innerWidth - tw - 8) + 'px';
    tip.style.top = Math.max(8, r.top - 6 - tip.offsetHeight + 20) + 'px';
    clearTimeout(hideT); hideT = setTimeout(() => tip.classList.remove('show'), 2200);
  };
  document.addEventListener('pointerover', show); document.addEventListener('pointerdown', show);
})();

/* =========================================================
   Rendering
   ========================================================= */
const TYPE_DE = { wordOrder: 'Satzstellung', case: 'Fälle', verbForm: 'Verbformen', genderArticle: 'Artikel', preposition: 'Präpositionen', wordChoice: 'Wortwahl', other: 'Sonstiges' };

function renderTop() {
  const p = S.profile;
  $('#chipAvatar').textContent = p ? (p.name || '?').slice(0, 1).toUpperCase() : '?';
  $('#chipName').textContent = p ? p.name || 'Profil' : 'Profil';
  const today = spokenSecOn(dayKey());
  $('#pillToday').innerHTML = MIC + fmtMin(today) + ' min';
  $('#pillStreak').innerHTML = FLAME + streak();
}

function renderHome() {
  const p = S.profile, goalSec = (p.dailyGoalMin || 8) * 60, today = spokenSecOn(dayKey());
  const week = lastDays(7).reduce((a, d) => a + d.sec, 0);
  const due = dueWords(10);
  const last = S.data.sessions.slice().reverse().find((s) => s.feedback);
  const name = p.persona || 'Akhiro';
  let h = '';
  if (!S.settings.apiKey) h += `<div class="card accent"><h3>Noch ein Schritt</h3><p class="small">${esc(name)} braucht deinen kostenlosen Gemini-Schlüssel. Hol ihn auf <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> und füg ihn unter Profil ein.</p><button class="btn small dark" onclick="showView('profile')">Zum Profil</button></div>`;
  h += `<h1>Hallo${p.name ? ' ' + esc(p.name) : ''}!</h1><p class="muted">Bereit für ein Gespräch mit ${esc(name)}?</p>`;
  h += `<div class="card"><div class="hero"><div class="ring">${ringSvg(today / goalSec)}<div class="lbl"><div><b>${fmtMin(today)}</b><span>von ${p.dailyGoalMin || 8} Min</span></div></div></div>
    <div class="mini-stats"><div><b>${streak()}</b><span>Tage in Folge</span></div><div><b>${fmtMin(week)}</b><span>Min diese Woche</span></div>
    <div><b>${esc(S.data.level || '?')}</b><span>Niveau (KI)</span></div><div><b>${S.data.memory.vocab.length}</b><span>Wörter</span></div></div></div>
    <p class="tiny muted" style="margin-top:10px">Der Ring zählt nur deine eigene Sprechzeit.</p></div>`;
  h += `<h3 style="margin-top:18px">Worüber reden wir?</h3><div class="chips" style="margin:10px 0 14px">${TOPICS.map((t) => `<button class="chip ${t === S.topic ? 'on' : ''}" data-topic="${esc(t)}">${esc(t)}</button>`).join('')}</div>`;
  h += `<p class="small muted" style="margin:0 0 12px">${p.turnMode === 'tap' ? 'Modus: Tippen zum Sprechen (im Profil änderbar).' : 'Einfach losreden – ' + esc(name) + ' antwortet von selbst, und du kannst jederzeit reinreden.'}</p>`;
  h += `<button class="btn block big" id="startBtn">${MIC.replace('<svg', '<svg width="24" height="24"')} Mit ${esc(name)} reden</button>`;
  if (due.length) h += `<div class="card tint"><h3>Heute wiederholen</h3><p class="small muted">${esc(name)} baut diese Wörter ins Gespräch ein. Versuch sie zu benutzen!</p><div class="chips">${due.map((v) => `<span class="chip" data-tip="${esc(v.meaning)}">${esc(v.word)}</span>`).join('')}</div></div>`;
  if (last) h += `<div class="card"><div class="row spread"><h3>Letztes Gespräch</h3><span class="tiny muted">${fmtDate(last.date)}</span></div><p class="small">${esc(last.feedback.summary || '')}</p>${last.feedback.focusNext ? `<p class="small"><b>Nächstes Mal:</b> ${esc(last.feedback.focusNext)}</p>` : ''}</div>`;
  $('#view-home').innerHTML = h;
  $('#startBtn').onclick = startTalk;
  document.querySelectorAll('#view-home [data-topic]').forEach((b) => (b.onclick = () => { S.topic = b.dataset.topic; renderHome(); }));
}

function statTile(label, value, tag, sub) {
  const tags = { exact: ['exact', 'Genau'], approx: ['approx', 'Ungefähr'], ai: ['ai', 'KI-Schätzung'] };
  const t = tags[tag];
  return `<div class="stat"><b>${value}</b><div class="k">${label}</div>${sub ? `<div class="tiny muted">${sub}</div>` : ''}<span class="tag ${t[0]}">${t[1]}</span></div>`;
}

function renderProgress() {
  const ss = S.data.sessions;
  if (!ss.length) { $('#view-progress').innerHTML = `<h1>Fortschritt</h1><div class="card empty">Nach deinem ersten Gespräch siehst du hier deine Werte – wie in einer Fitness-App, nur fürs Sprechen.</div>`; return; }
  const totalSec = ss.reduce((a, s) => a + (s.userSpeechSec || 0), 0);
  const r7 = recentSessions(7), pick = (k) => avg(r7.map((s) => s.metrics[k]));
  const graded = ss.filter((s) => s.metrics && s.metrics.errorsPer100 != null).slice(-14);
  const fluent = ss.filter((s) => s.metrics && s.metrics.wpm != null).slice(-14);
  let h = `<h1>Fortschritt</h1>`;
  h += `<div class="card"><div class="row"><div class="levelbadge">${esc(S.data.level || '?')}</div><div><h3 style="margin:0">Sprechniveau</h3><span class="tag ai">KI-Schätzung</span><p class="small muted" style="margin-top:6px">${esc(S.data.levelReason || 'Wird nach dem ersten ausgewerteten Gespräch geschätzt.')}</p></div></div>
    ${S.data.levelHistory.length > 1 ? `<div class="chips" style="margin-top:12px">${S.data.levelHistory.slice(-8).map((l) => `<span class="chip">${fmtDate(l.date)}: <b>${esc(l.level)}</b></span>`).join('')}</div>` : ''}</div>`;
  h += `<div class="statgrid">${statTile('Minuten gesprochen', fmtMin(totalSec), 'exact', 'gesamt, nur du')}${statTile('Gespräche', ss.length, 'exact')}${statTile('Tage in Folge', streak(), 'exact', 'Rekord: ' + bestStreak())}${statTile('Wörter gelernt', S.data.memory.vocab.length, 'approx', S.data.memory.vocab.filter((v) => v.uses >= 2).length + ' aktiv benutzt')}</div>`;
  const days = lastDays(14).map((d, i, a) => ({ label: d.date.toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' }), value: d.sec / 60, hi: i === a.length - 1, showLabel: i % 3 === 1 || i === a.length - 1, tip: d.date.toLocaleDateString('de-DE', { weekday: 'short', day: 'numeric', month: 'short' }) + ': ' + fmtMin(d.sec) + ' min' }));
  h += `<div class="card"><h3>Deine Sprechzeit, letzte 14 Tage</h3><p class="tiny muted">Minuten pro Tag, in denen du gesprochen hast</p>${barChart(days, { goal: S.profile.dailyGoalMin || 8, unit: ' min' })}</div>`;
  if (fluent.length >= 2) h += `<div class="card"><h3>Sprechtempo</h3><p class="tiny muted">Wörter pro Minute deiner Sprechzeit · <span class="tag approx">Ungefähr</span></p>${lineChart(fluent.map((s) => ({ label: fmtDate(s.date), value: s.metrics.wpm })), { unit: ' W/Min', fmt: (v) => fmtNum(v) })}</div>`;
  if (graded.length >= 2) h += `<div class="card"><h3>Fehler pro 100 Wörter</h3><p class="tiny muted"><span class="tag ai">KI-Schätzung</span></p>${lineChart(graded.map((s) => ({ label: fmtDate(s.date), value: s.metrics.errorsPer100 })), { lowerIsBetter: true })}</div>`;
  h += `<h2 style="margin-top:20px">Die letzten 7 Tage</h2><p class="small muted">Durchschnitt aller Gespräche dieser Woche.</p>`;
  h += `<div class="statgrid" style="margin-top:10px">
    ${statTile('Wörter pro Minute', fmtNum(pick('wpm')), 'approx', 'Tempo')}
    ${statTile('Wörter pro Redefluss', fmtNum(pick('mlr'), 1), 'approx', 'zwischen zwei Pausen')}
    ${statTile('Pausen pro Minute', fmtNum(pick('pausesPerMin'), 1), 'approx', 'Pausen über 0,25 s')}
    ${statTile('Antwortzeit', pick('replyDelay') == null ? '–' : fmtNum(pick('replyDelay'), 1) + ' s', 'exact', 'bis du anfängst')}
    ${statTile('Dein Redeanteil', pick('talkShare') == null ? '–' : Math.round(pick('talkShare') * 100) + ' %', 'exact', 'Ziel: über 50 %')}
    ${statTile('Fehler / 100 Wörter', fmtNum(pick('errorsPer100'), 1), 'ai')}
    ${statTile('Nebensätze / 100 Wörter', fmtNum(pick('subClausesPer100'), 1), 'approx', 'weil, dass, obwohl …')}
    ${statTile('Wörter pro Beitrag', fmtNum(pick('wordsPerTurn'), 1), 'approx')}
    ${statTile('Verschiedene Wörter', fmtNum(pick('uniqueWords')), 'approx', 'pro Gespräch')}
    ${statTile('Englisch-Anteil', pick('nativeShare') == null ? '–' : fmtNum(pick('nativeShare'), 1) + ' %', 'ai')}
  </div>`;
  const et = {}; r7.forEach((s) => Object.entries(s.metrics.errorTypes || {}).forEach(([k, v]) => (et[k] = (et[k] || 0) + (Number(v) || 0))));
  const etList = Object.entries(et).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  if (etList.length) { const mx = etList[0][1]; h += `<div class="card"><h3>Fehlerarten (7 Tage)</h3><span class="tag ai">KI-Schätzung</span>${etList.map(([k, v]) => `<div class="hbar"><span>${TYPE_DE[k] || esc(k)}</span><div class="track"><div class="fill" style="width:${(v / mx) * 100}%"></div></div><b>${v}</b></div>`).join('')}</div>`; }
  h += `<div class="card"><h3>Alle Gespräche</h3>${ss.slice().reverse().map((s) => sessionRow(s)).join('')}</div>`;
  $('#view-progress').innerHTML = h;
}

function sessionRow(s) {
  const m = s.metrics || {};
  return `<details class="sess"><summary><div class="row spread"><span><b>${fmtDate(s.date)}</b> · ${esc(s.topic || '')}</span><span class="small muted">${fmtMin(s.userSpeechSec || 0)} min${s.feedback && s.feedback.level ? ' · ' + esc(s.feedback.level) : ''}</span></div></summary>
    <div class="small" style="margin-top:8px">${s.feedback ? esc(s.feedback.summary || '') : `<span class="muted">Noch nicht ausgewertet.</span> <button class="link" onclick="retryTeacher('${s.id}')">Jetzt auswerten</button>`}</div>
    <div class="chips" style="margin-top:8px"><span class="chip">${fmtNum(m.wpm)} W/Min</span><span class="chip">${fmtNum(m.errorsPer100, 1)} Fehler/100</span><span class="chip">${m.talkShare == null ? '–' : Math.round(m.talkShare * 100) + ' %'} Redeanteil</span></div>
    ${s.feedback && s.feedback.mistakes.length ? `<ul class="clean" style="margin-top:8px">${s.feedback.mistakes.map(mistakeLi).join('')}</ul>` : ''}
    <details style="margin-top:8px"><summary class="small muted">Gespräch ansehen</summary><div class="transcript">${s.transcript.map((l) => `<div class="bubble ${l.role}">${esc(l.text)}</div>`).join('')}</div>
    ${s.feedback && s.feedback.verbatim ? `<p class="tiny muted" style="margin-top:8px"><b>Was du wirklich gesagt hast (aus der Aufnahme):</b><br>${esc(s.feedback.verbatim)}</p>` : ''}</details>
    <button class="link" style="color:var(--bad)" onclick="deleteSession('${s.id}')">Löschen</button></details>`;
}
const mistakeLi = (m) => `<li><div class="said">${esc(m.said)}</div><div class="better">→ ${esc(m.better)}</div><div class="small muted">${esc(m.why || '')}${m.type && TYPE_DE[m.type] ? ' · ' + TYPE_DE[m.type] : ''}</div></li>`;

function renderMemory() {
  const m = S.data.memory, name = personaName();
  let h = `<h1>Gedächtnis</h1><p class="muted">Was ${esc(name)} sich merkt und vor jedem Gespräch liest. Du kannst alles löschen.</p>`;
  h += `<div class="card accent"><h3>Was ${esc(name)} über dich weiß</h3>${m.facts.length ? `<ul class="clean">${m.facts.map((f) => `<li class="fact"><span class="small">${esc(f.text)}</span><button aria-label="Löschen" onclick="delFact('${f.id}')">✕</button></li>`).join('')}</ul>` : `<p class="small muted">Noch nichts. Erzähl ${esc(name)} von dir!</p>`}
    <div class="row" style="margin-top:10px"><input type="text" id="factInput" placeholder="Selbst etwas hinzufügen …"><button class="btn small dark" onclick="addFact()">+</button></div></div>`;
  h += `<div class="card"><h3>Typische Fehler</h3>${m.mistakes.length ? `<ul class="clean">${m.mistakes.map((x) => `<li><b class="small">${esc(x.pattern)}</b><div class="small muted"><i>${esc(x.example || '')}</i></div><div class="small">${esc(x.tip || '')}</div></li>`).join('')}</ul>` : '<p class="small muted">Erscheinen nach den ersten Auswertungen.</p>'}</div>`;
  if (S.data.focus.length) h += `<div class="card tint"><h3>Fokus für die nächsten 2 Wochen</h3><ul class="clean">${S.data.focus.map((f) => `<li class="small">${esc(f)}</li>`).join('')}</ul></div>`;
  const vocab = m.vocab.slice().sort((a, b) => Date.parse(b.added) - Date.parse(a.added));
  h += `<div class="card"><div class="row spread"><h3>Meine Wörter</h3><span class="tiny muted">${vocab.length}</span></div><input type="search" id="vocabSearch" placeholder="Suchen …" style="margin:6px 0 4px"><ul class="clean" id="vocabList">${vocabItems(vocab, '')}</ul></div>`;
  h += `<div class="card"><h3>Gesprächsnotizen</h3>${m.summaries.length ? `<ul class="clean">${m.summaries.slice().reverse().slice(0, 20).map((s) => `<li class="small"><b>${fmtDate(s.date)}</b> · ${esc(s.text)}</li>`).join('')}</ul>` : '<p class="small muted">Noch keine.</p>'}</div>`;
  $('#view-memory').innerHTML = h;
  const vs = $('#vocabSearch');
  vs.oninput = () => { $('#vocabList').innerHTML = vocabItems(vocab, vs.value.trim().toLowerCase()); };
}
function vocabItems(list, q) {
  const now = Date.now();
  const f = q ? list.filter((v) => (v.word + ' ' + v.meaning).toLowerCase().includes(q)) : list;
  if (!f.length) return '<li class="small muted">Noch keine Wörter.</li>';
  return f.map((v) => `<li><div class="row spread"><span class="word">${esc(v.word)}</span>${v.uses >= 2 ? '<span class="tag exact">aktiv</span>' : (v.due || 0) <= now ? '<span class="tag ai">heute dran</span>' : ''}</div><div class="small">${esc(v.meaning)}</div>${v.example ? `<div class="small muted"><i>${esc(v.example)}</i></div>` : ''}</li>`).join('');
}

function renderProfile() {
  const p = S.profile, st = S.settings;
  const voices = [['Puck', 'Puck · männlich, fröhlich'], ['Iapetus', 'Iapetus · männlich, klar'], ['Charon', 'Charon · männlich, ruhig'], ['Fenrir', 'Fenrir · männlich, lebhaft'], ['Aoede', 'Aoede · weiblich, leicht'], ['Leda', 'Leda · weiblich, jung'], ['Kore', 'Kore · weiblich, klar'], ['Zephyr', 'Zephyr · weiblich, hell']];
  const seg = (key, opts) => `<div class="seg" data-seg="${key}">${opts.map(([v, l]) => `<button data-v="${v}" class="${String(p[key]) === String(v) ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  let h = `<h1>Profil</h1>`;
  h += `<div class="card"><div class="row spread"><div class="row"><span class="avatar" style="width:48px;height:48px;font-size:24px">${esc((p.name || '?').slice(0, 1).toUpperCase())}</span><div><h3 style="margin:0">${esc(p.name || 'Ohne Namen')}</h3><span class="small muted">${S.data.sessions.length} Gespräche · Niveau ${esc(S.data.level || '?')}</span></div></div><button class="btn small ghost" onclick="openPeople()">Wechseln</button></div></div>`;
  h += `<div class="card"><h3>Über dich</h3>
    <label class="f" for="pf-name">Name</label><input type="text" id="pf-name" value="${esc(p.name)}">
    <label class="f" for="pf-native">Muttersprache</label><input type="text" id="pf-native" value="${esc(p.nativeLang)}"><div class="hint">Erklärungen kommen in dieser Sprache.</div>
    <label class="f" for="pf-city">Stadt / Region</label><input type="text" id="pf-city" value="${esc(p.city)}" placeholder="z. B. Berlin, München, Köln"><div class="hint">Für lokale Ausdrücke.</div>
    <label class="f" for="pf-level">Dein Niveau (selbst geschätzt)</label><select id="pf-level">${['unknown', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'].map((l) => `<option value="${l}" ${p.level === l ? 'selected' : ''}>${l === 'unknown' ? 'Weiß nicht' : l}</option>`).join('')}</select>
    <label class="f" for="pf-goal">Ziel</label><select id="pf-goal">${['Alltag', 'Arbeit & Kollegen', 'Jobsuche & Interviews', 'Prüfung (z. B. B1/B2)', 'Freunde finden'].map((g) => `<option ${p.goal === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
    <label class="f" for="pf-int">Interessen, Job, Alltag</label><textarea id="pf-int" rows="3">${esc(p.interests)}</textarea></div>`;
  h += `<div class="card"><h3>Gesprächspartner</h3>
    <label class="f" for="pf-persona">Name</label><input type="text" id="pf-persona" value="${esc(p.persona)}">
    <label class="f" for="pf-voice">Stimme</label><select id="pf-voice">${voices.map(([v, l]) => `<option value="${v}" ${p.voice === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
    <label class="f">Korrekturen</label>${seg('correction', [['chill', 'Locker'], ['normal', 'Normal'], ['strict', 'Streng']])}
    <label class="f">Gesprächsart</label>${seg('turnMode', [['natural', 'Natürlich'], ['tap', 'Mit Tippen']])}<div class="hint">Natürlich: einfach reden, ${esc(p.persona || 'Akhiro')} antwortet von selbst und du kannst jederzeit unterbrechen. Mit Tippen: du entscheidest, wann du fertig bist.</div>
    <label class="f">Wie lange ${esc(p.persona || 'Akhiro')} wartet, bevor er antwortet</label>${seg('pause', [['short', 'Kurz'], ['normal', 'Normal'], ['long', 'Lang']])}<div class="hint">„Lang“ hilft, wenn du beim Sprechen oft nachdenkst.</div>
    <label class="f">Tagesziel (deine Sprechminuten)</label>${seg('dailyGoalMin', [[5, '5'], [8, '8'], [12, '12'], [20, '20']])}
    <div class="toggle"><div><b class="small">Echo-Schutz (Lautsprecher)</b><div class="hint">Damit ${esc(p.persona || 'Akhiro')} sich nicht selbst hört. Falls er zu leise oder abgehackt klingt, ausschalten.</div></div><input type="checkbox" id="pf-echo" ${p.echoGuard !== false ? 'checked' : ''}></div></div>`;
  h += `<button class="btn block" id="pfSave">Speichern</button>`;
  h += `<div class="card" style="margin-top:22px"><h3>Gemini-Schlüssel</h3><input type="password" id="st-key" value="${esc(st.apiKey)}" placeholder="AIza…" autocomplete="off"><div class="hint">Nur auf diesem Gerät gespeichert, für alle Profile. Kostenlos: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></div>
    <details style="margin-top:10px"><summary class="small">Erweitert: Modelle</summary><label class="f" for="st-live">Sprachmodell</label><input type="text" id="st-live" value="${esc(st.liveModel)}"><label class="f" for="st-text">Auswertungsmodell</label><input type="text" id="st-text" value="${esc(st.textModel)}"><div class="hint">Nur ändern, wenn Google die Namen ändert.</div></details>
    <button class="btn small dark" id="stSave" style="margin-top:12px">Schlüssel speichern</button></div>`;
  h += `<div class="card"><h3>Daten</h3><p class="small muted">Alles liegt nur auf diesem Handy. Mach ab und zu ein Backup.</p><div class="row wrap"><button class="btn small ghost" id="exportBtn">Backup exportieren</button><button class="btn small ghost" id="importBtn">Backup laden</button><input type="file" id="importFile" accept="application/json" class="hidden"></div>
    <div class="row wrap" style="margin-top:12px"><button class="btn small danger" id="delProfile">Profil löschen</button></div></div>
    <p class="tiny muted center">Akhiro v${APP_VERSION} · Stimme: Google Gemini Live</p>`;
  $('#view-profile').innerHTML = h;
  document.querySelectorAll('#view-profile [data-seg]').forEach((sg) => sg.querySelectorAll('button').forEach((b) => (b.onclick = () => {
    sg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on');
  })));
  $('#pfSave').onclick = () => {
    Object.assign(S.profile, { name: $('#pf-name').value.trim(), nativeLang: $('#pf-native').value.trim() || 'English', city: $('#pf-city').value.trim(), level: $('#pf-level').value, goal: $('#pf-goal').value, interests: $('#pf-int').value.trim(), persona: $('#pf-persona').value.trim() || 'Akhiro', voice: $('#pf-voice').value, echoGuard: $('#pf-echo').checked });
    document.querySelectorAll('#view-profile [data-seg]').forEach((sg) => { const on = sg.querySelector('.on'); if (on) { const k = sg.dataset.seg; S.profile[k] = k === 'dailyGoalMin' ? Number(on.dataset.v) : on.dataset.v; } });
    persistProfile(); toast('Gespeichert ✓'); renderAll();
  };
  $('#stSave').onclick = () => {
    S.settings.apiKey = $('#st-key').value.trim(); S.settings.liveModel = $('#st-live').value.trim() || DEFAULT_SETTINGS.liveModel; S.settings.textModel = $('#st-text').value.trim() || DEFAULT_SETTINGS.textModel;
    saveSettings(); toast('Schlüssel gespeichert ✓'); renderAll();
  };
  $('#exportBtn').onclick = exportBackup;
  $('#importBtn').onclick = () => $('#importFile').click();
  $('#importFile').onchange = importBackup;
  $('#delProfile').onclick = deleteProfile;
}

function renderAll() {
  if (!S.profile) return;
  renderTop(); renderHome(); renderProgress(); renderMemory(); renderProfile();
  $('#appTitle') && ($('#appTitle').textContent = personaName());
}

function showView(v) {
  S.view = v;
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('active', s.id === 'view-' + v));
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('#main').scrollTop = 0;
}
window.showView = showView;

/* ---------- Result screen ---------- */
function showResultLoading() {
  $('#resultTitle').textContent = 'Auswertung';
  $('#resultBody').innerHTML = `<div class="card center" style="margin-top:30px"><span class="spinner"></span><p class="small" style="margin-top:12px">${esc(personaName())} hört sich deine Aufnahme an und schreibt dein Feedback …</p><p class="tiny muted">Das dauert meist 10–40 Sekunden.</p></div>`;
  $('#resultDone').textContent = 'Im Hintergrund weiter';
  $('#result').classList.remove('hidden');
}
function showResultError(s, err) {
  $('#resultBody').innerHTML = `<div class="card"><h3>Auswertung fehlgeschlagen</h3><p class="small">${esc(err && err.message ? err.message : String(err))}</p><p class="small muted">Dein Gespräch und deine Sprechzeit sind gespeichert. Du kannst es später unter Fortschritt auswerten.</p><button class="btn small dark" onclick="retryTeacher('${s.id}')">Nochmal versuchen</button></div>`;
  $('#resultDone').textContent = 'Weiter';
}
function showResult(s) {
  const f = s.feedback, m = s.metrics, name = personaName();
  $('#resultTitle').textContent = 'Gut gemacht' + (S.profile.name ? ', ' + S.profile.name : '') + '!';
  let h = `<div class="statgrid">
    ${statTile('Minuten gesprochen', fmtMin(s.userSpeechSec), 'exact', 'nur du')}
    ${statTile('Wörter pro Minute', fmtNum(m.wpm), 'approx')}
    ${statTile('Fehler / 100 Wörter', fmtNum(m.errorsPer100, 1), 'ai')}
    ${statTile('Dein Redeanteil', m.talkShare == null ? '–' : Math.round(m.talkShare * 100) + ' %', 'exact')}
  </div>`;
  h += `<div class="card"><div class="row"><div class="levelbadge">${esc(f.level || '?')}</div><div><b>Niveau heute</b> <span class="tag ai">KI-Schätzung</span><p class="small muted" style="margin:4px 0 0">${esc(f.levelReason || '')}</p></div></div><p class="small" style="margin-top:12px">${esc(f.summary || '')}</p></div>`;
  h += `<div class="card"><h3>Korrekturen</h3>${f.mistakes.length ? `<ul class="clean">${f.mistakes.map(mistakeLi).join('')}</ul>` : '<p class="small">Keine großen Fehler – stark!</p>'}${!m.fromAudio ? '<p class="tiny muted">Hinweis: ohne Audio ausgewertet, manche Fehler können fehlen.</p>' : ''}</div>`;
  if (f.newWords.length) h += `<div class="card tint"><h3>Neue Wörter</h3><ul class="clean">${f.newWords.map((w) => `<li><span class="word">${esc(w.word)}</span> – <span class="small">${esc(w.meaning)}</span><div class="small muted"><i>${esc(w.example || '')}</i></div></li>`).join('')}</ul></div>`;
  if (s.newFacts && s.newFacts.length) h += `<div class="card accent"><h3>${esc(name)} merkt sich</h3><ul class="clean">${s.newFacts.map((t) => `<li class="small">${esc(t)}</li>`).join('')}</ul><p class="tiny muted">Unter Gedächtnis kannst du alles löschen.</p></div>`;
  if (f.focusNext) h += `<div class="card"><h3>Nächstes Mal</h3><p class="small">${esc(f.focusNext)}</p></div>`;
  $('#resultBody').innerHTML = h;
  $('#resultDone').textContent = 'Weiter';
  $('#result').classList.remove('hidden');
}

/* ---------- Profiles overlay ---------- */
function openPeople(forceCreate) {
  const ov = $('#people'); ov.classList.remove('hidden');
  $('#peopleClose').classList.toggle('hidden', !S.profile);
  if (forceCreate || !S.profiles.length) { renderCreate(); return; }
  $('#peopleTitle').textContent = 'Wer übt heute?';
  $('#peopleBody').innerHTML = `<div class="stack">${S.profiles.map((p) => `<button class="card row" style="width:100%;text-align:left;cursor:pointer;margin:0" data-pid="${p.id}"><span class="avatar" style="width:44px;height:44px;font-size:22px">${esc((p.name || '?').slice(0, 1).toUpperCase())}</span><div><h3 style="margin:0">${esc(p.name || 'Ohne Namen')}</h3><span class="small muted">${esc(p.goal || '')}</span></div></button>`).join('')}
    <button class="btn block ghost" id="newProfile">+ Neues Profil</button></div>`;
  document.querySelectorAll('#peopleBody [data-pid]').forEach((b) => (b.onclick = async () => { ov.classList.add('hidden'); await selectProfile(b.dataset.pid); showView('home'); }));
  $('#newProfile').onclick = () => renderCreate();
}
window.openPeople = openPeople;

function renderCreate() {
  $('#peopleTitle').textContent = S.profiles.length ? 'Neues Profil' : 'Willkommen!';
  $('#peopleBody').innerHTML = `<p class="muted">${S.profiles.length ? 'Ein Profil pro Person oder pro Ziel.' : 'Akhiro ist dein Freund zum Deutschsprechen – und dein Lehrer. Erzähl ihm kurz von dir.'}</p>
    <label class="f" for="np-name">Dein Name</label><input type="text" id="np-name" placeholder="z. B. Akhil">
    <label class="f" for="np-native">Muttersprache</label><input type="text" id="np-native" value="English">
    <label class="f" for="np-city">Stadt / Region</label><input type="text" id="np-city" placeholder="z. B. Berlin">
    <label class="f" for="np-level">Dein Niveau</label><select id="np-level"><option value="unknown">Weiß nicht</option><option>A1</option><option>A2</option><option>B1</option><option>B2</option><option>C1</option></select>
    <label class="f" for="np-goal">Ziel</label><select id="np-goal"><option>Alltag</option><option>Arbeit & Kollegen</option><option>Jobsuche & Interviews</option><option>Prüfung (z. B. B1/B2)</option><option>Freunde finden</option></select>
    <label class="f" for="np-int">Interessen, Job, Alltag</label><textarea id="np-int" rows="2" placeholder="z. B. Ich arbeite als Ingenieur, spiele Badminton …"></textarea>
    ${S.settings.apiKey ? '' : `<label class="f" for="np-key">Gemini-Schlüssel (kostenlos)</label><input type="password" id="np-key" placeholder="AIza…" autocomplete="off"><div class="hint">Hol ihn auf <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>. Du kannst ihn auch später eintragen.</div>`}
    <button class="btn block big" id="np-go" style="margin-top:20px">Los geht's</button>`;
  $('#np-go').onclick = async () => {
    const name = $('#np-name').value.trim(); if (!name) { toast('Wie heißt du?'); return; }
    const p = { ...DEFAULT_PROFILE, id: uid(), name, nativeLang: $('#np-native').value.trim() || 'English', city: $('#np-city').value.trim(), level: $('#np-level').value, goal: $('#np-goal').value, interests: $('#np-int').value.trim(), createdAt: new Date().toISOString() };
    S.profiles.push(p); await saveProfiles();
    const k = $('#np-key'); if (k && k.value.trim()) { S.settings.apiKey = k.value.trim(); await saveSettings(); }
    $('#people').classList.add('hidden');
    await selectProfile(p.id); showView('home');
  };
}

/* ---------- Mutations ---------- */
function persistProfile() {
  const i = S.profiles.findIndex((x) => x.id === S.profile.id);
  if (i >= 0) S.profiles[i] = { ...S.profile }; saveProfiles();
}
window.delFact = (id) => { S.data.memory.facts = S.data.memory.facts.filter((f) => f.id !== id); saveData(); renderMemory(); };
window.addFact = () => { const v = $('#factInput').value.trim(); if (!v) return; S.data.memory.facts.unshift({ id: uid(), text: v, added: new Date().toISOString() }); saveData(); renderMemory(); };
window.deleteSession = (id) => { if (!confirm('Dieses Gespräch löschen? Gedächtnis und Wörter bleiben.')) return; S.data.sessions = S.data.sessions.filter((s) => s.id !== id); saveData(); renderAll(); };
window.retryTeacher = retryTeacher;
async function deleteProfile() {
  if (!confirm('Profil „' + (S.profile.name || '') + '“ mit allen Gesprächen und Erinnerungen löschen? Das kann nicht rückgängig gemacht werden.')) return;
  await DB.del('p:' + S.profile.id);
  S.profiles = S.profiles.filter((p) => p.id !== S.profile.id); await saveProfiles();
  S.profile = null; S.settings.activeProfileId = null; await saveSettings();
  if (S.profiles.length) await selectProfile(S.profiles[0].id); else openPeople(true);
}
async function exportBackup() {
  const all = { app: 'akhiro', version: APP_VERSION, exportedAt: new Date().toISOString(), profiles: S.profiles, data: {} };
  for (const p of S.profiles) all.data[p.id] = p.id === S.profile.id ? S.data : await DB.get('p:' + p.id, null);
  const blob = new Blob([JSON.stringify(all)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'akhiro-backup-' + dayKey() + '.json'; a.click();
}
async function importBackup(e) {
  const f = e.target.files[0]; if (!f) return;
  try {
    const all = JSON.parse(await f.text());
    if (!all || !Array.isArray(all.profiles)) throw new Error('Kein Akhiro-Backup');
    for (const p of all.profiles) {
      if (!S.profiles.some((x) => x.id === p.id)) S.profiles.push(p);
      if (all.data && all.data[p.id]) await DB.set('p:' + p.id, all.data[p.id]);
    }
    await saveProfiles(); await selectProfile(S.profile ? S.profile.id : all.profiles[0].id); toast('Backup geladen ✓');
  } catch (err) { toast('Datei konnte nicht gelesen werden.'); }
  e.target.value = '';
}

/* =========================================================
   Wiring & boot
   ========================================================= */
document.querySelectorAll('.tabbar button').forEach((b) => (b.onclick = () => showView(b.dataset.view)));
$('#profileChip').onclick = () => openPeople();
$('#peopleClose').onclick = () => $('#people').classList.add('hidden');
$('#talkMain').onclick = mainButton;
$('#talkEnd').onclick = endTalk;
$('#talkClose').onclick = endTalk;
$('#typeSend').onclick = sendTyped;
$('#typeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendTyped(); });
$('#transcript').addEventListener('click', (e) => { const b = e.target.closest('.bubble.user'); if (b) fixLine(Number(b.dataset.i)); });
$('#resultDone').onclick = () => { $('#result').classList.add('hidden'); showView('home'); };
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && T.active && (!T.wake || T.wake.released) && 'wakeLock' in navigator) navigator.wakeLock.request('screen').then((l) => (T.wake = l)).catch(() => {}); });

(async function boot() {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  await loadSettings();
  if (S.settings.activeProfileId && S.profiles.some((p) => p.id === S.settings.activeProfileId)) await selectProfile(S.settings.activeProfileId);
  else if (S.profiles.length) openPeople();
  else openPeople(true);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
