"use client";

import { useMutation } from '@tanstack/react-query';
import {
  generateFollowupsResponseSchema,
  type GenerateFollowupsRequest,
  type GenerateFollowupsResponse,
} from '@mp-writer/api-types';

async function postFollowups(payload: GenerateFollowupsRequest): Promise<GenerateFollowupsResponse> {
  const response = await fetch('/api/ai/followups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error('Follow-up generation failed');
  }

  const data = await response.json();
  return generateFollowupsResponseSchema.parse(data);
}

export function useGenerateFollowups() {
  return useMutation({
    mutationFn: postFollowups,
  });
}
