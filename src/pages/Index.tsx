// FrostGuard Developer Tools - v1.0
import { Link } from "react-router-dom";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Radio, Link2, ClipboardList, BarChart3 } from "lucide-react";

const Index = () => {
  const features = [
    { icon: Link2, label: "TTN Integration" },
    { icon: ClipboardList, label: "Device Management" },
    { icon: BarChart3, label: "Test Dashboard" },
  ];

  return (
    <div className="min-h-screen bg-background">
      {/* Hero Section */}
      <div className="border-b border-border bg-card">
        <div className="container mx-auto px-4 py-16 text-center">
          <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
            FrostGuard Developer Tools
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Development and testing tools for LoRaWAN sensor integration, TTN webhook simulation, and multi-tenant data validation.
          </p>
        </div>
      </div>

      {/* Feature Card */}
      <div className="container mx-auto px-4 py-12">
        <Link to="/device-emulator">
          <Card className="max-w-md mx-auto hover:border-primary hover:shadow-lg transition-all duration-200 cursor-pointer">
            <CardHeader className="space-y-4">
              <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                <Radio className="w-6 h-6 text-primary" />
              </div>
              <div>
                <CardTitle className="text-lg">Device Emulator</CardTitle>
                <CardDescription className="mt-2">
                  Simulate LoRaWAN sensors, configure TTN webhooks, and test multi-tenant data flow
                </CardDescription>
              </div>
              <div className="pt-2 border-t border-border">
                <p className="text-xs text-muted-foreground mb-2">Includes:</p>
                <div className="flex flex-wrap gap-2">
                  {features.map((feature) => {
                    const Icon = feature.icon;
                    return (
                      <span key={feature.label} className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <Icon className="w-3 h-3" />
                        {feature.label}
                      </span>
                    );
                  })}
                </div>
              </div>
            </CardHeader>
          </Card>
        </Link>
      </div>

      {/* Footer */}
      <div className="border-t border-border mt-auto">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          FrostGuard LoRaWAN Development Suite
        </div>
      </div>
    </div>
  );
};

export default Index;
