// V1: audio in code. The reference clip check (length, level, clipping, noise and silence), edge trim, 5 ms fades,
// RMS levelling and WAV encoding. Everything works on Float32Array samples so node tests run it without a browser.

export const RATE = 24000;
/** A reference clip runs 10 to 15 seconds from its first word to its last, mostly speech (the server's README). */
export const CLIP = Object.freeze({ minSpeech: 10, maxSeconds: 15, frame: 0.02, pad: 0.15 });
// Her King County levelling, the same numbers as the server: RMS 0.112, peak at -1 dBFS, lift at most four times.
export const LEVEL = Object.freeze({ target: 0.112, peak: 0.891, maxLift: 4 });
export const FADE_S = 0.005;

const db = value => value > 0 ? 20 * Math.log10(value) : -120;

/** 16-bit little-endian PCM bytes as samples between -1 and 1. */
export function pcm16ToFloat(bytes) {
    const view = new DataView(bytes.buffer || bytes, bytes.byteOffset || 0, bytes.byteLength);
    const out = new Float32Array(Math.floor(view.byteLength / 2));
    for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true) / 32768;
    return out;
}

/** Several channels as one by averaging. */
export function mixDown(channels) {
    if (!channels.length) return new Float32Array(0);
    if (channels.length === 1) return Float32Array.from(channels[0]);
    const out = new Float32Array(channels[0].length);
    for (const channel of channels) for (let i = 0; i < out.length; i++) out[i] += channel[i] / channels.length;
    return out;
}

/** The samples with the leading and trailing stretch below `floor` of the peak taken off. */
export function trimEdges(samples, floor = 0.02) {
    let peak = 0;
    for (const value of samples) peak = Math.max(peak, Math.abs(value));
    if (!peak) return samples;
    const limit = peak * floor;
    let start = 0, end = samples.length - 1;
    while (start < end && Math.abs(samples[start]) <= limit) start++;
    while (end > start && Math.abs(samples[end]) <= limit) end--;
    return samples.slice(start, end + 1);
}

/** A 5 ms ramp in and out, so a cut never clicks. */
export function fadeEdges(samples, rate = RATE, seconds = FADE_S) {
    const out = Float32Array.from(samples);
    const n = Math.min(Math.floor(rate * seconds), Math.floor(out.length / 2));
    for (let i = 0; i < n; i++) {
        const gain = i / n;
        out[i] *= gain;
        out[out.length - 1 - i] *= gain;
    }
    return out;
}

/** Loudness brought to a common RMS, capped so nothing clips and near-silence is not dragged up. */
export function levelRms(samples, { target = LEVEL.target, peak = LEVEL.peak, maxLift = LEVEL.maxLift } = {}) {
    let sum = 0, top = 0;
    for (const value of samples) { sum += value * value; top = Math.max(top, Math.abs(value)); }
    if (!samples.length || !top) return Float32Array.from(samples);
    const rms = Math.sqrt(sum / samples.length);
    const gain = Math.min(target / rms, maxLift, peak / top);
    return samples.map(value => Math.max(-1, Math.min(1, value * gain)));
}

/** One spoken line ready to join the others: trimmed, faded and levelled. */
export function prepareLine(samples, rate = RATE) {
    return levelRms(fadeEdges(trimEdges(samples), rate));
}

/** Loudness per 20 ms frame, in dBFS. */
function frames(samples, rate) {
    const size = Math.max(1, Math.round(rate * CLIP.frame));
    const out = [];
    for (let at = 0; at + size <= samples.length; at += size) {
        let sum = 0;
        for (let i = at; i < at + size; i++) sum += samples[i] * samples[i];
        out.push(db(Math.sqrt(sum / size)));
    }
    return out;
}

const percentile = (values, p) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : -120;
};

/**
 * Check a recording as a reference clip and cut it to the stretch the voice uses. Returns { ok, problems, clip,
 * seconds, speechSeconds, speechDb, noiseDb, snrDb, clippedShare, cutTo }. problems are plain reasons she can act on;
 * clip is the trimmed recording (at most 15 s) when it passes.
 */
