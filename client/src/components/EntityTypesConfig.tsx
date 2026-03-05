import { useState, useMemo } from "react";
import { ChevronDown, ChevronRight, Search } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  ENTITY_TYPES_LIST,
  ENTITY_TYPE_LABELS,
  ENTITY_TYPE_CATEGORIES,
} from "@/lib/hooks/useDetection";

interface EntityTypesConfigProps {
  entityTypes: Set<string>;
  onChange: (types: Set<string>) => void;
  disabled?: boolean;
}

const EntityTypesConfig = ({
  entityTypes,
  onChange,
  disabled,
}: EntityTypesConfigProps) => {
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState("");
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(
    new Set(),
  );

  const allSelected = entityTypes.size === ENTITY_TYPES_LIST.length;

  const filteredTypes = useMemo(() => {
    if (!search.trim()) return null; // null = show categorized view
    const query = search.toLowerCase();
    return ENTITY_TYPES_LIST.filter(
      (type) =>
        type.includes(query) ||
        (ENTITY_TYPE_LABELS[type] || "").toLowerCase().includes(query),
    );
  }, [search]);

  const toggleType = (type: string) => {
    const next = new Set(entityTypes);
    if (next.has(type)) {
      if (next.size > 1) next.delete(type);
    } else {
      next.add(type);
    }
    onChange(next);
  };

  const toggleAll = () => {
    if (allSelected) {
      onChange(new Set([ENTITY_TYPES_LIST[0]]));
    } else {
      onChange(new Set(ENTITY_TYPES_LIST));
    }
  };

  const toggleCategory = (category: string) => {
    const types = ENTITY_TYPE_CATEGORIES[category] || [];
    const allInCategorySelected = types.every((t) => entityTypes.has(t));
    const next = new Set(entityTypes);

    if (allInCategorySelected) {
      // Deselect all in category, but keep at least 1 globally
      for (const t of types) {
        if (next.size > 1) next.delete(t);
      }
    } else {
      // Select all in category
      for (const t of types) {
        next.add(t);
      }
    }
    onChange(next);
  };

  const toggleCategoryExpanded = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const getCategoryState = (category: string): "all" | "some" | "none" => {
    const types = ENTITY_TYPE_CATEGORIES[category] || [];
    const selectedCount = types.filter((t) => entityTypes.has(t)).length;
    if (selectedCount === types.length) return "all";
    if (selectedCount > 0) return "some";
    return "none";
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
        <h4 className="text-sm font-semibold">Entity Types</h4>
        <span className="text-xs text-muted-foreground ml-auto">
          {entityTypes.size}/{ENTITY_TYPES_LIST.length}
        </span>
      </div>
      {expanded && (
        <div className="space-y-1.5 pl-1">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
            <Input
              placeholder="Filter entity types..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7 text-xs pl-7"
              disabled={disabled}
            />
          </div>

          {/* Select All */}
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <Checkbox
              checked={allSelected}
              onCheckedChange={toggleAll}
              disabled={disabled}
            />
            <span className="font-medium">Select All</span>
          </label>

          <div className="border-t pt-1.5 max-h-60 overflow-y-auto space-y-0.5">
            {filteredTypes ? (
              // Flat filtered view
              filteredTypes.length === 0 ? (
                <p className="text-xs text-muted-foreground py-1 px-1">
                  No matching entity types
                </p>
              ) : (
                filteredTypes.map((type) => (
                  <label
                    key={type}
                    className="flex items-center gap-2 text-xs cursor-pointer py-0.5"
                  >
                    <Checkbox
                      checked={entityTypes.has(type)}
                      onCheckedChange={() => toggleType(type)}
                      disabled={disabled}
                    />
                    <span>{ENTITY_TYPE_LABELS[type] || type}</span>
                    <span className="text-muted-foreground font-mono text-[10px] ml-auto">
                      {type}
                    </span>
                  </label>
                ))
              )
            ) : (
              // Categorized view
              Object.entries(ENTITY_TYPE_CATEGORIES).map(
                ([category, types]) => {
                  const catState = getCategoryState(category);
                  const catExpanded = expandedCategories.has(category);
                  const selectedCount = types.filter((t) =>
                    entityTypes.has(t),
                  ).length;

                  return (
                    <div key={category}>
                      <div className="flex items-center gap-1.5 py-0.5">
                        <div
                          className="flex items-center gap-1 cursor-pointer select-none flex-1"
                          onClick={() => toggleCategoryExpanded(category)}
                          role="button"
                          aria-expanded={catExpanded}
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              toggleCategoryExpanded(category);
                            }
                          }}
                        >
                          {catExpanded ? (
                            <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-3 w-3 text-muted-foreground" />
                          )}
                          <Checkbox
                            checked={
                              catState === "all"
                                ? true
                                : catState === "some"
                                  ? "indeterminate"
                                  : false
                            }
                            onCheckedChange={() => toggleCategory(category)}
                            onClick={(e) => e.stopPropagation()}
                            disabled={disabled}
                          />
                          <span className="text-xs font-medium">
                            {category}
                          </span>
                          <span className="text-[10px] text-muted-foreground ml-auto">
                            {selectedCount}/{types.length}
                          </span>
                        </div>
                      </div>
                      {catExpanded && (
                        <div className="pl-6 space-y-0.5">
                          {types.map((type) => (
                            <label
                              key={type}
                              className="flex items-center gap-2 text-xs cursor-pointer py-0.5"
                            >
                              <Checkbox
                                checked={entityTypes.has(type)}
                                onCheckedChange={() => toggleType(type)}
                                disabled={disabled}
                              />
                              <span>{ENTITY_TYPE_LABELS[type] || type}</span>
                              <span className="text-muted-foreground font-mono text-[10px] ml-auto">
                                {type}
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                },
              )
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default EntityTypesConfig;
