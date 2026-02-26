import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff, CheckCircle, XCircle, Loader2 } from "lucide-react";
import type { SkyflowConfig as SkyflowConfigType } from "@/lib/hooks/useDetection";

interface SkyflowConfigProps {
  config: SkyflowConfigType;
  onChange: (config: SkyflowConfigType) => void;
  validationStatus: "unconfigured" | "validating" | "valid" | "invalid";
  validationError: string;
  onValidate: () => void;
}

const SkyflowConfigPanel = ({
  config,
  onChange,
  validationStatus,
  validationError,
  onValidate,
}: SkyflowConfigProps) => {
  const [showToken, setShowToken] = useState(false);

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          Cluster ID
        </label>
        <Input
          placeholder="e.g. abc123"
          value={config.clusterId}
          onChange={(e) => onChange({ ...config, clusterId: e.target.value })}
          className="font-mono text-xs"
          data-testid="skyflow-cluster-id"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          Vault ID
        </label>
        <Input
          placeholder="e.g. v123456789"
          value={config.vaultId}
          onChange={(e) => onChange({ ...config, vaultId: e.target.value })}
          className="font-mono text-xs"
          data-testid="skyflow-vault-id"
        />
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">
          Bearer Token
        </label>
        <div className="flex gap-2">
          <Input
            type={showToken ? "text" : "password"}
            placeholder="Bearer token"
            value={config.bearerToken}
            onChange={(e) =>
              onChange({ ...config, bearerToken: e.target.value })
            }
            className="font-mono text-xs"
            data-testid="skyflow-bearer-token"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-9 w-9 p-0 shrink-0"
            onClick={() => setShowToken(!showToken)}
            aria-label={showToken ? "Hide token" : "Show token"}
          >
            {showToken ? (
              <Eye className="h-4 w-4" />
            ) : (
              <EyeOff className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>

      <Button
        variant="outline"
        size="sm"
        className="w-full"
        onClick={onValidate}
        disabled={
          !config.clusterId ||
          !config.bearerToken ||
          !config.vaultId ||
          validationStatus === "validating"
        }
      >
        {validationStatus === "validating" ? (
          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
        ) : null}
        Test Connection
      </Button>

      {validationStatus === "invalid" && validationError && (
        <p className="text-xs text-red-500">{validationError}</p>
      )}

      <p className="text-xs text-muted-foreground">
        Get credentials at{" "}
        <a
          href="https://docs.skyflow.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-500 hover:underline"
        >
          docs.skyflow.com
        </a>
      </p>
    </div>
  );
};

export function StatusIndicator({
  status,
}: {
  status: "unconfigured" | "validating" | "valid" | "invalid";
}) {
  switch (status) {
    case "valid":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "invalid":
      return <XCircle className="h-4 w-4 text-red-500" />;
    case "validating":
      return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    default:
      return (
        <span className="h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-600" />
      );
  }
}

export default SkyflowConfigPanel;
