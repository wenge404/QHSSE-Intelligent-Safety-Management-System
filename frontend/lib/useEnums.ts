'use client';

import { useEffect, useState } from 'react';
import { api } from './api';

export type EnumMap = Record<string, Record<string, string>>;

export interface WorkflowDescriptor {
  incident: { transitions: Record<string, string[]>; roles: Record<string, string[]> };
  correctiveAction: { transitions: Record<string, string[]> };
  audit: { transitions: Record<string, string[]> };
}

let enumCache: EnumMap | null = null;
let workflowCache: WorkflowDescriptor | null = null;

/**
 * Dropdown options come from the API, which derives them from the Prisma
 * schema. Hard-coding the option lists in the frontend would mean the
 * vocabulary lives in three places (schema, model, UI) and drifts in two of
 * them.
 */
export function useEnums() {
  const [enums, setEnums] = useState<EnumMap | null>(enumCache);
  const [workflow, setWorkflow] = useState<WorkflowDescriptor | null>(workflowCache);

  useEffect(() => {
    if (!enumCache) {
      api<EnumMap>('/api/v1/meta/enums')
        .then((data) => {
          enumCache = data;
          setEnums(data);
        })
        .catch(() => setEnums({}));
    }
    if (!workflowCache) {
      api<WorkflowDescriptor>('/api/v1/meta/workflow')
        .then((data) => {
          workflowCache = data;
          setWorkflow(data);
        })
        .catch(() => undefined);
    }
  }, []);

  return { enums, workflow };
}

export function optionsOf(enums: EnumMap | null, name: string): string[] {
  if (!enums?.[name]) return [];
  return Object.values(enums[name]);
}
