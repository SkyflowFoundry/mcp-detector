import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  SCAN_METHODS_LIST,
  SCAN_METHOD_LABELS,
} from "@/lib/hooks/useDetection";

interface ScanMethodsConfigProps {
  methods: Set<string>;
  onChange: (methods: Set<string>) => void;
  disabled?: boolean;
}

const ScanMethodsConfig = ({
  methods,
  onChange,
  disabled,
}: ScanMethodsConfigProps) => {
  const [expanded, setExpanded] = useState(false);
  const allSelected = methods.size === SCAN_METHODS_LIST.length;

  const toggleMethod = (method: string) => {
    const next = new Set(methods);
    if (next.has(method)) {
      if (next.size > 1) next.delete(method);
    } else {
      next.add(method);
    }
    onChange(next);
  };

  const toggleAll = () => {
    if (allSelected) {
      onChange(new Set([SCAN_METHODS_LIST[0]]));
    } else {
      onChange(new Set(SCAN_METHODS_LIST));
    }
  };

  return (
    <div className="space-y-2">
      <div
        className="flex items-center gap-1 cursor-pointer select-none"
        onClick={() => setExpanded(!expanded)}
        role="button"
        aria-expanded={expanded}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setExpanded(!expanded);
          }
        }}
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
        <h4 className="text-sm font-semibold">Scan Methods</h4>
        <span className="text-xs text-muted-foreground ml-auto">
          {methods.size}/{SCAN_METHODS_LIST.length}
        </span>
      </div>
      {expanded && (
        <div className="space-y-1.5 pl-1">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              disabled={disabled}
            />
            <span className="font-medium">Select All</span>
          </label>
          <div className="border-t pt-1.5 space-y-1">
            {SCAN_METHODS_LIST.map((method) => (
              <label
                key={method}
                className="flex items-center gap-2 text-xs cursor-pointer"
              >
                <Checkbox
                  checked={methods.has(method)}
                  onCheckedChange={() => toggleMethod(method)}
                  disabled={disabled}
                />
                <span>{SCAN_METHOD_LABELS[method]}</span>
                <span className="text-muted-foreground font-mono text-[10px] ml-auto">
                  {method}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default ScanMethodsConfig;
