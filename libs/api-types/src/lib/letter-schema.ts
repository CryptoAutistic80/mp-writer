import { z } from 'zod';

export const letterReferenceSchema = z.object({
  title: z.string().min(1, 'Reference title is required.'),
  source: z.string().min(1, 'Reference source is required.'),
  year: z.string().optional(),
  url: z.string().url().optional(),
});

export const letterActionSchema = z.object({
  label: z.string().min(1),
  description: z.string().optional(),
});

export const letterBodyParagraphSchema = z.object({
  html: z.string().min(1),
});

export const letterSchema = z.object({
  metadata: z.object({
    generatedAtIso: z.string().datetime().optional().nullable(),
    model: z.string().optional().nullable(),
    tone: z.string().optional().nullable(),
    promptHash: z.string().optional().nullable(),
    jobId: z.string().optional(),
  }),
  recipient: z.object({
    name: z.string().min(1),
    role: z.string().optional(),
    constituency: z.string().optional(),
    addressHtml: z.string().optional(),
  }),
  sender: z.object({
    name: z.string().optional(),
    addressHtml: z.string().optional(),
  }),
  salutationHtml: z.string().min(1),
  body: z.object({
    paragraphs: z.array(letterBodyParagraphSchema).min(1),
    actions: z.array(letterActionSchema).optional(),
  }),
  closingHtml: z.string().min(1),
  references: z.array(letterReferenceSchema).max(10).optional(),
});

export type Letter = z.infer<typeof letterSchema>;
export type LetterReference = z.infer<typeof letterReferenceSchema>;
export type LetterAction = z.infer<typeof letterActionSchema>;
export type LetterBodyParagraph = z.infer<typeof letterBodyParagraphSchema>;
