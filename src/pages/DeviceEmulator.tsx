import { Helmet } from 'react-helmet-async';
import LoRaWANEmulator from '@/components/LoRaWANEmulator';

export default function DeviceEmulator() {
  return (
    <>
      <Helmet>
        <title>LoRaWAN Device Emulator</title>
        <meta name="description" content="Simulate LoRaWAN temperature, humidity, and door sensors for refrigerator and freezer monitoring" />
      </Helmet>
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-4xl mx-auto space-y-6">
          <header className="text-center space-y-2">
            <h1 className="text-3xl font-bold tracking-tight">LoRaWAN Device Emulator</h1>
            <p className="text-muted-foreground">
              Simulate temperature/humidity sensors and door sensors for testing
            </p>
          </header>
          <LoRaWANEmulator />
          <footer className="text-center text-sm text-muted-foreground">
            <p>Data is stored in your database and can be queried via the sensor_readings and door_events tables.</p>
          </footer>
        </div>
      </div>
    </>
  );
}
