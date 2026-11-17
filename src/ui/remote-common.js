// (2.37.0) Remote desktop: what both sides use (the Remote page, and the hidden sender on the PC you control).
//
// Safety, in short: every PC has its own key pair, made here with the browser's own crypto. The private half
// can't be read back out, not even by this page (it's "non-extractable"), and it never leaves the PC.
// Each hello note is signed, and the signature covers the connection's lock (the DTLS fingerprint in the
// SDP). So a note that was changed on the way (even by our own server) doesn't match and is thrown away.
// The first time, both PCs show a 6-digit code made from both keys and both locks: you check it's the same.

const RD_ICE = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302", "stun:stun.cloudflare.com:3478"] }];
const RD_TOKEN = new URLSearchParams(location.search).get("t") || "";

async function rdPost(path, body) {
  const headers = { "Content-Type": "application/json" };
  if (RD_TOKEN) headers["X-Lelons-Token"] = RD_TOKEN;
  try {
    const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body || {}) });
    return await res.json();
  } catch (e) {
    return { ok: false, error: "offline" };
  }
}

const rdB64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const rdUnB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
const rdBytes = (text) => new TextEncoder().encode(text);

// role: "ctrl" (this PC controls others) or "host" (others control this PC). Kept in this engine's own store.
function rdDb() {
  return new Promise((done, fail) => {
    const req = indexedDB.open("vaulthub-remote", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("keys");
    req.onsuccess = () => done(req.result);
    req.onerror = () => fail(req.error);
  });
}
async function rdKeys(role) {
  const db = await rdDb();
  const get = () => new Promise((done) => {
    const r = db.transaction("keys").objectStore("keys").get(role);
    r.onsuccess = () => done(r.result || null);
    r.onerror = () => done(null);
  });
  let found = await get();
  if (!found) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
    const pub = rdB64(await crypto.subtle.exportKey("spki", pair.publicKey));
    found = { priv: pair.privateKey, pub };
    await new Promise((done) => {
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").put(found, role);
      tx.oncomplete = done; tx.onerror = done;
    });
  }
  return found;
}

async function rdSign(priv, text) {
  return rdB64(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, priv, rdBytes(text)));
}
async function rdVerify(pub, text, sig) {
  try {
    const key = await crypto.subtle.importKey("spki", rdUnB64(pub), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, rdUnB64(sig), rdBytes(text));
  } catch (e) {
    return false;
  }
}

// The connection's lock: WebRTC encrypts everything with DTLS, and this is its fingerprint.
function rdFingerprint(sdp) {
  const m = /^a=fingerprint:sha-256 ([0-9A-F:]+)/im.exec(sdp || "");
  return m ? m[1].toUpperCase() : "";
}

// The 6-digit code both PCs show the first time. Made from both keys and both locks: if anything sat in
// the middle, the two PCs would show different numbers.
async function rdCode(ctrlKey, hostKey, fpOffer, fpAnswer) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", rdBytes(`vaulthub-remote|${ctrlKey}|${hostKey}|${fpOffer}|${fpAnswer}`)));
  const n = ((hash[0] << 24) >>> 0) + (hash[1] << 16) + (hash[2] << 8) + hash[3];
  return String(n % 1000000).padStart(6, "0");
}

function rdGathered(pc) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((done) => {
    const check = () => { if (pc.iceGatheringState === "complete") finish(); };
    const finish = () => { pc.removeEventListener("icegatheringstatechange", check); clearTimeout(timer); done(); };
    const timer = setTimeout(finish, 4000);
    pc.addEventListener("icegatheringstatechange", check);
  });
}

// The other PC's sound in stereo, at good quality.
function rdTuneOpus(sdp) {
  for (const [, pt] of sdp.matchAll(/^a=rtpmap:(\d+) opus\/48000/gim)) {
    const line = new RegExp(`^a=fmtp:${pt} (.*)$`, "m");
    const found = sdp.match(line);
    const extra = "stereo=1;sprop-stereo=1;maxaveragebitrate=192000";
    sdp = found ? sdp.replace(line, `a=fmtp:${pt} ${found[1]};${extra}`) : sdp;
  }
  return sdp;
}

// Picture modes: [frames a second, most pixels high, bits per second, what WebRTC gives up first]
const RD_MODES = {
  auto: { fps: 60, height: 1440, bitrate: 20e6, keep: "balanced", hint: "motion" },
  smooth: { fps: 60, height: 1080, bitrate: 12e6, keep: "maintain-framerate", hint: "motion" },
  sharp: { fps: 60, height: 2160, bitrate: 30e6, keep: "maintain-resolution", hint: "detail" },
  save: { fps: 30, height: 720, bitrate: 2.5e6, keep: "balanced", hint: "detail" },
};
