

# Fix: QR Code Canvas Not Rendering

## Problem
The source code correctly imports `qrcode` and calls `QRCode.toCanvas()`, but the QR code appears blank in the browser. Two issues:

1. **CSS size conflict**: The canvas has `className="w-48 h-48"` (192x192px via CSS) while `QRCode.toCanvas` sets the canvas's intrinsic dimensions to 200x200. This mismatch can cause blank or distorted rendering in some browsers.
2. **Possible stale build**: The preview may still be serving a cached version with the old placeholder code.

## Solution

**File: `src/components/emulator/QRCodeModal.tsx`**

**Line 73** -- Remove the fixed Tailwind size classes from the canvas element. Let the `qrcode` library control the canvas dimensions natively:

```
Before:  <canvas ref={canvasRef} className="w-48 h-48" />
After:   <canvas ref={canvasRef} />
```

This ensures the `qrcode` library's `width: 200` option directly controls the canvas size without CSS interference.

No other changes needed -- the rest of the implementation (import, toCanvas call, error handling) is already correct.

