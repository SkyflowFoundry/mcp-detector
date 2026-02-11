import type { DetectionMode } from "@/lib/hooks/useDetection";

interface ModeSelectorProps {
  mode: DetectionMode;
  onChange: (mode: DetectionMode) => void;
  disabled?: boolean;
}

const MODE_CONFIG: {
  value: DetectionMode;
  label: string;
  description: string;
  color: string;
  activeColor: string;
}[] = [
  {
    value: "log",
    label: "Log",
    description: "Detect PII without blocking traffic",
    color: "border-green-300 dark:border-green-700",
    activeColor:
      "border-green-500 bg-green-50 dark:bg-green-950 dark:border-green-500",
  },
  {
    value: "warn",
    label: "Warn",
    description: "Detect and flag with warnings",
    color: "border-amber-300 dark:border-amber-700",
    activeColor:
      "border-amber-500 bg-amber-50 dark:bg-amber-950 dark:border-amber-500",
  },
  {
    value: "error",
    label: "Error",
    description: "Block messages containing PII",
    color: "border-red-300 dark:border-red-700",
    activeColor: "border-red-500 bg-red-50 dark:bg-red-950 dark:border-red-500",
  },
];

const ModeSelector = ({ mode, onChange, disabled }: ModeSelectorProps) => {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">Detection Mode</h4>
      <div className="grid grid-cols-3 gap-2">
        {MODE_CONFIG.map(
          ({ value, label, description, color, activeColor }) => (
            <button
              key={value}
              onClick={() => onChange(value)}
              disabled={disabled}
              className={`
              p-2 rounded-md border text-left transition-colors
              ${mode === value ? activeColor : color}
              ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:opacity-80"}
            `}
            >
              <div className="text-xs font-semibold">{label}</div>
              <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                {description}
              </div>
            </button>
          ),
        )}
      </div>
    </div>
  );
};

export default ModeSelector;
