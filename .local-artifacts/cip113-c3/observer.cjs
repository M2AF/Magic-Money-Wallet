var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main/cardano-programmable.ts
var cardano_programmable_exports = {};
__export(cardano_programmable_exports, {
  CIP113_MAINNET: () => CIP113_MAINNET,
  CIP113_REGISTRY_ADDRESS: () => CIP113_REGISTRY_ADDRESS,
  cachedCip113Holdings: () => cachedCip113Holdings,
  cip113HistoryEvents: () => cip113HistoryEvents,
  cip113KoiosRead: () => cip113KoiosRead,
  collectCip113Holdings: () => collectCip113Holdings,
  decodeCip113Protocol: () => decodeCip113Protocol,
  decodeCip113Registry: () => decodeCip113Registry,
  deriveCip113OwnerAddresses: () => deriveCip113OwnerAddresses,
  discoverCip113Holdings: () => discoverCip113Holdings
});
module.exports = __toCommonJS(cardano_programmable_exports);

// node_modules/@scure/base/lib/esm/index.js
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function isArrayOf(isString, arr) {
  if (!Array.isArray(arr))
    return false;
  if (arr.length === 0)
    return true;
  if (isString) {
    return arr.every((item) => typeof item === "string");
  } else {
    return arr.every((item) => Number.isSafeInteger(item));
  }
}
function afn(input) {
  if (typeof input !== "function")
    throw new Error("function expected");
  return true;
}
function astr(label, input) {
  if (typeof input !== "string")
    throw new Error(`${label}: string expected`);
  return true;
}
function anumber(n) {
  if (!Number.isSafeInteger(n))
    throw new Error(`invalid integer: ${n}`);
}
function aArr(input) {
  if (!Array.isArray(input))
    throw new Error("array expected");
}
function astrArr(label, input) {
  if (!isArrayOf(true, input))
    throw new Error(`${label}: array of strings expected`);
}
function anumArr(label, input) {
  if (!isArrayOf(false, input))
    throw new Error(`${label}: array of numbers expected`);
}
// @__NO_SIDE_EFFECTS__
function chain(...args) {
  const id = (a) => a;
  const wrap = (a, b) => (c) => a(b(c));
  const encode = args.map((x) => x.encode).reduceRight(wrap, id);
  const decode = args.map((x) => x.decode).reduce(wrap, id);
  return { encode, decode };
}
// @__NO_SIDE_EFFECTS__
function alphabet(letters) {
  const lettersA = typeof letters === "string" ? letters.split("") : letters;
  const len = lettersA.length;
  astrArr("alphabet", lettersA);
  const indexes = new Map(lettersA.map((l, i) => [l, i]));
  return {
    encode: (digits) => {
      aArr(digits);
      return digits.map((i) => {
        if (!Number.isSafeInteger(i) || i < 0 || i >= len)
          throw new Error(`alphabet.encode: digit index outside alphabet "${i}". Allowed: ${letters}`);
        return lettersA[i];
      });
    },
    decode: (input) => {
      aArr(input);
      return input.map((letter) => {
        astr("alphabet.decode", letter);
        const i = indexes.get(letter);
        if (i === void 0)
          throw new Error(`Unknown letter: "${letter}". Allowed: ${letters}`);
        return i;
      });
    }
  };
}
// @__NO_SIDE_EFFECTS__
function join(separator = "") {
  astr("join", separator);
  return {
    encode: (from) => {
      astrArr("join.decode", from);
      return from.join(separator);
    },
    decode: (to) => {
      astr("join.decode", to);
      return to.split(separator);
    }
  };
}
var gcd = (a, b) => b === 0 ? a : gcd(b, a % b);
var radix2carry = /* @__NO_SIDE_EFFECTS__ */ (from, to) => from + (to - gcd(from, to));
var powers = /* @__PURE__ */ (() => {
  let res = [];
  for (let i = 0; i < 40; i++)
    res.push(2 ** i);
  return res;
})();
function convertRadix2(data, from, to, padding) {
  aArr(data);
  if (from <= 0 || from > 32)
    throw new Error(`convertRadix2: wrong from=${from}`);
  if (to <= 0 || to > 32)
    throw new Error(`convertRadix2: wrong to=${to}`);
  if (/* @__PURE__ */ radix2carry(from, to) > 32) {
    throw new Error(`convertRadix2: carry overflow from=${from} to=${to} carryBits=${/* @__PURE__ */ radix2carry(from, to)}`);
  }
  let carry = 0;
  let pos = 0;
  const max = powers[from];
  const mask = powers[to] - 1;
  const res = [];
  for (const n of data) {
    anumber(n);
    if (n >= max)
      throw new Error(`convertRadix2: invalid data word=${n} from=${from}`);
    carry = carry << from | n;
    if (pos + from > 32)
      throw new Error(`convertRadix2: carry overflow pos=${pos} from=${from}`);
    pos += from;
    for (; pos >= to; pos -= to)
      res.push((carry >> pos - to & mask) >>> 0);
    const pow = powers[pos];
    if (pow === void 0)
      throw new Error("invalid carry");
    carry &= pow - 1;
  }
  carry = carry << to - pos & mask;
  if (!padding && pos >= from)
    throw new Error("Excess padding");
  if (!padding && carry > 0)
    throw new Error(`Non-zero padding: ${carry}`);
  if (padding && pos > 0)
    res.push(carry >>> 0);
  return res;
}
// @__NO_SIDE_EFFECTS__
function radix2(bits, revPadding = false) {
  anumber(bits);
  if (bits <= 0 || bits > 32)
    throw new Error("radix2: bits should be in (0..32]");
  if (/* @__PURE__ */ radix2carry(8, bits) > 32 || /* @__PURE__ */ radix2carry(bits, 8) > 32)
    throw new Error("radix2: carry overflow");
  return {
    encode: (bytes2) => {
      if (!isBytes(bytes2))
        throw new Error("radix2.encode input should be Uint8Array");
      return convertRadix2(Array.from(bytes2), 8, bits, !revPadding);
    },
    decode: (digits) => {
      anumArr("radix2.decode", digits);
      return Uint8Array.from(convertRadix2(digits, bits, 8, revPadding));
    }
  };
}
function unsafeWrapper(fn) {
  afn(fn);
  return function(...args) {
    try {
      return fn.apply(null, args);
    } catch (e) {
    }
  };
}
var BECH_ALPHABET = /* @__PURE__ */ chain(/* @__PURE__ */ alphabet("qpzry9x8gf2tvdw0s3jn54khce6mua7l"), /* @__PURE__ */ join(""));
var POLYMOD_GENERATORS = [996825010, 642813549, 513874426, 1027748829, 705979059];
function bech32Polymod(pre) {
  const b = pre >> 25;
  let chk = (pre & 33554431) << 5;
  for (let i = 0; i < POLYMOD_GENERATORS.length; i++) {
    if ((b >> i & 1) === 1)
      chk ^= POLYMOD_GENERATORS[i];
  }
  return chk;
}
function bechChecksum(prefix, words, encodingConst = 1) {
  const len = prefix.length;
  let chk = 1;
  for (let i = 0; i < len; i++) {
    const c = prefix.charCodeAt(i);
    if (c < 33 || c > 126)
      throw new Error(`Invalid prefix (${prefix})`);
    chk = bech32Polymod(chk) ^ c >> 5;
  }
  chk = bech32Polymod(chk);
  for (let i = 0; i < len; i++)
    chk = bech32Polymod(chk) ^ prefix.charCodeAt(i) & 31;
  for (let v of words)
    chk = bech32Polymod(chk) ^ v;
  for (let i = 0; i < 6; i++)
    chk = bech32Polymod(chk);
  chk ^= encodingConst;
  return BECH_ALPHABET.encode(convertRadix2([chk % powers[30]], 30, 5, false));
}
// @__NO_SIDE_EFFECTS__
function genBech32(encoding) {
  const ENCODING_CONST = encoding === "bech32" ? 1 : 734539939;
  const _words = /* @__PURE__ */ radix2(5);
  const fromWords = _words.decode;
  const toWords = _words.encode;
  const fromWordsUnsafe = unsafeWrapper(fromWords);
  function encode(prefix, words, limit = 90) {
    astr("bech32.encode prefix", prefix);
    if (isBytes(words))
      words = Array.from(words);
    anumArr("bech32.encode", words);
    const plen = prefix.length;
    if (plen === 0)
      throw new TypeError(`Invalid prefix length ${plen}`);
    const actualLength = plen + 7 + words.length;
    if (limit !== false && actualLength > limit)
      throw new TypeError(`Length ${actualLength} exceeds limit ${limit}`);
    const lowered = prefix.toLowerCase();
    const sum = bechChecksum(lowered, words, ENCODING_CONST);
    return `${lowered}1${BECH_ALPHABET.encode(words)}${sum}`;
  }
  function decode(str, limit = 90) {
    astr("bech32.decode input", str);
    const slen = str.length;
    if (slen < 8 || limit !== false && slen > limit)
      throw new TypeError(`invalid string length: ${slen} (${str}). Expected (8..${limit})`);
    const lowered = str.toLowerCase();
    if (str !== lowered && str !== str.toUpperCase())
      throw new Error(`String must be lowercase or uppercase`);
    const sepIndex = lowered.lastIndexOf("1");
    if (sepIndex === 0 || sepIndex === -1)
      throw new Error(`Letter "1" must be present between prefix and data only`);
    const prefix = lowered.slice(0, sepIndex);
    const data = lowered.slice(sepIndex + 1);
    if (data.length < 6)
      throw new Error("Data must be at least 6 characters long");
    const words = BECH_ALPHABET.decode(data).slice(0, -6);
    const sum = bechChecksum(prefix, words, ENCODING_CONST);
    if (!data.endsWith(sum))
      throw new Error(`Invalid checksum in ${str}: expected "${sum}"`);
    return { prefix, words };
  }
  const decodeUnsafe = unsafeWrapper(decode);
  function decodeToBytes(str) {
    const { prefix, words } = decode(str, false);
    return { prefix, words, bytes: fromWords(words) };
  }
  function encodeFromBytes(prefix, bytes2) {
    return encode(prefix, toWords(bytes2));
  }
  return {
    encode,
    decode,
    encodeFromBytes,
    decodeToBytes,
    decodeUnsafe,
    fromWords,
    fromWordsUnsafe,
    toWords
  };
}
var bech32 = /* @__PURE__ */ genBech32("bech32");

