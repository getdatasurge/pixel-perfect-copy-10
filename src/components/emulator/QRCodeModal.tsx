import { useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Copy, Download } from 'lucide-react';
import { LoRaWANDevice, buildQRCodeData } from '@/lib/ttn-payload';
import { toast } from '@/hooks/use-toast';
import QRCode from 'qrcode';

interface QRCodeModalProps {
  device: LoRaWANDevice | null;
  open: boolean;
  onClose: () => void;
}

export default function QRCodeModal({ device, open, onClose }: QRCodeModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!device || !open || !canvasRef.current) return;

    const qrData = buildQRCodeData(device);

    QRCode.toCanvas(canvasRef.current, qrData, {
      width: 200,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff',
      },
      errorCorrectionLevel: 'M',
    }).catch((err: Error) => {
      console.error('Failed to generate QR code:', err);
      toast({
        title: 'QR Error',
        description: 'Failed to generate QR code',
        variant: 'destructive',
      });
    });
  }, [device, open]);

  if (!device) return null;

  const qrData = buildQRCodeData(device);

  const copyData = async () => {
    await navigator.clipboard.writeText(qrData);
    toast({ title: 'Copied', description: 'QR data copied to clipboard' });
  };

  const downloadQR = () => {
    if (!canvasRef.current) return;
    const link = document.createElement('a');
    link.download = `${device.name.replace(/\s+/g, '-')}-qr.png`;
    link.href = canvasRef.current.toDataURL('image/png');
    link.click();
    toast({ title: 'Downloaded', description: 'QR code image saved' });
  };

  return (
    <Dialog open={open} onOpenChange={open => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Device QR Code</DialogTitle>
          <DialogDescription>
            Scan this code in your mobile app to claim {device.name}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <div className="bg-white p-4 rounded-lg shadow-inner">
            <canvas ref={canvasRef} />
          </div>
        </div>

        <div className="space-y-3">
          <div className="space-y-1">
            <Label>QR Data (LoRaWAN Alliance Format)</Label>
            <div className="flex gap-2">
              <Input
                value={qrData}
                readOnly
                className="font-mono text-xs"
              />
              <Button variant="outline" size="icon" onClick={copyData}>
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={downloadQR} className="flex-1">
              <Download className="h-4 w-4 mr-2" />
              Download PNG
            </Button>
            <Button onClick={onClose} className="flex-1">
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
