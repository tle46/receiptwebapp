import { useEffect, useRef, useState } from "react";
import { Camera, Check, ImagePlus, RotateCw, Trash2, X } from "lucide-react";
import { createWorker, PSM, type Worker } from "tesseract.js";
import { mergePhotoText, parseReceipt, type ScanResult } from "./ocr";
import { money } from "./api";
import { round } from "./allocation";

type Photo = {
  id: string;
  url: string;
  name: string;
  rotation: number;
  top: number;
  bottom: number;
  text: string;
  confidence: number | null;
};
export default function ReceiptScanner({
  close,
  apply,
  currency,
}: {
  close: () => void;
  apply: (result: ScanResult) => void;
  currency: string;
}) {
  const [photos, setPhotos] = useState<Photo[]>([]),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null),
    [confirmed, setConfirmed] = useState(false);
  const worker = useRef<Worker | null>(null),
    urls = useRef<string[]>([]),
    cancelled = useRef(false);
  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      void worker.current?.terminate();
      urls.current.forEach(URL.revokeObjectURL);
    };
  }, []);
  function update(id: string, patch: Partial<Photo>) {
    setPhotos((p) =>
      p.map((photo) => (photo.id === id ? { ...photo, ...patch } : photo)),
    );
    setResult(null);
    setConfirmed(false);
  }
  async function add(files: FileList | null) {
    if (!files) return;
    setError("");
    const next: Photo[] = [];
    for (const file of Array.from(files)) {
      if (photos.length + next.length >= 12) {
        setError("Use up to 12 photos per receipt.");
        break;
      }
      if (!/^image\/(jpeg|png|webp|bmp|gif)$/.test(file.type)) {
        setError(
          "Use JPG, PNG, WebP, BMP, or GIF images. Export HEIC photos as JPG first.",
        );
        continue;
      }
      if (file.size > 25 * 1024 * 1024) {
        setError("Each photo must be smaller than 25 MB.");
        continue;
      }
      const url = URL.createObjectURL(file);
      urls.current.push(url);
      next.push({
        id: crypto.randomUUID(),
        url,
        name: file.name,
        rotation: 0,
        top: 0,
        bottom: 100,
        text: "",
        confidence: null,
      });
    }
    setPhotos((p) => [...p, ...next]);
    setResult(null);
    setConfirmed(false);
  }
  async function prepare(photo: Photo, contrast: boolean) {
    const image = new Image();
    image.src = photo.url;
    await image.decode();
    const rotated = document.createElement("canvas");
    const sideways = photo.rotation % 180 !== 0;
    rotated.width = sideways ? image.height : image.width;
    rotated.height = sideways ? image.width : image.height;
    const rc = rotated.getContext("2d")!;
    rc.translate(rotated.width / 2, rotated.height / 2);
    rc.rotate((photo.rotation * Math.PI) / 180);
    rc.drawImage(image, -image.width / 2, -image.height / 2);
    const start = (rotated.height * photo.top) / 100,
      height = (rotated.height * (photo.bottom - photo.top)) / 100;
    const scale = Math.min(2, 2200 / rotated.width, 7000 / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(rotated.width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.filter = contrast ? "grayscale(1) contrast(1.35)" : "grayscale(1)";
    ctx.drawImage(
      rotated,
      0,
      start,
      rotated.width,
      height,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    return canvas;
  }
  async function read() {
    setBusy(true);
    setError("");
    setConfirmed(false);
    setProgress("Loading receipt reader…");
    try {
      if (!worker.current)
        worker.current = await createWorker("eng", 1, {
          workerPath: "/ocr/worker.min.js",
          corePath: "/ocr/core",
          langPath: "/ocr/lang",
          gzip: false,
          cachePath: "gather-english-best-v1",
          logger: (m) => {
            if (!cancelled.current && m.status === "recognizing text")
              setProgress(`Reading text… ${Math.round(m.progress * 100)}%`);
            else if (!cancelled.current)
              setProgress(`${m.status}… ${Math.round(m.progress * 100)}%`);
          },
        });
      if (cancelled.current) {
        await worker.current.terminate();
        worker.current = null;
        return;
      }
      await worker.current.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
        preserve_interword_spaces: "1",
        user_defined_dpi: "300",
      });
      const updated: Photo[] = [];
      for (const [i, photo] of photos.entries()) {
        if (cancelled.current) return;
        setProgress(`Reading photo ${i + 1} of ${photos.length}…`);
        if (photo.text) {
          updated.push(photo);
          continue;
        }
        let { data } = await worker.current.recognize(
          await prepare(photo, false),
          { rotateAuto: true },
        );
        if (data.confidence < 85) {
          setProgress(`Improving photo ${i + 1}…`);
          await worker.current.setParameters({
            tessedit_pageseg_mode: PSM.AUTO,
          });
          const second = await worker.current.recognize(
            await prepare(photo, true),
            { rotateAuto: true },
          );
          if (second.data.confidence > data.confidence) data = second.data;
          await worker.current.setParameters({
            tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
          });
        }
        updated.push({
          ...photo,
          text: data.text,
          confidence: data.confidence,
        });
      }
      if (!cancelled.current) {
        setPhotos(updated);
        setResult(parseReceipt(mergePhotoText(updated.map((p) => p.text))));
      }
    } catch (e) {
      await worker.current?.terminate();
      worker.current = null;
      if (!cancelled.current)
        setError(
          `Could not read these photos. ${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
      if (!cancelled.current) {
        setBusy(false);
        setProgress("");
      }
    }
  }
  const sum = result
    ? round(
        result.items.reduce((n, i) => n + round(i.quantity * i.unitPrice), 0) +
          result.tax +
          result.fee +
          result.tip -
          result.discount,
      )
    : 0;
  const matches = result?.total != null && Math.abs(sum - result.total) < 0.011;
  const patchResult = (patch: Partial<ScanResult>) => {
    setResult((r) => (r ? { ...r, ...patch } : r));
    setConfirmed(false);
  };
  return (
    <div className="modal-backdrop">
      <section
        className="scanner-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scan-title"
      >
        <div className="scanner-heading">
          <div>
            <div className="eyebrow">SNAP. CHECK. SPLIT.</div>
            <h2 id="scan-title">Scan your receipt</h2>
          </div>
          <button aria-label="Close scanner" onClick={close}>
            <X size={20} />
          </button>
        </div>
        <p>
          Photograph the top, then the items, then the total. Add close-ups for
          long receipts, keeping a few overlapping lines between photos.
        </p>
        <div className="scan-actions">
          <label className={`upload-button primary ${busy ? "disabled" : ""}`}>
            <Camera size={18} />
            Take a photo
            <input
              aria-label="Take receipt photo"
              type="file"
              accept="image/*"
              capture="environment"
              disabled={busy}
              onChange={(e) => {
                void add(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
          <label className="upload-button">
            <ImagePlus size={18} />
            Choose photos
            <input
              aria-label="Choose receipt photos"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/bmp,image/gif"
              multiple
              disabled={busy}
              onChange={(e) => {
                void add(e.target.files);
                e.target.value = "";
              }}
            />
          </label>
        </div>
        <small>
          Photos are processed on this device. Use bright, even light, a flat
          receipt, and sharp, upright photos. English text is supported.
        </small>
        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}
        <div className="scan-photos">
          {photos.map((photo, index) => (
            <div className="scan-photo" key={photo.id}>
              <div className="photo-preview">
                <img
                  src={photo.url}
                  alt={`Receipt photo ${index + 1}`}
                  style={{ transform: `rotate(${photo.rotation}deg)` }}
                />
              </div>
              <div className="photo-tools">
                <b>Photo {index + 1}</b>
                <button
                  disabled={busy}
                  aria-label={`Rotate photo ${index + 1}`}
                  onClick={() =>
                    update(photo.id, {
                      rotation: (photo.rotation + 90) % 360,
                      text: "",
                      confidence: null,
                    })
                  }
                >
                  <RotateCw size={14} />
                </button>
                <button
                  disabled={busy}
                  aria-label={`Remove photo ${index + 1}`}
                  onClick={() => {
                    setPhotos((p) => p.filter((a) => a.id !== photo.id));
                    setResult(null);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              </div>
              <details>
                <summary>Crop & recognized text</summary>
                <label>
                  Crop top (%)
                  <input
                    disabled={busy}
                    type="number"
                    min="0"
                    max={photo.bottom - 5}
                    value={photo.top}
                    onChange={(e) =>
                      update(photo.id, {
                        top: Math.min(
                          photo.bottom - 5,
                          Math.max(0, Number(e.target.value)),
                        ),
                        text: "",
                      })
                    }
                  />
                </label>
                <label>
                  Crop bottom (%)
                  <input
                    disabled={busy}
                    type="number"
                    min={photo.top + 5}
                    max="100"
                    value={photo.bottom}
                    onChange={(e) =>
                      update(photo.id, {
                        bottom: Math.max(
                          photo.top + 5,
                          Math.min(100, Number(e.target.value)),
                        ),
                        text: "",
                      })
                    }
                  />
                </label>
                <textarea
                  aria-label={`Recognized text photo ${index + 1}`}
                  value={photo.text}
                  disabled={busy}
                  onChange={(e) => update(photo.id, { text: e.target.value })}
                />
              </details>
              {photo.confidence !== null && (
                <small className={photo.confidence < 80 ? "field-error" : ""}>
                  {photo.confidence < 80
                    ? "Low clarity — retake or carefully check this photo"
                    : "Text read — verify names and prices"}
                </small>
              )}
            </div>
          ))}
        </div>
        {photos.length > 0 && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => void read()}
          >
            {busy ? progress : result ? "Read photos again" : "Read receipt"}
          </button>
        )}
        {busy && (
          <p role="status">
            {progress} · The first scan may take a little longer.
          </p>
        )}
        {result && (
          <div className="scan-review">
            <h3>Check what we captured</h3>
            <div className="capture-checks">
              {[
                ["Store", !!result.merchant],
                ["Date", !!result.date],
                ["Items", result.items.length > 0],
                ["Total", result.total !== null],
              ].map(([label, ok]) => (
                <span key={String(label)} className={ok ? "complete" : ""}>
                  {ok ? <Check size={13} /> : <Camera size={13} />}
                  {label}
                </span>
              ))}
            </div>
            {result.warnings.map((warning, i) => (
              <p className="scan-warning" key={i}>
                {warning}
              </p>
            ))}
            <div className="details-grid">
              <label>
                Store
                <input
                  value={result.merchant}
                  onChange={(e) => patchResult({ merchant: e.target.value })}
                />
              </label>
              <label>
                Purchase date
                <input
                  type="datetime-local"
                  value={result.date}
                  onChange={(e) => patchResult({ date: e.target.value })}
                />
              </label>
              <label>
                Printed total
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={result.total ?? ""}
                  onChange={(e) =>
                    patchResult({
                      total:
                        e.target.value === "" ? null : Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            <div className="scan-item-labels">
              <span>Item</span>
              <span>Qty</span>
              <span>Unit price</span>
            </div>
            {result.items.map((item, i) => (
              <div className="scan-item" key={i}>
                <input
                  aria-label={`Scanned item ${i + 1} name`}
                  value={item.name}
                  onChange={(e) =>
                    patchResult({
                      items: result.items.map((v, j) =>
                        j === i ? { ...v, name: e.target.value } : v,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`Scanned item ${i + 1} quantity`}
                  type="number"
                  min="0.0001"
                  step="any"
                  value={item.quantity}
                  onChange={(e) =>
                    patchResult({
                      items: result.items.map((v, j) =>
                        j === i
                          ? { ...v, quantity: Number(e.target.value) }
                          : v,
                      ),
                    })
                  }
                />
                <input
                  aria-label={`Scanned item ${i + 1} price`}
                  type="number"
                  step="0.01"
                  min="0"
                  value={item.unitPrice}
                  onChange={(e) =>
                    patchResult({
                      items: result.items.map((v, j) =>
                        j === i
                          ? { ...v, unitPrice: Number(e.target.value) }
                          : v,
                      ),
                    })
                  }
                />
                <button
                  aria-label={`Remove scanned item ${i + 1}`}
                  onClick={() =>
                    patchResult({
                      items: result.items.filter((_, j) => j !== i),
                    })
                  }
                >
                  <X size={14} />
                </button>
              </div>
            ))}
            <button
              onClick={() =>
                patchResult({
                  items: [
                    ...result.items,
                    {
                      name: "",
                      quantity: 1,
                      unitPrice: 0,
                      source: "Manual correction",
                    },
                  ],
                })
              }
            >
              Add missing item
            </button>
            <div className="extras-grid">
              {(["tax", "fee", "tip", "discount"] as const).map((key) => (
                <label key={key}>
                  {key}
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={result[key]}
                    onChange={(e) =>
                      patchResult({ [key]: Number(e.target.value) })
                    }
                  />
                </label>
              ))}
            </div>
            <div className={matches ? "scan-balanced" : "error"}>
              {matches
                ? `Items and adjustments match ${money(sum, currency)}`
                : `Calculated ${money(sum, currency)}${result.total !== null ? ` — printed ${money(result.total, currency)}. Difference ${money(sum - result.total, currency)}.` : ". Printed total is missing."} Add another photo or correct the rows above.`}
            </div>
            <label className="inline">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              I checked the item names, quantities, prices, and any repeated
              lines{!matches ? ", including the total difference" : ""}.
            </label>
            <button
              className="primary"
              disabled={
                !confirmed ||
                !result.items.length ||
                result.items.some(
                  (i) => !i.name.trim() || i.quantity <= 0 || i.unitPrice < 0,
                )
              }
              onClick={() => apply(result)}
            >
              Use {result.items.length} items
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