// node_modules/@noble/hashes/esm/utils.js
function isBytes2(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array";
}
function anumber2(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("positive integer expected, got " + n);
}
function abytes(b, ...lengths) {
  if (!isBytes2(b))
    throw new Error("Uint8Array expected");
  if (lengths.length > 0 && !lengths.includes(b.length))
    throw new Error("Uint8Array expected of length " + lengths + ", got length=" + b.length);
}
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (checkFinished && instance.finished)
    throw new Error("Hash#digest() has already been called");
}
function aoutput(out, instance) {
  abytes(out);
  const min = instance.outputLen;
  if (out.length < min) {
    throw new Error("digestInto() expects output buffer of length at least " + min);
  }
}
function u32(arr) {
  return new Uint32Array(arr.buffer, arr.byteOffset, Math.floor(arr.byteLength / 4));
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
var isLE = /* @__PURE__ */ (() => new Uint8Array(new Uint32Array([287454020]).buffer)[0] === 68)();
function byteSwap(word) {
  return word << 24 & 4278190080 | word << 8 & 16711680 | word >>> 8 & 65280 | word >>> 24 & 255;
}
var swap8IfBE = isLE ? (n) => n : (n) => byteSwap(n);
function byteSwap32(arr) {
  for (let i = 0; i < arr.length; i++) {
    arr[i] = byteSwap(arr[i]);
  }
  return arr;
}
var swap32IfBE = isLE ? (u) => u : byteSwap32;
function utf8ToBytes(str) {
  if (typeof str !== "string")
    throw new Error("string expected");
  return new Uint8Array(new TextEncoder().encode(str));
}
function toBytes(data) {
  if (typeof data === "string")
    data = utf8ToBytes(data);
  abytes(data);
  return data;
}
var Hash = class {
};
function createOptHasher(hashCons) {
  const hashC = (msg, opts) => hashCons(opts).update(toBytes(msg)).digest();
  const tmp = hashCons({});
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.create = (opts) => hashCons(opts);
  return hashC;
}

// node_modules/@noble/hashes/esm/_blake.js
var BSIGMA = /* @__PURE__ */ Uint8Array.from([
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  14,
  10,
  4,
  8,
  9,
  15,
  13,
  6,
  1,
  12,
  0,
  2,
  11,
  7,
  5,
  3,
  11,
  8,
  12,
  0,
  5,
  2,
  15,
  13,
  10,
  14,
  3,
  6,
  7,
  1,
  9,
  4,
  7,
  9,
  3,
  1,
  13,
  12,
  11,
  14,
  2,
  6,
  5,
  10,
  4,
  0,
  15,
  8,
  9,
  0,
  5,
  7,
  2,
  4,
  10,
  15,
  14,
  1,
  11,
  12,
  6,
  8,
  3,
  13,
  2,
  12,
  6,
  10,
  0,
  11,
  8,
  3,
  4,
  13,
  7,
  5,
  15,
  14,
  1,
  9,
  12,
  5,
  1,
  15,
  14,
  13,
  4,
  10,
  0,
  7,
  6,
  3,
  9,
  2,
  8,
  11,
  13,
  11,
  7,
  14,
  12,
  1,
  3,
  9,
  5,
  0,
  15,
  4,
  8,
  6,
  2,
  10,
  6,
  15,
  14,
  9,
  11,
  3,
  0,
  8,
  12,
  2,
  13,
  7,
  1,
  4,
  10,
  5,
  10,
  2,
  8,
  4,
  7,
  6,
  1,
  5,
  15,
  11,
  9,
  14,
  3,
  12,
  13,
  0,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  11,
  12,
  13,
  14,
  15,
  14,
  10,
  4,
  8,
  9,
  15,
  13,
  6,
  1,
  12,
  0,
  2,
  11,
  7,
  5,
  3,
  // Blake1, unused in others
  11,
  8,
  12,
  0,
  5,
  2,
  15,
  13,
  10,
  14,
  3,
  6,
  7,
  1,
  9,
  4,
  7,
  9,
  3,
  1,
  13,
  12,
  11,
  14,
  2,
  6,
  5,
  10,
  4,
  0,
  15,
  8,
  9,
  0,
  5,
  7,
  2,
  4,
  10,
  15,
  14,
  1,
  11,
  12,
  6,
  8,
  3,
  13,
  2,
  12,
  6,
  10,
  0,
  11,
  8,
  3,
  4,
  13,
  7,
  5,
  15,
  14,
  1,
  9
]);

// node_modules/@noble/hashes/esm/_u64.js
var U32_MASK64 = /* @__PURE__ */ BigInt(2 ** 32 - 1);
var _32n = /* @__PURE__ */ BigInt(32);
function fromBig(n, le = false) {
  if (le)
    return { h: Number(n & U32_MASK64), l: Number(n >> _32n & U32_MASK64) };
  return { h: Number(n >> _32n & U32_MASK64) | 0, l: Number(n & U32_MASK64) | 0 };
}
var rotrSH = (h, l, s) => h >>> s | l << 32 - s;
var rotrSL = (h, l, s) => h << 32 - s | l >>> s;
var rotrBH = (h, l, s) => h << 64 - s | l >>> s - 32;
var rotrBL = (h, l, s) => h >>> s - 32 | l << 64 - s;
var rotr32H = (_h, l) => l;
var rotr32L = (h, _l) => h;
function add(Ah, Al, Bh, Bl) {
  const l = (Al >>> 0) + (Bl >>> 0);
  return { h: Ah + Bh + (l / 2 ** 32 | 0) | 0, l: l | 0 };
}
var add3L = (Al, Bl, Cl) => (Al >>> 0) + (Bl >>> 0) + (Cl >>> 0);
var add3H = (low, Ah, Bh, Ch) => Ah + Bh + Ch + (low / 2 ** 32 | 0) | 0;

// node_modules/@noble/hashes/esm/blake2.js
var B2B_IV = /* @__PURE__ */ Uint32Array.from([
  4089235720,
  1779033703,
  2227873595,
  3144134277,
  4271175723,
  1013904242,
  1595750129,
  2773480762,
  2917565137,
  1359893119,
  725511199,
  2600822924,
  4215389547,
  528734635,
  327033209,
  1541459225
]);
var BBUF = /* @__PURE__ */ new Uint32Array(32);
function G1b(a, b, c, d, msg, x) {
  const Xl = msg[x], Xh = msg[x + 1];
  let Al = BBUF[2 * a], Ah = BBUF[2 * a + 1];
  let Bl = BBUF[2 * b], Bh = BBUF[2 * b + 1];
  let Cl = BBUF[2 * c], Ch = BBUF[2 * c + 1];
  let Dl = BBUF[2 * d], Dh = BBUF[2 * d + 1];
  let ll = add3L(Al, Bl, Xl);
  Ah = add3H(ll, Ah, Bh, Xh);
  Al = ll | 0;
  ({ Dh, Dl } = { Dh: Dh ^ Ah, Dl: Dl ^ Al });
  ({ Dh, Dl } = { Dh: rotr32H(Dh, Dl), Dl: rotr32L(Dh, Dl) });
  ({ h: Ch, l: Cl } = add(Ch, Cl, Dh, Dl));
  ({ Bh, Bl } = { Bh: Bh ^ Ch, Bl: Bl ^ Cl });
  ({ Bh, Bl } = { Bh: rotrSH(Bh, Bl, 24), Bl: rotrSL(Bh, Bl, 24) });
  BBUF[2 * a] = Al, BBUF[2 * a + 1] = Ah;
  BBUF[2 * b] = Bl, BBUF[2 * b + 1] = Bh;
  BBUF[2 * c] = Cl, BBUF[2 * c + 1] = Ch;
  BBUF[2 * d] = Dl, BBUF[2 * d + 1] = Dh;
}
function G2b(a, b, c, d, msg, x) {
  const Xl = msg[x], Xh = msg[x + 1];
  let Al = BBUF[2 * a], Ah = BBUF[2 * a + 1];
  let Bl = BBUF[2 * b], Bh = BBUF[2 * b + 1];
  let Cl = BBUF[2 * c], Ch = BBUF[2 * c + 1];
  let Dl = BBUF[2 * d], Dh = BBUF[2 * d + 1];
  let ll = add3L(Al, Bl, Xl);
  Ah = add3H(ll, Ah, Bh, Xh);
  Al = ll | 0;
  ({ Dh, Dl } = { Dh: Dh ^ Ah, Dl: Dl ^ Al });
  ({ Dh, Dl } = { Dh: rotrSH(Dh, Dl, 16), Dl: rotrSL(Dh, Dl, 16) });
  ({ h: Ch, l: Cl } = add(Ch, Cl, Dh, Dl));
  ({ Bh, Bl } = { Bh: Bh ^ Ch, Bl: Bl ^ Cl });
  ({ Bh, Bl } = { Bh: rotrBH(Bh, Bl, 63), Bl: rotrBL(Bh, Bl, 63) });
  BBUF[2 * a] = Al, BBUF[2 * a + 1] = Ah;
  BBUF[2 * b] = Bl, BBUF[2 * b + 1] = Bh;
  BBUF[2 * c] = Cl, BBUF[2 * c + 1] = Ch;
  BBUF[2 * d] = Dl, BBUF[2 * d + 1] = Dh;
}
function checkBlake2Opts(outputLen, opts = {}, keyLen, saltLen, persLen) {
  anumber2(keyLen);
  if (outputLen < 0 || outputLen > keyLen)
    throw new Error("outputLen bigger than keyLen");
  const { key, salt, personalization } = opts;
  if (key !== void 0 && (key.length < 1 || key.length > keyLen))
    throw new Error("key length must be undefined or 1.." + keyLen);
  if (salt !== void 0 && salt.length !== saltLen)
    throw new Error("salt must be undefined or " + saltLen);
  if (personalization !== void 0 && personalization.length !== persLen)
    throw new Error("personalization must be undefined or " + persLen);
}
var BLAKE2 = class extends Hash {
  constructor(blockLen, outputLen) {
    super();
    this.finished = false;
    this.destroyed = false;
    this.length = 0;
    this.pos = 0;
    anumber2(blockLen);
    anumber2(outputLen);
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.buffer = new Uint8Array(blockLen);
    this.buffer32 = u32(this.buffer);
  }
  update(data) {
    aexists(this);
    data = toBytes(data);
    abytes(data);
    const { blockLen, buffer, buffer32 } = this;
    const len = data.length;
    const offset = data.byteOffset;
    const buf = data.buffer;
    for (let pos = 0; pos < len; ) {
      if (this.pos === blockLen) {
        swap32IfBE(buffer32);
        this.compress(buffer32, 0, false);
        swap32IfBE(buffer32);
        this.pos = 0;
      }
      const take = Math.min(blockLen - this.pos, len - pos);
      const dataOffset = offset + pos;
      if (take === blockLen && !(dataOffset % 4) && pos + take < len) {
        const data32 = new Uint32Array(buf, dataOffset, Math.floor((len - pos) / 4));
        swap32IfBE(data32);
        for (let pos32 = 0; pos + blockLen < len; pos32 += buffer32.length, pos += blockLen) {
          this.length += blockLen;
          this.compress(data32, pos32, false);
        }
        swap32IfBE(data32);
        continue;
      }
      buffer.set(data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      this.length += take;
      pos += take;
    }
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    const { pos, buffer32 } = this;
    this.finished = true;
    clean(this.buffer.subarray(pos));
    swap32IfBE(buffer32);
    this.compress(buffer32, 0, true);
    swap32IfBE(buffer32);
    const out32 = u32(out);
    this.get().forEach((v, i) => out32[i] = swap8IfBE(v));
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneInto(to) {
    const { buffer, length, finished, destroyed, outputLen, pos } = this;
    to || (to = new this.constructor({ dkLen: outputLen }));
    to.set(...this.get());
    to.buffer.set(buffer);
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    to.outputLen = outputLen;
    return to;
  }
  clone() {
    return this._cloneInto();
  }
};
var BLAKE2b = class extends BLAKE2 {
  constructor(opts = {}) {
    const olen = opts.dkLen === void 0 ? 64 : opts.dkLen;
    super(128, olen);
    this.v0l = B2B_IV[0] | 0;
    this.v0h = B2B_IV[1] | 0;
    this.v1l = B2B_IV[2] | 0;
    this.v1h = B2B_IV[3] | 0;
    this.v2l = B2B_IV[4] | 0;
    this.v2h = B2B_IV[5] | 0;
    this.v3l = B2B_IV[6] | 0;
    this.v3h = B2B_IV[7] | 0;
    this.v4l = B2B_IV[8] | 0;
    this.v4h = B2B_IV[9] | 0;
    this.v5l = B2B_IV[10] | 0;
    this.v5h = B2B_IV[11] | 0;
    this.v6l = B2B_IV[12] | 0;
    this.v6h = B2B_IV[13] | 0;
    this.v7l = B2B_IV[14] | 0;
    this.v7h = B2B_IV[15] | 0;
    checkBlake2Opts(olen, opts, 64, 16, 16);
    let { key, personalization, salt } = opts;
    let keyLength = 0;
    if (key !== void 0) {
      key = toBytes(key);
      keyLength = key.length;
    }
    this.v0l ^= this.outputLen | keyLength << 8 | 1 << 16 | 1 << 24;
    if (salt !== void 0) {
      salt = toBytes(salt);
      const slt = u32(salt);
      this.v4l ^= swap8IfBE(slt[0]);
      this.v4h ^= swap8IfBE(slt[1]);
      this.v5l ^= swap8IfBE(slt[2]);
      this.v5h ^= swap8IfBE(slt[3]);
    }
    if (personalization !== void 0) {
      personalization = toBytes(personalization);
      const pers = u32(personalization);
      this.v6l ^= swap8IfBE(pers[0]);
      this.v6h ^= swap8IfBE(pers[1]);
      this.v7l ^= swap8IfBE(pers[2]);
      this.v7h ^= swap8IfBE(pers[3]);
    }
    if (key !== void 0) {
      const tmp = new Uint8Array(this.blockLen);
      tmp.set(key);
      this.update(tmp);
    }
  }
  // prettier-ignore
  get() {
    let { v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h } = this;
    return [v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h];
  }
  // prettier-ignore
  set(v0l, v0h, v1l, v1h, v2l, v2h, v3l, v3h, v4l, v4h, v5l, v5h, v6l, v6h, v7l, v7h) {
    this.v0l = v0l | 0;
    this.v0h = v0h | 0;
    this.v1l = v1l | 0;
    this.v1h = v1h | 0;
    this.v2l = v2l | 0;
    this.v2h = v2h | 0;
    this.v3l = v3l | 0;
    this.v3h = v3h | 0;
    this.v4l = v4l | 0;
    this.v4h = v4h | 0;
    this.v5l = v5l | 0;
    this.v5h = v5h | 0;
    this.v6l = v6l | 0;
    this.v6h = v6h | 0;
    this.v7l = v7l | 0;
    this.v7h = v7h | 0;
  }
  compress(msg, offset, isLast) {
    this.get().forEach((v, i) => BBUF[i] = v);
    BBUF.set(B2B_IV, 16);
    let { h, l } = fromBig(BigInt(this.length));
    BBUF[24] = B2B_IV[8] ^ l;
    BBUF[25] = B2B_IV[9] ^ h;
    if (isLast) {
      BBUF[28] = ~BBUF[28];
      BBUF[29] = ~BBUF[29];
    }
    let j = 0;
    const s = BSIGMA;
    for (let i = 0; i < 12; i++) {
      G1b(0, 4, 8, 12, msg, offset + 2 * s[j++]);
      G2b(0, 4, 8, 12, msg, offset + 2 * s[j++]);
      G1b(1, 5, 9, 13, msg, offset + 2 * s[j++]);
      G2b(1, 5, 9, 13, msg, offset + 2 * s[j++]);
      G1b(2, 6, 10, 14, msg, offset + 2 * s[j++]);
      G2b(2, 6, 10, 14, msg, offset + 2 * s[j++]);
      G1b(3, 7, 11, 15, msg, offset + 2 * s[j++]);
      G2b(3, 7, 11, 15, msg, offset + 2 * s[j++]);
      G1b(0, 5, 10, 15, msg, offset + 2 * s[j++]);
      G2b(0, 5, 10, 15, msg, offset + 2 * s[j++]);
      G1b(1, 6, 11, 12, msg, offset + 2 * s[j++]);
      G2b(1, 6, 11, 12, msg, offset + 2 * s[j++]);
      G1b(2, 7, 8, 13, msg, offset + 2 * s[j++]);
      G2b(2, 7, 8, 13, msg, offset + 2 * s[j++]);
      G1b(3, 4, 9, 14, msg, offset + 2 * s[j++]);
      G2b(3, 4, 9, 14, msg, offset + 2 * s[j++]);
    }
    this.v0l ^= BBUF[0] ^ BBUF[16];
    this.v0h ^= BBUF[1] ^ BBUF[17];
    this.v1l ^= BBUF[2] ^ BBUF[18];
    this.v1h ^= BBUF[3] ^ BBUF[19];
    this.v2l ^= BBUF[4] ^ BBUF[20];
    this.v2h ^= BBUF[5] ^ BBUF[21];
    this.v3l ^= BBUF[6] ^ BBUF[22];
    this.v3h ^= BBUF[7] ^ BBUF[23];
    this.v4l ^= BBUF[8] ^ BBUF[24];
    this.v4h ^= BBUF[9] ^ BBUF[25];
    this.v5l ^= BBUF[10] ^ BBUF[26];
    this.v5h ^= BBUF[11] ^ BBUF[27];
    this.v6l ^= BBUF[12] ^ BBUF[28];
    this.v6h ^= BBUF[13] ^ BBUF[29];
    this.v7l ^= BBUF[14] ^ BBUF[30];
    this.v7h ^= BBUF[15] ^ BBUF[31];
    clean(BBUF);
  }
  destroy() {
    this.destroyed = true;
    clean(this.buffer32);
    this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
  }
};
var blake2b = /* @__PURE__ */ createOptHasher((opts) => new BLAKE2b(opts));

// node_modules/@noble/hashes/esm/blake2b.js
var blake2b2 = blake2b;

// src/main/cardano-plutus-data.ts
var PlutusDataError = class extends Error {
};
var MAX_DEPTH = 64;
var BREAK = Symbol("break");
function readHead(b, off) {
  if (off >= b.length) throw new PlutusDataError("truncated datum");
  const major = b[off] >> 5;
  const ai = b[off] & 31;
  if (ai < 24) return { major, ai, arg: BigInt(ai), next: off + 1 };
  const width = ai === 24 ? 1 : ai === 25 ? 2 : ai === 26 ? 4 : ai === 27 ? 8 : 0;
  if (width === 0) {
    if (ai === 31) return { major, ai, arg: -1n, next: off + 1 };
    throw new PlutusDataError("reserved CBOR additional info");
  }
  if (off + 1 + width > b.length) throw new PlutusDataError("truncated datum");
  let arg = 0n;
  for (let i = 0; i < width; i++) arg = arg << 8n | BigInt(b[off + 1 + i]);
  return { major, ai, arg, next: off + 1 + width };
}
function toLength(arg, b) {
  if (arg > BigInt(b.length)) throw new PlutusDataError("length exceeds datum size");
  return Number(arg);
}
function bytesFrom(b, h) {
  if (h.ai === 31) {
    const parts = [];
    let pos = h.next;
    for (; ; ) {
      if (pos >= b.length) throw new PlutusDataError("unterminated byte string");
      if (b[pos] === 255) {
        pos++;
        break;
      }
      const chunk = readHead(b, pos);
      if (chunk.major !== 2 || chunk.ai === 31) throw new PlutusDataError("bad byte-string chunk");
      const len2 = toLength(chunk.arg, b);
      if (chunk.next + len2 > b.length) throw new PlutusDataError("truncated datum");
      parts.push(b.slice(chunk.next, chunk.next + len2));
      pos = chunk.next + len2;
    }
    const total = parts.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return { value: out, next: pos };
  }
  const len = toLength(h.arg, b);
  if (h.next + len > b.length) throw new PlutusDataError("truncated datum");
  return { value: b.slice(h.next, h.next + len), next: h.next + len };
}
function readItems(b, h, depth, perItem) {
  const items = [];
  let pos = h.next;
  if (h.ai === 31) {
    for (; ; ) {
      const item = readItem(b, pos, depth + 1);
      if (item.value === BREAK) return { items, next: item.next };
      items.push(item.value);
      pos = item.next;
    }
  }
  const count = toLength(h.arg, b) * perItem;
  for (let i = 0; i < count; i++) {
    const item = readItem(b, pos, depth + 1);
    if (item.value === BREAK) throw new PlutusDataError("unexpected break");
    items.push(item.value);
    pos = item.next;
  }
  return { items, next: pos };
}
function constrIndex(tag) {
  if (tag >= 121n && tag <= 127n) return Number(tag - 121n);
  if (tag >= 1280n && tag <= 1400n) return Number(tag - 1280n) + 7;
  if (tag === 102n) return -1;
  return null;
}
function readItem(b, off, depth) {
  if (depth > MAX_DEPTH) throw new PlutusDataError("datum nested too deeply");
  if (off < b.length && b[off] === 255) return { value: BREAK, next: off + 1 };
  const h = readHead(b, off);
  switch (h.major) {
    case 0:
      return { value: { kind: "int", value: h.arg }, next: h.next };
    case 1:
      return { value: { kind: "int", value: -1n - h.arg }, next: h.next };
    case 2: {
      const r = bytesFrom(b, h);
      return { value: { kind: "bytes", value: r.value }, next: r.next };
    }
    case 4: {
      const r = readItems(b, h, depth, 1);
      return { value: { kind: "list", items: r.items }, next: r.next };
    }
    case 5: {
      const r = readItems(b, h, depth, 2);
      if (r.items.length % 2 !== 0) throw new PlutusDataError("odd map entry count");
      const entries = [];
      for (let i = 0; i < r.items.length; i += 2) entries.push([r.items[i], r.items[i + 1]]);
      return { value: { kind: "map", entries }, next: r.next };
    }
    case 6: {
      if (h.arg === 2n || h.arg === 3n) {
        const inner2 = readItem(b, h.next, depth + 1);
        if (inner2.value === BREAK || inner2.value.kind !== "bytes") throw new PlutusDataError("bad bignum");
        let mag = 0n;
        for (const byte of inner2.value.value) mag = mag << 8n | BigInt(byte);
        return { value: { kind: "int", value: h.arg === 2n ? mag : -1n - mag }, next: inner2.next };
      }
      const index = constrIndex(h.arg);
      if (index == null) throw new PlutusDataError(`tag ${h.arg} is not Plutus Data`);
      const inner = readItem(b, h.next, depth + 1);
      if (inner.value === BREAK) throw new PlutusDataError("unexpected break");
      if (index === -1) {
        const v = inner.value;
        if (v.kind !== "list" || v.items.length !== 2 || v.items[0].kind !== "int" || v.items[1].kind !== "list") {
          throw new PlutusDataError("bad general constructor");
        }
        const idx = v.items[0].value;
        if (idx < 0n || idx > 0xffffffffn) throw new PlutusDataError("constructor index out of range");
        return { value: { kind: "constr", index: Number(idx), fields: v.items[1].items }, next: inner.next };
      }
      if (inner.value.kind !== "list") throw new PlutusDataError("constructor fields must be a list");
      return { value: { kind: "constr", index, fields: inner.value.items }, next: inner.next };
    }
    default:
      throw new PlutusDataError(`CBOR major type ${h.major} is not Plutus Data`);
  }
}
function decodePlutusData(bytes2) {
  const r = readItem(bytes2, 0, 0);
  if (r.value === BREAK) throw new PlutusDataError("unexpected break");
  if (r.next !== bytes2.length) throw new PlutusDataError("trailing bytes after datum");
  return r.value;
}
function asConstr(d, what, index, arity) {
  if (d.kind !== "constr") throw new PlutusDataError(`${what}: expected a constructor`);
  if (index != null && d.index !== index) throw new PlutusDataError(`${what}: unexpected constructor ${d.index}`);
  if (arity != null && d.fields.length !== arity) throw new PlutusDataError(`${what}: expected ${arity} fields`);
  return d.fields;
}
function asBytes(d, what, length) {
  if (d.kind !== "bytes") throw new PlutusDataError(`${what}: expected bytes`);
  if (length != null && d.value.length !== length) throw new PlutusDataError(`${what}: expected ${length} bytes`);
  return d.value;
}

// src/main/cardano-programmable.ts
var CIP113_MAINNET = {
  deploymentId: "bfefbd222e40d88f5d4454e92b24062533070f41a3e25c0a23383264650cdb72",
  registryPolicy: "484e733d122af44e6101988bcc47ed261a7af5c43c797e89d60e3075",
  baseScript: "d91d08e381f8ef95ffbb3f8048f020d7361ded8f3abfdf66c25fa838",
  paramsPolicy: "3a511ec25af655c1aef31d0d9c0c6154eae7321045b1fa46fac55ecd",
  paramsName: "50726f746f636f6c506172616d73",
  // ProtocolParams, not an empty asset name.
  dispatcher: "46b61f0584f21481b22ea18f945e48ac4148f50fc3ade494a7762440",
  issuance: "ed3fb7e046b4f3387e0749fb46847dbc15e85e61aaa76558f968136d",
  transfer: "cb418959c00d6779e176fcf6227824a6ac3b5bea7a672ef66a216dae",
  thirdParty: "92e307862c5374ee78f3cfdaaa45447f7f0db6776d54fa5f8df1a85c",
  upgrade: "2ab871806b01d07fe7d93bf45ff4ce97bd156d168d7a08078ac8a517"
};
var KOIOS = "https://api.koios.rest/api/v1";
var SENTINEL = "ff".repeat(30);
var hex = (bytes2) => Array.from(bytes2, (n) => n.toString(16).padStart(2, "0")).join("");
function bytes(value) {
  if (!/^(?:[0-9a-f]{2})+$/i.test(value) || value.length > 32768) throw new Error("Invalid CIP-113 datum bytes");
  return Uint8Array.from(value.match(/../g), (n) => parseInt(n, 16));
}
function address(header, payment, stake) {
  return bech32.encode("addr", bech32.toWords(new Uint8Array([header, ...bytes(payment), ...stake ?? []])), 200);
}
var CIP113_REGISTRY_ADDRESS = address(113, CIP113_MAINNET.registryPolicy);
var PARAMS_ADDRESS = address(113, CIP113_MAINNET.paramsPolicy);
function deriveCip113OwnerAddresses(walletAddress) {
  const decoded = bech32.decode(walletAddress, 200);
  const data = Uint8Array.from(bech32.fromWords(decoded.words));
  if (decoded.prefix !== "addr" || (data[0] & 15) !== 1) throw new Error("CIP-113 discovery supports mainnet addresses only");
  const kind = data[0] >> 4;
  if ((kind !== 0 || data.length !== 57) && (kind !== 6 || data.length !== 29)) {
    throw new Error("CIP-113 discovery requires a key-owned base or enterprise address");
  }
  const candidates = [["payment-key", data.slice(1, 29)]];
  if (kind === 0) candidates.push(["stake-key", data.slice(29, 57)]);
  const seen = /* @__PURE__ */ new Set();
  return candidates.flatMap(([credentialSource, credential2]) => {
    const receive = address(17, CIP113_MAINNET.baseScript, credential2);
    if (seen.has(receive)) return [];
    seen.add(receive);
    return [{ address: receive, credentialSource, credentialHash: hex(credential2) }];
  });
}
function object(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("Invalid CIP-113 provider object");
  return v;
}
function list(v) {
  if (!Array.isArray(v)) throw new Error("Invalid CIP-113 provider list");
  return v;
}
function string(v) {
  if (typeof v !== "string") throw new Error("Invalid CIP-113 provider string");
  return v;
}
function integer(v) {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new Error("Invalid CIP-113 provider integer");
  return v;
}
function quantity(v) {
  const s = string(v);
  if (!/^\d{1,78}$/.test(s)) throw new Error("Invalid CIP-113 asset quantity");
  return BigInt(s);
}
function ref(row) {
  const hash = string(row.tx_hash);
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error("Invalid CIP-113 output reference");
  return `${hash}#${integer(row.tx_index)}`;
}
function credential(d) {
  const fields = asConstr(d, "credential", void 0, 1);
  if (d.kind !== "constr" || d.index !== 0 && d.index !== 1) throw new Error("Unsupported CIP-113 credential");
  const hash = hex(asBytes(fields[0], "credential hash"));
  if (hash.length !== 56 && !(d.index === 0 && hash === "")) throw new Error("Invalid CIP-113 credential hash");
  return { type: d.index === 0 ? "key" : "script", hash };
}
function datum(row) {
  const raw = bytes(string(object(row.inline_datum).bytes));
  if (hex(blake2b2(raw, { dkLen: 32 })) !== row.datum_hash) throw new Error("CIP-113 datum hash does not match its bytes");
  return decodePlutusData(raw);
}
function hasMarker(row, policy, name) {
  const markers = list(row.asset_list).map(object).filter((a) => a.policy_id === policy);
  return markers.length === 1 && markers[0].asset_name === name && quantity(markers[0].quantity) === 1n;
}
function decodeCip113Protocol(rows) {
  const candidates = list(rows).map(object).filter((r) => hasMarker(r, CIP113_MAINNET.paramsPolicy, CIP113_MAINNET.paramsName));
  if (candidates.length !== 1) throw new Error("The canonical CIP-113 protocol parameters are missing or ambiguous");
  const row = candidates[0];
  if (row.address !== PARAMS_ADDRESS || row.is_spent !== false) throw new Error("Invalid CIP-113 protocol parameter custody");
  const fields = asConstr(datum(row), "protocol params", 0, 6);
  const current = fields.slice(0, 5).map(credential);
  if (current.some((c) => c.hash.length !== 56)) throw new Error("Invalid CIP-113 protocol wiring");
  const pending = asConstr(fields[5], "pending authority");
  const pendingIndex = fields[5].kind === "constr" ? fields[5].index : -1;
  if (!(pendingIndex === 1 && pending.length === 0 || pendingIndex === 0 && pending.length === 1)) throw new Error("Invalid CIP-113 authority nomination");
  const nominee = pendingIndex === 0 ? credential(pending[0]) : null;
  if (nominee && nominee.hash.length !== 56) throw new Error("Invalid CIP-113 pending authority");
  return {
    outputReference: ref(row),
    dispatcher: current[0],
    issuance: current[1],
    transferDelegate: current[2],
    thirdPartyDelegate: current[3],
    upgradeAuthority: current[4],
    pendingUpgradeAuthority: nominee,
    matchesPublishedWiring: [CIP113_MAINNET.dispatcher, CIP113_MAINNET.issuance, CIP113_MAINNET.transfer, CIP113_MAINNET.thirdParty, CIP113_MAINNET.upgrade].every((expected, i) => current[i].type === "script" && current[i].hash === expected)
  };
}
function decodeCip113Registry(rows) {
  const nodes = /* @__PURE__ */ new Map();
  for (const row of list(rows).map(object)) {
    if (row.address !== CIP113_REGISTRY_ADDRESS || row.is_spent !== false) throw new Error("Invalid CIP-113 registry custody");
    const assets = list(row.asset_list).map(object);
    if (!assets.some((a) => a.policy_id === CIP113_MAINNET.registryPolicy)) continue;
    const f = asConstr(datum(row), "registry node", 0, 7);
    const key = hex(asBytes(f[0], "registry key"));
    const next = hex(asBytes(f[1], "next registry key"));
    if (key !== "" && key.length !== 56 || next.length !== 56 && next !== SENTINEL || !hasMarker(row, CIP113_MAINNET.registryPolicy, key) || nodes.has(key) || next <= key) throw new Error("Invalid CIP-113 registry NFT or ordering");
    const global = hex(asBytes(f[6], "global state policy"));
    if (global !== "" && global.length !== 56) throw new Error("Invalid CIP-113 global state policy");
    nodes.set(key, { next, proof: {
      outputReference: ref(row),
      policyId: key,
      minting: credential(f[2]),
      transfer: credential(f[3]),
      thirdParty: credential(f[4]),
      unfracking: credential(f[5]),
      globalStatePolicy: global || null
    } });
  }
  let cursor = "";
  const visited = /* @__PURE__ */ new Set();
  while (cursor !== SENTINEL) {
    const node = nodes.get(cursor);
    if (!node || visited.has(cursor)) throw new Error("The CIP-113 registry response is incomplete");
    visited.add(cursor);
    cursor = node.next;
  }
  if (visited.size !== nodes.size) throw new Error("The CIP-113 registry has disconnected entries");
  const origin = nodes.get("").proof;
  if ([origin.minting, origin.transfer, origin.thirdParty, origin.unfracking].some((c) => c.type !== "key" || c.hash !== "") || origin.globalStatePolicy !== null) throw new Error("Invalid CIP-113 origin node");
  nodes.delete("");
  return new Map(Array.from(nodes, ([key, value]) => [key, value.proof]));
}
function collectCip113Holdings(rows, owners, registry, protocol, checkedAt) {
  const addresses = new Set(owners.map((o) => o.address));
  const seen = /* @__PURE__ */ new Set();
  const balances = /* @__PURE__ */ new Map();
  for (const row of list(rows).map(object)) {
    if (!addresses.has(string(row.address)) || row.payment_cred !== CIP113_MAINNET.baseScript || row.is_spent !== false) throw new Error("CIP-113 holding ownership does not match the requested account");
    const outputReference = ref(row);
    if (seen.has(outputReference)) throw new Error("Duplicate CIP-113 holding output");
    seen.add(outputReference);
    const units = /* @__PURE__ */ new Set();
    for (const asset of list(row.asset_list).map(object)) {
      const policy = string(asset.policy_id), name = string(asset.asset_name);
      if (!/^[0-9a-f]{56}$/.test(policy) || !/^(?:[0-9a-f]{2}){0,32}$/.test(name)) throw new Error("Invalid CIP-113 asset identity");
      const amount = quantity(asset.quantity);
      const unit = policy + name;
      if (units.has(unit)) throw new Error("Duplicate CIP-113 asset entry");
      units.add(unit);
      if (!registry.has(policy) || amount === 0n) continue;
      balances.set(unit, (balances.get(unit) ?? 0n) + amount);
    }
  }
  return Array.from(balances, ([unit, balance]) => ({ unit, rawBalance: balance.toString(), details: {
    deploymentId: CIP113_MAINNET.deploymentId,
    network: "mainnet",
    checkedAt,
    holdingAddresses: owners,
    registry: registry.get(unit.slice(0, 56)),
    protocol,
    availableRawBalance: null,
    restrictions: { state: "unknown", reason: protocol.matchesPublishedWiring ? "Token-specific transfer rules and third-party powers have not been verified." : "The live protocol wiring differs from the published release." },
    history: { state: "unknown", reason: "Recent token balance changes have not been loaded." }
  } }));
}
function cip113HistoryEvents(rows, unit, owners) {
  const addresses = new Set(owners.map((o) => o.address));
  const seen = /* @__PURE__ */ new Set();
  return list(rows).map(object).flatMap((row) => {
    const txHash = string(row.tx_hash);
    if (!/^[0-9a-f]{64}$/.test(txHash) || seen.has(txHash)) throw new Error("Invalid or duplicate CIP-113 history transaction");
    seen.add(txHash);
    if (row.valid_contract === false) return [];
    if (row.valid_contract !== true) throw new Error("CIP-113 history transaction outcome is unverified");
    const amount = (outputs) => {
      const refs = /* @__PURE__ */ new Set();
      return list(outputs).map(object).reduce((sum, out) => {
        if (!addresses.has(string(object(out.payment_addr).bech32))) return sum;
        const reference = ref(out);
        if (refs.has(reference)) throw new Error("Duplicate CIP-113 history output");
        refs.add(reference);
        const units = /* @__PURE__ */ new Set();
        return sum + list(out.asset_list).map(object).reduce((n, asset) => {
          const assetUnit = string(asset.policy_id) + string(asset.asset_name);
          if (units.has(assetUnit)) throw new Error("Duplicate CIP-113 history asset");
          units.add(assetUnit);
          return assetUnit === unit ? n + quantity(asset.quantity) : n;
        }, 0n);
      }, 0n);
    };
    const incoming = amount(row.outputs), outgoing = amount(row.inputs);
    if (incoming === 0n && outgoing === 0n) return [];
    const net = incoming - outgoing;
    return [{
      txHash,
      blockHeight: integer(row.block_height),
      timestamp: integer(row.tx_timestamp),
      netRawQuantity: net.toString(),
      change: net > 0n ? "increase" : net < 0n ? "decrease" : "unchanged",
      trigger: "unknown"
    }];
  }).sort((a, b) => b.blockHeight - a.blockHeight || b.txHash.localeCompare(a.txHash));
}
var cip113KoiosRead = async (path, body) => {
  if (!/^(?:address_utxos\?limit=1000&offset=\d+|asset_utxos|address_txs\?order=block_height.desc&limit=20|tx_info|tx_cbor)$/.test(path)) throw new Error("Unsupported CIP-113 read endpoint");
  const response = await fetch(`${KOIOS}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12e3)
  });
  if (!response.ok) throw new Error(`CIP-113 provider unavailable (${response.status})`);
  const text = await response.text();
  if (text.length > 4e6) throw new Error("CIP-113 provider response is too large");
  return JSON.parse(text);
};
async function utxos(read, addresses) {
  const result = [];
  for (let page = 0; page < 10; page++) {
    const rows = list(await read(`address_utxos?limit=1000&offset=${page * 1e3}`, { _addresses: addresses, _extended: true }));
    if (rows.length > 1e3) throw new Error("CIP-113 pagination exceeded its requested page size");
    result.push(...rows);
    if (rows.length < 1e3) return result;
  }
  throw new Error("CIP-113 discovery exceeded its scan limit; holdings may be incomplete");
}
async function discoverCip113Holdings(walletAddress, read = cip113KoiosRead) {
  const checkedAt = Date.now();
  try {
    const owners = deriveCip113OwnerAddresses(walletAddress);
    const [registryRows, paramsRows, ownedRows] = await Promise.all([
      utxos(read, [CIP113_REGISTRY_ADDRESS]),
      read("asset_utxos", { _asset_list: [[CIP113_MAINNET.paramsPolicy, CIP113_MAINNET.paramsName]], _extended: true }),
      utxos(read, owners.map((o) => o.address))
    ]);
    const registry = decodeCip113Registry(registryRows), protocol = decodeCip113Protocol(paramsRows);
    const holdings = collectCip113Holdings(ownedRows, owners, registry, protocol, checkedAt);
    if (holdings.length) {
      try {
        const history = list(await read("address_txs?order=block_height.desc&limit=20", { _addresses: owners.map((o) => o.address), _after_block_height: 0 }));
        if (!history.length) throw new Error("CIP-113 history is unavailable for known held outputs");
        const hashes = Array.from(new Set(history.map((v) => string(object(v).tx_hash)))).slice(0, 20);
        if (hashes.some((h) => !/^[0-9a-f]{64}$/.test(h))) throw new Error("Invalid CIP-113 history reference");
        const [transactions, statuses] = await Promise.all([
          read("tx_info", { _tx_hashes: hashes, _inputs: true, _assets: true }),
          read("tx_cbor", { _tx_hashes: hashes })
        ]);
        if (list(transactions).length !== hashes.length || list(transactions).some((t) => !hashes.includes(string(object(t).tx_hash)))) throw new Error("Incomplete CIP-113 history transaction response");
        const outcomes = /* @__PURE__ */ new Map();
        for (const status of list(statuses).map(object)) {
          const hash = string(status.tx_hash);
          if (!hashes.includes(hash) || outcomes.has(hash) || typeof status.valid_contract !== "boolean") throw new Error("Invalid CIP-113 history outcome");
          outcomes.set(hash, status.valid_contract);
        }
        if (outcomes.size !== hashes.length) throw new Error("Incomplete CIP-113 history outcomes");
        const checkedTransactions = list(transactions).map(object).map((row) => ({ ...row, valid_contract: outcomes.get(string(row.tx_hash)) }));
        for (const holding of holdings) holding.details.history = {
          state: "ready",
          checkedAt,
          value: { scope: "token", coverage: "recent", events: cip113HistoryEvents(checkedTransactions, holding.unit, owners) }
        };
      } catch {
        for (const holding of holdings) holding.details.history = { state: "error", reason: "Could not load recent programmable-token balance changes." };
      }
    }
    return { holdings, registryPolicies: Array.from(registry.keys()), checkedAt, error: null };
  } catch (error) {
    return { holdings: [], registryPolicies: [], checkedAt, error: error instanceof Error ? error.message : "CIP-113 discovery failed" };
  }
}
var snapshots = /* @__PURE__ */ new Map();
function cachedCip113Holdings(walletAddress) {
  const held = snapshots.get(walletAddress);
  if (held && held.expiresAt > Date.now()) return held.promise;
  if (snapshots.size >= 32) snapshots.delete(snapshots.keys().next().value);
  const promise = discoverCip113Holdings(walletAddress);
  snapshots.set(walletAddress, { promise, expiresAt: Infinity });
  void promise.then((result) => {
    const entry = snapshots.get(walletAddress);
    if (entry?.promise !== promise) return;
    if (result.error) snapshots.delete(walletAddress);
    else entry.expiresAt = Date.now() + 5e3;
  });
  return promise;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  CIP113_MAINNET,
  CIP113_REGISTRY_ADDRESS,
  cachedCip113Holdings,
  cip113HistoryEvents,
  cip113KoiosRead,
  collectCip113Holdings,
  decodeCip113Protocol,
  decodeCip113Registry,
  deriveCip113OwnerAddresses,
  discoverCip113Holdings
});
/*! Bundled license information:

@scure/base/lib/esm/index.js:
  (*! scure-base - MIT License (c) 2022 Paul Miller (paulmillr.com) *)

@noble/hashes/esm/utils.js:
  (*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) *)
*/
