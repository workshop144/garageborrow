import { useCallback, useEffect, useRef, useState } from "react";
import Cropper from "react-easy-crop";
import type { Area } from "react-easy-crop";

import type { DonateDraftPhoto } from "../../hooks/useDonate";
import { MAX_PHOTOS, MIN_PHOTOS } from "../../hooks/useDonate";

type Props = {
  photos: DonateDraftPhoto[];
  onChange: (next: DonateDraftPhoto[]) => void;
};

type Pending = {
  fileUrl: string;
  fileType: string;
};

// Square crop helper. Reads the source image, draws the user-selected square
// region into a 1024-edge canvas, returns a JPEG blob. We cap edge size so we
// don't ship 12MP camera shots over the wire.
const CROP_EDGE_PX = 1024;
async function cropToSquareBlob(fileUrl: string, area: Area, fileType: string): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = CROP_EDGE_PX;
      canvas.height = CROP_EDGE_PX;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("canvas-2d not supported"));
        return;
      }
      ctx.drawImage(img, area.x, area.y, area.width, area.height, 0, 0, CROP_EDGE_PX, CROP_EDGE_PX);
      canvas.toBlob(
        (blob) => {
          if (!blob) reject(new Error("toBlob failed"));
          else resolve(blob);
        },
        fileType.startsWith("image/") ? "image/jpeg" : "image/jpeg",
        0.9,
      );
    };
    img.onerror = () => reject(new Error("image load failed"));
    img.src = fileUrl;
  });
}

export function StepPhotos({ photos, onChange }: Props): JSX.Element {
  const [pending, setPending] = useState<Pending | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Revoke the pending object URL if the component unmounts mid-crop.
  useEffect(() => {
    return () => {
      if (pending) URL.revokeObjectURL(pending.fileUrl);
    };
  }, [pending]);

  const onCropComplete = useCallback((_area: Area, areaPx: Area) => {
    setCroppedArea(areaPx);
  }, []);

  function handleFile(file: File): void {
    const url = URL.createObjectURL(file);
    setPending({ fileUrl: url, fileType: file.type });
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
  }

  function pickFile(): void {
    fileInputRef.current?.click();
  }

  async function confirmCrop(): Promise<void> {
    if (!pending || !croppedArea) return;
    const blob = await cropToSquareBlob(pending.fileUrl, croppedArea, pending.fileType);
    const previewUrl = URL.createObjectURL(blob);
    URL.revokeObjectURL(pending.fileUrl);
    setPending(null);
    onChange([...photos, { previewUrl, blob }]);
  }

  function cancelCrop(): void {
    if (pending) URL.revokeObjectURL(pending.fileUrl);
    setPending(null);
  }

  function removePhoto(idx: number): void {
    const removed = photos[idx];
    if (removed) {
      try {
        URL.revokeObjectURL(removed.previewUrl);
      } catch {
        /* ignore */
      }
    }
    onChange(photos.filter((_, i) => i !== idx));
  }

  const atMax = photos.length >= MAX_PHOTOS;

  return (
    <div className="space-y-4" data-testid="donate-step-photos">
      <header>
        <h2 className="font-heading text-2xl">Show us a photo or three</h2>
        <p className="mt-1 text-sm opacity-80">
          Add {MIN_PHOTOS}–{MAX_PHOTOS} photos. A square crop looks best on the pegboard.
        </p>
      </header>

      <div className="grid grid-cols-3 gap-3">
        {photos.map((p, idx) => (
          <div
            key={p.previewUrl}
            className="relative aspect-square overflow-hidden rounded-xl border border-workshop/15 dark:border-surface-light/15"
            data-testid={`donate-photo-${idx}`}
          >
            <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />
            <button
              type="button"
              onClick={() => removePhoto(idx)}
              className="absolute right-1 top-1 rounded-full bg-workshop/85 px-2 py-0.5 text-xs text-surface-light"
              data-testid={`donate-photo-remove-${idx}`}
              aria-label="Remove photo"
            >
              Remove
            </button>
          </div>
        ))}
        {!atMax ? (
          <button
            type="button"
            onClick={pickFile}
            className="flex aspect-square items-center justify-center rounded-xl border-2 border-dashed border-workshop/25 dark:border-surface-light/25 text-sm opacity-80 hover:opacity-100"
            data-testid="donate-photo-add"
          >
            Add a photo
          </button>
        ) : null}
      </div>

      {atMax ? (
        <p className="text-xs opacity-60">That&apos;s the limit — three is plenty.</p>
      ) : null}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
        className="hidden"
        data-testid="donate-photo-file"
      />

      {pending ? (
        <div className="space-y-3" data-testid="donate-photo-cropper">
          <div className="relative h-72 w-full overflow-hidden rounded-xl bg-workshop/10">
            <Cropper
              image={pending.fileUrl}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="rect"
              showGrid={false}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={onCropComplete}
            />
          </div>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={1}
              max={3}
              step={0.05}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="flex-1"
              aria-label="Zoom"
            />
            <button
              type="button"
              onClick={cancelCrop}
              className="rounded-xl border border-workshop/15 dark:border-surface-light/15 px-3 py-2 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void confirmCrop()}
              className="rounded-xl bg-gold-bright px-3 py-2 text-sm font-semibold text-workshop"
              data-testid="donate-photo-crop-confirm"
            >
              Use this crop
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
