"use client";

import { useMutation } from '@tanstack/react-query';
import {
  transformLetterRequestSchema,
  transformLetterResponseSchema,
  type TransformLetterRequest,
  type TransformLetterResponse,
} from '@mp-writer/api-types';

async function postTransform(payload: TransformLetterRequest): Promise<TransformLetterResponse> {
  const validated = transformLetterRequestSchema.parse(payload);
  const response = await fetch('/api/ai/transform', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(validated),
  });

  if (!response.ok) {
    throw new Error('Letter transformation failed');
  }

  const data = await response.json();
  return transformLetterResponseSchema.parse(data);
}

export function useTransformLetter() {
  return useMutation({
    mutationFn: postTransform,
  });
}
