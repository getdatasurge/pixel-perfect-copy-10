import { AlertCircle, CheckCircle, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { ValidationResult, ValidationIssue } from '@/lib/sync-validation';

interface SyncReadinessPanelProps {
  validation: ValidationResult;
}

export default function SyncReadinessPanel({ validation }: SyncReadinessPanelProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  if (validation.isValid && validation.warnings.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400 p-3 rounded-lg border border-green-200 dark:border-green-800">
        <CheckCircle className="h-4 w-4" />
        Ready to sync
      </div>
    );
  }

  const groupBySection = (issues: ValidationIssue[]) => {
    const groups: Record<string, ValidationIssue[]> = { context: [], gateways: [], devices: [] };
    issues.forEach(issue => {
      groups[issue.section].push(issue);
    });
    return groups;
  };

  const errorGroups = groupBySection(validation.blockingErrors);
  const warningGroups = groupBySection(validation.warnings);

  const renderIssueGroup = (title: string, issues: ValidationIssue[], isError: boolean) => {
    if (issues.length === 0) return null;
    return (
      <div className="mt-2">
        <div className="text-xs font-medium text-muted-foreground uppercase mb-1">{title}</div>
        {issues.map((issue, i) => (
          <div
            key={i}
            className={`flex items-start gap-2 text-sm py-1 ${
              isError
                ? 'text-destructive'
                : 'text-yellow-600 dark:text-yellow-400'
            }`}
          >
            {isError ? (
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            )}
            <div>
              <span className="font-medium">{issue.label}:</span> {issue.message}
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div
      className={`p-3 rounded-lg border ${
        validation.isValid
          ? 'bg-yellow-50 border-yellow-200 dark:bg-yellow-950/30 dark:border-yellow-800'
          : 'bg-destructive/10 border-destructive/30'
      }`}
    >
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center justify-between w-full text-left"
      >
        <div className="flex items-center gap-2">
          {validation.isValid ? (
            <AlertTriangle className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
          ) : (
            <AlertCircle className="h-4 w-4 text-destructive" />
          )}
          <span
            className={`text-sm font-medium ${
              validation.isValid
                ? 'text-yellow-700 dark:text-yellow-300'
                : 'text-destructive'
            }`}
          >
            {validation.isValid
              ? `${validation.warnings.length} warning${validation.warnings.length !== 1 ? 's' : ''}`
              : `Fix ${validation.blockingErrors.length} issue${validation.blockingErrors.length !== 1 ? 's' : ''} before syncing`}
          </span>
        </div>
        {isExpanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {isExpanded && (
        <div className="mt-3 border-t border-border pt-3">
          {renderIssueGroup('Context', errorGroups.context, true)}
          {renderIssueGroup('Gateways', errorGroups.gateways, true)}
          {renderIssueGroup('Devices', errorGroups.devices, true)}
          {validation.isValid && renderIssueGroup('Warnings', validation.warnings, false)}
        </div>
      )}
    </div>
  );
}