export function checkClip(samples, rate = RATE) {
    const problems = [];
    const seconds = samples.length / rate;
    if (seconds < 1) return { ok: false, problems: ['The recording is under a second long. Record 10 to 15 seconds of speech.'], clip: null, seconds, speechSeconds: 0 };
    let clipped = 0;
    for (const value of samples) if (Math.abs(value) >= 0.985) clipped++;
    const loudness = frames(samples, rate);
    const noiseDb = percentile(loudness, 0.1);
    const speechDb = percentile(loudness, 0.9);
    const snrDb = speechDb - noiseDb;
    const threshold = Math.max(noiseDb + 10, speechDb - 30);
    const voiced = loudness.map(value => value > threshold);
    const first = voiced.indexOf(true), last = voiced.lastIndexOf(true);
    const size = Math.round(rate * CLIP.frame);
    const pad = Math.round(rate * CLIP.pad);
    let start = first < 0 ? 0 : Math.max(0, first * size - pad);
    let end = last < 0 ? samples.length : Math.min(samples.length, (last + 1) * size + pad);
    // Keep at most 15 s, ending in a pause between 12 and 15 s when there is one, so no word is cut in half.
    let cutTo = 0;
    if ((end - start) / rate > CLIP.maxSeconds) {
        const from = Math.floor((start + 12 * rate) / size), to = Math.floor((start + CLIP.maxSeconds * rate) / size);
        let at = to;
        for (let i = to; i >= from; i--) if (!voiced[i]) { at = i; break; }
        end = Math.min(end, at * size);
        cutTo = (end - start) / rate;
    }
    const speechFrames = voiced.slice(Math.floor(start / size), Math.ceil(end / size)).filter(Boolean).length;
    const speechSeconds = speechFrames * CLIP.frame;
    const kept = (end - start) / rate;
    const clippedShare = clipped / samples.length;
    const round = value => Math.round(value * 10) / 10;
    if (speechDb < -40) problems.push(`Too soft: the speech peaks at ${round(speechDb)} dBFS. Hold the phone closer or speak up.`);
    if (clippedShare > 0.001) problems.push(`Clipped: ${round(clippedShare * 100)}% of the recording hits full scale, which distorts the voice. Hold the phone a little further away.`);
    if (snrDb < 20) problems.push(`Noisy: the speech is only ${round(snrDb)} dB above the background. Record somewhere quieter.`);
    if (kept < CLIP.minSpeech) problems.push(`Too short: ${round(kept)} seconds from the first word to the last. Record 10 to 15 seconds.`);
    else if (speechFrames / Math.max(1, Math.round(kept / CLIP.frame)) < 0.55) problems.push('Too many pauses: under half the recording is speech. Read without stopping.');
    const clip = problems.length ? null : samples.slice(start, end);
    return { ok: !problems.length, problems, clip, seconds: round(seconds), kept: round(kept), speechSeconds: round(speechSeconds),
        speechDb: round(speechDb), noiseDb: round(noiseDb), snrDb: round(snrDb), clippedShare, cutTo: round(cutTo) };
}

/** Linear resampling, for a recording made at the device's own rate. Good enough for a reference clip. */
export function resample(samples, from, to = RATE) {
    if (from === to) return Float32Array.from(samples);
    const out = new Float32Array(Math.floor(samples.length * to / from));
    const step = from / to;
    for (let i = 0; i < out.length; i++) {
        const at = i * step, low = Math.floor(at), frac = at - low;
        out[i] = (samples[low] || 0) * (1 - frac) + (samples[low + 1] ?? samples[low] ?? 0) * frac;
    }
    return out;
}

/** Samples as a 16-bit mono WAV file. */
export function wavBytes(samples, rate = RATE) {
    const out = new Uint8Array(44 + samples.length * 2);
    const view = new DataView(out.buffer);
    const text = (at, value) => { for (let i = 0; i < value.length; i++) out[at + i] = value.charCodeAt(i); };
    text(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); text(8, 'WAVE');
    text(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    text(36, 'data'); view.setUint32(40, samples.length * 2, true);
    for (let i = 0; i < samples.length; i++) view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), true);
    return out;
}
