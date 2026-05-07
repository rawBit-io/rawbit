import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SelectFieldProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  options: string[];
}

export function SelectField({ value, onChange, label, options }: SelectFieldProps) {
  return (
    <div className="mb-3">
      <div className="mb-1 font-mono text-sm text-primary">{label}</div>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="field-surface h-8 w-full font-mono text-xs">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option} className="font-mono text-xs">
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
