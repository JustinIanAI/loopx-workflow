/**
 * LoopX AI-Native Workflow 核心门禁契约与类型定义
 */

export type GateName = 'typecheck' | 'lint' | 'build' | 'test';

export interface GateExecutionResult {
  gate: GateName;
  command: string;
  exitCode: number;
  durationMs: number;
  stdout: string;
  stderr: string;
  passed: boolean;
  timestamp: string;
}

export interface HardenedGateEvidence {
  feature: string;
  goalId: string;
  timestamp: string;
  allPassed: boolean;
  gates: Record<GateName, GateExecutionResult>;
  typecheckStrictness: {
    compiler: 'tsc';
    noEmit: boolean;
    configFile: string;
    checkedFilesCount: number;
  };
  lintCoverage: {
    shellScriptsCount: number;
    jsFilesAstChecked: number;
    syntaxErrors: number;
  };
  buildHealth: {
    executableBinChecked: boolean;
    depsResolved: boolean;
  };
}
