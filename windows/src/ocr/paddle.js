// Separate experimental engine. No remote model fetch and no silent fallback.
export const PADDLE_EXPERIMENTAL = true;
export class PaddleOCRService {
  constructor(progress = () => {}) {
    this.progress = progress;
    this.engine = "paddle";
    this.pending = new Map();
    this.sequence = 0;
  }
  async request(message, transfers = [], timeout = 60000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error("Paddle OCR 시간 한도 초과"));
        void this.close();
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.worker.postMessage({ ...message, id }, transfers);
    });
  }
  async init() {
    if (this.initialized) return;
    const p = window.CM_PADDLE;
    if (!p?.rec || !p?.det)
      throw Error("실험용 로컬 Paddle 모델이 포함되지 않았습니다.");
    const decode = (b) =>
      Uint8Array.from(atob(b), (c) => c.charCodeAt(0)).buffer;
    this.url = URL.createObjectURL(
      new Blob([p.workerSource], { type: "application/javascript" }),
    );
    this.worker = new Worker(this.url);
    this.worker.onmessage = ({ data }) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(data.id);
      if (data.error) pending.reject(Error(data.error));
      else pending.resolve(data.result);
    };
    this.worker.onerror = (e) => {
      this.progress(e.message, 0);
      this.close();
    };
    const wasm = decode(p.wasm),
      det = decode(p.det),
      rec = decode(p.rec);
    await this.request(
      {
        type: "init",
        wasm,
        det,
        rec,
        dictionary: p.dictionary,
        runtimeModule: p.runtimeModule,
      },
      [wasm, det, rec],
    );
    this.initialized = true;
  }
  async recognize(canvas, { psm = 3, timeout = 30000 } = {}) {
    await this.init();
    this.progress("PaddleOCR 실험 인식", 0);
    const rgba = canvas
      .getContext("2d")
      .getImageData(0, 0, canvas.width, canvas.height).data.buffer;
    const result = await this.request(
      {
        type: "recognize",
        rgba,
        width: canvas.width,
        height: canvas.height,
        psm,
      },
      [rgba],
      timeout,
    );
    if (!result.text.trim())
      throw Error("PaddleOCR에서 텍스트를 읽지 못했습니다.");
    return result;
  }
  async close() {
    this.worker?.terminate();
    if (this.url) URL.revokeObjectURL(this.url);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(Error("Paddle OCR 종료됨"));
    }
    this.pending.clear();
    this.worker = null;
    this.url = null;
    this.initialized = false;
  }
}
