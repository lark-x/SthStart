import React from 'react';
import {
  BookCheck,
  PenTool,
  Sparkles,
  HelpCircle,
  GitBranch,
  Layers,
  Compass,
  Zap,
  Flag,
  Clock,
  Loader2,
  Check,
  AlertTriangle,
  RefreshCw,
  FileImage,
} from 'lucide-react';
import { Badge } from '@/app/components/ui/badge';
import type {
  SourceNature,
  BranchMode,
  ImagePhase,
  ImageStatus,
} from './types';
import {
  SOURCE_NATURE_CONFIG,
  BRANCH_MODE_CONFIG,
  IMAGE_PHASE_CONFIG,
  IMAGE_STATUS_CONFIG,
} from './reading-utils';

export function SourceNatureBadge({
  nature,
  className,
}: {
  nature: SourceNature;
  className?: string;
}) {
  const cfg = SOURCE_NATURE_CONFIG[nature] || SOURCE_NATURE_CONFIG.unverified;

  const renderIcon = () => {
    switch (nature) {
      case 'canon':
        return <BookCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />;
      case 'author':
        return <PenTool className="w-3 h-3 text-indigo-600 dark:text-indigo-400" />;
      case 'ai':
        return <Sparkles className="w-3 h-3 text-amber-600 dark:text-amber-400" />;
      case 'unverified':
      default:
        return <HelpCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />;
    }
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border font-sans select-none ${cfg.badgeClass} ${className || ''}`}
      title={`${cfg.label}：${cfg.description}`}
    >
      {renderIcon()}
      <span>{cfg.label}</span>
    </span>
  );
}

export function BranchModeBadge({
  mode,
  className,
  showDescription = false,
}: {
  mode: BranchMode;
  className?: string;
  showDescription?: boolean;
}) {
  const cfg = BRANCH_MODE_CONFIG[mode] || BRANCH_MODE_CONFIG['canon-gap'];

  const renderIcon = () => {
    switch (mode) {
      case 'canon-gap':
        return <Sparkles className="w-3.5 h-3.5 text-sky-600 dark:text-sky-400" />;
      case 'adaptation':
        return <GitBranch className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />;
      case 'alternate':
        return <Layers className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />;
      default:
        return <GitBranch className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className={`inline-flex flex-col ${className || ''}`}>
      <span
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border font-sans ${cfg.badgeClass}`}
        title={cfg.description}
      >
        {renderIcon()}
        <span>{cfg.label}</span>
      </span>
      {showDescription && (
        <span className="text-[11px] text-muted font-sans mt-0.5 px-1 leading-snug">
          {cfg.description}
        </span>
      )}
    </div>
  );
}

export function ImagePhaseBadge({
  phase,
  className,
}: {
  phase: ImagePhase;
  className?: string;
}) {
  const cfg = IMAGE_PHASE_CONFIG[phase] || IMAGE_PHASE_CONFIG.establishing;

  const renderIcon = () => {
    switch (phase) {
      case 'establishing':
        return <Compass className="w-3 h-3 text-blue-600 dark:text-blue-400" />;
      case 'action':
        return <Zap className="w-3 h-3 text-amber-600 dark:text-amber-400" />;
      case 'result':
        return <Flag className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />;
      default:
        return <Compass className="w-3 h-3" />;
    }
  };

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border font-sans select-none ${cfg.subtleClass} ${className || ''}`}
      title={`${cfg.label}（第 ${cfg.stepOrder} 幕）：${cfg.description}`}
    >
      {renderIcon()}
      <span>{cfg.label}</span>
    </span>
  );
}

export function ImageStatusBadge({
  status,
  className,
}: {
  status: ImageStatus;
  className?: string;
}) {
  const cfg = IMAGE_STATUS_CONFIG[status] || IMAGE_STATUS_CONFIG.planned;

  const renderIcon = () => {
    switch (status) {
      case 'planned':
        return <FileImage className="w-3 h-3 text-muted" />;
      case 'queued':
        return <Clock className="w-3 h-3 text-warning-fg" />;
      case 'running':
        return <Loader2 className="w-3 h-3 text-success-fg animate-spin" />;
      case 'succeeded':
        return <Check className="w-3 h-3 text-success-fg" />;
      case 'failed':
        return <AlertTriangle className="w-3 h-3 text-danger-fg" />;
      case 'uncertain':
        return <AlertTriangle className="w-3 h-3 text-warning-fg" />;
      case 'stale':
        return <RefreshCw className="w-3 h-3 text-muted" />;
      default:
        return <FileImage className="w-3 h-3" />;
    }
  };

  return (
    <Badge
      variant={cfg.variant}
      className={`gap-1 font-sans text-[11px] ${className || ''}`}
      title={cfg.description}
    >
      {renderIcon()}
      <span>{cfg.label}</span>
    </Badge>
  );
}
